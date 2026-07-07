// /app/subscriptions — OAuth-backed provider subscriptions (docs/GAPS.md §14
// row 11), built entirely on @pellux/goodvibes-sdk's SubscriptionManager /
// subscription-provider helpers / OpenAI Codex OAuth helpers / loopback OAuth
// listener — the exact same SDK primitives goodvibes-tui drives in-process
// (../goodvibes-tui/src/input/commands/subscription-runtime.ts, READ-ONLY
// reference; the openai-codex branch below mirrors its
// beginOpenAICodexLogin/exchangeOpenAICodexCode special-case verbatim). No
// OAuth mechanics are reimplemented here.
//
// Storage: SubscriptionManager and ServiceRegistry are constructed pointed at
// the exact same files the TUI uses — ~/.goodvibes/tui/subscriptions.json and
// ~/.goodvibes/tui/services.json (shellPaths.resolveUserPath('tui', ...) on
// the TUI side) — so a login made in either surface is visible in both. This
// module builds its own SDK instances rather than importing secrets.ts's
// private module-level ones (that file exports no such handle); same idiom as
// github.ts building its own SecretsManager pointed at the shared TUI store.
//
// Routes (all under /app/subscriptions):
//   GET    /                    -> {subscriptions, pending, available} (safe fields only)
//   POST   /login/start         body {provider} -> {authorizationUrl}
//   POST   /login/finish        body {provider, code} -> {subscription} (code accepts a raw code or a full redirect URL)
//   POST   /refresh             body {provider} -> {subscription}
//   DELETE /login/pending       ?provider= -> {ok:true}  (abandons a stuck login; closes any loopback listener)
//   DELETE /                    ?provider= -> {ok:true, removed}
//
// Every response is built from a whitelist of safe fields — accessToken,
// refreshToken (raw), and the PKCE verifier NEVER leave this process; GET
// reports only hasRefreshToken (boolean) plus expiry/scope/mode metadata.
//
// Loopback auto-capture: when the resolved OAuth config's redirect lands on
// a loopback address (either via an explicit `localCallback` block, e.g. the
// builtin OpenAI Codex provider's localhost:1455/auth/callback, or a plain
// loopback redirectUri on a service-registered provider), login/start also
// spins up createOAuthLocalListener in the background. If it captures a code
// before the user pastes one, the login completes server-side and the
// pending record clears on its own — GET keeps reporting that pending record
// until then, so the panel's poll-until-cleared UX needs no extra signal.
// The manual paste-code-or-URL path (login/finish) always remains available
// as a fallback since the listener may fail to bind.

import { homedir } from "node:os";
import { join } from "node:path";
import {
  SecretsManager,
  ServiceRegistry,
  SubscriptionManager,
  createOAuthLocalListener,
  beginOpenAICodexLogin,
  exchangeOpenAICodexCode,
  refreshOpenAICodexToken,
  getSubscriptionProviderConfig,
  listAvailableSubscriptionProviders,
  type OAuthLocalListener,
  type OAuthProviderConfig,
  type OpenAICodexLoginStart,
  type PendingSubscriptionLogin,
  type ProviderSubscription,
} from "@pellux/goodvibes-sdk/platform/config";
import type { AppRouteHandler } from "./app-routes.ts";

const HOME = homedir();
const TUI_SURFACE_ROOT = "tui"; // same store the TUI uses — see src/bun/secrets.ts's identical idiom

// ─── injectable seams (tests point these at a temp file, never ~/.goodvibes) ─

export interface SubscriptionRouteDeps {
  readonly subscriptionManager?: SubscriptionManager;
  readonly serviceRegistry?: ServiceRegistry;
  readonly now?: () => number;
}

function defaultSubscriptionManager(): SubscriptionManager {
  return new SubscriptionManager(join(HOME, ".goodvibes", TUI_SURFACE_ROOT, "subscriptions.json"));
}

function defaultServiceRegistry(subscriptionManager: SubscriptionManager): ServiceRegistry {
  const secretsManager = new SecretsManager({ projectRoot: HOME, globalHome: HOME, surfaceRoot: TUI_SURFACE_ROOT });
  const servicesFilePath = join(HOME, ".goodvibes", TUI_SURFACE_ROOT, "services.json");
  return new ServiceRegistry(servicesFilePath, { secretsManager, subscriptionManager });
}

