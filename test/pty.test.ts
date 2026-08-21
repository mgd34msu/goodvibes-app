// src/bun/pty.ts, session-cap fix: a session whose shell exits on its own
// (typing `exit`, not clicking "Close tab") sets alive:false but stays in the
// module-level `sessions` map until an explicit DELETE prunes it. The cap
// check used to count every map entry regardless of `alive`, so a pile of
// already-exited shells could block starting a new terminal even though zero
// shells were actually running. Live integration test (real openpty/setsid,
// no mocking) — spawns real PTY sessions, so it is heavier and slower than
// this repo's other Bun-side route tests; everything it creates is torn down
// in afterAll.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPtyRoutes, MAX_SESSIONS } from "../src/bun/pty.ts";
import type { AppRouteHandler } from "../src/bun/app-routes.ts";

const handler: AppRouteHandler = createPtyRoutes();

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
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

async function createSession(): Promise<{ status: number; body: any }> {
  return call("POST", "/app/pty/sessions");
}

async function waitUntilNotAlive(id: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await call("GET", "/app/pty/sessions");
    const found = (list.body.sessions as any[]).find((s) => s.id === id);
    if (found && found.alive === false) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

const createdIds: string[] = [];
let unsupported = false;

beforeAll(async () => {
  const probe = await createSession();
  // openpty/setsid unavailable on this host — the feature degrades honestly
  // (PTY_UNSUPPORTED, see pty.ts's file header); nothing to test here.
  if (probe.status === 501) {
    unsupported = true;
    return;
  }
  createdIds.push(probe.body.id);
  await call("DELETE", `/app/pty/sessions/${probe.body.id}`);
}, 15_000);

afterAll(async () => {
  await Promise.all(createdIds.map((id) => call("DELETE", `/app/pty/sessions/${id}`).catch(() => undefined)));
});

describe("session-cap counts only live sessions", () => {
  test(
    "a dead (naturally-exited) session does not consume a cap slot",
    async () => {
      if (unsupported) return;

      // 1. A session that exits on its own (not via DELETE) stays in the
      //    list as alive:false — the exact condition the old cap check
      //    mis-treated as still occupying a slot.
      const dead = await createSession();
      expect(dead.status).toBe(201);
      createdIds.push(dead.body.id);
      const input = await call("POST", `/app/pty/sessions/${dead.body.id}/input`, { data: "exit\n" });
      expect(input.status).toBe(204);
      const died = await waitUntilNotAlive(dead.body.id, 5_000);
      expect(died).toBe(true);
      const afterExit = await call("GET", "/app/pty/sessions");
      expect((afterExit.body.sessions as any[]).some((s) => s.id === dead.body.id)).toBe(true);

      // 2. With that dead session still in the map (never DELETEd), fill up
      //    to MAX_SESSIONS - 1 LIVE sessions. Map size is now MAX_SESSIONS
      //    (1 dead + (MAX_SESSIONS - 1) live), but live count is one under
      //    the cap. Pre-fix (`sessions.size >= MAX_SESSIONS`), the next
      //    create would have been refused with 429; the fix must allow it.
      for (let i = 0; i < MAX_SESSIONS - 1; i++) {
        const created = await createSession();
        expect(created.status).toBe(201);
        createdIds.push(created.body.id);
      }

      const oneMore = await createSession();
      expect(oneMore.status).toBe(201);
      createdIds.push(oneMore.body.id);

      // 3. Live count is now exactly MAX_SESSIONS — the cap must still bite.
      const overCap = await createSession();
      expect(overCap.status).toBe(429);
      expect(overCap.body.code).toBe("PTY_LIMIT");
    },
    60_000,
  );
});
