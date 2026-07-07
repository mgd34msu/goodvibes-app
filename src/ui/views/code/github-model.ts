// GitHub panel model (docs/FEATURES.md §15 rows 5-7; docs/GAPS.md §15 rows
// 5-7): typed client for the app-local /app/github/* routes the app itself
// now serves (src/bun/github.ts, built in parallel — this file is coded
// against its contract verbatim, not against that module's source).
//
// Two shape families live behind this one client:
//  - auth/* responses are app-normalized camelCase JSON the Bun module
//    produces itself (authenticated, tokenSource, clientIdConfigured, …).
//  - user / repos / pulls / issues / rate-limit / pr-comment / pr-review /
//    issue-comment are STRAIGHT PROXIES of GitHub's REST API — the raw
//    snake_case shapes GitHub returns (html_url, created_at, user.login, …).
// Same idiom as git-api.ts: this is a fixed app-local contract, not a
// variable-shape daemon wire route, so plain typed fetches are used rather
// than the defensive lib/wire.ts readers.

import { appFetch, appJson, HttpError } from "../../lib/http.ts";
import { errorStatus } from "../../lib/errors.ts";
import type { GitRemote } from "./git-api.ts";

// ─── query keys (own "githubApp" prefix — never codeKeys.git) ───────────────

export const githubAppKeys = {
  root: ["githubApp"] as const,
  authStatus: ["githubApp", "authStatus"] as const,
  rateLimit: ["githubApp", "rateLimit"] as const,
  pulls: (owner: string, repo: string, state: GitHubStateFilter) =>
    ["githubApp", "pulls", owner, repo, state] as const,
  issues: (owner: string, repo: string, state: GitHubStateFilter) =>
    ["githubApp", "issues", owner, repo, state] as const,
} as const;

export type GitHubStateFilter = "open" | "closed" | "all";

// ─── auth shapes (app-normalized) ────────────────────────────────────────────

export type GitHubTokenSource = "device" | "pat";

export interface GitHubAuthStatus {
  authenticated: boolean;
  login?: string;
  scopes?: string[];
  tokenSource?: GitHubTokenSource;
  clientIdConfigured: boolean;
}

export interface GitHubDeviceStart {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
}

export type GitHubDevicePollStatus = "pending" | "complete" | "expired" | "denied" | "error";

export interface GitHubDevicePoll {
  status: GitHubDevicePollStatus;
  login?: string;
  error?: string;
}

export interface GitHubTokenSaveResult {
  login: string;
  scopes: string[];
}

// ─── proxied GitHub REST shapes (raw snake_case, minimal fields used here) ──

export interface GitHubUserRef {
  login: string;
  avatar_url?: string;
  html_url?: string;
}

export interface GitHubPull {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  user: GitHubUserRef | null;
  draft?: boolean;
  merged_at?: string | null;
  created_at: string;
  updated_at: string;
  head: { ref: string; sha: string };
  base: { ref: string };
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  user: GitHubUserRef | null;
  created_at: string;
  updated_at: string;
  comments: number;
  /** Present when the issues endpoint is echoing back a PR — filter these out. */
  pull_request?: unknown;
}

export interface GitHubRateResource {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

export interface GitHubRateLimit {
  resources: Record<string, GitHubRateResource | undefined>;
  rate?: GitHubRateResource;
}

// The three write endpoints wrap SDK GitHubIntegration.post* methods, which
// return void — the app-local routes answer with a plain {ok:true} rather than
// the created comment/review object, so callers key off resolution only.
export interface GitHubWriteAck {
  ok: true;
}

// ─── fetchers ────────────────────────────────────────────────────────────────

function put<T>(path: string, body: unknown): Promise<T> {
  return appJson<T>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function post<T>(path: string, body: unknown): Promise<T> {
  return appJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function del(path: string): Promise<{ ok: true }> {
  const res = await appFetch(path, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, path, body);
  }
  return { ok: true };
}

export const githubApi = {
  authStatus: () => appJson<GitHubAuthStatus>("/app/github/auth/status"),
  saveClientId: (clientId: string) => put<{ ok: true }>("/app/github/auth/client-id", { clientId }),
  deviceStart: () => post<GitHubDeviceStart>("/app/github/auth/device/start", {}),
  devicePoll: (flowId: string) =>
    appJson<GitHubDevicePoll>(`/app/github/auth/device/poll?flowId=${encodeURIComponent(flowId)}`),
  saveToken: (token: string) => put<GitHubTokenSaveResult>("/app/github/auth/token", { token }),
  signOut: () => del("/app/github/auth/token"),

  rateLimit: () => appJson<GitHubRateLimit>("/app/github/rate-limit"),

  pulls: (owner: string, repo: string, state: GitHubStateFilter) =>
    appJson<GitHubPull[]>(
      `/app/github/pulls?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&state=${state}`,
    ),
  issues: (owner: string, repo: string, state: GitHubStateFilter) =>
    appJson<GitHubIssue[]>(
      `/app/github/issues?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&state=${state}`,
    ),

  prComment: (owner: string, repo: string, prNumber: number, body: string) =>
    post<GitHubWriteAck>("/app/github/pr-comment", { owner, repo, prNumber, body }),
  prReview: (owner: string, repo: string, prNumber: number, body: string, event: GitHubReviewEvent) =>
    post<GitHubWriteAck>("/app/github/pr-review", { owner, repo, prNumber, body, event }),
  issueComment: (owner: string, repo: string, issueNumber: number, body: string) =>
    post<GitHubWriteAck>("/app/github/issue-comment", { owner, repo, issueNumber, body }),
} as const;

export type GitHubReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

// ─── error helpers ───────────────────────────────────────────────────────────

/** POST /auth/device/start refuses with 409 when no client id is saved yet. */
export function isClientNotConfiguredError(error: unknown): boolean {
  return errorStatus(error) === 409;
}

/** PUT /auth/token refuses a bad/unreachable token with 401. */
export function isTokenRejectedError(error: unknown): boolean {
  return errorStatus(error) === 401;
}

// ─── display helpers ─────────────────────────────────────────────────────────

/** Issues endpoints echo PRs back too — real issue rows never carry this key. */
export function isRealIssue(issue: GitHubIssue): boolean {
  return issue.pull_request === undefined;
}

export function formatRateReset(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "unknown";
  return new Date(unixSeconds * 1000).toLocaleTimeString();
}

// ─── owner/repo derivation from the existing git remotes list ───────────────

const GITHUB_REMOTE_RE = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const m = GITHUB_REMOTE_RE.exec(url.trim());
  if (!m) return null;
  const [, owner, repo] = m;
  return owner && repo ? { owner, repo } : null;
}

/**
 * Picks the "origin" remote first (falling back to any other configured
 * remote) and parses owner/repo out of its fetch or push URL. Returns null
 * when there are no remotes, or none of them point at github.com — an honest
 * "no repo context" state the panel renders as a placeholder, not an error.
 */
export function githubRepoFromRemotes(remotes: GitRemote[]): { owner: string; repo: string } | null {
  if (remotes.length === 0) return null;
  const origin = remotes.find((r) => r.name === "origin");
  const ordered = origin ? [origin, ...remotes.filter((r) => r.name !== "origin")] : remotes;
  for (const remote of ordered) {
    const parsed = parseGitHubUrl(remote.fetchUrl) ?? (remote.pushUrl ? parseGitHubUrl(remote.pushUrl) : null);
    if (parsed) return parsed;
  }
  return null;
}
