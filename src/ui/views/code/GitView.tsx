// Git view — workspace status master (docs/FEATURES.md §15): staged /
// unstaged / untracked / conflicted groups with per-file stage/unstage, a
// commit composer that refuses no-op commits with visible reasons, a bounded
// log with a detail peek, a branch list with dirty-guarded checkout (via
// ConfirmSurface) and a create-branch form, a stash panel, and read-only
// tags/remotes/reflog-rescue panels (§15 rows 2-3). All data is app-local
// (/app/git/* — src/bun/git.ts): no wire events exist, so freshness is a
// targeted 15s status poll + mutation-driven invalidation of the
// ["code","git"] prefix.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  History,
  Layers,
  RefreshCw,
  RotateCcw,
  Tag,
} from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import {
  codeKeys,
  gitApi,
  isCheckoutDirtyError,
  isGitMissingError,
  isNotARepoError,
  stagedStatusLabel,
  unstagedStatusLabel,
  formatCommitDate,
  type GitBranch as GitBranchRecord,
  type GitCommitRecord,
  type GitFileEntry,
  type GitGuard,
  type GitStashEntry,
  type GitStatus,
} from "./git-api.ts";
import { jumpToDiff } from "./diff-model.ts";
import { GitHubPanel } from "./GitHubPanel.tsx";
import { RepoSessionsPanel } from "./RepoSessionsPanel.tsx";
import { DevSnapshotsPanel } from "./DevSnapshotsPanel.tsx";

const STATUS_POLL_MS = 15_000; // no wire events for app-local git — targeted poll
const LISTS_POLL_MS = 30_000;
const LOG_LIMIT = 50;
const REFLOG_LIMIT = 50;

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
          <BranchesSection enabled={repoOk} guard={status.data?.guard} />
        </div>
      </div>

      <div className="git-columns">
        <div className="git-column">
          <GitHubPanel />
        </div>
        <div className="git-column">
          <RepoSessionsPanel workspaceDir={workspace.data.workspaceDir} />
          <RepoFilesPanel />
        </div>
      </div>

      <div className="git-columns">
        <div className="git-column">
          <TagsPanel enabled={repoOk} />
        </div>
        <div className="git-column">
          <RemotesPanel enabled={repoOk} />
          <ReflogSection enabled={repoOk} />
        </div>
      </div>

      <div className="git-columns">
        <div className="git-column git-column--wide">
          <DevSnapshotsPanel />
        </div>
      </div>
    </div>
  );
}

// ─── repo file browser (docs/GAPS.md §15 row 9 — honest gap, see note) ──────

// Repo file browser (docs/FEATURES.md §15 row 9) over the Bun-side
// /app/git/files + /app/git/file endpoints (tracked files only; bounded
// listing and reads — src/bun/git.ts). Filter is client-side; preview is
// plain text with binary/truncation honesty.
function RepoFilesPanel() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const files = useQuery({ queryKey: [...codeKeys.git, "files"], queryFn: gitApi.files, refetchInterval: false });
  const preview = useQuery({
    queryKey: [...codeKeys.git, "file", selected ?? ""],
    queryFn: () => gitApi.file(selected ?? ""),
    enabled: selected !== null,
  });
  const shown = useMemo(() => {
    const all = files.data?.files ?? [];
    const q = filter.trim().toLowerCase();
    const hits = q ? all.filter((f) => f.toLowerCase().includes(q)) : all;
    return { list: hits.slice(0, 500), total: hits.length };
  }, [files.data, filter]);
  return (
    <section className="repo-files" aria-label="Repo file browser">
      <h3 className="git-section-title">
        <FolderGit2 size={14} aria-hidden="true" /> Repo files
        {files.data && <span className="git-section-count">{files.data.total}{files.data.truncated ? "+" : ""}</span>}
      </h3>
      {files.isPending && <SkeletonBlock variant="text" lines={3} />}
      {files.isError && <ErrorState error={files.error} onRetry={() => void files.refetch()} title="File listing failed" />}
      {files.isSuccess && (
        <>
          <input
            type="search"
            className="repo-files__filter"
            placeholder={`Filter ${files.data.total} tracked files…`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter repo files"
          />
          {shown.list.length === 0 && <EmptyState title="No files match" description="Adjust the filter." />}
          <ul className="repo-files__list">
            {shown.list.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  className={`repo-files__item${selected === f ? " is-active" : ""}`}
                  onClick={() => setSelected(selected === f ? null : f)}
                >
                  {f}
                </button>
              </li>
            ))}
          </ul>
          {shown.total > 500 && (
            <p className="repo-files__note">Showing first 500 of {shown.total} matches — narrow the filter.</p>
          )}
        </>
      )}
      {selected !== null && (
        <div className="repo-files__preview" aria-label={`Preview of ${selected}`}>
          {preview.isPending && <SkeletonBlock variant="text" lines={4} />}
          {preview.isError && <ErrorState error={preview.error} title="File read failed" />}
          {preview.isSuccess && preview.data.binary && (
            <p className="repo-files__note">Binary file ({preview.data.size.toLocaleString()} bytes) — no preview.</p>
          )}
          {preview.isSuccess && !preview.data.binary && (
            <>
              {preview.data.truncated && (
                <p className="repo-files__note">Showing first 512 KB of {preview.data.size.toLocaleString()} bytes.</p>
              )}
              <pre className="repo-files__content"><code>{preview.data.content}</code></pre>
            </>
          )}
        </div>
      )}
    </section>
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

