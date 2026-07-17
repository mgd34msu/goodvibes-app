// SessionChanges — the session review cockpit's "Changes" section.
//
// DAEMON SURFACE: sessions.changes.get (contract 1.11) returns a session's
// aggregate workspace diff, joined over the workspace checkpoints stamped
// with that session's id — the net change from before the session's earliest
// stamped checkpoint to its latest. That is the PRIMARY, default source. A
// session with no stamped checkpoints answers honestly with
// checkpointCount:0 and an empty diff — rendered as an explicit "no captured
// changes" state with a one-tap workspace-scoped fallback (checkpoints.list +
// checkpoints.diff), never a blank panel. If sessions.changes.get itself is
// not available on this daemon build, the same fallback is offered with a
// visible note explaining why (never a silent switch).
//
// PER-HUNK REVERT: checkpoints.revertHunkPreview -> render exactly what would
// be reverted -> ConfirmSurface (danger) -> checkpoints.revertHunk with the
// preview's confirmToken. A stale hunk (preview applies:false, or a 409 on
// apply) renders the honest conflict state and refreshes the diff — never a
// partial apply, never stale state left standing.
//
// Ported in spirit from goodvibes-webui src/views/sessions/SessionChanges.tsx
// + HunkRevertSheet.tsx, trimmed to this wave's scope (no comment/approve
// actions — those are a separate, not-yet-wired capability).

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileDiff, RefreshCw, Undo2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { errorStatus, formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, firstString, formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock } from "../../components/feedback.tsx";
import {
  diffFileTotals,
  formatRange,
  hunkNewRange,
  hunkOldRange,
  hunkToPatch,
  parseUnifiedDiff,
  type DiffFile,
  type DiffHunk,
} from "./diff-hunks.ts";
import {
  parseCheckpointDiffLite,
  parseCheckpointListLite,
  sortCheckpointsNewestFirst,
  type CheckpointLite,
} from "./checkpoints-lite.ts";

export interface SessionChangesProps {
  sessionId: string;
}

type ViewMode = "session" | "workspace";

// --- wire result readers (kept local; gv.* returns `unknown` here) --------

interface SessionChangesResult {
  checkpointCount: number;
  from: string;
  to: string;
  unifiedDiff: string;
}
function parseSessionChanges(value: unknown): SessionChangesResult {
  const record = asRecord(value);
  return {
    checkpointCount: typeof record["checkpointCount"] === "number" ? (record["checkpointCount"] as number) : 0,
    from: firstString(record, ["from"]),
    to: firstString(record, ["to"]),
    unifiedDiff: firstString(record, ["unifiedDiff"]),
  };
}

interface RevertPreviewResult {
  applies: boolean;
  conflict: string | null;
  addedLinesRemoved: number;
  removedLinesRestored: number;
  token: string | null;
}
function parseRevertPreview(value: unknown): RevertPreviewResult {
  const record = asRecord(value);
  return {
    applies: record["applies"] === true,
    conflict: typeof record["conflict"] === "string" ? (record["conflict"] as string) : null,
    addedLinesRemoved: typeof record["addedLinesRemoved"] === "number" ? (record["addedLinesRemoved"] as number) : 0,
    removedLinesRestored:
      typeof record["removedLinesRestored"] === "number" ? (record["removedLinesRestored"] as number) : 0,
    token: typeof record["token"] === "string" ? (record["token"] as string) : null,
  };
}

interface RevertApplyResult {
  reverted: boolean;
  refusalReason: string | null;
}
function parseRevertApply(value: unknown): RevertApplyResult {
  const record = asRecord(value);
  const receipt = asRecord(record["receipt"]);
  const refusal = asRecord(record["refusal"]);
  return {
    reverted: record["receipt"] != null && receipt["reverted"] === true,
    refusalReason: typeof refusal["reason"] === "string" ? (refusal["reason"] as string) : null,
  };
}

