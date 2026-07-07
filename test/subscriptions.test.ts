// test/subscriptions.test.ts — unit coverage for src/bun/subscriptions.ts per
// the task contract:
//  1. GET /app/subscriptions never echoes accessToken/refreshToken/verifier
//     for a stored subscription or a pending login (only safe metadata).
//  2. extractAuthorizationCode accepts a raw code OR a full pasted redirect
//     URL, same tolerance as the TUI's own login finish.
//  3. An unknown/unconfigured, non-builtin provider is honestly refused
//     (404) on login/start, login/finish, and refresh.
// Every SubscriptionManager/ServiceRegistry instance here points at a fresh
// temp directory — never ~/.goodvibes/tui — and nothing exercises real
// network: the only code paths reached here never call
// beginOpenAICodexLogin/exchangeOpenAICodexCode/beginOAuthLogin (they either
// read local state or refuse before reaching the network).

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretsManager, ServiceRegistry, SubscriptionManager } from "@pellux/goodvibes-sdk/platform/config";
import { createSubscriptionRoutes, extractAuthorizationCode } from "../src/bun/subscriptions.ts";
import type { AppRouteHandler } from "../src/bun/app-routes.ts";

// ─── test fixtures: real SDK classes pointed at a throwaway temp dir ───────

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeHandler(): { handler: AppRouteHandler; subscriptionManager: SubscriptionManager } {
  const dir = mkdtempSync(join(tmpdir(), "gv-subs-test-"));
  tempDirs.push(dir);
  const subscriptionManager = new SubscriptionManager(join(dir, "subscriptions.json"));
  const secretsManager = new SecretsManager({ projectRoot: dir, globalHome: dir, surfaceRoot: "test" });
  const serviceRegistry = new ServiceRegistry(join(dir, "services.json"), { secretsManager, subscriptionManager });
  return { handler: createSubscriptionRoutes({ subscriptionManager, serviceRegistry }), subscriptionManager };
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

// ─── extractAuthorizationCode ────────────────────────────────────────────────

describe("extractAuthorizationCode", () => {
  test("pulls ?code= out of a full pasted redirect URL", () => {
    expect(extractAuthorizationCode("https://example.test/callback?state=abc&code=xyz123")).toBe("xyz123");
  });

  test("passes a raw code straight through when it is not a URL", () => {
    expect(extractAuthorizationCode("xyz123")).toBe("xyz123");
  });

  test("falls back to the raw input when the URL has no code param", () => {
    expect(extractAuthorizationCode("https://example.test/callback?state=abc")).toBe(
      "https://example.test/callback?state=abc",
    );
  });

  test("trims surrounding whitespace from a pasted value", () => {
    expect(extractAuthorizationCode("  xyz123  \n")).toBe("xyz123");
  });
});

// ─── GET /app/subscriptions never leaks tokens ──────────────────────────────

describe("GET /app/subscriptions", () => {
  test("never echoes accessToken/refreshToken for a stored subscription", async () => {
    const { handler, subscriptionManager } = makeHandler();
    const secretAccessToken = "sk-live-supersecret-access-000111";
    const secretRefreshToken = "rt-live-supersecret-refresh-222333";
    subscriptionManager.saveSubscription({
      provider: "openai",
      accessToken: secretAccessToken,
      refreshToken: secretRefreshToken,
      tokenType: "Bearer",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["offline_access"],
      authMode: "oauth",
      overrideAmbientApiKeys: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await call(handler, "GET", "/app/subscriptions");
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(secretAccessToken);
    expect(raw).not.toContain(secretRefreshToken);
    expect(res.body.subscriptions).toHaveLength(1);
    expect(res.body.subscriptions[0]).toMatchObject({ provider: "openai", tokenType: "Bearer", hasRefreshToken: true });
    expect(res.body.subscriptions[0].accessToken).toBeUndefined();
    expect(res.body.subscriptions[0].refreshToken).toBeUndefined();
  });

  test("never echoes the PKCE verifier for a pending login", async () => {
    const { handler, subscriptionManager } = makeHandler();
    const secretVerifier = "pkce-verifier-should-never-leave-the-server-xyz";
    subscriptionManager.savePending({
      provider: "anthropic",
      state: "state-abc",
      verifier: secretVerifier,
      redirectUri: "http://127.0.0.1:1234/callback",
      createdAt: Date.now(),
    });

    const res = await call(handler, "GET", "/app/subscriptions");
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(secretVerifier);
    expect(res.body.pending).toHaveLength(1);
    expect(res.body.pending[0]).toEqual({
      provider: "anthropic",
      redirectUri: "http://127.0.0.1:1234/callback",
      createdAt: expect.any(Number),
    });
  });

  test("openai is always listed as an available builtin provider", async () => {
    const { handler } = makeHandler();
    const res = await call(handler, "GET", "/app/subscriptions");
    const openai = res.body.available.find((p: { provider: string }) => p.provider === "openai");
    expect(openai).toBeDefined();
    expect(openai.builtin).toBe(true);
  });
});

// ─── unknown-provider refusal ────────────────────────────────────────────────

describe("unknown-provider refusal", () => {
  test("POST /app/subscriptions/login/start refuses an unconfigured, non-builtin provider", async () => {
    const { handler } = makeHandler();
    const res = await call(handler, "POST", "/app/subscriptions/login/start", { provider: "totally-unknown-provider" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  test("POST /app/subscriptions/refresh refuses an unconfigured, non-builtin provider", async () => {
    const { handler } = makeHandler();
    const res = await call(handler, "POST", "/app/subscriptions/refresh", { provider: "totally-unknown-provider" });
    expect(res.status).toBe(404);
  });

  test("POST /app/subscriptions/login/finish refuses an unconfigured, non-builtin provider", async () => {
    const { handler } = makeHandler();
    const res = await call(handler, "POST", "/app/subscriptions/login/finish", {
      provider: "totally-unknown-provider",
      code: "abc",
    });
    expect(res.status).toBe(404);
  });

  test("POST /app/subscriptions/login/start requires a provider field", async () => {
    const { handler } = makeHandler();
    const res = await call(handler, "POST", "/app/subscriptions/login/start", {});
    expect(res.status).toBe(400);
  });
});

// ─── pending cancel + logout (no network) ───────────────────────────────────

describe("DELETE /app/subscriptions/login/pending", () => {
  test("clears a pending login without touching a stored subscription for the same provider", async () => {
    const { handler, subscriptionManager } = makeHandler();
    subscriptionManager.saveSubscription({
      provider: "openai",
      accessToken: "tok",
      tokenType: "Bearer",
      authMode: "oauth",
      overrideAmbientApiKeys: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    subscriptionManager.savePending({
      provider: "openai",
      state: "s",
      verifier: "v",
      redirectUri: "http://127.0.0.1:1455/auth/callback",
      createdAt: Date.now(),
    });

    const res = await call(handler, "DELETE", "/app/subscriptions/login/pending?provider=openai");
    expect(res.status).toBe(200);
    expect(subscriptionManager.getPending("openai")).toBeNull();
    expect(subscriptionManager.get("openai")).not.toBeNull();
  });

  test("requires a provider query param", async () => {
    const { handler } = makeHandler();
    const res = await call(handler, "DELETE", "/app/subscriptions/login/pending");
    expect(res.status).toBe(400);
  });
});

describe("DELETE /app/subscriptions", () => {
  test("logout of a provider with nothing stored reports removed:false, not an error", async () => {
    const { handler } = makeHandler();
    const res = await call(handler, "DELETE", "/app/subscriptions?provider=never-signed-in");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, removed: false });
  });

  test("logout of a provider with a stored subscription removes it and reports removed:true", async () => {
    const { handler, subscriptionManager } = makeHandler();
    subscriptionManager.saveSubscription({
      provider: "openai",
      accessToken: "tok",
      tokenType: "Bearer",
      authMode: "oauth",
      overrideAmbientApiKeys: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const res = await call(handler, "DELETE", "/app/subscriptions?provider=openai");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, removed: true });
    expect(subscriptionManager.get("openai")).toBeNull();
  });
});
