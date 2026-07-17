// Worktrees view — merges TWO independent sources into one table with honest
// per-source labels (docs/FEATURES.md §15):
//   1. worktrees.snapshot — the daemon's agent-worktree awareness (HTTP GET
//      /api/worktrees per the generated route table; payload shape read
//      defensively — daemon 1.0.0 may 404 the method entirely).
//   2. /app/git/worktrees — `git worktree list --porcelain` on the app's own
//      workspace repo (src/bun/git.ts).
// Rows are merged by normalized path; each row shows which source(s) know it.
// Neither source has wire events — targeted 30s poll.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, RefreshCw, Trash2, Wrench } from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { gv, listFrom } from "../../lib/gv.ts";
import {
  isMethodUnavailableError,
  isMethodNotInvokableError,
  isWsBridgeUnavailableError,
  formatError,
} from "../../lib/errors.ts";
import { asRecord, firstString } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { codeKeys, gitApi, isGitMissingError, isNotARepoError, type GitLocalWorktree } from "./git-api.ts";
import {
  failingSetupSteps,
  formatSetupSummary,
  parseDiscardReceipt,
  parseWorktreeSetupResult,
  useWorktreeDiscard,
  useWorktreeSetupRun,
  type WorktreeSetupResult,
} from "./worktrees-actions.ts";
import { WorkspacesPanel } from "./WorkspacesPanel.tsx";

const POLL_MS = 30_000; // no wire events for worktrees.* or app-local git

interface DaemonWorktree {
  path: string;
  branch: string;
  status: string;
  session: string;
  setup: WorktreeSetupResult | null;
  raw: unknown;
}

function parseDaemonWorktrees(data: unknown): DaemonWorktree[] {
  // worktrees.snapshot's real wire shape (operator-contract.json) is
  // {summary, records:[...]}. "worktrees"/"items"/"entries" are defensive
  // fallbacks kept for daemon builds that serialize differently — "records"
  // is the confirmed-live key and must come first.
  return listFrom(data, ["records", "worktrees", "items", "entries"]).map((item) => {
    const record = asRecord(item);
    return {
      path: firstString(record, ["path", "worktreePath", "dir", "directory", "root"]),
      branch: firstString(record, ["branch", "branchName", "ref"]),
      status: firstString(record, ["status", "state", "phase"]),
      session: firstString(record, ["sessionId", "session", "agentId", "agent", "owner"]),
      setup: parseWorktreeSetupResult(record["setup"]),
      raw: item,
    };
  });
}

/** Capability-gap check shared by the setup-rerun and discard actions —
 * either a plain method-missing daemon or (both verbs are ws-only) a
 * disconnected ws bridge, same treatment CheckpointsView.tsx gives its own
 * all-ws-only checkpoints.* verbs. */
function isActionCapabilityGap(error: unknown): boolean {
  return isMethodUnavailableError(error) || isMethodNotInvokableError(error) || isWsBridgeUnavailableError(error);
}

