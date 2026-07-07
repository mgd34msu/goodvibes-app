// Worktrees view — merges TWO independent sources into one table with honest
// per-source labels (docs/FEATURES.md §15):
//   1. worktrees.snapshot — the daemon's agent-worktree awareness (HTTP GET
//      /api/worktrees per the generated route table; payload shape read
//      defensively — daemon 1.0.0 may 404 the method entirely).
//   2. /app/git/worktrees — `git worktree list --porcelain` on the app's own
//      workspace repo (src/bun/git.ts).
// Rows are merged by normalized path; each row shows which source(s) know it.
// Neither source has wire events — targeted 30s poll.

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, RefreshCw } from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { gv, listFrom } from "../../lib/gv.ts";
import { isMethodUnavailableError, isMethodNotInvokableError, formatError } from "../../lib/errors.ts";
import { asRecord, firstString } from "../../lib/wire.ts";
import { codeKeys, gitApi, isGitMissingError, isNotARepoError, type GitLocalWorktree } from "./git-api.ts";

const POLL_MS = 30_000; // no wire events for worktrees.* or app-local git

interface DaemonWorktree {
  path: string;
  branch: string;
  status: string;
  session: string;
  raw: unknown;
}

function parseDaemonWorktrees(data: unknown): DaemonWorktree[] {
  return listFrom(data, ["worktrees", "items", "entries"]).map((item) => {
    const record = asRecord(item);
    return {
      path: firstString(record, ["path", "worktreePath", "dir", "directory", "root"]),
      branch: firstString(record, ["branch", "branchName", "ref"]),
      status: firstString(record, ["status", "state", "phase"]),
      session: firstString(record, ["sessionId", "session", "agentId", "agent", "owner"]),
      raw: item,
    };
  });
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

interface MergedRow {
  path: string;
  daemon: DaemonWorktree | null;
  local: GitLocalWorktree | null;
}

export function WorktreesView() {
  const queryClient = useQueryClient();

  const daemon = useQuery({
    queryKey: codeKeys.daemonWorktrees,
    queryFn: () => gv.invoke("worktrees.snapshot"),
    refetchInterval: POLL_MS,
    retry: false,
  });

  const local = useQuery({
    queryKey: codeKeys.localWorktrees,
    queryFn: gitApi.worktrees,
    refetchInterval: POLL_MS,
    retry: false,
  });

  const daemonRows = useMemo(() => (daemon.isSuccess ? parseDaemonWorktrees(daemon.data) : []), [daemon.isSuccess, daemon.data]);
  const localRows = local.data?.worktrees ?? [];

  const merged = useMemo<MergedRow[]>(() => {
    const byPath = new Map<string, MergedRow>();
    for (const wt of localRows) {
      const key = normalizePath(wt.path);
      byPath.set(key, { path: wt.path, daemon: null, local: wt });
    }
    for (const wt of daemonRows) {
      const key = normalizePath(wt.path);
      const existing = wt.path ? byPath.get(key) : undefined;
      if (existing) existing.daemon = wt;
      else byPath.set(key || `daemon:${byPath.size}`, { path: wt.path || "(path not reported)", daemon: wt, local: null });
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  }, [daemonRows, localRows]);

  const daemonUnavailable =
    daemon.isError && (isMethodUnavailableError(daemon.error) || isMethodNotInvokableError(daemon.error));
  const localNotARepo = local.isError && isNotARepoError(local.error);

  const bothPending = daemon.isPending && local.isPending;
  const anySuccess = daemon.isSuccess || local.isSuccess;

  return (
    <div className="worktrees-view">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <GitBranch size={14} aria-hidden="true" /> Worktrees
          {anySuccess ? ` · ${merged.length}` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh worktrees"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: codeKeys.daemonWorktrees });
            void queryClient.invalidateQueries({ queryKey: codeKeys.localWorktrees });
          }}
        >
          <RefreshCw
            size={15}
            aria-hidden="true"
            className={daemon.isFetching || local.isFetching ? "spinning" : undefined}
          />
        </button>
      </div>

      {/* Per-source health, always visible — the merge must never hide that a
          source is down (honest per-source labels are the row's spec). */}
      <div className="worktrees-sources">
        <span className={`worktrees-source ${daemon.isSuccess ? "worktrees-source--ok" : daemon.isError ? "worktrees-source--bad" : ""}`}>
          daemon worktrees.snapshot:{" "}
          {daemon.isPending ? "loading…" : daemon.isSuccess ? `${daemonRows.length} entries` : daemonUnavailable ? "unavailable" : "error"}
        </span>
        <span className={`worktrees-source ${local.isSuccess ? "worktrees-source--ok" : local.isError ? "worktrees-source--bad" : ""}`}>
          local git worktree list:{" "}
          {local.isPending ? "loading…" : local.isSuccess ? `${localRows.length} entries` : localNotARepo ? "not a repo" : "error"}
        </span>
      </div>

      {daemonUnavailable && (
        <UnavailableState
          capability="worktrees.snapshot"
          description="agent-worktree awareness from the daemon is missing; only the local git listing below is shown."
        />
      )}
      {daemon.isError && !daemonUnavailable && (
        <ErrorState error={daemon.error} onRetry={() => void daemon.refetch()} title="Daemon worktree snapshot failed" />
      )}

      {local.isError && localNotARepo && (
        <p className="git-honest-note" role="note">
          Local source skipped: the workspace directory is not a git repository.
        </p>
      )}
      {local.isError && !localNotARepo && (
        <>
          {isGitMissingError(local.error) ? (
            <UnavailableState capability="git (system binary)" description="the git executable was not found on PATH." />
          ) : (
            <ErrorState error={local.error} onRetry={() => void local.refetch()} title="Local git worktree list failed" />
          )}
        </>
      )}

      {bothPending && <SkeletonBlock variant="text" lines={4} />}

      {anySuccess && merged.length === 0 && (
        <EmptyState
          icon={<GitBranch size={28} aria-hidden="true" />}
          title="No worktrees"
          description="Neither the daemon snapshot nor the local repository reports any worktrees."
        />
      )}

      {merged.length > 0 && (
        <ul className="worktrees-rows">
          {merged.map((row) => (
            <li key={row.path} className="worktrees-row">
              <div className="worktrees-row__main">
                <code className="worktrees-row__path" title={row.path}>
                  {row.path}
                </code>
                <span className="worktrees-row__sources">
                  {row.local && <span className="badge neutral">local git</span>}
                  {row.daemon && <span className="badge info">daemon</span>}
                </span>
              </div>
              <div className="worktrees-row__meta">
                {row.local && (
                  <>
                    <span className="worktrees-row__fact">
                      branch: <code>{row.local.detached ? "(detached)" : row.local.branch || "unknown"}</code>
                    </span>
                    {row.local.head && (
                      <span className="worktrees-row__fact">
                        HEAD: <code>{row.local.head.slice(0, 12)}</code>
                      </span>
                    )}
                    {row.local.bare && <span className="badge neutral">bare</span>}
                    {row.local.locked && (
                      <span className="badge warning" title={row.local.lockReason || undefined}>
                        locked
                      </span>
                    )}
                    {row.local.prunable && <span className="badge warning">prunable</span>}
                  </>
                )}
                {row.daemon && (
                  <>
                    {row.daemon.branch && (
                      <span className="worktrees-row__fact">
                        daemon branch: <code>{row.daemon.branch}</code>
                      </span>
                    )}
                    {row.daemon.status && <span className="badge neutral">{row.daemon.status}</span>}
                    {row.daemon.session && (
                      <span className="worktrees-row__fact">
                        session: <code>{row.daemon.session}</code>
                      </span>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {daemon.isError && !daemonUnavailable && local.isError && (
        <p className="git-honest-note" role="note">
          Both sources failed — {formatError(local.error)}
        </p>
      )}
    </div>
  );
}