export function SessionChanges({ sessionId }: SessionChangesProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<ViewMode>("session");
  const [baselineId, setBaselineId] = useState("");
  const [revertTarget, setRevertTarget] = useState<{ file: DiffFile; hunk: DiffHunk } | null>(null);
  const [revertConflict, setRevertConflict] = useState<string | null>(null);

  // ── Primary: sessions.changes.get — genuinely session-scoped ────────────
  const sessionChanges = useQuery({
    queryKey: queryKeys.sessionChanges(sessionId),
    queryFn: () => gv.sessions.changes({ sessionId }),
    enabled: Boolean(sessionId) && mode === "session",
  });
  const sessionChangesUnavailable = sessionChanges.isError && isMethodUnavailableError(sessionChanges.error);
  const sessionChangesFailed = sessionChanges.isError && !sessionChangesUnavailable;
  const parsedSessionChanges = useMemo(
    () => (sessionChanges.data ? parseSessionChanges(sessionChanges.data) : null),
    [sessionChanges.data],
  );
  const sessionHasNoCapturedChanges = parsedSessionChanges != null && parsedSessionChanges.checkpointCount === 0;

  // ── Secondary/fallback: checkpoints.list + checkpoints.diff (workspace-wide) ──
  const list = useQuery({
    queryKey: queryKeys.checkpoints,
    queryFn: () => gv.checkpoints.list(),
    enabled: mode === "workspace",
  });
  const checkpoints = useMemo(() => sortCheckpointsNewestFirst(parseCheckpointListLite(list.data)), [list.data]);
  const effectiveBaselineId = useMemo(() => {
    if (baselineId && checkpoints.some((c) => c.id === baselineId)) return baselineId;
    return checkpoints[0]?.id ?? "";
  }, [checkpoints, baselineId]);
  const baseline: CheckpointLite | null = useMemo(
    () => checkpoints.find((c) => c.id === effectiveBaselineId) ?? null,
    [checkpoints, effectiveBaselineId],
  );
  const diff = useQuery({
    queryKey: [...queryKeys.checkpoints, effectiveBaselineId, "diff"],
    queryFn: () => gv.checkpoints.diff({ a: effectiveBaselineId }),
    enabled: mode === "workspace" && Boolean(effectiveBaselineId),
  });
  const parsedWorkspaceDiff = useMemo(() => (diff.data ? parseCheckpointDiffLite(diff.data) : null), [diff.data]);

  const files = useMemo(() => {
    if (mode === "session") {
      return parsedSessionChanges && !sessionHasNoCapturedChanges
        ? parseUnifiedDiff(parsedSessionChanges.unifiedDiff)
        : [];
    }
    return parsedWorkspaceDiff ? parseUnifiedDiff(parsedWorkspaceDiff.unifiedDiff) : [];
  }, [mode, parsedSessionChanges, sessionHasNoCapturedChanges, parsedWorkspaceDiff]);

  const totals = useMemo(() => diffFileTotals(files), [files]);

  async function refreshActiveDiff(): Promise<void> {
    setRevertConflict(null);
    if (mode === "session") await sessionChanges.refetch();
    else await diff.refetch();
  }

  // ── Reject → revert (preview + apply, honest conflict on stale) ─────────
  const preview = useMutation({
    mutationFn: (target: { file: DiffFile; hunk: DiffHunk }) =>
      gv.checkpoints.revertHunkPreview({ path: target.file.path, hunk: hunkToPatch(target.hunk), sessionId }),
    onSuccess: (raw) => {
      const result = parseRevertPreview(raw);
      if (!(result.applies && result.token)) {
        setRevertConflict(result.conflict?.trim() ? result.conflict : "this hunk no longer applies cleanly");
      }
    },
  });

  const apply = useMutation({
    mutationFn: (input: { target: { file: DiffFile; hunk: DiffHunk }; token: string }) =>
      gv.checkpoints.revertHunk({
        path: input.target.file.path,
        hunk: hunkToPatch(input.target.hunk),
        sessionId,
        confirmToken: input.token,
      }),
    onSuccess: async (raw) => {
      const result = parseRevertApply(raw);
      if (result.reverted) {
        setRevertTarget(null);
        toast({ title: "Hunk reverted", tone: "success" });
        await refreshActiveDiff();
      } else {
        // A confirmed call should not be refused; if it somehow is, surface it honestly.
        setRevertConflict(result.refusalReason ?? "the revert was refused");
      }
    },
    onError: async (error: unknown) => {
      if (errorStatus(error) === 409) {
        // Stale hunk on apply — never leave stale state, re-read the diff now.
        setRevertConflict(formatError(error));
        await refreshActiveDiff();
      } else {
        toast({ title: "Revert failed", description: formatError(error), tone: "danger" });
      }
    },
  });

  function startRevert(file: DiffFile, hunk: DiffHunk): void {
    setRevertConflict(null);
    preview.reset();
    apply.reset();
    const target = { file, hunk };
    setRevertTarget(target);
    preview.mutate(target);
  }

  function cancelRevert(): void {
    setRevertTarget(null);
    setRevertConflict(null);
    preview.reset();
    apply.reset();
  }

  const previewResult = preview.data ? parseRevertPreview(preview.data) : null;
  const revertReady = Boolean(previewResult?.applies && previewResult.token);

  const capturedLabel =
    mode === "session"
      ? parsedSessionChanges && !sessionHasNoCapturedChanges
        ? `Session changes from "${parsedSessionChanges.from}" to "${parsedSessionChanges.to}" — filtered to this session's own checkpoints only.`
        : "Session changes, aggregated over this session's own captured checkpoints."
      : baseline
        ? `Workspace changes since checkpoint "${baseline.label || baseline.id}" (${formatRelative(baseline.createdAt)}), compared to the live working tree — workspace-scoped fallback, not filtered to this session.`
        : "Workspace diff vs. the live working tree — workspace-scoped fallback, not filtered to this session.";

  return (
    <section className="session-changes">
      <header className="session-changes__header">
        <FileDiff size={15} aria-hidden="true" />
        <span>Changes</span>
        <button
          type="button"
          className="session-changes__refresh"
          title={mode === "session" ? "Refresh session changes" : "Refresh checkpoints and diff"}
          aria-label="Refresh changes"
          onClick={() => {
            void refreshActiveDiff();
            if (mode === "workspace") void list.refetch();
          }}
        >
          <RefreshCw size={14} className={sessionChanges.isFetching || diff.isFetching ? "spinning" : undefined} />
        </button>
      </header>

      {mode === "session" ? (
        <>
          {sessionChanges.isPending && <SkeletonBlock variant="text" lines={3} />}
          {sessionChangesFailed && (
            <ErrorState
              error={sessionChanges.error}
              onRetry={() => void sessionChanges.refetch()}
              title="Failed to load session changes"
            />
          )}
          {sessionChangesUnavailable && (
            <div className="session-changes__empty" role="note">
              This daemon doesn&apos;t serve session-scoped changes (sessions.changes.get) yet.{" "}
              <button type="button" className="session-changes__inline-link" onClick={() => setMode("workspace")}>
                View workspace-wide changes instead
              </button>
            </div>
          )}
          {sessionHasNoCapturedChanges && (
            <div className="session-changes__empty" role="note">
              No captured changes for this session — no workspace checkpoints have been stamped with this
              session&apos;s id yet (older sessions predate session-id stamping).{" "}
              <button type="button" className="session-changes__inline-link" onClick={() => setMode("workspace")}>
                View workspace-wide changes instead
              </button>
            </div>
          )}
          {parsedSessionChanges && !sessionHasNoCapturedChanges && (
            <p className="session-changes__captured">{capturedLabel}</p>
          )}
        </>
      ) : (
        <>
          <div className="session-changes__toolbar">
            <button type="button" className="session-changes__inline-link" onClick={() => setMode("session")}>
              ← Back to session changes
            </button>
            <label className="session-changes__baseline">
              Baseline
              <select
                value={effectiveBaselineId}
                onChange={(e) => setBaselineId(e.target.value)}
                aria-label="Diff baseline checkpoint"
                disabled={!checkpoints.length}
              >
                {checkpoints.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label || c.id} · {formatRelative(c.createdAt)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {list.isPending && <SkeletonBlock variant="text" lines={3} />}
          {list.isError && (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load checkpoints" />
          )}
          {list.isSuccess && !checkpoints.length && (
            <div className="session-changes__empty" role="note">
              No workspace checkpoints yet — the daemon captures them per turn/agent-run. Without one there is no
              file diff to show.
            </div>
          )}
          {baseline && (
            <>
              <p className="session-changes__captured">{capturedLabel}</p>
              {diff.isPending && <SkeletonBlock variant="text" lines={5} />}
              {diff.isError && (
                <ErrorState error={diff.error} onRetry={() => void diff.refetch()} title="Failed to load diff" />
              )}
            </>
          )}
        </>
      )}

      {files.length === 0 &&
        ((mode === "session" && parsedSessionChanges != null && !sessionHasNoCapturedChanges) ||
          (mode === "workspace" && baseline != null && diff.isSuccess)) && (
          <EmptyState title="No file differences" description="Nothing changed between the compared points." />
        )}

      {files.length > 0 && (
        <div className="session-changes__files">
          <p className="session-changes__totals">
            {totals.files} file{totals.files === 1 ? "" : "s"} ·{" "}
            <span className="session-changes__add">+{totals.additions}</span>{" "}
            <span className="session-changes__del">−{totals.deletions}</span>
          </p>
          {files.map((file) => (
            <FileBlock key={file.path} file={file} onRevert={(hunk) => startRevert(file, hunk)} />
          ))}
        </div>
      )}

      {revertTarget && (
        <>
          {preview.isPending && (
            <p className="session-changes__checking" role="status">
              Checking whether this hunk still applies cleanly…{" "}
              <button type="button" className="session-changes__inline-link" onClick={cancelRevert}>
                Cancel
              </button>
            </p>
          )}
          {!preview.isPending && revertConflict && (
            <div className="session-changes__conflict" role="alert">
              <p>
                This hunk changed since it was captured — {revertConflict}. Nothing was reverted. Refresh the diff
                and try again.
              </p>
              <div className="session-changes__conflict-actions">
                <button type="button" className="sessions-action" onClick={cancelRevert}>
                  Close
                </button>
                <button
                  type="button"
                  className="sessions-action"
                  onClick={() => {
                    cancelRevert();
                    void refreshActiveDiff();
                  }}
                >
                  <RefreshCw size={13} aria-hidden="true" /> Refresh diff
                </button>
              </div>
            </div>
          )}
          {preview.isError && (
            <div className="session-changes__conflict" role="alert">
              <p>{formatError(preview.error)}</p>
              <button type="button" className="sessions-action" onClick={cancelRevert}>
                Close
              </button>
            </div>
          )}
          <ConfirmSurface
            open={revertReady && !preview.isPending}
            action="Revert hunk"
            target={revertTarget.file.path}
            blastRadius="Reverse-applies exactly this hunk to the live working tree, undoing exactly it and nothing else. A safety checkpoint is taken first, so this revert is itself reversible."
            danger
            confirmLabel={apply.isPending ? "Reverting…" : "Revert"}
            onConfirm={() => {
              if (!previewResult?.token) return;
              apply.mutate({ target: revertTarget, token: previewResult.token });
            }}
            onCancel={cancelRevert}
          >
            {previewResult && (
              <p className="session-changes__revert-stats">
                Will remove {previewResult.addedLinesRemoved} added line
                {previewResult.addedLinesRemoved === 1 ? "" : "s"} and restore {previewResult.removedLinesRestored}{" "}
                removed line{previewResult.removedLinesRestored === 1 ? "" : "s"}.
              </p>
            )}
            <pre className="session-changes__revert-excerpt" aria-label="Change that would be reverted">
              {hunkToPatch(revertTarget.hunk)}
            </pre>
          </ConfirmSurface>
        </>
      )}
    </section>
  );
}

function FileBlock({ file, onRevert }: { file: DiffFile; onRevert: (hunk: DiffHunk) => void }) {
  return (
    <section className="session-changes__file" aria-label={`Diff for ${file.path}`}>
      <header className="session-changes__file-head">
        <code>{file.status === "renamed" ? `${file.oldPath} → ${file.path}` : file.path}</code>
        <span className="session-changes__file-flags">
          {file.status === "added" && <span className="badge ok">new</span>}
          {file.status === "deleted" && <span className="badge bad">deleted</span>}
          {file.status === "renamed" && <span className="badge info">renamed</span>}
          {file.binary && <span className="badge neutral">binary</span>}
        </span>
      </header>
      {file.binary ? (
        <p className="session-changes__binary-note" role="note">
          Binary file — no text diff to render.
        </p>
      ) : (
        file.hunks.map((hunk) => <HunkBlock key={hunk.id} hunk={hunk} onRevert={() => onRevert(hunk)} />)
      )}
    </section>
  );
}

function HunkBlock({ hunk, onRevert }: { hunk: DiffHunk; onRevert: () => void }) {
  const oldRange = formatRange(hunkOldRange(hunk));
  const newRange = formatRange(hunkNewRange(hunk));
  return (
    <div className="session-changes__hunk">
      <div className="session-changes__hunk-head">
        <code>
          old {oldRange} · new {newRange}
        </code>
        <button type="button" className="session-changes__hunk-revert" onClick={onRevert}>
          <Undo2 size={12} aria-hidden="true" /> Revert
        </button>
      </div>
      <pre className="session-changes__hunk-lines">
        {hunk.lines.map((line, i) => {
          const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : line.type === "meta" ? "" : " ";
          const cls =
            line.type === "add"
              ? "session-changes__line-add"
              : line.type === "del"
                ? "session-changes__line-del"
                : line.type === "meta"
                  ? "session-changes__hunk-meta"
                  : undefined;
          return (
            <span key={i} className={cls}>
              {prefix}
              {line.text}
              {"\n"}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
