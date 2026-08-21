// src/bun/github.ts, unit coverage per the task contract:
//  1. the device-flow HttpFetch quirk adapter (200+string-error becomes
//     non-ok; a clean 200 passes through unchanged);
//  2. POST /auth/device/start refuses with 409 client-not-configured when no
//     clientId is saved;
//  3. GET /auth/status never leaks the stored token in its response body.
// Fetch is mocked throughout; nothing here touches the real network, the
// real secrets store, or the real settings.json.

import { describe, expect, test } from "bun:test";
import { createDeviceFlowHttpFetch, createGithubRoutes, type GithubRouteDeps } from "../src/bun/github.ts";
import type { AppRouteHandler } from "../src/bun/app-routes.ts";
import type { HttpRequest } from "@pellux/goodvibes-sdk/platform/calendar";

// ─── test doubles ────────────────────────────────────────────────────────────

function fakeSecretStore(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
}

interface FakeGithubSettings {
  clientId: string;
  tokenSource?: "device" | "pat";
  login?: string;
  scopes?: string[];
}

function fakeSettingsStore(initial: FakeGithubSettings = { clientId: "" }) {
  let current: FakeGithubSettings = { ...initial };
  return {
    readSettings: async () => current,
    writeSettings: async (mutate: (cur: FakeGithubSettings) => FakeGithubSettings) => {
      current = mutate(current);
      return current;
    },
    get current() {
      return current;
    },
  };
}

function makeHandler(deps: GithubRouteDeps): AppRouteHandler {
  return createGithubRoutes(deps);
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

// ─── 1. device-flow HttpFetch quirk adapter ─────────────────────────────────

describe("createDeviceFlowHttpFetch", () => {
  test("a 200 response carrying a string `error` field becomes non-ok / status 400", async () => {
    const rawFetch = (async () =>
      new Response(JSON.stringify({ error: "authorization_pending" }), { status: 200 })) as unknown as typeof fetch;
    const httpFetch = createDeviceFlowHttpFetch(rawFetch);
    const req: HttpRequest = { url: "https://github.com/login/oauth/access_token", method: "POST" };
    const res = await httpFetch(req);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "authorization_pending" });
  });

  test("slow_down and expired_token are likewise reported as non-ok with the original body intact", async () => {
    for (const errorCode of ["slow_down", "expired_token", "access_denied"]) {
      const rawFetch = (async () =>
        new Response(JSON.stringify({ error: errorCode }), { status: 200 })) as unknown as typeof fetch;
      const httpFetch = createDeviceFlowHttpFetch(rawFetch);
      const res = await httpFetch({ url: "https://github.com/login/oauth/access_token", method: "POST" });
      expect(res.ok).toBe(false);
      await expect(res.json()).resolves.toEqual({ error: errorCode });
    }
  });

  test("a clean 200 with no `error` field passes through untouched", async () => {
    const payload = { access_token: "ghu_live", token_type: "bearer" };
    const rawFetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
    const httpFetch = createDeviceFlowHttpFetch(rawFetch);
    const res = await httpFetch({ url: "https://github.com/login/oauth/access_token", method: "POST" });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(payload);
  });

  test("a real HTTP failure (non-2xx, no error field) passes through with its original status", async () => {
    const rawFetch = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const httpFetch = createDeviceFlowHttpFetch(rawFetch);
    const res = await httpFetch({ url: "https://github.com/login/device/code", method: "POST" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });

  test("header() proxies through to the underlying response's headers, case-insensitively", async () => {
    const rawFetch = (async () =>
      new Response("{}", { status: 200, headers: { "X-Custom": "abc" } })) as unknown as typeof fetch;
    const httpFetch = createDeviceFlowHttpFetch(rawFetch);
    const res = await httpFetch({ url: "https://example.test", method: "GET" });
    expect(res.header("x-custom")).toBe("abc");
  });
});

// ─── 2. client-not-configured refusal ───────────────────────────────────────

describe("POST /auth/device/start", () => {
  test("refuses with 409 client-not-configured when no clientId has been saved", async () => {
    const secrets = fakeSecretStore();
    const settings = fakeSettingsStore({ clientId: "" });
    const handler = makeHandler({
      secrets,
      readSettings: settings.readSettings,
      writeSettings: settings.writeSettings,
      fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    });
    const res = await call(handler, "POST", "/app/github/auth/device/start");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "client-not-configured" });
  });

  test("proceeds to call the device-authorization endpoint once a clientId is saved", async () => {
    const secrets = fakeSecretStore();
    const settings = fakeSettingsStore({ clientId: "some-client-id" });
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          device_code: "dc",
          user_code: "USER-CODE",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const handler = makeHandler({
      secrets,
      readSettings: settings.readSettings,
      writeSettings: settings.writeSettings,
      fetchImpl,
    });
    const res = await call(handler, "POST", "/app/github/auth/device/start");
    expect(res.status).toBe(200);
    expect(res.body.userCode).toBe("USER-CODE");
    expect(typeof res.body.flowId).toBe("string");
    expect(calls[0]).toContain("github.com/login/device/code");
  });
});

// ─── 3. auth/status never leaks the token ───────────────────────────────────