function actionCapabilityLabel(error: unknown, base: string): string {
  return isWsBridgeUnavailableError(error) ? `${base} (ws bridge not connected)` : base;
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
  const { toast } = useToast();
  const [discardTarget, setDiscardTarget] = useState<string>("");

  const setupRun = useWorktreeSetupRun();
  const discard = useWorktreeDiscard();

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

  function runSetup(path: string) {
    setupRun.mutate(path, {
      onSuccess: (raw) => {
        void queryClient.invalidateQueries({ queryKey: codeKeys.daemonWorktrees });
        const record = asRecord(raw);
        const setup = parseWorktreeSetupResult(record["setup"]);
        toast({
          title: setup ? `Setup ${formatSetupSummary(setup)}` : "Setup ran",
          description: path,
          tone: setup?.state === "failed" ? "danger" : "success",
        });
      },
      onError: (error) => {
        toast({
          title: isActionCapabilityGap(error) ? "Setup not available" : "Setup failed",
          description: isActionCapabilityGap(error)
            ? `${actionCapabilityLabel(error, "worktrees.setup.run")} — ${path}`
            : formatError(error),
          tone: "danger",
        });
      },
    });
  }

  function confirmDiscard(meta: ConfirmMetadata) {
    const path = discardTarget;
    if (!path) return;
    discard.mutate(
      { path, meta },
      {
        onSuccess: (raw) => {
          setDiscardTarget("");
          void queryClient.invalidateQueries({ queryKey: codeKeys.daemonWorktrees });
          void queryClient.invalidateQueries({ queryKey: codeKeys.localWorktrees });
          const receipt = parseDiscardReceipt(raw, path);
          if (receipt.ok) {
            // The reassurance IS the feature — never a bare "discarded" toast.
            toast({
              title: "Worktree discarded",
              description: `Branch kept: ${receipt.branch || "(unknown)"} · Preserved commit: ${receipt.preservedCommit || "(none — nothing to preserve)"}${receipt.detail ? ` · ${receipt.detail}` : ""}`,
              tone: "success",
              durationMs: 10_000,
            });
          } else {
            toast({
              title: "Discard refused",
              description: receipt.detail || `${path} was not discarded.`,
              tone: "danger",
            });
          }
        },
        onError: (error) => {
          setDiscardTarget("");
          toast({
            title: isActionCapabilityGap(error) ? "Discard not available" : "Discard failed",
            description: isActionCapabilityGap(error)
              ? `${actionCapabilityLabel(error, "worktrees.discard")} — ${path}`
              : formatError(error),
            tone: "danger",
          });
        },
      },
    );
  }

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
          {merged.map((row) => {
            const setup = row.daemon?.setup ?? null;
            const setupPending = setupRun.isPending && setupRun.variables === row.path;
            const discardPending = discard.isPending && discard.variables?.path === row.path;
            const canAct = row.path && row.path !== "(path not reported)";
            return (
              <li key={row.path} className={setup?.state === "failed" ? "worktrees-row worktrees-row--setup-failed" : "worktrees-row"}>
                <div className="worktrees-row__main">
                  <code className="worktrees-row__path" title={row.path}>
                    {row.path}
                  </code>
                  <span className="worktrees-row__sources">
                    {row.local && <span className="badge neutral">local git</span>}
                    {row.daemon && <span className="badge info">daemon</span>}
                  </span>
                  {canAct && (
                    <span className="worktrees-row__actions">
                      <button
                        type="button"
                        className="git-mini-button"
                        title="Re-run cold-start setup for this worktree"
                        disabled={setupPending}
                        onClick={() => runSetup(row.path)}
                      >
                        <Wrench size={12} aria-hidden="true" /> {setupPending ? "Running…" : "Run setup"}
                      </button>
                      <button
                        type="button"
                        className="git-mini-button git-mini-button--danger"
                        title="Discard this worktree (branch kept)"
                        disabled={discardPending}
                        onClick={() => setDiscardTarget(row.path)}
                      >
                        <Trash2 size={12} aria-hidden="true" /> {discardPending ? "Discarding…" : "Discard"}
                      </button>
                    </span>
                  )}
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
                {/* Persisted setup outcome — visible on the row until a fresh
                    run changes it, sourced from the daemon's own record so it
                    survives reloads (never a locally-fabricated "pending"
                    guess). A failed setup never hides behind a good-looking
                    row. */}
                {setup && (
                  <div className="worktrees-row__setup" role="note">
                    <span className={`badge ${setup.state === "failed" ? "bad" : setup.state === "succeeded" ? "ok" : "neutral"}`}>
                      setup: {formatSetupSummary(setup)}
                    </span>
                    {setup.state === "failed" && (
                      <ul className="worktrees-row__setup-steps">
                        {failingSetupSteps(setup).map((step, index) => (
                          <li key={`${step.label}-${index}`}>
                            <strong>
                              {step.kind} — {step.label}
                              {typeof step.exitCode === "number" ? ` (exit ${step.exitCode})` : ""}
                            </strong>
                            {step.output && <pre className="worktrees-row__setup-output">{step.output.slice(0, 2000)}</pre>}
                          </li>
                        ))}
                        {setup.error && !failingSetupSteps(setup).length && <li>{setup.error}</li>}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {daemon.isError && !daemonUnavailable && local.isError && (
        <p className="git-honest-note" role="note">
          Both sources failed — {formatError(local.error)}
        </p>
      )}

      <ConfirmSurface
        open={discardTarget !== ""}
        danger
        action="Discard worktree"
        target={discardTarget}
        blastRadius="The branch is KEPT — any dirty (uncommitted) state is first committed onto that branch as a preservation commit — then the worktree directory is removed. A preservation failure refuses the removal rather than losing work."
        requireTypedText="discard"
        confirmLabel={discard.isPending ? "Discarding…" : "Discard worktree"}
        onConfirm={confirmDiscard}
        onCancel={() => setDiscardTarget("")}
      />

      <WorkspacesPanel />
    </div>
  );
}
