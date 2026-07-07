// Git view — workspace status master (docs/FEATURES.md §15): staged /
// unstaged / untracked / conflicted groups with per-file stage/unstage, a
// commit composer that refuses no-op commits with visible reasons, a bounded
// log with a detail peek, a read-only branch list (checkout is NOT wired in
// this wave — honest note), and a stash panel. All data is app-local
// (/app/git/* — src/bun/git.ts): no wire events exist, so freshness is a
// targeted 15s status poll + mutation-driven invalidation of the
// ["code","git"] prefix.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGit2, GitBranch, GitCommitHorizontal, History, Layers, RefreshCw } from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import {
  codeKeys,
  gitApi,
  isGitMissingError,
  isNotARepoError,
  stagedStatusLabel,
  unstagedStatusLabel,
  formatCommitDate,
  type GitCommitRecord,
  type GitFileEntry,
  type GitStashEntry,
  type GitStatus,
} from "./git-api.ts";
import { jumpToDiff } from "./diff-model.ts";

const STATUS_POLL_MS = 15_000; // no wire events for app-local git — targeted poll
const LISTS_POLL_MS = 30_000;
const LOG_LIMIT = 50;

export function GitView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const workspace = useQuery({
    queryKey: codeKeys.workspace,
    queryFn: gitApi.workspace,
    staleTime: 60_000,
    retry: false,
  });
  const repoOk = workspace.data?.isRepo === true;

  const status = useQuery({
    queryKey: codeKeys.status,
    queryFn: gitApi.status,
    enabled: repoOk,
    refetchInterval: STATUS_POLL_MS,
    retry: false,
  });

  const refreshAll = () => void queryClient.invalidateQueries({ queryKey: codeKeys.git });

  // Palette command — view-scoped, live only while mounted.
  useEffect(() => {
    registerCommand({
      id: "git.refresh",
      title: "Refresh Git Status",
      group: "code",
      keywords: ["git", "status", "reload"],
      run: refreshAll,
    });
    return () => unregisterCommand("git.refresh");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: codeKeys.git });

  const stage = useMutation({
    mutationFn: (paths: string[]) => gitApi.stage(paths),
    onSuccess: () => void invalidate(),
    onError: (error: unknown) => toast({ title: "Stage failed", description: formatError(error), tone: "danger" }),
  });
  const unstage = useMutation({
    mutationFn: (paths: string[]) => gitApi.unstage(paths),
    onSuccess: () => void invalidate(),
    onError: (error: unknown) => toast({ title: "Unstage failed", description: formatError(error), tone: "danger" }),
  });

  // ── top-level gates ─────────────────────────────────────────────────────
  if (workspace.isPending) {
    return (
      <div className="git-view">
        <SkeletonBlock variant="text" lines={6} />
      </div>
    );
  }
  if (workspace.isError) {
    return (
      <div className="git-view">
        {isGitMissingError(workspace.error) ? (
          <UnavailableState
            capability="git (system binary)"
            description="the git executable was not found on PATH, so the Git, Diff, and Worktrees views cannot run."
          />
        ) : (
          <ErrorState
            error={workspace.error}
            onRetry={() => void workspace.refetch()}
            title="Failed to inspect the workspace"
          />
        )}
      </div>
    );
  }
  if (!repoOk) {
    return (
      <div className="git-view">
        <EmptyState
          icon={<FolderGit2 size={28} aria-hidden="true" />}
          title="Not a git repository"
          description={`The workspace directory ${workspace.data.workspaceDir} (${workspace.data.source}) is not inside a git repository. Initialize one there, or launch the app from a repo.`}
          action={{ label: "Re-check", onClick: () => void workspace.refetch() }}
        />
      </div>
    );
  }

  return (
    <div className="git-view">
      <GitHeader
        workspaceDir={workspace.data.workspaceDir}
        status={status.data}
        fetching={status.isFetching}
        onRefresh={refreshAll}
      />

      {status.isPending && <SkeletonBlock variant="text" lines={5} />}
      {status.isError && !isNotARepoError(status.error) && (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} title="Failed to load git status" />
      )}

      <div className="git-columns">
        <div className="git-column">
          {status.isSuccess && (
            <StatusGroups
              status={status.data}
              onStage={(paths) => stage.mutate(paths)}
              onUnstage={(paths) => unstage.mutate(paths)}
              staging={stage.isPending}
              unstaging={unstage.isPending}
            />
          )}
          {status.isSuccess && <CommitComposer status={status.data} />}
          <StashPanel enabled={repoOk} />
        </div>
        <div className="git-column">
          <LogSection enabled={repoOk} />
          <BranchesSection enabled={repoOk} />
        </div>
      </div>
    </div>
  );
}

