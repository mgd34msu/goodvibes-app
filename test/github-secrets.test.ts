// src/bun/github.ts against the REAL SecretsManager, on a throwaway HOME.
//
// The other github tests inject a Map-backed fake store. That fake is a single
// flat namespace, so it cannot represent the thing that actually matters here:
// sdk 2.x files secrets in TIERS (project / user / daemon), the daemon tier
// leads the read order, and SecretsManager.delete() treats a daemon-needed key
// as a revoke that sweeps EVERY tier. A fake with no tiers reports success for
// code that would destroy a daemon-owned credential in production.
//
// So these run the real manager over temp directories and assert the two
// properties the rename exists to guarantee:
//   1. signing out of the app's GitHub panel does not touch a daemon-tier
//      GITHUB_TOKEN (the github-copilot provider's credential);
//   2. a token stored under the pre-rename key is migrated on first read, and
//      the legacy copy is removed only from the app's own tier.
//
// Nothing here touches the real ~/.goodvibes: every path is under a temp dir.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretsManager, isDaemonNeededSecretKey } from "@pellux/goodvibes-sdk/platform/config";
import { createGithubRoutes } from "../src/bun/github.ts";
import type { AppRouteHandler } from "../src/bun/app-routes.ts";

const APP_KEY = "GOODVIBES_APP_GITHUB_TOKEN";
const LEGACY_KEY = "GITHUB_TOKEN";

let base: string;
let projectRoot: string;
let globalHome: string;
let secrets: SecretsManager;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "gv-app-github-secrets-"));
  // Distinct roots on purpose: pointing both at one directory collapses the
  // project and user tiers into the same file and the tier assertions below
  // stop meaning anything.
  projectRoot = join(base, "project");
  globalHome = join(base, "home");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(globalHome, { recursive: true });
  secrets = new SecretsManager({ projectRoot, globalHome, surfaceRoot: "tui" });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/**
 * Put a GITHUB_TOKEN in the app's USER tier, as sdk 1.x would have left it.
 *
 * This writes the store file directly because it cannot be done through the
 * API: `set("GITHUB_TOKEN", v, { scope: "user" })` is exactly the call the
 * platform now RELOCATES to the daemon tier, so using it here would set up the
 * opposite of the state under test. sdk 1.x had no daemon tier, so a token
 * written by the old app landed in a client tier like this one.
 */
function plantLegacyUserToken(value: string): void {
  mkdirSync(join(globalHome, ".goodvibes"), { recursive: true });
  writeFileSync(
    join(globalHome, ".goodvibes", "tui.secrets.json"),
    JSON.stringify({ version: 1, secrets: { [LEGACY_KEY]: value } }, null, 2),
  );
}

function fakeSettings(clientId = "") {
  let current = { clientId } as { clientId: string; tokenSource?: "device" | "pat"; login?: string; scopes?: string[] };
  return {
    readSettings: async () => current,
    writeSettings: async (mutate: (cur: typeof current) => typeof current) => {
      current = mutate(current);
      return current;
    },
  };
}

function makeHandler(): AppRouteHandler {
  const settings = fakeSettings();
  return createGithubRoutes({
    secrets,
    readSettings: settings.readSettings,
    writeSettings: settings.writeSettings,
    // Any GitHub identity lookup during these tests answers as "octocat".
    fetchImpl: (async () =>
      new Response(JSON.stringify({ login: "octocat" }), {
        status: 200,
        headers: { "X-OAuth-Scopes": "repo" },
      })) as unknown as typeof fetch,
  });
}

async function call(handler: AppRouteHandler, method: string, path: string) {
  const url = new URL(`http://127.0.0.1${path}`);
  const res = await handler(new Request(url, { method }), url);
  const text = await res.text();
  return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
}

describe("app GitHub token key vs the platform's daemon-owned credentials", () => {
  test("the platform claims GITHUB_TOKEN but not the app's renamed key", () => {
    // The premise of the whole rename. If this ever flips, the isolation below
    // is not doing what it claims and the key needs choosing again.
    expect(isDaemonNeededSecretKey(LEGACY_KEY)).toBe(true);
    expect(isDaemonNeededSecretKey(APP_KEY)).toBe(false);
  });

  test("sign-out does NOT destroy a daemon-tier GITHUB_TOKEN", async () => {
    // The daemon's own copilot credential, in the tier the daemon reads.
    await secrets.set(LEGACY_KEY, "daemon-owned-copilot-token", { scope: "daemon" });
    // The app's own token, stored the way github.ts stores it.
    await secrets.set(APP_KEY, "app-token");

    const handler = makeHandler();
    const res = await call(handler, "DELETE", "/app/github/auth/token");
    expect(res.status).toBe(200);

    // The app's token is gone...
    expect(await secrets.get(APP_KEY)).toBeNull();
    // ...and the daemon's credential is untouched. Under the old name, delete()
    // would have swept the daemon tier and this would be null.
    expect(await secrets.getFromScope(LEGACY_KEY, "daemon")).toBe("daemon-owned-copilot-token");
  });

  test("a daemon-tier GITHUB_TOKEN does not shadow the app's own token", async () => {
    await secrets.set(LEGACY_KEY, "daemon-owned-copilot-token", { scope: "daemon" });
    await secrets.set(APP_KEY, "app-token");

    const handler = makeHandler();
    const res = await call(handler, "GET", "/app/github/auth/status");
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    // The value the app proxies with is its own, not the daemon's.
    expect(await secrets.get(APP_KEY)).toBe("app-token");
  });
});

describe("legacy key migration", () => {
  test("a pre-rename token is adopted on first read and cleared from the app's tier", async () => {
    plantLegacyUserToken("legacy-app-token");
    expect(await secrets.getFromScope(LEGACY_KEY, "user")).toBe("legacy-app-token");

    const handler = makeHandler();
    const res = await call(handler, "GET", "/app/github/auth/status");
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);

    // Moved under the new key, and the app's own legacy copy is gone.
    expect(await secrets.get(APP_KEY)).toBe("legacy-app-token");
    expect(await secrets.getFromScope(LEGACY_KEY, "user")).toBeNull();
  });

  test("migration reads the app's tier and leaves the daemon's copy alone", async () => {
    await secrets.set(LEGACY_KEY, "daemon-owned-copilot-token", { scope: "daemon" });
    plantLegacyUserToken("legacy-app-token");

    const handler = makeHandler();
    await call(handler, "GET", "/app/github/auth/status");

    expect(await secrets.get(APP_KEY)).toBe("legacy-app-token");
    expect(await secrets.getFromScope(LEGACY_KEY, "daemon")).toBe("daemon-owned-copilot-token");
  });

  test("sign-out after a migration stays signed out (no resurrection on next read)", async () => {
    plantLegacyUserToken("legacy-app-token");
    const handler = makeHandler();

    await call(handler, "GET", "/app/github/auth/status"); // migrates
    await call(handler, "DELETE", "/app/github/auth/token"); // signs out

    const after = await call(handler, "GET", "/app/github/auth/status");
    expect(after.body.authenticated).toBe(false);
    expect(await secrets.get(APP_KEY)).toBeNull();
  });
});