// ─── response helpers (duplicated small idiom — see local-tools.ts header) ──

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

function notFound(message: string): Response {
  return json({ error: message }, 404);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

// ─── code-or-URL extraction (same tolerance as the TUI's own login finish) ──

/** Accepts either a bare authorization code or a full pasted redirect URL —
 *  when the input parses as a URL carrying a `code` query param, that param
 *  wins; otherwise the trimmed input is returned as-is (a bare code, or an
 *  unparseable string the token endpoint will honestly reject). */
export function extractAuthorizationCode(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("code") ?? trimmed;
  } catch {
    return trimmed;
  }
}

// ─── safe-field whitelists — accessToken/refreshToken/verifier never escape ─

interface SafeSubscription {
  provider: string;
  tokenType: string;
  expiresAt?: number;
  scopes?: readonly string[];
  authMode: "oauth";
  overrideAmbientApiKeys: boolean;
  createdAt: number;
  updatedAt: number;
  hasRefreshToken: boolean;
}

function safeSubscription(sub: ProviderSubscription): SafeSubscription {
  return {
    provider: sub.provider,
    tokenType: sub.tokenType,
    ...(sub.expiresAt !== undefined ? { expiresAt: sub.expiresAt } : {}),
    ...(sub.scopes ? { scopes: sub.scopes } : {}),
    authMode: sub.authMode,
    overrideAmbientApiKeys: sub.overrideAmbientApiKeys,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    hasRefreshToken: Boolean(sub.refreshToken),
  };
}

interface SafePending {
  provider: string;
  redirectUri: string;
  createdAt: number;
}

function safePending(pending: PendingSubscriptionLogin): SafePending {
  return { provider: pending.provider, redirectUri: pending.redirectUri, createdAt: pending.createdAt };
}

interface SafeAvailableProvider {
  provider: string;
  displayName: string;
  source: "builtin" | "service";
  redirectUri: string;
  builtin: boolean;
}

// ─── loopback listener config resolution ────────────────────────────────────

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function loopbackListenerConfigFromRedirectUri(
  redirectUri: string,
): { host?: string; port?: number; path?: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return null;
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null;
  return {
    host: parsed.hostname,
    ...(parsed.port ? { port: Number(parsed.port) } : {}),
    path: parsed.pathname || "/",
  };
}

/** Prefers an explicit `localCallback` block (exact host/port/path from the
 *  provider config) and falls back to sniffing a plain loopback redirectUri —
 *  either way, only ever returns non-null for a genuinely loopback target. */
function resolveLoopbackListenerConfig(
  oauth: OAuthProviderConfig,
): { host?: string; port?: number; path?: string } | null {
  const lc = oauth.localCallback;
  if (lc) return { ...(lc.host ? { host: lc.host } : {}), ...(lc.port ? { port: lc.port } : {}), ...(lc.path ? { path: lc.path } : {}) };
  return loopbackListenerConfigFromRedirectUri(oauth.redirectUri);
}

// ─── main factory ────────────────────────────────────────────────────────────

