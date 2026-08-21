// src/bun/secrets.ts, POST /app/secrets/set name validation. Regression test
// for the fix: handleSetSecret used to skip rejectUnsafeName (the guard
// handleTestSecret/handleDeleteSecret both apply), so a name carrying a
// parent-path segment or control characters would have been passed straight
// to secretsManager.set(). Only the REJECTION path is exercised here — a
// rejected name returns before secretsManager.set() ever runs, so this test
// never touches the real ~/.goodvibes/tui/secrets.enc store (SecretsManager's
// constructor is lazy, disk is only touched on an actual get/set/list call).

import { describe, expect, test } from "bun:test";
import { createSecretsRoutes } from "../src/bun/secrets.ts";
import type { AppRouteHandler } from "../src/bun/app-routes.ts";

function makeHandler(): AppRouteHandler {
  return createSecretsRoutes();
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

const CONTROL_CHAR_NAME = `openai${String.fromCharCode(1)}key`;

describe("POST /app/secrets/set name validation", () => {
  test("rejects a name carrying a parent-path segment, same as DELETE/test", async () => {
    const h = makeHandler();
    const res = await call(h, "POST", "/app/secrets/set", { name: "../../etc/passwd", value: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SECRETS_BAD_NAME");
  });

  test("rejects a name carrying a control character, same as DELETE/test", async () => {
    const h = makeHandler();
    const res = await call(h, "POST", "/app/secrets/set", { name: CONTROL_CHAR_NAME, value: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SECRETS_BAD_NAME");
  });

  test("still requires a name before the unsafe-name check runs", async () => {
    const h = makeHandler();
    const res = await call(h, "POST", "/app/secrets/set", { name: "", value: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SECRETS_NAME_REQUIRED");
  });

  test("an ordinary namespacing slash is still allowed through the guard (not rejected as unsafe)", async () => {
    // A bare "/" segment name with no ".." and no control chars must pass
    // rejectUnsafeName — it should fail later for an unrelated reason (no
    // value/link given), never with SECRETS_BAD_NAME.
    const h = makeHandler();
    const res = await call(h, "POST", "/app/secrets/set", { name: "openai/key" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SECRETS_VALUE_REQUIRED");
  });
});