// ─── branches (checkout + create wired; §15 row 2) ──────────────────────────

function BranchesSection({ enabled, guard }: { enabled: boolean; guard: GitGuard | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [checkoutTarget, setCheckoutTarget] = useState<GitBranchRecord | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchFrom, setNewBranchFrom] = useState("");

  const branches = useQuery({
    queryKey: codeKeys.branches,
    queryFn: gitApi.branches,
    enabled,
    refetchInterval: LISTS_POLL_MS, // app-local, no wire events
    retry: false,
  });

  const invalidateGit = () => queryClient.invalidateQueries({ queryKey: codeKeys.git });

  const checkout = useMutation({
    mutationFn: (branch: string) => gitApi.checkout(branch),
    onSuccess: async (result) => {
      setCheckoutTarget(null);
      await invalidateGit();
      toast({ title: "Checked out", description: result.branch, tone: "success" });
    },
    onError: (error: unknown) => {
      setCheckoutTarget(null);
      toast({
        title: "Checkout failed",
        description: isCheckoutDirtyError(error)
          ? "Working tree is dirty — commit or stash first."
          : formatError(error),
        tone: "danger",
        durationMs: 0,
      });
    },
  });

  const createBranch = useMutation({
    mutationFn: () => gitApi.branchCreate(newBranchName.trim(), newBranchFrom.trim() || undefined),
    onSuccess: async (result) => {
      setNewBranchName("");
      setNewBranchFrom("");
      await queryClient.invalidateQueries({ queryKey: codeKeys.branches });
      toast({ title: "Branch created", description: result.name, tone: "success" });
    },
    onError: (error: unknown) =>
      toast({ title: "Branch create failed", description: formatError(error), tone: "danger" }),
  });

  const dirtyCount = guard
    ? guard.stagedCount + guard.unstagedCount + guard.untrackedCount + guard.conflictedCount
    : 0;

  function checkoutReason(branch: GitBranchRecord): string {
    if (branch.current) return "Already on this branch";
    if (checkout.isPending) return "Checking out…";
    if (guard === undefined) return "Checking working tree status…";
    if (guard.dirty) return `Working tree has ${dirtyCount} dirty file(s) — commit or stash first`;
    return "";
  }

  const createReason = createBranch.isPending
    ? "Creating…"
    : newBranchName.trim() === ""
      ? "A branch name is required"
      : "";

  return (
    <section className="git-branches" aria-label="Branches">
      <h3 className="git-section-title">
        <GitBranch size={14} aria-hidden="true" /> Branches
      </h3>
      <p className="git-honest-note" role="note">
        No force flags anywhere — checkout refuses when the working tree is dirty; deleting branches is not wired.
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
              {branches.data.local.map((branch) => {
                const reason = checkoutReason(branch);
                return (
                  <li key={branch.name} className="git-branch-row">
                    <code className="git-branch-row__name">{branch.name}</code>
                    {branch.current && <span className="badge ok">current</span>}
                    {branch.upstream && <span className="git-branch-row__upstream">→ {branch.upstream}</span>}
                    <code className="git-branch-row__sha">{branch.sha}</code>
                    {!branch.current && (
                      <button
                        type="button"
                        className="git-mini-button"
                        onClick={() => setCheckoutTarget(branch)}
                        disabled={reason !== ""}
                        title={reason || `Checkout ${branch.name}`}
                        aria-label={`Checkout ${branch.name}`}
                      >
                        Checkout
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {branches.data.remote.length > 0 && (
            <p className="git-branches__remote-note">
              + {branches.data.remote.length} remote branch{branches.data.remote.length === 1 ? "" : "es"}
            </p>
          )}
        </>
      )}

      <form
        className="git-branch-create"
        onSubmit={(e) => {
          e.preventDefault();
          if (createReason === "") createBranch.mutate();
        }}
      >
        <input
          type="text"
          className="git-branch-create__name"
          placeholder="New branch name"
          value={newBranchName}
          onChange={(e) => setNewBranchName(e.target.value)}
          disabled={createBranch.isPending}
          aria-label="New branch name"
        />
        <input
          type="text"
          className="git-branch-create__from"
          placeholder="from (optional, defaults to HEAD)"
          value={newBranchFrom}
          onChange={(e) => setNewBranchFrom(e.target.value)}
          disabled={createBranch.isPending}
          aria-label="Start point (optional)"
        />
        <button type="submit" className="git-mini-button" disabled={createReason !== ""} title={createReason}>
          {createBranch.isPending ? "Creating…" : "Create branch"}
        </button>
      </form>

      <ConfirmSurface
        open={checkoutTarget !== null}
        action="Checkout branch"
        target={checkoutTarget?.name ?? ""}
        blastRadius="Switches the working tree to this branch's files. Refused automatically when the working tree is dirty; no force flag exists to override that."
        confirmLabel={checkout.isPending ? "Checking out…" : "Checkout"}
        onConfirm={() => {
          if (checkoutTarget) checkout.mutate(checkoutTarget.name);
        }}
        onCancel={() => setCheckoutTarget(null)}
      />
    </section>
  );
}

// ─── tags (read-only; §15 row 3) ─────────────────────────────────────────────

function TagsPanel({ enabled }: { enabled: boolean }) {
  const tags = useQuery({
    queryKey: codeKeys.tags,
    queryFn: gitApi.tags,
    enabled,
    refetchInterval: LISTS_POLL_MS, // app-local, no wire events
    retry: false,
  });

  return (
    <section className="git-tags" aria-label="Tags">
      <h3 className="git-section-title">
        <Tag size={14} aria-hidden="true" /> Tags
        {tags.isSuccess ? ` · ${tags.data.tags.length}` : ""}
      </h3>
      <p className="git-honest-note" role="note">
        Read-only — tag creation and deletion are not wired.
      </p>
      {tags.isPending && <SkeletonBlock variant="text" lines={2} />}
      {tags.isError && <ErrorState error={tags.error} onRetry={() => void tags.refetch()} title="Failed to load tags" />}
      {tags.isSuccess && tags.data.tags.length === 0 && (
        <EmptyState title="No tags" description="This repository has no tags yet." />
      )}
      {tags.isSuccess && tags.data.tags.length > 0 && (
        <ul className="git-tag-rows">
          {tags.data.tags.map((tag) => (
            <li key={tag.name} className="git-tag-row">
              <code className="git-tag-row__name">{tag.name}</code>
              <span className={tag.annotated ? "badge info" : "badge neutral"}>
                {tag.annotated ? "annotated" : "lightweight"}
              </span>
              <code className="git-tag-row__sha" title={tag.target}>
                {tag.target.slice(0, 12)}
              </code>
              {tag.message && (
                <span className="git-tag-row__message" title={tag.message}>
                  {tag.message}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── remotes (read-only; §15 row 3) ──────────────────────────────────────────

function RemotesPanel({ enabled }: { enabled: boolean }) {
  const remotes = useQuery({
    queryKey: codeKeys.remotes,
    queryFn: gitApi.remotes,
    enabled,
    refetchInterval: LISTS_POLL_MS, // app-local, no wire events
    retry: false,
  });

  return (
    <section className="git-remotes" aria-label="Remotes">
      <h3 className="git-section-title">
        <Globe size={14} aria-hidden="true" /> Remotes
        {remotes.isSuccess ? ` · ${remotes.data.remotes.length}` : ""}
      </h3>
      <p className="git-honest-note" role="note">
        Read-only — no add/remove/fetch/push wired.
      </p>
      {remotes.isPending && <SkeletonBlock variant="text" lines={2} />}
      {remotes.isError && (
        <ErrorState error={remotes.error} onRetry={() => void remotes.refetch()} title="Failed to load remotes" />
      )}
      {remotes.isSuccess && remotes.data.remotes.length === 0 && (
        <EmptyState title="No remotes" description="This repository has no configured remotes." />
      )}
      {remotes.isSuccess && remotes.data.remotes.length > 0 && (
        <ul className="git-remote-rows">
          {remotes.data.remotes.map((remote) => (
            <li key={remote.name} className="git-remote-row">
              <code className="git-remote-row__name">{remote.name}</code>
              <span className="git-remote-row__url" title={remote.fetchUrl}>
                {remote.fetchUrl}
              </span>
              {remote.pushUrl && remote.pushUrl !== remote.fetchUrl && (
                <span className="git-remote-row__push" title={`push: ${remote.pushUrl}`}>
                  push differs
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── reflog rescue drawer (read-only; §15 row 3) ─────────────────────────────

function ReflogSection({ enabled }: { enabled: boolean }) {
  const peek = usePeek();
  return (
    <section className="git-reflog" aria-label="Reflog rescue">
      <h3 className="git-section-title">
        <RotateCcw size={14} aria-hidden="true" /> Reflog rescue
      </h3>
      <p className="git-honest-note" role="note">
        Read-only browsing of the last {REFLOG_LIMIT} HEAD movements. Restoring from a reflog entry is a terminal
        operation this app does not perform yet — copy a hash and use your own tools if you need to act on it.
      </p>
      <button
        type="button"
        className="git-mini-button"
        disabled={!enabled}
        onClick={() => peek.open({ title: "Reflog rescue", content: <ReflogDrawerContent /> })}
      >
        Open reflog
      </button>
    </section>
  );
}

function ReflogDrawerContent() {
  const reflog = useQuery({
    queryKey: codeKeys.reflog,
    queryFn: gitApi.reflog,
    refetchInterval: false,
    retry: false,
  });

  return (
    <div className="git-reflog-peek">
      <p className="git-honest-note" role="note">
        Bounded to the last {REFLOG_LIMIT} entries. Restoring from reflog is a terminal operation for now — this
        drawer only browses and copies ids.
      </p>
      {reflog.isPending && <SkeletonBlock variant="text" lines={5} />}
      {reflog.isError && (
        <ErrorState error={reflog.error} onRetry={() => void reflog.refetch()} title="Failed to load reflog" />
      )}
      {reflog.isSuccess && reflog.data.entries.length === 0 && (
        <EmptyState title="No reflog entries" description={reflog.data.note ?? "Nothing to rescue yet."} />
      )}
      {reflog.isSuccess && reflog.data.entries.length > 0 && (
        <ul className="git-reflog-rows">
          {reflog.data.entries.map((entry, index) => (
            <li key={`${entry.selector}:${index}`} className="git-reflog-row">
              <code className="git-reflog-row__selector">{entry.selector}</code>
              <span className="git-reflog-row__subject" title={entry.subject}>
                {entry.subject || "(no message)"}
              </span>
              <CopyChip value={entry.hash} label={`hash ${entry.shortHash}`} display={entry.shortHash} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Small copy-to-clipboard chip — local to Git views (no shared component owns this). */
function CopyChip({ value, label, display }: { value: string; label: string; display: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="git-copy-chip"
      aria-label={`Copy ${label}`}
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <code>{display}</code>
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
    </button>
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