// ─── header ──────────────────────────────────────────────────────────────────

function GitHeader({
  workspaceDir,
  status,
  fetching,
  onRefresh,
}: {
  workspaceDir: string;
  status: GitStatus | undefined;
  fetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="git-header">
      <div className="git-header__identity">
        <FolderGit2 size={16} aria-hidden="true" />
        <code className="git-header__dir" title={workspaceDir}>
          {workspaceDir}
        </code>
        {status && (
          <>
            <span className="badge neutral">
              <GitBranch size={11} aria-hidden="true" /> {status.branch.name || "(detached)"}
            </span>
            {status.branch.upstream && (
              <span className="badge info" title={`Upstream ${status.branch.upstream}`}>
                ↑{status.branch.ahead} ↓{status.branch.behind}
              </span>
            )}
            <span className={status.guard.dirty ? "badge warning" : "badge ok"}>
              {status.guard.dirty
                ? `dirty · ${status.guard.stagedCount} staged / ${status.guard.unstagedCount} unstaged / ${status.guard.untrackedCount} untracked`
                : "clean"}
            </span>
            {status.guard.conflictedCount > 0 && (
              <span className="badge bad">{status.guard.conflictedCount} conflicted</span>
            )}
          </>
        )}
      </div>
      <button type="button" className="section-toolbar__refresh" aria-label="Refresh git data" onClick={onRefresh}>
        <RefreshCw size={15} aria-hidden="true" className={fetching ? "spinning" : undefined} />
      </button>
    </div>
  );
}

// ─── status groups ───────────────────────────────────────────────────────────

function StatusGroups({
  status,
  onStage,
  onUnstage,
  staging,
  unstaging,
}: {
  status: GitStatus;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  staging: boolean;
  unstaging: boolean;
}) {
  const empty =
    status.staged.length === 0 &&
    status.unstaged.length === 0 &&
    status.untracked.length === 0 &&
    status.conflicted.length === 0;

  return (
    <section className="git-status" aria-label="Working tree status">
      {status.conflicted.length > 0 && (
        <FileGroup
          title="Conflicted"
          tone="danger"
          entries={status.conflicted}
          statusOf={() => "conflict"}
          note="Resolve conflicts in your editor, then stage the resolved files."
          action={{ label: "Stage", onAct: (path) => onStage([path]), busy: staging }}
        />
      )}
      <FileGroup
        title="Staged"
        tone="success"
        entries={status.staged}
        statusOf={(e) => stagedStatusLabel(e.xy)}
        action={{ label: "Unstage", onAct: (path) => onUnstage([path]), busy: unstaging }}
        groupAction={
          status.staged.length > 1
            ? { label: "Unstage all", onAct: () => onUnstage(status.staged.map((e) => e.path)), busy: unstaging }
            : undefined
        }
      />
      <FileGroup
        title="Unstaged"
        tone="warning"
        entries={status.unstaged}
        statusOf={(e) => unstagedStatusLabel(e.xy)}
        action={{ label: "Stage", onAct: (path) => onStage([path]), busy: staging }}
        groupAction={
          status.unstaged.length > 1
            ? { label: "Stage all", onAct: () => onStage(status.unstaged.map((e) => e.path)), busy: staging }
            : undefined
        }
      />
      <FileGroup
        title="Untracked"
        tone="neutral"
        entries={status.untracked.map((path) => ({ path, xy: "??" }))}
        statusOf={() => "untracked"}
        action={{ label: "Stage", onAct: (path) => onStage([path]), busy: staging }}
        groupAction={
          status.untracked.length > 1
            ? { label: "Stage all", onAct: () => onStage([...status.untracked]), busy: staging }
            : undefined
        }
      />
      {empty && (
        <EmptyState
          icon={<Layers size={24} aria-hidden="true" />}
          title="Working tree clean"
          description="No staged, unstaged, untracked, or conflicted files."
        />
      )}
    </section>
  );
}

