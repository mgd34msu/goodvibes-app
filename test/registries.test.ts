// /app/registries — store round-trip, corrupt-file recovery, documents
// versioning, VIBE file, and the read-only agent import bridge. Exercised
// through the real HTTP handler with the storage root pointed at a temp dir
// (explicit option + one GOODVIBES_APP_HOME env-override case).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistriesRoutes } from "../src/bun/registries/index.ts";
import type { AppRouteHandler } from "../src/bun/app-routes.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gv-app-registries-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeHandler(): AppRouteHandler {
  return createRegistriesRoutes({ appHome: join(dir, "app"), agentRoot: join(dir, "agent") });
}

async function call(
  handler: AppRouteHandler,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const url = new URL(`http://127.0.0.1${path}`);
  const req = new Request(url, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
  const res = await handler(req, url);
  const text = await res.text();
  return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
}

describe("registries CRUD round-trip", () => {
  test("create, list, get, update, delete a routine", async () => {
    const handler = makeHandler();

    const created = await call(handler, "POST", "/app/registries/routines", {
      item: { name: "Morning brief", steps: ["open inbox", "summarize"], enabled: true, startCount: 0, custom: "extra" },
    });
    expect(created.status).toBe(201);
    const item = created.body.item;
    expect(typeof item.id).toBe("string");
    expect(typeof item.createdAt).toBe("string");
    expect(typeof item.updatedAt).toBe("string");
    expect(item.name).toBe("Morning brief");
    expect(item.custom).toBe("extra"); // superset-tolerant

    const list = await call(handler, "GET", "/app/registries/routines");
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);

    const got = await call(handler, "GET", `/app/registries/routines/${item.id}`);
    expect(got.status).toBe(200);
    expect(got.body.item.id).toBe(item.id);

    const updated = await call(handler, "PUT", `/app/registries/routines/${item.id}`, {
      item: { ...item, name: "Evening brief", id: "attempted-id-override", createdAt: "1999-01-01" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.item.name).toBe("Evening brief");
    expect(updated.body.item.id).toBe(item.id); // id preserved
    expect(updated.body.item.createdAt).toBe(item.createdAt); // createdAt preserved

    const deleted = await call(handler, "DELETE", `/app/registries/routines/${item.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });

    const after = await call(handler, "GET", "/app/registries/routines");
    expect(after.body.items).toHaveLength(0);

    const missing = await call(handler, "GET", `/app/registries/routines/${item.id}`);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("REGISTRY_ITEM_NOT_FOUND");
  });

  test("unknown collection is a 404", async () => {
    const handler = makeHandler();
    const res = await call(handler, "GET", "/app/registries/nonsense");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("REGISTRY_UNKNOWN_COLLECTION");
  });

  test("GOODVIBES_APP_HOME env override picks the storage root", async () => {
    const prev = process.env.GOODVIBES_APP_HOME;
    process.env.GOODVIBES_APP_HOME = join(dir, "env-home");
    try {
      const handler = createRegistriesRoutes({ agentRoot: join(dir, "agent") });
      const created = await call(handler, "POST", "/app/registries/notes", { item: { text: "hi" } });
      expect(created.status).toBe(201);
      expect(existsSync(join(dir, "env-home", "registries", "notes.json"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.GOODVIBES_APP_HOME;
      else process.env.GOODVIBES_APP_HOME = prev;
    }
  });
});

describe("corrupt store file recovery", () => {
  test("garbage json is renamed aside and the collection starts clean", async () => {
    const storeDir = join(dir, "app", "registries");
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, "skills.json"), "{ this is not json !!!", "utf8");

    const handler = makeHandler();
    const list = await call(handler, "GET", "/app/registries/skills");
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);

    // A later write must still work and the corrupt original is kept aside.
    const created = await call(handler, "POST", "/app/registries/skills", {
      item: { name: "s", description: "d", body: "b", enabled: true },
    });
    expect(created.status).toBe(201);
    const aside = readdirSync(storeDir).filter((f) => f.startsWith("skills.json.corrupt-"));
    expect(aside.length).toBe(1);
  });
});

describe("documents versioning", () => {
  test("create seeds v1 from content; versions append, bound at 100, update head", async () => {
    const handler = makeHandler();
    const created = await call(handler, "POST", "/app/registries/documents", {
      item: { title: "Spec", content: "first draft" },
    });
    expect(created.status).toBe(201);
    const id = created.body.item.id;
    expect(created.body.item.headVersion).toBe(1);

    const appended = await call(handler, "POST", `/app/registries/documents/${id}/versions`, {
      content: "second draft",
      label: "rev2",
    });
    expect(appended.status).toBe(201);
    expect(appended.body.version.v).toBe(2);

    const versions = await call(handler, "GET", `/app/registries/documents/${id}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.body.versions).toHaveLength(2);
    expect(versions.body.versions[1]).toMatchObject({ v: 2, content: "second draft", label: "rev2" });

    const head = await call(handler, "GET", `/app/registries/documents/${id}`);
    expect(head.body.item.headVersion).toBe(2);
    expect(head.body.item.content).toBe("second draft");

    for (let i = 3; i <= 105; i++) {
      await call(handler, "POST", `/app/registries/documents/${id}/versions`, { content: `draft ${i}` });
    }
    const bounded = await call(handler, "GET", `/app/registries/documents/${id}/versions`);
    expect(bounded.body.versions).toHaveLength(100);
    expect(bounded.body.versions[99].v).toBe(105); // newest kept, oldest dropped
    expect(bounded.body.versions[0].v).toBe(6);
  });
});

describe("VIBE.md", () => {
  test("PUT writes a real file, GET reads it back", async () => {
    const handler = makeHandler();
    const before = await call(handler, "GET", "/app/registries/vibe");
    expect(before.status).toBe(200);
    expect(before.body.exists).toBe(false);
    expect(before.body.content).toBe("");

    const put = await call(handler, "PUT", "/app/registries/vibe", { content: "# Vibe\nbe kind\n" });
    expect(put.status).toBe(200);
    expect(put.body.exists).toBe(true);

    const realPath = join(dir, "app", "VIBE.md");
    expect(readFileSync(realPath, "utf8")).toBe("# Vibe\nbe kind\n"); // REAL file, not a DB

    const after = await call(handler, "GET", "/app/registries/vibe");
    expect(after.body).toEqual({ content: "# Vibe\nbe kind\n", path: realPath, exists: true });
  });
});

describe("agent import bridge", () => {
  function seedAgentStores(): void {
    const agent = join(dir, "agent");
    mkdirSync(join(agent, "routines"), { recursive: true });
    mkdirSync(join(agent, "personas"), { recursive: true });
    mkdirSync(join(agent, "skills"), { recursive: true });
    mkdirSync(join(agent, "notes"), { recursive: true });
    mkdirSync(join(agent, "research"), { recursive: true });
    writeFileSync(
      join(agent, "routines", "routines.json"),
      JSON.stringify({
        version: 1,
        routines: [
          {
            id: "rt-1",
            name: "Daily digest",
            description: "morning routine",
            steps: "check email\nsummarize\n\nsend digest",
            triggers: ["morning"],
            tags: ["daily"],
            requirements: [],
            enabled: true,
            source: "user",
            provenance: "test",
            reviewState: "reviewed",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            startCount: 4,
          },
        ],
      }),
    );
    writeFileSync(
      join(agent, "personas", "personas.json"),
      JSON.stringify({
        version: 1,
        activePersonaId: "p-1",
        personas: [
          { id: "p-1", name: "Coach", description: "supportive", body: "You are a coach.", tags: [], triggers: [] },
          { id: "p-2", name: "Editor", description: "precise", body: "You edit.", tags: [], triggers: [] },
        ],
      }),
    );
    writeFileSync(
      join(agent, "skills", "skills.json"),
      JSON.stringify({
        version: 1,
        skills: [
          { id: "sk-1", name: "triage", description: "triage inbox", procedure: "step A\nstep B", enabled: false, requirements: [{ kind: "command", name: "git" }] },
        ],
      }),
    );
    writeFileSync(
      join(agent, "notes", "notes.json"),
      JSON.stringify({
        version: 1,
        notes: [{ id: "n-1", title: "Idea", body: "ship it", tags: ["t"], reviewState: "reviewed" }],
      }),
    );
    writeFileSync(
      join(agent, "research", "runs.json"),
      JSON.stringify({
        version: 1,
        runs: [
          { id: "rr-1", title: "Bun perf", question: "Is bun fast?", status: "completed", sourceIds: ["src-1"], reportArtifactId: "art-9" },
        ],
      }),
    );
    writeFileSync(
      join(agent, "research", "sources.json"),
      JSON.stringify({
        version: 1,
        sources: [
          { id: "src-1", question: "Is bun fast?", title: "Bun benchmarks", url: "https://bun.sh", summary: "fast", credibility: "high" },
          { id: "src-2", question: "other", title: "unrelated", url: "https://x.test", summary: "n/a" },
        ],
      }),
    );
  }

  test("preview counts + samples map agent shapes to app shapes", async () => {
    seedAgentStores();
    const handler = makeHandler();
    const preview = await call(handler, "POST", "/app/registries/import/preview", { source: "agent" });
    expect(preview.status).toBe(200);
    expect(preview.body.collections).toMatchObject({
      routines: 1,
      personas: 2,
      skills: 1,
      notes: 1,
      "research-runs": 1,
      documents: 0,
      profiles: 0,
    });

    const routine = preview.body.samples.routines[0];
    expect(routine.steps).toEqual(["check email", "summarize", "send digest"]); // string → string[]
    expect(routine.source).toBe("agent-import");
    expect(routine.startCount).toBe(4);

    const personas = preview.body.samples.personas;
    expect(personas[0]).toMatchObject({ prompt: "You are a coach.", active: true });
    expect(personas[1]).toMatchObject({ prompt: "You edit.", active: false });

    expect(preview.body.samples.skills[0]).toMatchObject({ body: "step A\nstep B", enabled: false });
    expect(preview.body.samples.notes[0]).toMatchObject({ text: "Idea\n\nship it", promoted: true });

    const run = preview.body.samples["research-runs"][0];
    expect(run).toMatchObject({ question: "Is bun fast?", status: "completed", reportArtifactId: "art-9" });
    expect(run.findings).toEqual([
      { url: "https://bun.sh", title: "Bun benchmarks", note: "fast", credibility: "high" },
    ]);
  });

  test("apply imports selected collections, is idempotent, never mutates the source", async () => {
    seedAgentStores();
    const routinesRaw = readFileSync(join(dir, "agent", "routines", "routines.json"), "utf8");
    const handler = makeHandler();

    const apply = await call(handler, "POST", "/app/registries/import/apply", {
      source: "agent",
      collections: ["routines", "personas"],
    });
    expect(apply.status).toBe(200);
    expect(apply.body.imported).toEqual({ routines: 1, personas: 2 });

    const routines = await call(handler, "GET", "/app/registries/routines");
    expect(routines.body.items).toHaveLength(1);
    expect(routines.body.items[0].id).toBe("rt-1"); // agent ids preserved for idempotency
    expect(routines.body.items[0].source).toBe("agent-import");

    // Re-apply: nothing new.
    const again = await call(handler, "POST", "/app/registries/import/apply", {
      source: "agent",
      collections: ["routines", "personas"],
    });
    expect(again.body.imported).toEqual({ routines: 0, personas: 0 });

    // Source store byte-identical (never mutated).
    expect(readFileSync(join(dir, "agent", "routines", "routines.json"), "utf8")).toBe(routinesRaw);

    // Unlisted collections untouched.
    const skills = await call(handler, "GET", "/app/registries/skills");
    expect(skills.body.items).toHaveLength(0);
  });

  test("missing agent home previews as all-zero, apply imports nothing", async () => {
    const handler = makeHandler(); // dir/agent never created
    const preview = await call(handler, "POST", "/app/registries/import/preview", { source: "agent" });
    expect(preview.status).toBe(200);
    expect(Object.values(preview.body.collections).every((count) => count === 0)).toBe(true);

    const apply = await call(handler, "POST", "/app/registries/import/apply", {
      source: "agent",
      collections: ["routines"],
    });
    expect(apply.body.imported).toEqual({ routines: 0 });
  });

  test("bad import source is rejected", async () => {
    const handler = makeHandler();
    const res = await call(handler, "POST", "/app/registries/import/preview", { source: "tui" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REGISTRY_IMPORT_SOURCE");
  });
});