describe("GET /auth/status", () => {
  test("reports authenticated:false and never echoes a token when none is stored", async () => {
    const secrets = fakeSecretStore();
    const settings = fakeSettingsStore({ clientId: "abc" });
    const handler = makeHandler({ secrets, readSettings: settings.readSettings, writeSettings: settings.writeSettings });
    const res = await call(handler, "GET", "/app/github/auth/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, clientIdConfigured: true });
    expect(JSON.stringify(res.body)).not.toContain("ghp_");
  });

  test("reports login/scopes/tokenSource but never the raw stored token value", async () => {
    const secretToken = "ghp_supersecretvalue1234567890";
    const secrets = fakeSecretStore({ GITHUB_TOKEN: secretToken });
    const settings = fakeSettingsStore({
      clientId: "abc",
      tokenSource: "pat",
      login: "octocat",
      scopes: ["repo", "read:org"],
    });
    const handler = makeHandler({ secrets, readSettings: settings.readSettings, writeSettings: settings.writeSettings });
    const res = await call(handler, "GET", "/app/github/auth/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authenticated: true,
      login: "octocat",
      scopes: ["repo", "read:org"],
      tokenSource: "pat",
      clientIdConfigured: true,
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(secretToken);
    expect(raw).not.toContain("GITHUB_TOKEN");
  });
});

// ─── additional coverage: token PUT validates live and never returns it, DELETE clears only the token ──

describe("PUT /auth/token", () => {
  test("rejects an invalid token with 401 and does not store it", async () => {
    const secrets = fakeSecretStore();
    const settings = fakeSettingsStore({ clientId: "" });
    const fetchImpl = (async () => new Response("bad credentials", { status: 401 })) as unknown as typeof fetch;
    const handler = makeHandler({ secrets, readSettings: settings.readSettings, writeSettings: settings.writeSettings, fetchImpl });
    const res = await call(handler, "PUT", "/app/github/auth/token", { token: "bad-token" });
    expect(res.status).toBe(401);
    expect(secrets.store.has("GITHUB_TOKEN")).toBe(false);
  });

  test("accepts a valid token, stores it, and returns login/scopes without the token", async () => {
    const secrets = fakeSecretStore();
    const settings = fakeSettingsStore({ clientId: "" });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ login: "octocat" }), {
        status: 200,
        headers: { "X-OAuth-Scopes": "repo, read:org" },
      })) as unknown as typeof fetch;
    const handler = makeHandler({ secrets, readSettings: settings.readSettings, writeSettings: settings.writeSettings, fetchImpl });
    const res = await call(handler, "PUT", "/app/github/auth/token", { token: "good-token" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ login: "octocat", scopes: ["repo", "read:org"] });
    expect(JSON.stringify(res.body)).not.toContain("good-token");
    expect(secrets.store.get("GITHUB_TOKEN")).toBe("good-token");
    expect(settings.current.tokenSource).toBe("pat");
  });
});

// ─── device-flow Map growth (fix: superseded/terminal flows must not pile up
// forever, see the FLOW_RETENTION_MS sweep in handleDeviceStart/handleDevicePoll) ──

describe("device-flow Map growth", () => {
  function deviceStartFetch(): typeof fetch {
    return (async () =>
      new Response(
        JSON.stringify({
          device_code: "dc",
          user_code: "USER-CODE",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
  }

  test("a freshly superseded flow still answers 'superseded' (grace window intact)", async () => {
    const secrets = fakeSecretStore();
    const settings = fakeSettingsStore({ clientId: "some-client-id" });
    let clock = 0;
    const handler = makeHandler({
      secrets,
      readSettings: settings.readSettings,
      writeSettings: settings.writeSettings,
      fetchImpl: deviceStartFetch(),
      now: () => clock,
    });

    const first = await call(handler, "POST", "/app/github/auth/device/start");
    const firstFlowId = first.body.flowId as string;

    clock += 1_000; // still well inside FLOW_RETENTION_MS
    const second = await call(handler, "POST", "/app/github/auth/device/start");
    expect(second.body.flowId).not.toBe(firstFlowId);

    const poll = await call(handler, "GET", `/app/github/auth/device/poll?flowId=${firstFlowId}`);
    expect(poll.body).toEqual({ status: "error", error: "Superseded by a newer device flow." });
  });

  test("a flow older than FLOW_RETENTION_MS is swept instead of retained forever", async () => {
    const secrets = fakeSecretStore();
    const settings = fakeSettingsStore({ clientId: "some-client-id" });
    let clock = 0;
    const handler = makeHandler({
      secrets,
      readSettings: settings.readSettings,
      writeSettings: settings.writeSettings,
      fetchImpl: deviceStartFetch(),
      now: () => clock,
    });

    const first = await call(handler, "POST", "/app/github/auth/device/start");
    const firstFlowId = first.body.flowId as string;

    // Confirm it is really there before the sweep window passes.
    const stillThere = await call(handler, "GET", `/app/github/auth/device/poll?flowId=${firstFlowId}`);
    expect(stillThere.body.status).toBe("pending");

    clock += 5 * 60_000 + 1; // past FLOW_RETENTION_MS
    // Polling itself sweeps stale entries (handleDevicePoll calls pruneFlows).
    const afterSweep = await call(handler, "GET", `/app/github/auth/device/poll?flowId=${firstFlowId}`);
    expect(afterSweep.body).toEqual({ status: "error", error: "Unknown or expired flow id." });
  });
});

describe("proxied reads", () => {
  test("GET /user returns 401 when not authenticated", async () => {
    const secrets = fakeSecretStore();
    const settings = fakeSettingsStore({ clientId: "" });
    const handler = makeHandler({ secrets, readSettings: settings.readSettings, writeSettings: settings.writeSettings });
    const res = await call(handler, "GET", "/app/github/user");
    expect(res.status).toBe(401);
  });

  test("GET /pulls requires owner and repo", async () => {
    const secrets = fakeSecretStore({ GITHUB_TOKEN: "tok" });
    const settings = fakeSettingsStore({ clientId: "" });
    const handler = makeHandler({ secrets, readSettings: settings.readSettings, writeSettings: settings.writeSettings });
    const res = await call(handler, "GET", "/app/github/pulls");
    expect(res.status).toBe(400);
  });
});
