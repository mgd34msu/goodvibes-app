// /app/github — GitHub device-flow + PAT auth, a thin read proxy to the
// GitHub REST API, and the three SDK-backed write calls (PR comment, PR
// review, issue comment). Backs docs/FEATURES.md §15 "GitHub: device-flow
// auth + PR/issue list/create" and closes the docs/GAPS.md §15 PARTIAL rows
// that were blocked on "no github.* wire method exists" — this module serves
// the endpoints directly from the app process instead of through the daemon
// wire, so src/ui/views/code/GitHubPanel.tsx (built against this contract,
// not against this file) gets a live surface on every daemon.
//
// Routes (all under /app/github):
//   GET    /auth/status          -> { authenticated, login?, scopes?, tokenSource?, clientIdConfigured }
//   PUT    /auth/client-id       body {clientId} -> {ok:true}            (persisted app-side; "" clears)
//   POST   /auth/device/start    -> {flowId,userCode,verificationUri,expiresAt,intervalMs} | 409 client-not-configured
//   GET    /auth/device/poll     ?flowId= -> {status,login?,error?}      (reads server-side flow state)
//   PUT    /auth/token           body {token} -> {login,scopes} | 401 {error}
//   DELETE /auth/token           -> {ok:true}
//   GET    /user                 -> proxied GET /user
//   GET    /repos                ?page&per_page -> proxied GET /user/repos?sort=updated
//   GET    /pulls                ?owner&repo&state -> proxied GET /repos/{owner}/{repo}/pulls
//   GET    /issues               ?owner&repo&state -> proxied GET /repos/{owner}/{repo}/issues
//   GET    /rate-limit           -> proxied GET /rate_limit
//   POST   /pr-comment           body {owner,repo,prNumber,body} -> SDK GitHubIntegration.postPRComment
//   POST   /pr-review            body {owner,repo,prNumber,body,event} -> SDK GitHubIntegration.postPRReview
//   POST   /issue-comment        body {owner,repo,issueNumber,body} -> SDK GitHubIntegration.postIssueComment
//
// The stored token never appears in a response body after it is stored —
// every route below returns metadata (login/scopes/tokenSource) only.
//
// Device flow (RFC 8628): beginDeviceCodeFlow/pollDeviceCodeFlow from the
// SDK's platform/calendar module are generic OAuth machinery, not
// calendar-specific — reused here rather than reimplemented. GitHub's device
// token endpoint answers HTTP 200 with {"error":"authorization_pending"} (and
// "slow_down"/"expired_token"/"access_denied") while pending, but the SDK's
// pollDeviceCodeFlow treats `res.ok` as success. createDeviceFlowHttpFetch
// below is the fix: it buffers the JSON body and, when a 200 carries a string
// `error` field, reports ok:false/status 400 with that same body as json() —
// which makes the SDK's own pending/slow_down/expiry branches run unchanged.
// A clean 200 (no `error` field) passes through untouched.
//
// Only one device flow runs at a time — starting a new one supersedes
// whatever flow was previously active; a poll on a superseded flowId still
// resolves (to an honest "superseded" error), it just never completes.
//
// GitHub is not a member of the SDK's CalendarProviderId union ('google' |
// 'microsoft') — that field is never read by beginDeviceCodeFlow /
// pollDeviceCodeFlow (verified against dist/platform/calendar/oauth-flow.js),
// so buildGithubClientConfig below deliberately escapes that narrower type
// with a documented cast rather than lying about being a calendar provider.

import { homedir } from "node:os";
import {
  beginDeviceCodeFlow,
  pollDeviceCodeFlow,
  OAuthFlowError,
  type DeviceCodeFlowStart,
  type HttpFetch,
  type HttpRequest,
  type HttpResponse,
  type ResolvedClientConfig,
} from "@pellux/goodvibes-sdk/platform/calendar";
import { SecretsManager } from "@pellux/goodvibes-sdk/platform/config";
import { GitHubIntegration } from "@pellux/goodvibes-sdk/platform/integrations";
import type { AppRouteHandler } from "./app-routes.ts";
import { readAppSettings, mutateAppSettings } from "./settings-store.ts";

// ─── storage: token via the shared SecretsManager store, clientId/metadata
// alongside it in the app's own settings.json ("github" top-level key) ──────

const HOME = homedir();
const TUI_SURFACE_ROOT = "tui"; // same store secrets.ts uses — see src/bun/secrets.ts
const TOKEN_KEY = "GITHUB_TOKEN"; // matches the SDK service-registry convention (dist/platform/config/service-registry.d.ts example)