export function createSubscriptionRoutes(deps: SubscriptionRouteDeps = {}): AppRouteHandler {
  const subscriptionManager = deps.subscriptionManager ?? defaultSubscriptionManager();
  const serviceRegistry = deps.serviceRegistry ?? defaultServiceRegistry(subscriptionManager);
  const now = deps.now ?? Date.now;

  // One best-effort loopback listener per provider at a time; a fresh
  // login/start for the same provider closes whatever was still listening.
  const listeners = new Map<string, OAuthLocalListener>();

  function closeListener(provider: string): void {
    const existing = listeners.get(provider);
    if (existing) {
      existing.close();
      listeners.delete(provider);
    }
  }

  // ─── background capture: openai codex (fixed redirect, bundled client id) ─

  async function runOpenAiLoopbackCapture(
    provider: string,
    started: OpenAICodexLoginStart,
    loopbackConfig: { host?: string; port?: number; path?: string },
  ): Promise<void> {
    const listener = await createOAuthLocalListener({ expectedState: started.state, ...loopbackConfig }).catch(
      () => null,
    );
    if (!listener) return;
    listeners.set(provider, listener);
    try {
      const callback = await listener.waitForCode();
      const token = await exchangeOpenAICodexCode(callback.code, started.verifier);
      const nowMs = now();
      subscriptionManager.saveSubscription({
        provider,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenType: token.tokenType,
        expiresAt: token.expiresAt,
        ...(token.scopes ? { scopes: token.scopes } : {}),
        authMode: "oauth",
        overrideAmbientApiKeys: false,
        createdAt: subscriptionManager.get(provider)?.createdAt ?? nowMs,
        updatedAt: nowMs,
      });
    } catch {
      // best-effort: capture failed/timed out — the pending record survives
      // for the manual paste-code-or-URL fallback (login/finish).
    } finally {
      if (listeners.get(provider) === listener) listeners.delete(provider);
    }
  }

  // ─── background capture: generic service-configured OAuth provider ────────

  async function runGenericLoopbackCapture(
    provider: string,
    config: OAuthProviderConfig,
    listener: OAuthLocalListener,
  ): Promise<void> {
    try {
      const callback = await listener.waitForCode();
      await subscriptionManager.completeOAuthLogin(provider, config, callback.code);
    } catch {
      // best-effort — manual finish remains available
    } finally {
      if (listeners.get(provider) === listener) listeners.delete(provider);
    }
  }

  // ─── GET / ──────────────────────────────────────────────────────────────

  function handleList(): Response {
    const subscriptions = subscriptionManager.list().map(safeSubscription);
    const pending = subscriptionManager.listPending().map(safePending);
    const available: SafeAvailableProvider[] = listAvailableSubscriptionProviders(serviceRegistry.getAll()).map(
      (p) => ({
        provider: p.provider,
        displayName: p.displayName,
        source: p.source,
        redirectUri: p.oauth.redirectUri,
        builtin: p.source === "builtin",
      }),
    );
    return json({ subscriptions, pending, available });
  }

  // ─── POST /login/start ──────────────────────────────────────────────────

  async function handleLoginStart(req: Request): Promise<Response> {
    const body = await readJsonBody(req);
    const provider = readString(body, "provider");
    if (!provider) return badRequest("A provider is required.");

    const resolved = getSubscriptionProviderConfig(provider, serviceRegistry.get(provider));
    if (!resolved) {
      return notFound(
        `No subscription provider found for "${provider}". Register an OAuth service config for it under Settings > Secrets & Services, or use a builtin provider (openai).`,
      );
    }

    closeListener(provider);
    const loopbackConfig = resolveLoopbackListenerConfig(resolved.oauth);

    if (provider === "openai" && resolved.source === "builtin") {
      let started: OpenAICodexLoginStart;
      try {
        started = await beginOpenAICodexLogin();
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 502);
      }
      subscriptionManager.savePending({
        provider,
        state: started.state,
        verifier: started.verifier,
        redirectUri: started.redirectUri,
        createdAt: now(),
      });
      if (loopbackConfig) void runOpenAiLoopbackCapture(provider, started, loopbackConfig);
      return json({ authorizationUrl: started.authorizationUrl });
    }

    let listener: OAuthLocalListener | null = null;
    let activeConfig = resolved.oauth;
    if (loopbackConfig) {
      listener = await createOAuthLocalListener({ expectedState: "", ...loopbackConfig }).catch(() => null);
      if (listener) activeConfig = { ...activeConfig, redirectUri: listener.redirectUri };
    }

    let started: { authorizationUrl: string; pending: PendingSubscriptionLogin };
    try {
      started = await subscriptionManager.beginOAuthLogin(provider, activeConfig);
    } catch (err) {
      listener?.close();
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }

    if (listener) {
      listener.setExpectedState(started.pending.state);
      listeners.set(provider, listener);
      void runGenericLoopbackCapture(provider, activeConfig, listener);
    }

    return json({ authorizationUrl: started.authorizationUrl });
  }

  // ─── POST /login/finish ─────────────────────────────────────────────────

  async function handleLoginFinish(req: Request): Promise<Response> {
    const body = await readJsonBody(req);
    const provider = readString(body, "provider");
    const codeInput = readString(body, "code");
    if (!provider || !codeInput) return badRequest("provider and code are required.");
    const code = extractAuthorizationCode(codeInput);

    const resolved = getSubscriptionProviderConfig(provider, serviceRegistry.get(provider));
    if (!resolved) return notFound(`No subscription provider found for "${provider}".`);

    closeListener(provider);

    if (provider === "openai" && resolved.source === "builtin") {
      const pending = subscriptionManager.getPending(provider);
      if (!pending) return json({ error: `No pending OAuth login for ${provider}. Start the login first.` }, 409);
      try {
        const token = await exchangeOpenAICodexCode(code, pending.verifier);
        const nowMs = now();
        const record = subscriptionManager.saveSubscription({
          provider,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt,
          ...(token.scopes ? { scopes: token.scopes } : {}),
          authMode: "oauth",
          overrideAmbientApiKeys: false,
          createdAt: subscriptionManager.get(provider)?.createdAt ?? nowMs,
          updatedAt: nowMs,
        });
        return json({ subscription: safeSubscription(record) });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 502);
      }
    }

    try {
      const record = await subscriptionManager.completeOAuthLogin(provider, resolved.oauth, code);
      return json({ subscription: safeSubscription(record) });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  // ─── POST /refresh ──────────────────────────────────────────────────────

  async function handleRefresh(req: Request): Promise<Response> {
    const body = await readJsonBody(req);
    const provider = readString(body, "provider");
    if (!provider) return badRequest("A provider is required.");

    const resolved = getSubscriptionProviderConfig(provider, serviceRegistry.get(provider));
    if (!resolved) return notFound(`No subscription provider found for "${provider}".`);

    if (provider === "openai" && resolved.source === "builtin") {
      const existing = subscriptionManager.get(provider);
      if (!existing) return json({ error: `No stored subscription for ${provider}.` }, 404);
      if (!existing.refreshToken) return json({ subscription: safeSubscription(existing) });
      try {
        const token = await refreshOpenAICodexToken(existing.refreshToken);
        const nowMs = now();
        const record = subscriptionManager.saveSubscription({
          provider,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken || existing.refreshToken,
          tokenType: token.tokenType || existing.tokenType,
          expiresAt: token.expiresAt ?? existing.expiresAt,
          ...(token.scopes ? { scopes: token.scopes } : existing.scopes ? { scopes: existing.scopes } : {}),
          authMode: "oauth",
          overrideAmbientApiKeys: existing.overrideAmbientApiKeys,
          createdAt: existing.createdAt,
          updatedAt: nowMs,
        });
        return json({ subscription: safeSubscription(record) });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 502);
      }
    }

    try {
      const record = await subscriptionManager.refreshOAuthToken(provider, resolved.oauth);
      return json({ subscription: safeSubscription(record) });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  // ─── DELETE /login/pending ──────────────────────────────────────────────

  function handleClearPending(url: URL): Response {
    const provider = url.searchParams.get("provider") ?? "";
    if (!provider) return badRequest("A provider query param is required.");
    closeListener(provider);
    subscriptionManager.clearPending(provider);
    return json({ ok: true });
  }

  // ─── DELETE / (logout) ──────────────────────────────────────────────────

  function handleLogout(url: URL): Response {
    const provider = url.searchParams.get("provider") ?? "";
    if (!provider) return badRequest("A provider query param is required.");
    closeListener(provider);
    const removed = subscriptionManager.logout(provider);
    return json({ ok: true, removed });
  }

  // ─── dispatch ────────────────────────────────────────────────────────────

  return async (req, url) => {
    const sub = url.pathname.slice("/app/subscriptions".length); // "", "/login/start", …
    const method = req.method;

    try {
      if ((sub === "" || sub === "/") && method === "GET") return handleList();
      if (sub === "/login/start" && method === "POST") return handleLoginStart(req);
      if (sub === "/login/finish" && method === "POST") return handleLoginFinish(req);
      if (sub === "/refresh" && method === "POST") return handleRefresh(req);
      if (sub === "/login/pending" && method === "DELETE") return handleClearPending(url);
      if ((sub === "" || sub === "/") && method === "DELETE") return handleLogout(url);

      return notFound(`No subscriptions route for ${method} ${url.pathname}.`);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  };
}
