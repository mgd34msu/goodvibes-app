// Typed client for the app-local /app/git/* routes (src/bun/git.ts) plus the
// LOCAL query-key registry for the Code views. Keys use the unique
// ["code", …] prefix — git/worktree data is app-local and has NO wire events,
// so freshness is targeted polling + mutation-driven invalidation (the
// checkpoints view alone rides lib/queries.ts queryKeys.checkpoints).

import { appJson } from "../../lib/http.ts";
import { errorCode } from "../../lib/errors.ts";

export const codeKeys = {
  git: ["code", "git"] as const,
  workspace: ["code", "git", "workspace"] as const,
  status: ["code", "git", "status"] as const,
  log: (ref: string, limit: number) => ["code", "git", "log", ref, limit] as const,
  branches: ["code", "git", "branches"] as const,
  stash: ["code", "git", "stash"] as const,
  diff: (mode: string, ref: string) => ["code", "git", "diff", mode, ref] as const,
  localWorktrees: ["code", "git", "worktrees"] as const,
  daemonWorktrees: ["code", "worktrees", "daemon"] as const,
} as const;

// ─── shapes (mirror src/bun/git.ts responses; parsed defensively) ────────────

export interface GitWorkspace {
  workspaceDir: string;
  isRepo: boolean;
  gitVersion: string;
  source: string;
}

export interface GitFileEntry {
  path: string;
  xy: string;
  origPath?: string;
}

export interface GitGuard {
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
}

export interface GitStatus {
  workspaceDir: string;
  branch: { name: string; oid: string; upstream: string; ahead: number; behind: number };
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
  conflicted: GitFileEntry[];
  guard: GitGuard;
}

export interface GitCommitRecord {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  parents: string[];
  subject: string;
  body: string;
}

export interface GitBranch {
  name: string;
  sha: string;
  current: boolean;
  upstream: string;
  committedAt: string;
}

export interface GitStashEntry {
  ref: string;
  sha: string;
  date: string;
  message: string;
}

export interface GitDiffResponse {
  mode: string;
  ref: string;
  path: string;
  diff: string;
  truncated: boolean;
}

export interface GitLocalWorktree {
  path: string;
  head: string;
  branch: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string;
  prunable: boolean;
}

export type DiffMode = "working" | "staged" | "ref";

// ─── fetchers ────────────────────────────────────────────────────────────────

function post<T>(path: string, body: unknown): Promise<T> {
  return appJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const gitApi = {
  workspace: () => appJson<GitWorkspace>("/app/git/workspace"),
  status: () => appJson<GitStatus>("/app/git/status"),
  log: (options?: { ref?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.ref) params.set("ref", options.ref);
    if (options?.limit) params.set("limit", String(options.limit));
    const qs = params.toString();
    return appJson<{ commits: GitCommitRecord[]; limit: number; note?: string }>(
      `/app/git/log${qs ? `?${qs}` : ""}`,
    );
  },
  branches: () => appJson<{ local: GitBranch[]; remote: GitBranch[] }>("/app/git/branches"),
  diff: (mode: DiffMode, ref?: string, path?: string) => {
    const params = new URLSearchParams({ mode });
    if (ref) params.set("ref", ref);
    if (path) params.set("path", path);
    return appJson<GitDiffResponse>(`/app/git/diff?${params.toString()}`);
  },
  stage: (paths: string[]) => post<{ ok: boolean; guard?: GitGuard }>("/app/git/stage", { paths }),
  unstage: (paths: string[]) => post<{ ok: boolean; guard?: GitGuard }>("/app/git/unstage", { paths }),
  commit: (message: string) => post<{ ok: boolean; hash: string; summary: string }>("/app/git/commit", { message }),
  stashList: () => appJson<{ stashes: GitStashEntry[] }>("/app/git/stash"),
  stashPush: (message: string, includeUntracked: boolean) =>
    post<{ ok: boolean; noop: boolean; note?: string; summary?: string }>("/app/git/stash/push", {
      message: message || undefined,
      includeUntracked,
    }),
  stashPop: (ref?: string) => post<{ ok: boolean; summary?: string }>("/app/git/stash/pop", ref ? { ref } : {}),
  worktrees: () => appJson<{ worktrees: GitLocalWorktree[] }>("/app/git/worktrees"),
} as const;

// ─── error helpers ───────────────────────────────────────────────────────────

/** The workspace dir is not a git repository — a normal state, not a failure. */
export function isNotARepoError(error: unknown): boolean {
  return errorCode(error) === "GIT_NOT_A_REPO";
}

/** The git binary is missing from PATH (Bun side reports 501). */
export function isGitMissingError(error: unknown): boolean {
  return errorCode(error) === "GIT_BINARY_MISSING";
}

// ─── display helpers ─────────────────────────────────────────────────────────

/** Human label for a porcelain-v2 XY code, index (staged) side. */
export function stagedStatusLabel(xy: string): string {
  return STATUS_LABELS[xy[0] ?? "."] ?? xy;
}

/** Human label for a porcelain-v2 XY code, worktree (unstaged) side. */
export function unstagedStatusLabel(xy: string): string {
  return STATUS_LABELS[xy[1] ?? "."] ?? xy;
}

const STATUS_LABELS: Record<string, string> = {
  M: "modified",
  T: "type changed",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflict",
  ".": "unchanged",
};

export function formatCommitDate(iso: string): string {
  if (!iso) return "unknown date";
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : iso;
}