const GITHUB_API_BASE = "https://api.github.com";
const DEVICE_AUTHORIZATION_ENDPOINT = "https://github.com/login/device/code";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const DEVICE_SCOPES = ["repo", "read:org"];
const REST_TIMEOUT_MS = 10_000;

interface GithubAppSettings {
  clientId: string;
  tokenSource?: "device" | "pat";
  login?: string;
  scopes?: string[];
}

const DEFAULT_GITHUB_SETTINGS: GithubAppSettings = { clientId: "" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readGithubSettingsFromFile(file: Record<string, unknown>): GithubAppSettings {
  const raw = isRecord(file["github"]) ? file["github"] : {};
  const clientId = typeof raw["clientId"] === "string" ? raw["clientId"] : "";
  const tokenSource = raw["tokenSource"] === "device" || raw["tokenSource"] === "pat" ? raw["tokenSource"] : undefined;
  const login = typeof raw["login"] === "string" ? raw["login"] : undefined;
  const scopes =
    Array.isArray(raw["scopes"]) && raw["scopes"].every((s) => typeof s === "string")
      ? (raw["scopes"] as string[])
      : undefined;
  return {
    clientId,
    ...(tokenSource ? { tokenSource } : {}),
    ...(login ? { login } : {}),
    ...(scopes ? { scopes } : {}),
  };
}

/** Narrow slice of SecretsManager this module needs — real instance by default, a Map-backed fake in tests. */
export interface SecretStoreLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Injectable seams so tests never touch the real secrets store, settings.json, or network. */
export interface GithubRouteDeps {
  readonly secrets?: SecretStoreLike;
  readonly readSettings?: () => Promise<GithubAppSettings>;
  readonly writeSettings?: (mutate: (current: GithubAppSettings) => GithubAppSettings) => Promise<GithubAppSettings>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

function defaultSecretStore(): SecretStoreLike {
  return new SecretsManager({ projectRoot: HOME, globalHome: HOME, surfaceRoot: TUI_SURFACE_ROOT });
}

async function defaultReadSettings(): Promise<GithubAppSettings> {
  const file = await readAppSettings();
  return readGithubSettingsFromFile(file);
}

function defaultWriteSettings(
  mutate: (current: GithubAppSettings) => GithubAppSettings,
): Promise<GithubAppSettings> {
  let next: GithubAppSettings = DEFAULT_GITHUB_SETTINGS;
  return mutateAppSettings((file) => {
    const current = readGithubSettingsFromFile(file);
    next = mutate(current);
    return { ...file, github: next };
  }).then(() => next);
}

// ─── response helpers ────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

function notFound(message: string): Response {
  return json({ error: message }, 404);
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

function readNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ─── device-flow HttpFetch quirk adapter (unit-tested directly) ────────────

/**
 * Wrap a raw fetch into the SDK's HttpFetch shape, fixing GitHub's device-flow
 * quirk: the token endpoint answers HTTP 200 with a JSON `error` field while
 * pending/denied/expired instead of a non-2xx status. When that happens this
 * reports ok:false/status 400 (json() still resolves to the same body) so
 * pollDeviceCodeFlow's own authorization_pending / slow_down / expired_token
 * branches fire correctly. A response with no string `error` field — success
 * or a real HTTP failure — passes through with its original ok/status.
 */
export function createDeviceFlowHttpFetch(rawFetch: typeof fetch): HttpFetch {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const res = await rawFetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    const hasStringErrorField = isRecord(parsed) && typeof parsed["error"] === "string";
    const effectiveOk = res.ok && !hasStringErrorField;
    const effectiveStatus = res.ok && hasStringErrorField ? 400 : res.status;
    return {
      status: effectiveStatus,
      ok: effectiveOk,
      header: (name: string) => res.headers.get(name),
      json: async () => parsed,
      text: async () => text,
    };
  };
}

// ─── device-flow client config ──────────────────────────────────────────────

interface GithubClientConfigShape {
  readonly provider: "github";
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly deviceAuthorizationEndpoint: string;
  readonly apiBaseUrl: string;
  readonly usingBundledDefault: boolean;
  readonly isPlaceholder: boolean;
}

/** Build a ResolvedClientConfig for GitHub. See the file-header note on the
 *  deliberate `provider` type escape — GitHub is not a calendar provider. */
function buildGithubClientConfig(clientId: string): ResolvedClientConfig {
  const config: GithubClientConfigShape = {
    provider: "github",
    clientId,
    scopes: DEVICE_SCOPES,
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: TOKEN_ENDPOINT,
    deviceAuthorizationEndpoint: DEVICE_AUTHORIZATION_ENDPOINT,
    apiBaseUrl: GITHUB_API_BASE,
    usingBundledDefault: false,
    isPlaceholder: false,
  };
  return config as unknown as ResolvedClientConfig;
}

// ─── server-side device-flow state (one active flow at a time) ─────────────

type DeviceFlowStatus = "pending" | "complete" | "expired" | "denied" | "error";

interface DeviceFlowRecord {
  status: DeviceFlowStatus;
  login?: string;
  error?: string;
  superseded: boolean;
}

function classifyRejection(message: string): "denied" | "error" {
  return /access_denied/i.test(message) ? "denied" : "error";
}

async function fetchGithubUser(
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ login: string; scopes: string[] } | null> {
  const res = await githubApiFetch(fetchImpl, "/user", token);
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { login?: unknown } | null;
  const login = body && typeof body.login === "string" ? body.login : "";
  if (!login) return null;
  const scopesHeader = res.headers.get("x-oauth-scopes");
  const scopes = scopesHeader
    ? scopesHeader
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return { login, scopes };
}

// ─── main factory ────────────────────────────────────────────────────────────

export function createGithubRoutes(deps: GithubRouteDeps = {}): AppRouteHandler {
  const secrets = deps.secrets ?? defaultSecretStore();
  const readSettings = deps.readSettings ?? defaultReadSettings;
  const writeSettings = deps.writeSettings ?? defaultWriteSettings;
  const rawFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deviceFlowHttpFetch = createDeviceFlowHttpFetch(rawFetch);
  const githubIntegration = new GitHubIntegration();

  const flows = new Map<string, DeviceFlowRecord>();
  let activeFlowId: string | null = null;

  async function runDeviceFlow(flowId: string, config: ResolvedClientConfig, start: DeviceCodeFlowStart): Promise<void> {
    const record = flows.get(flowId);
    if (!record) return;
    try {
      const tokenSet = await pollDeviceCodeFlow(config, deviceFlowHttpFetch, start, now, sleep);
      const current = flows.get(flowId);
      if (!current || current.superseded) return;
      const identity = await fetchGithubUser(tokenSet.accessToken, rawFetch);
      if (!identity) {
        current.status = "error";
        current.error = "Device flow succeeded but the GitHub user lookup failed.";
        return;
      }
      await secrets.set(TOKEN_KEY, tokenSet.accessToken);
      await writeSettings((cur) => ({
        ...cur,
        tokenSource: "device",
        login: identity.login,
        scopes: identity.scopes,
      }));
      current.status = "complete";
      current.login = identity.login;
    } catch (err) {
      const current = flows.get(flowId);
      if (!current || current.superseded) return;
      if (err instanceof OAuthFlowError) {
        if (err.reason === "device-code-expired") {
          current.status = "expired";
          current.error = err.message;
          return;
        }
        const kind = classifyRejection(err.message);
        current.status = kind;
        current.error = err.message;
        return;
      }
      current.status = "error";
      current.error = err instanceof Error ? err.message : String(err);
    }
  }

  // ─── auth handlers ─────────────────────────────────────────────────────────

  async function handleAuthStatus(): Promise<Response> {
    const settings = await readSettings();
    const token = await secrets.get(TOKEN_KEY);
    if (!token) {
      return json({ authenticated: false, clientIdConfigured: settings.clientId.length > 0 });
    }
    return json({
      authenticated: true,
      ...(settings.login ? { login: settings.login } : {}),
      ...(settings.scopes ? { scopes: settings.scopes } : {}),
      ...(settings.tokenSource ? { tokenSource: settings.tokenSource } : {}),
      clientIdConfigured: settings.clientId.length > 0,
    });
  }

  async function handleSetClientId(req: Request): Promise<Response> {
    const body = await readJsonBody(req);
    if (typeof body["clientId"] !== "string") return badRequest("A clientId string is required (empty string clears it).");
    const clientId = body["clientId"].trim();
    await writeSettings((cur) => ({ ...cur, clientId }));
    return json({ ok: true });
  }

  async function handleDeviceStart(): Promise<Response> {
    const settings = await readSettings();
    if (!settings.clientId) return json({ error: "client-not-configured" }, 409);

    const config = buildGithubClientConfig(settings.clientId);
    let start: DeviceCodeFlowStart;
    try {
      start = await beginDeviceCodeFlow(config, deviceFlowHttpFetch, now());
    } catch (err) {
      if (err instanceof OAuthFlowError && err.reason === "client-not-configured") {
        return json({ error: "client-not-configured" }, 409);
      }
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }

    if (activeFlowId) {
      const previous = flows.get(activeFlowId);
      if (previous) previous.superseded = true;
    }
    const flowId = crypto.randomUUID();
    flows.set(flowId, { status: "pending", superseded: false });
    activeFlowId = flowId;
    void runDeviceFlow(flowId, config, start);

    return json({
      flowId,
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresAt: start.expiresAt,
      intervalMs: start.intervalMs,
    });
  }

  function handleDevicePoll(url: URL): Response {
    const flowId = url.searchParams.get("flowId") ?? "";
    const record = flowId ? flows.get(flowId) : undefined;
    if (!record) return json({ status: "error", error: "Unknown or expired flow id." });
    if (record.superseded) return json({ status: "error", error: "Superseded by a newer device flow." });
    return json({
      status: record.status,
      ...(record.login ? { login: record.login } : {}),
      ...(record.error ? { error: record.error } : {}),
    });
  }

  async function handlePutToken(req: Request): Promise<Response> {
    const body = await readJsonBody(req);
    const token = readString(body, "token");
    if (!token) return badRequest("A token is required.");

    const res = await githubApiFetch(rawFetch, "/user", token);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json({ error: `GitHub rejected that token (HTTP ${res.status}).${detail ? ` ${detail.slice(0, 200)}` : ""}` }, 401);
    }
    const identityBody = (await res.json().catch(() => null)) as { login?: unknown } | null;
    const login = identityBody && typeof identityBody.login === "string" ? identityBody.login : "";
    if (!login) return json({ error: "GitHub accepted the token but returned no login." }, 401);
    const scopesHeader = res.headers.get("x-oauth-scopes");
    const scopes = scopesHeader
      ? scopesHeader
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    await secrets.set(TOKEN_KEY, token);
    await writeSettings((cur) => ({ ...cur, tokenSource: "pat", login, scopes }));
    return json({ login, scopes });
  }

  async function handleDeleteToken(): Promise<Response> {
    await secrets.delete(TOKEN_KEY);
    await writeSettings((cur) => ({ clientId: cur.clientId }));
    return json({ ok: true });
  }

  // ─── proxied reads ───────────────────────────────────────────────────────

  async function requireToken(): Promise<string | Response> {
    const token = await secrets.get(TOKEN_KEY);
    if (!token) return json({ error: "Not authenticated with GitHub." }, 401);
    return token;
  }

  async function proxyGet(path: string, token: string): Promise<Response> {
    try {
      const res = await githubApiFetch(rawFetch, path, token);
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  async function handleUser(): Promise<Response> {
    const tokenOrResp = await requireToken();
    if (typeof tokenOrResp !== "string") return tokenOrResp;
    return proxyGet("/user", tokenOrResp);
  }

  async function handleRepos(url: URL): Promise<Response> {
    const tokenOrResp = await requireToken();
    if (typeof tokenOrResp !== "string") return tokenOrResp;
    const params = new URLSearchParams({ sort: "updated" });
    const page = url.searchParams.get("page");
    const perPage = url.searchParams.get("per_page");
    if (page) params.set("page", page);
    if (perPage) params.set("per_page", perPage);
    return proxyGet(`/user/repos?${params.toString()}`, tokenOrResp);
  }

  async function handlePulls(url: URL): Promise<Response> {
    const tokenOrResp = await requireToken();
    if (typeof tokenOrResp !== "string") return tokenOrResp;
    const owner = url.searchParams.get("owner") ?? "";
    const repo = url.searchParams.get("repo") ?? "";
    if (!owner || !repo) return badRequest("owner and repo query params are required.");
    const state = url.searchParams.get("state") ?? "open";
    return proxyGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${encodeURIComponent(state)}`, tokenOrResp);
  }

  async function handleIssues(url: URL): Promise<Response> {
    const tokenOrResp = await requireToken();
    if (typeof tokenOrResp !== "string") return tokenOrResp;
    const owner = url.searchParams.get("owner") ?? "";
    const repo = url.searchParams.get("repo") ?? "";
    if (!owner || !repo) return badRequest("owner and repo query params are required.");
    const state = url.searchParams.get("state") ?? "open";
    return proxyGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${encodeURIComponent(state)}`, tokenOrResp);
  }

  async function handleRateLimit(): Promise<Response> {
    const tokenOrResp = await requireToken();
    if (typeof tokenOrResp !== "string") return tokenOrResp;
    return proxyGet("/rate_limit", tokenOrResp);
  }

  // ─── SDK-backed writes ───────────────────────────────────────────────────

  async function handlePrComment(req: Request): Promise<Response> {
    const tokenOrResp = await requireToken();
    if (typeof tokenOrResp !== "string") return tokenOrResp;
    const body = await readJsonBody(req);
    const owner = readString(body, "owner");
    const repo = readString(body, "repo");
    const prNumber = readNumber(body, "prNumber");
    const commentBody = readString(body, "body");
    if (!owner || !repo || prNumber === null || !commentBody) {
      return badRequest("owner, repo, prNumber, and body are required.");
    }
    try {
      await githubIntegration.postPRComment(owner, repo, prNumber, commentBody, tokenOrResp);
      return json({ ok: true });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  async function handlePrReview(req: Request): Promise<Response> {
    const tokenOrResp = await requireToken();
    if (typeof tokenOrResp !== "string") return tokenOrResp;
    const body = await readJsonBody(req);
    const owner = readString(body, "owner");
    const repo = readString(body, "repo");
    const prNumber = readNumber(body, "prNumber");
    const reviewBody = readString(body, "body");
    const event = body["event"];
    if (event !== "APPROVE" && event !== "REQUEST_CHANGES" && event !== "COMMENT") {
      return badRequest('event must be "APPROVE", "REQUEST_CHANGES", or "COMMENT".');
    }
    if (!owner || !repo || prNumber === null) {
      return badRequest("owner, repo, and prNumber are required.");
    }
    try {
      await githubIntegration.postPRReview(owner, repo, prNumber, reviewBody, event, tokenOrResp);
      return json({ ok: true });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  async function handleIssueComment(req: Request): Promise<Response> {
    const tokenOrResp = await requireToken();
    if (typeof tokenOrResp !== "string") return tokenOrResp;
    const body = await readJsonBody(req);
    const owner = readString(body, "owner");
    const repo = readString(body, "repo");
    const issueNumber = readNumber(body, "issueNumber");
    const commentBody = readString(body, "body");
    if (!owner || !repo || issueNumber === null || !commentBody) {
      return badRequest("owner, repo, issueNumber, and body are required.");
    }
    try {
      await githubIntegration.postIssueComment(owner, repo, issueNumber, commentBody, tokenOrResp);
      return json({ ok: true });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  // ─── dispatch ────────────────────────────────────────────────────────────

  return async (req, url) => {
    const sub = url.pathname.slice("/app/github".length); // "", "/auth/status", "/pulls", …
    const method = req.method;

    try {
      if (sub === "/auth/status" && method === "GET") return handleAuthStatus();
      if (sub === "/auth/client-id" && method === "PUT") return handleSetClientId(req);
      if (sub === "/auth/device/start" && method === "POST") return handleDeviceStart();
      if (sub === "/auth/device/poll" && method === "GET") return handleDevicePoll(url);
      if (sub === "/auth/token" && method === "PUT") return handlePutToken(req);
      if (sub === "/auth/token" && method === "DELETE") return handleDeleteToken();

      if (sub === "/user" && method === "GET") return handleUser();
      if (sub === "/repos" && method === "GET") return handleRepos(url);
      if (sub === "/pulls" && method === "GET") return handlePulls(url);
      if (sub === "/issues" && method === "GET") return handleIssues(url);
      if (sub === "/rate-limit" && method === "GET") return handleRateLimit();

      if (sub === "/pr-comment" && method === "POST") return handlePrComment(req);
      if (sub === "/pr-review" && method === "POST") return handlePrReview(req);
      if (sub === "/issue-comment" && method === "POST") return handleIssueComment(req);

      return notFound(`No github route for ${method} ${url.pathname}.`);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  };
}

// ─── shared GitHub REST fetch (10s timeout, standard headers, token never forwarded to the browser) ──

async function githubApiFetch(fetchImpl: typeof fetch, path: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  try {
    return await fetchImpl(`${GITHUB_API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