function FileGroup({
  title,
  tone,
  entries,
  statusOf,
  action,
  groupAction,
  note,
}: {
  title: string;
  tone: "success" | "warning" | "danger" | "neutral";
  entries: GitFileEntry[];
  statusOf: (entry: GitFileEntry) => string;
  action?: { label: string; onAct: (path: string) => void; busy: boolean };
  groupAction?: { label: string; onAct: () => void; busy: boolean } | undefined;
  note?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className={`git-file-group git-file-group--${tone}`}>
      <div className="git-file-group__head">
        <span className="git-file-group__title">
          {title} <span className="git-file-group__count">{entries.length}</span>
        </span>
        {groupAction && (
          <button type="button" className="git-mini-button" onClick={groupAction.onAct} disabled={groupAction.busy}>
            {groupAction.label}
          </button>
        )}
      </div>
      {note && <p className="git-file-group__note">{note}</p>}
      <ul className="git-file-list">
        {entries.map((entry) => (
          <li key={`${entry.path}:${entry.xy}`} className="git-file-row">
            <span className="git-file-row__status">{statusOf(entry)}</span>
            <code className="git-file-row__path" title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}>
              {entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}
            </code>
            {action && (
              <button
                type="button"
                className="git-mini-button"
                onClick={() => action.onAct(entry.path)}
                disabled={action.busy}
                aria-label={`${action.label} ${entry.path}`}
              >
                {action.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── commit composer ─────────────────────────────────────────────────────────

function CommitComposer({ status }: { status: GitStatus }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [message, setMessage] = useState("");

  const commit = useMutation({
    mutationFn: (msg: string) => gitApi.commit(msg),
    onSuccess: async (result) => {
      setMessage("");
      await queryClient.invalidateQueries({ queryKey: codeKeys.git });
      toast({ title: "Committed", description: result.hash.slice(0, 12), tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Commit failed", description: formatError(error), tone: "danger" }),
  });

  // Disabled-with-reason states (never a mute disabled button).
  const reason = commit.isPending
    ? "Committing…"
    : status.conflicted.length > 0
      ? `Resolve ${status.conflicted.length} conflict(s) first`
      : status.staged.length === 0
        ? "Nothing staged — no-op commits are refused"
        : message.trim() === ""
          ? "A commit message is required"
          : "";

  return (
    <section className="git-commit" aria-label="Commit composer">
      <h3 className="git-section-title">
        <GitCommitHorizontal size={14} aria-hidden="true" /> Commit
      </h3>
      <textarea
        className="git-commit__message"
        rows={3}
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={commit.isPending}
        aria-label="Commit message"
      />
      <div className="git-commit__actions">
        {reason && <span className="git-commit__reason">{reason}</span>}
        <button
          type="button"
          className="git-commit__button"
          disabled={reason !== ""}
          onClick={() => commit.mutate(message.trim())}
        >
          {commit.isPending ? "Committing…" : `Commit ${status.staged.length} staged file${status.staged.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </section>
  );
}

// ─── log ─────────────────────────────────────────────────────────────────────

function LogSection({ enabled }: { enabled: boolean }) {
  const peek = usePeek();
  const log = useQuery({
    queryKey: codeKeys.log("", LOG_LIMIT),
    queryFn: () => gitApi.log({ limit: LOG_LIMIT }),
    enabled,
    refetchInterval: LISTS_POLL_MS, // app-local, no wire events
    retry: false,
  });

  return (
    <section className="git-log" aria-label="Commit log">
      <h3 className="git-section-title">
        <History size={14} aria-hidden="true" /> Log
        {log.isSuccess ? ` · latest ${log.data.commits.length}` : ""}
      </h3>
      {log.isPending && <SkeletonBlock variant="text" lines={5} />}
      {log.isError && <ErrorState error={log.error} onRetry={() => void log.refetch()} title="Failed to load log" />}
      {log.isSuccess && log.data.commits.length === 0 && (
        <EmptyState title="No commits yet" description={log.data.note ?? "This repository has no history."} />
      )}
      {log.isSuccess && log.data.commits.length > 0 && (
        <ul className="git-log-rows">
          {log.data.commits.map((commit) => (
            <li key={commit.hash}>
              <button
                type="button"
                className="git-log-row"
                onClick={() => peek.open({ title: commit.shortHash, content: <CommitPeek commit={commit} /> })}
              >
                <span className="git-log-row__subject">{commit.subject || "(no subject)"}</span>
                <span className="git-log-row__meta">
                  <code>{commit.shortHash}</code> · {commit.author || "unknown"} · {formatCommitDate(commit.date)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommitPeek({ commit }: { commit: GitCommitRecord }) {
  return (
    <div className="git-commit-peek">
      <p className="git-commit-peek__subject">{commit.subject || "(no subject)"}</p>
      <dl className="git-commit-peek__facts">
        <dt>Hash</dt>
        <dd>
          <code>{commit.hash}</code>
        </dd>
        <dt>Author</dt>
        <dd>
          {commit.author} {commit.email ? `<${commit.email}>` : ""}
        </dd>
        <dt>Date</dt>
        <dd>{formatCommitDate(commit.date)}</dd>
        {commit.parents.length > 0 && (
          <>
            <dt>Parents</dt>
            <dd>
              {commit.parents.map((p) => (
                <code key={p} className="git-commit-peek__parent">
                  {p.slice(0, 12)}
                </code>
              ))}
            </dd>
          </>
        )}
      </dl>
      {commit.body && <pre className="git-commit-peek__body">{commit.body}</pre>}
      <div className="git-commit-peek__actions">
        <button
          type="button"
          className="git-mini-button"
          onClick={() => jumpToDiff({ mode: "ref", ref: `${commit.hash}~1..${commit.hash}` })}
          title="Open this commit's changes in the Diff view (fails honestly on a root commit)"
        >
          Diff vs parent
        </button>
        <button
          type="button"
          className="git-mini-button"
          onClick={() => jumpToDiff({ mode: "ref", ref: commit.hash })}
          title="Diff the current working tree against this commit"
        >
          Diff working tree vs this
        </button>
      </div>
    </div>
  );
}

// ─── branches (read-only this wave) ──────────────────────────────────────────

function BranchesSection({ enabled }: { enabled: boolean }) {
  const branches = useQuery({
    queryKey: codeKeys.branches,
    queryFn: gitApi.branches,
    enabled,
    refetchInterval: LISTS_POLL_MS, // app-local, no wire events
    retry: false,
  });

  return (
    <section className="git-branches" aria-label="Branches">
      <h3 className="git-section-title">
        <GitBranch size={14} aria-hidden="true" /> Branches
      </h3>
      <p className="git-honest-note" role="note">
        Read-only listing — checkout and branch creation are not wired in this wave.
      </p>
      {branches.isPending && <SkeletonBlock variant="text" lines={3} />}
      {branches.isError && (
        <ErrorState error={branches.error} onRetry={() => void branches.refetch()} title="Failed to load branches" />
      )}
      {branches.isSuccess && (
        <>
          {branches.data.local.length === 0 ? (
            <EmptyState title="No local branches" description="This repository has no local branches yet." />
          ) : (
            <ul className="git-branch-rows">
              {branches.data.local.map((branch) => (
                <li key={branch.name} className="git-branch-row">
                  <code className="git-branch-row__name">{branch.name}</code>
                  {branch.current && <span className="badge ok">current</span>}
                  {branch.upstream && <span className="git-branch-row__upstream">→ {branch.upstream}</span>}
                  <code className="git-branch-row__sha">{branch.sha}</code>
                </li>
              ))}
            </ul>
          )}
          {branches.data.remote.length > 0 && (
            <p className="git-branches__remote-note">
              + {branches.data.remote.length} remote branch{branches.data.remote.length === 1 ? "" : "es"}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ─── stash ───────────────────────────────────────────────────────────────────

function StashPanel({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [popTarget, setPopTarget] = useState<GitStashEntry | null>(null);

  const stashes = useQuery({
    queryKey: codeKeys.stash,
    queryFn: gitApi.stashList,
    enabled,
    refetchInterval: LISTS_POLL_MS, // app-local, no wire events
    retry: false,
  });

  const push = useMutation({
    mutationFn: () => gitApi.stashPush(message.trim(), includeUntracked),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: codeKeys.git });
      if (result.noop) {
        toast({ title: "Nothing stashed", description: result.note ?? "No local changes to save.", tone: "info" });
      } else {
        setMessage("");
        toast({ title: "Stashed", description: result.summary, tone: "success" });
      }
    },
    onError: (error: unknown) => toast({ title: "Stash failed", description: formatError(error), tone: "danger" }),
  });

  const pop = useMutation({
    mutationFn: (entry: GitStashEntry) => gitApi.stashPop(entry.ref),
    onSuccess: async () => {
      setPopTarget(null);
      await queryClient.invalidateQueries({ queryKey: codeKeys.git });
      toast({ title: "Stash popped", tone: "success" });
    },
    onError: async (error: unknown) => {
      setPopTarget(null);
      await queryClient.invalidateQueries({ queryKey: codeKeys.git });
      toast({ title: "Stash pop failed", description: formatError(error), tone: "danger", durationMs: 0 });
    },
  });

  return (
    <section className="git-stash" aria-label="Stash">
      <h3 className="git-section-title">
        <Layers size={14} aria-hidden="true" /> Stash
        {stashes.isSuccess ? ` · ${stashes.data.stashes.length}` : ""}
      </h3>

      <div className="git-stash__composer">
        <input
          type="text"
          className="git-stash__message"
          placeholder="Stash message (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={push.isPending}
          aria-label="Stash message"
        />
        <label className="git-stash__untracked">
          <input
            type="checkbox"
            checked={includeUntracked}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
            disabled={push.isPending}
          />
          include untracked
        </label>
        <button type="button" className="git-mini-button" onClick={() => push.mutate()} disabled={push.isPending}>
          {push.isPending ? "Stashing…" : "Stash changes"}
        </button>
      </div>

      {stashes.isPending && <SkeletonBlock variant="text" lines={2} />}
      {stashes.isError && (
        <ErrorState error={stashes.error} onRetry={() => void stashes.refetch()} title="Failed to load stashes" />
      )}
      {stashes.isSuccess && stashes.data.stashes.length === 0 && (
        <p className="git-honest-note" role="note">
          No stash entries.
        </p>
      )}
      {stashes.isSuccess && stashes.data.stashes.length > 0 && (
        <ul className="git-stash-rows">
          {stashes.data.stashes.map((entry) => (
            <li key={entry.ref} className="git-stash-row">
              <code className="git-stash-row__ref">{entry.ref}</code>
              <span className="git-stash-row__message" title={entry.message}>
                {entry.message || "(no message)"}
              </span>
              <button
                type="button"
                className="git-mini-button"
                onClick={() => setPopTarget(entry)}
                disabled={pop.isPending}
              >
                Pop
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmSurface
        open={popTarget !== null}
        action="Pop stash"
        target={popTarget ? `${popTarget.ref} — ${popTarget.message || "(no message)"}` : ""}
        blastRadius="Applies the stashed changes onto the current working tree and removes the entry from the stash list. Conflicts stop the pop, leave conflict markers in files, and keep the stash entry."
        confirmLabel={pop.isPending ? "Popping…" : "Pop stash"}
        onConfirm={() => {
          if (popTarget) pop.mutate(popTarget);
        }}
        onCancel={() => setPopTarget(null)}
      />
    </section>
  );
}
