// /app/local — hooks write validation, context allowlist guard, fetch-preview
// private-address refusal (asserted with no network), and provider filename
// validation. Exercised through the real HTTP handler with the ~/.goodvibes
// base pointed at a temp dir.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalToolsRoutes } from "../src/bun/local-tools.ts";
import type { AppRouteHandler } from "../src/bun/app-routes.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gv-app-local-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeHandler(): AppRouteHandler {
  return createLocalToolsRoutes({ home: join(dir, "gv") });
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

describe("hooks", () => {
  test("GET returns exists:false when the file is absent", async () => {
    const h = makeHandler();
    const res = await call(h, "GET", "/app/local/hooks");
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.content).toBe("");
  });

  test("PUT rejects invalid JSON with a 400 and a parse position", async () => {
    const h = makeHandler();
    const res = await call(h, "PUT", "/app/local/hooks", { content: "{ not json" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOCAL_HOOKS_INVALID_JSON");
    // A parse position should be surfaced for the editor.
    expect(typeof res.body.detail).toBe("string");
  });

  test("PUT rejects a non-object top-level JSON value", async () => {
    const h = makeHandler();
    const res = await call(h, "PUT", "/app/local/hooks", { content: "[1,2,3]" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOCAL_HOOKS_NOT_OBJECT");
  });

  test("PUT writes valid JSON verbatim and GET reads it back", async () => {
    const h = makeHandler();
    const content = JSON.stringify({ hooks: { PreToolUse: [] } }, null, 2);
    const put = await call(h, "PUT", "/app/local/hooks", { content });
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);
    const get = await call(h, "GET", "/app/local/hooks");
    expect(get.body.exists).toBe(true);
    expect(get.body.content).toBe(content);
  });
});

describe("context allowlist", () => {
  test("GET /context lists the well-known files with existence flags", async () => {
    const h = makeHandler();
    const projectDir = join(dir, "project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "CLAUDE.md"), "# hi", "utf8");
    const res = await call(h, "GET", `/app/local/context?dir=${encodeURIComponent(projectDir)}`);
    expect(res.status).toBe(200);
    const claude = res.body.files.find((f: any) => f.name === "CLAUDE.md");
    expect(claude.exists).toBe(true);
    expect(claude.size).toBeGreaterThan(0);
    const agents = res.body.files.find((f: any) => f.name === "AGENTS.md");
    expect(agents.exists).toBe(false);
  });

  test("GET /context/file rejects a basename that is not on the allowlist", async () => {
    const h = makeHandler();
    const secret = join(dir, "secret.txt");
    writeFileSync(secret, "top secret", "utf8");
    const res = await call(h, "GET", `/app/local/context/file?path=${encodeURIComponent(secret)}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("LOCAL_CONTEXT_NOT_ALLOWED");
  });

  test("GET /context/file rejects a traversal path whose basename is not allowlisted", async () => {
    const h = makeHandler();
    const res = await call(
      h,
      "GET",
      `/app/local/context/file?path=${encodeURIComponent("/etc/passwd")}`,
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("LOCAL_CONTEXT_NOT_ALLOWED");
  });

  test("GET /context/file reads an allowlisted file", async () => {
    const h = makeHandler();
    const projectDir = join(dir, "project");
    mkdirSync(projectDir, { recursive: true });
    const p = join(projectDir, "CLAUDE.md");
    writeFileSync(p, "hello context", "utf8");
    const res = await call(h, "GET", `/app/local/context/file?path=${encodeURIComponent(p)}`);
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("hello context");
    expect(res.body.truncated).toBe(false);
  });
});

describe("fetch-preview private-address refusal (no network)", () => {
  const cases = [
    "http://localhost/",
    "http://127.0.0.1/",
    "http://127.1.2.3:8080/x",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://169.254.1.1/",
    "http://[::1]/",
  ];
  for (const url of cases) {
    test(`refuses ${url}`, async () => {
      const h = makeHandler();
      const res = await call(h, "POST", "/app/local/fetch-preview", { url });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LOCAL_FETCH_PRIVATE");
    });
  }

  test("rejects a non-http(s) scheme", async () => {
    const h = makeHandler();
    const res = await call(h, "POST", "/app/local/fetch-preview", { url: "file:///etc/passwd" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOCAL_FETCH_BAD_SCHEME");
  });

  test("rejects a public 172 address that is outside 16-31", async () => {
    const h = makeHandler();
    // 172.15 and 172.32 are public — the refusal must NOT fire for the scheme
    // guard, so this should progress past the private check. We only assert it
    // is NOT a private refusal (a network error is acceptable, but no network
    // is hit in CI, so accept any non-PRIVATE code).
    const res = await call(h, "POST", "/app/local/fetch-preview", { url: "http://172.15.0.1.invalid-tld-xyz/" });
    expect(res.body.code).not.toBe("LOCAL_FETCH_PRIVATE");
  });
});

describe("providers filename validation", () => {
  test("PUT rejects a filename with a path separator", async () => {
    const h = makeHandler();
    const res = await call(h, "PUT", "/app/local/providers/..%2Fescape.json", { json: { a: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOCAL_PROVIDERS_BAD_NAME");
  });

  test("PUT rejects a non-.json filename", async () => {
    const h = makeHandler();
    const res = await call(h, "PUT", "/app/local/providers/evil.txt", { json: { a: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOCAL_PROVIDERS_BAD_NAME");
  });

  test("PUT rejects a body without a json object", async () => {
    const h = makeHandler();
    const res = await call(h, "PUT", "/app/local/providers/openrouter.json", { json: "not-an-object" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOCAL_PROVIDERS_BAD_BODY");
  });

  test("PUT writes, GET lists, DELETE removes a valid provider file", async () => {
    const h = makeHandler();
    const put = await call(h, "PUT", "/app/local/providers/openrouter.json", { json: { baseUrl: "https://x" } });
    expect(put.status).toBe(200);
    expect(existsSync(join(dir, "gv", "tui", "providers", "openrouter.json"))).toBe(true);

    const list = await call(h, "GET", "/app/local/providers");
    expect(list.status).toBe(200);
    const entry = list.body.providers.find((p: any) => p.file === "openrouter.json");
    expect(entry.json.baseUrl).toBe("https://x");

    const del = await call(h, "DELETE", "/app/local/providers/openrouter.json");
    expect(del.status).toBe(200);
    expect(existsSync(join(dir, "gv", "tui", "providers", "openrouter.json"))).toBe(false);
  });

  test("DELETE of a missing file returns 404", async () => {
    const h = makeHandler();
    const del = await call(h, "DELETE", "/app/local/providers/missing.json");
    expect(del.status).toBe(404);
    expect(del.body.code).toBe("LOCAL_PROVIDERS_NOT_FOUND");
  });
});

describe("deps doctor", () => {
  test("GET /deps returns a checks array with id/label/ok/detail", async () => {
    const h = makeHandler();
    const res = await call(h, "GET", "/app/local/deps");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.checks)).toBe(true);
    const git = res.body.checks.find((c: any) => c.id === "git");
    expect(git).toBeDefined();
    expect(typeof git.label).toBe("string");
    // ok is boolean or null; detail is always a string.
    expect(git.ok === true || git.ok === false || git.ok === null).toBe(true);
    expect(typeof git.detail).toBe("string");
  });
});

describe("unknown routes", () => {
  test("unknown subroute returns 404", async () => {
    const h = makeHandler();
    const res = await call(h, "GET", "/app/local/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("LOCAL_ROUTE_NOT_FOUND");
  });

  test("unsupported method returns 405", async () => {
    const h = makeHandler();
    const res = await call(h, "PATCH", "/app/local/hooks");
    expect(res.status).toBe(405);
  });
});
