// Checkpoints view — workspace checkpoints browser over checkpoints.* (ALL
// ws-only: they ride the /app/ws bridge via gv.invoke). Ported from
// goodvibes-webui src/views/checkpoints/CheckpointsView.tsx with the app's
// binding rules applied:
//   - restore is DESTRUCTIVE (git-backed workspace rewrite, no server-side
//     confirmation) → ConfirmSurface with confirm:true + explicitUserRequest
//     forwarded on the wire (never window.confirm — docs/UX.md §4);
//   - create's honest noop:true ("tree unchanged") renders as an info toast,
//     never an error, never a fabricated checkpoint;
//   - ws bridge down / method missing → UnavailableState naming the capability;
//   - checkpoints.* emits NO wire events (pinned upstream; queryKeys note in
//     lib/queries.ts) — freshness = mutation-driven invalidation + a gentle
//     30s poll while the view is visible.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronLeft, History, RefreshCw, RotateCcw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import {
  errorCode,
  formatError,
  isMethodUnavailableError,
  isMethodNotInvokableError,
  isWsBridgeUnavailableError,
} from "../../lib/errors.ts";
import { formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import {
  CHECKPOINT_NOOP_MESSAGE,
  formatBytes,
  parseCheckpoint,
  parseCheckpointDiff,
  parseCheckpointList,
  sortCheckpointsNewestFirst,
  type WorkspaceCheckpoint,
} from "./checkpoints-model.ts";

const POLL_MS = 30_000; // checkpoints.* has no wire events — targeted poll

function isNotFound(error: unknown): boolean {
  return errorCode(error) === "NOT_FOUND";
}

function isCapabilityGap(error: unknown): boolean {
  return isMethodUnavailableError(error) || isMethodNotInvokableError(error) || isWsBridgeUnavailableError(error);
}

function capabilityLabel(error: unknown): string {
  return isWsBridgeUnavailableError(error) ? "checkpoints.* (ws bridge not connected)" : "checkpoints.list";
}

export function CheckpointsView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState("");
  // '' = compare against the working tree; a checkpoint id = checkpoint-to-
  // checkpoint diff via checkpoints.diff's `b` input.
  const [compareToId, setCompareToId] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<WorkspaceCheckpoint | null>(null);

  const list = useQuery({
    queryKey: queryKeys.checkpoints,
    queryFn: () => gv.checkpoints.list(),
    refetchInterval: POLL_MS,
    retry: false,
  });

  const checkpoints = useMemo(() => sortCheckpointsNewestFirst(parseCheckpointList(list.data)), [list.data]);
  const selected = useMemo(() => checkpoints.find((c) => c.id === selectedId) ?? null, [checkpoints, selectedId]);
  const compareOptions = useMemo(() => checkpoints.filter((c) => c.id !== selectedId), [checkpoints, selectedId]);

  // A garbage-collected compare target falls back to the working-tree default.
  useEffect(() => {
    if (compareToId && !checkpoints.some((c) => c.id === compareToId)) setCompareToId("");
  }, [checkpoints, compareToId]);

  const diff = useQuery({
    queryKey: [...queryKeys.checkpoints, selectedId, "diff", compareToId || "working-tree"],
    queryFn: () => gv.checkpoints.diff(compareToId ? { a: selectedId, b: compareToId } : { a: selectedId }),
    enabled: selectedId !== "",
    retry: false,
  });

  // Restore always overwrites the CURRENT working tree, regardless of what
  // compareToId the detail pane happens to be showing — so the confirm's
  // preview is its OWN working-tree diff, never whatever comparison the
  // pane is mid-browsing (never show the wrong diff at the consent moment).
  const restoreDiff = useQuery({
    queryKey: [...queryKeys.checkpoints, restoreTarget?.id ?? "", "diff", "working-tree"],
    queryFn: () => gv.checkpoints.diff({ a: restoreTarget?.id ?? "" }),
    enabled: restoreTarget !== null,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => {
      const trimmed = labelDraft.trim();
      return gv.checkpoints.create({ kind: "manual", label: trimmed ? trimmed : undefined });
    },
    onSuccess: async (result) => {
      const record = (result ?? {}) as Record<string, unknown>;
      if (record["noop"] === true) {
        toast({ title: "No checkpoint created", description: CHECKPOINT_NOOP_MESSAGE, tone: "info" });
        return;
      }
      setLabelDraft("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.checkpoints });
      const created = parseCheckpoint(record["checkpoint"]);
      if (created.id) {
        setSelectedId(created.id);
        toast({ title: "Checkpoint created", description: created.label || created.id, tone: "success" });
      } else {
        toast({ title: "Checkpoint created", tone: "success" });
      }
    },
    onError: (error: unknown) => {
      toast({ title: "Failed to create checkpoint", description: formatError(error), tone: "danger" });
    },
  });

  const restore = useMutation({
    mutationFn: ({ checkpoint, meta }: { checkpoint: WorkspaceCheckpoint; meta: ConfirmMetadata }) =>
      // Dangerous ws verb: forward confirm:true + explicitUserRequest verbatim.
      gv.checkpoints.restore({ id: checkpoint.id, ...meta }),
    onSuccess: async (_result, { checkpoint }) => {
      setRestoreTarget(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.checkpoints });
      toast({ title: "Workspace restored", description: checkpoint.label || checkpoint.id, tone: "success" });
    },
    onError: (error: unknown, { checkpoint }) => {
      setRestoreTarget(null);
      toast({
        title: isNotFound(error) ? "Checkpoint no longer exists" : "Restore failed",
        description: isNotFound(error)
          ? `"${checkpoint.label || checkpoint.id}" was not found — it may have been garbage-collected.`
          : formatError(error),
        tone: "danger",
      });
    },
  });

  // Palette command — view-scoped.
  useEffect(() => {
    registerCommand({
      id: "checkpoints.snapshot",
      title: "Create Workspace Checkpoint",
      group: "code",
      keywords: ["checkpoint", "snapshot", "save"],
      run: () => create.mutate(),
    });
    return () => unregisterCommand("checkpoints.snapshot");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unavailable = list.isError && isCapabilityGap(list.error);

  return (
    <div className={selected ? "checkpoints-view has-selection" : "checkpoints-view"}>
      <div className="checkpoints-list-pane">
        <div className="checkpoints-toolbar">
          <div className="checkpoints-create-row">
            <input
              type="text"
              className="checkpoints-label-input"
              placeholder="Checkpoint label (optional)"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              disabled={create.isPending}
              aria-label="Checkpoint label"
            />
            <button
              type="button"
              className="checkpoints-create-button"
              onClick={() => create.mutate()}
              disabled={create.isPending}
              title="Create a checkpoint of the current workspace"
            >
              <Camera size={14} aria-hidden="true" /> {create.isPending ? "Snapshotting…" : "Snapshot"}
            </button>
          </div>
          <button
            type="button"
            className="section-toolbar__refresh"
            aria-label="Refresh checkpoints"
            onClick={() => void list.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
        </div>

        {list.isPending && <SkeletonBlock variant="text" lines={4} />}

        {unavailable && (
          <UnavailableState
            capability={capabilityLabel(list.error)}
            description="workspace checkpoints cannot be listed, created, diffed, or restored right now."
            action={{ label: "Retry", onClick: () => void list.refetch() }}
          />
        )}

        {list.isError && !unavailable && (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load checkpoints" />
        )}

        {list.isSuccess && checkpoints.length === 0 && (
          <EmptyState
            icon={<History size={28} aria-hidden="true" />}
            title="No checkpoints yet"
            description="Create one to capture the current workspace tree, or checkpoints are created automatically per turn/agent-run depending on daemon config."
            action={{ label: "Snapshot now", onClick: () => create.mutate() }}
          />
        )}

        {list.isSuccess && checkpoints.length > 0 && (
          <ul className="checkpoints-rows">
            {checkpoints.map((checkpoint) => (
              <li key={checkpoint.id}>
                <button
                  type="button"
                  className={checkpoint.id === selectedId ? "checkpoints-row active" : "checkpoints-row"}
                  onClick={() => {
                    setSelectedId(checkpoint.id);
                    setCompareToId("");
                  }}
                >
                  <span className="checkpoints-row__title">{checkpoint.label || checkpoint.id}</span>
                  <span className="checkpoints-row__badges">
                    <span className="badge neutral">{checkpoint.kind || "unknown"}</span>
                    <span className="badge neutral">{checkpoint.retentionClass || "unknown"}</span>
                    <span className="checkpoints-row__meta">
                      {formatRelative(checkpoint.createdAt)} · {formatBytes(checkpoint.sizeBytes)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="checkpoints-detail-pane">
        {selected ? (
          <CheckpointDetail
            checkpoint={selected}
            compareOptions={compareOptions}
            compareToId={compareToId}
            onCompareToChange={setCompareToId}
            diffData={diff.isSuccess ? diff.data : null}
            diffPending={diff.isPending}
            diffError={diff.isError ? diff.error : null}
            onRetryDiff={() => void diff.refetch()}
            onRestore={() => setRestoreTarget(selected)}
            restoring={restore.isPending}
            onBack={() => setSelectedId("")}
          />
        ) : (
          <div className="checkpoints-detail-empty">Select a checkpoint to view its diff.</div>
        )}
      </div>

      <ConfirmSurface
        open={restoreTarget !== null}
        danger
        action="Restore checkpoint"
        target={restoreTarget ? restoreTarget.label || restoreTarget.id : ""}
        blastRadius="Overwrites the CURRENT working tree with the files captured by that checkpoint (a git-backed rewrite). Uncommitted changes made since then that are not themselves checkpointed will be lost."
        requireTypedText="restore"
        confirmLabel={restore.isPending ? "Restoring…" : "Restore checkpoint"}
        onConfirm={(meta) => {
          if (restoreTarget) restore.mutate({ checkpoint: restoreTarget, meta });
        }}
        onCancel={() => setRestoreTarget(null)}
      >
        {restoreTarget && <RestoreDiffPreview query={restoreDiff} />}
      </ConfirmSurface>
    </div>
  );
}

// ─── detail pane ─────────────────────────────────────────────────────────────

function CheckpointDetail({
  checkpoint,
  compareOptions,
  compareToId,
  onCompareToChange,
  diffData,
  diffPending,
  diffError,
  onRetryDiff,
  onRestore,
  restoring,
  onBack,
}: {
  checkpoint: WorkspaceCheckpoint;
  compareOptions: readonly WorkspaceCheckpoint[];
  compareToId: string;
  onCompareToChange: (id: string) => void;
  diffData: unknown;
  diffPending: boolean;
  diffError: unknown;
  onRetryDiff: () => void;
  onRestore: () => void;
  restoring: boolean;
  onBack: () => void;
}) {
  const parsed = useMemo(() => (diffData != null ? parseCheckpointDiff(diffData) : null), [diffData]);
  const compareTarget = compareToId ? (compareOptions.find((c) => c.id === compareToId) ?? null) : null;
  const compareLabel = compareToId ? compareTarget?.label || compareToId : "the working tree";

  return (
    <div className="checkpoint-detail">
      <button type="button" className="checkpoints-detail__back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        Back to checkpoints
      </button>
      <header className="checkpoint-detail__header">
        <h2>{checkpoint.label || checkpoint.id}</h2>
        <div className="checkpoint-detail__badges">
          <span className="badge neutral">{checkpoint.kind || "unknown"}</span>
          <span className="badge neutral">{checkpoint.retentionClass || "unknown"}</span>
          <span className="badge neutral">{formatBytes(checkpoint.sizeBytes)}</span>
        </div>
        <div className="checkpoint-detail__meta">
          <small>Created {formatRelative(checkpoint.createdAt)}</small>
          <small>· commit {checkpoint.commit ? checkpoint.commit.slice(0, 12) : "unknown"}</small>
          {checkpoint.parentId && <small>· parent {checkpoint.parentId}</small>}
        </div>
        <button
          type="button"
          className="checkpoint-detail__restore"
          onClick={onRestore}
          disabled={restoring}
          title="Restore the workspace to this checkpoint (destructive — confirms first)"
        >
          <RotateCcw size={14} aria-hidden="true" /> {restoring ? "Restoring…" : "Restore this checkpoint"}
        </button>
      </header>

      <div className="checkpoint-detail__diff">
        <div className="checkpoint-detail__diff-header">
          <strong>Diff vs. {compareLabel}</strong>
          <label className="checkpoint-detail__compare">
            Compare to
            <select
              value={compareToId}
              onChange={(e) => onCompareToChange(e.target.value)}
              aria-label="Compare checkpoint to"
            >
              <option value="">Working tree</option>
              {compareOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label || c.id}
                </option>
              ))}
            </select>
          </label>
        </div>
        {diffPending && <SkeletonBlock variant="text" lines={6} />}
        {diffError != null &&
          (isNotFound(diffError) ? (
            <div className="checkpoints-empty" role="note">
              This checkpoint no longer exists (it may have been garbage-collected).
            </div>
          ) : isCapabilityGap(diffError) ? (
            <UnavailableState
              capability={isWsBridgeUnavailableError(diffError) ? "checkpoints.diff (ws bridge not connected)" : "checkpoints.diff"}
              description="the diff for this checkpoint cannot be computed right now."
              action={{ label: "Retry", onClick: onRetryDiff }}
            />
          ) : (
            <ErrorState error={diffError} onRetry={onRetryDiff} title="Failed to load diff" />
          ))}
        {parsed && diffError == null && (
          <>
            {parsed.files.length === 0 ? (
              <div className="checkpoints-empty" role="note">
                {compareToId
                  ? "No file differences between these checkpoints."
                  : "No file differences from the working tree."}
              </div>
            ) : (
              <p className="checkpoint-detail__diff-files">
                {parsed.files.length} file{parsed.files.length === 1 ? "" : "s"} changed: {parsed.files.join(", ")}
              </p>
            )}
            {parsed.unifiedDiff && <pre className="checkpoint-detail__diff-pre">{parsed.unifiedDiff}</pre>}
          </>
        )}
      </div>
    </div>
  );
}

// ─── restore confirm: full working-tree diff, never a truncated summary ─────

/** What restoring this checkpoint would actually do to the CURRENT working
 * tree, rendered in full at the moment of consent — never just the worded
 * blast-radius sentence with the real change hidden behind it. */
function RestoreDiffPreview({
  query,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; isSuccess: boolean; data: unknown };
}) {
  const parsed = useMemo(() => (query.isSuccess ? parseCheckpointDiff(query.data) : null), [query.isSuccess, query.data]);
  return (
    <div className="confirm-surface__diff-preview">
      <strong className="confirm-surface__diff-preview-label">What restoring will change (vs. the working tree)</strong>
      {query.isPending && <SkeletonBlock variant="text" lines={4} />}
      {query.isError && (
        <p className="git-honest-note" role="note">
          Could not load the diff this restore would apply — the blast-radius description above still holds.
        </p>
      )}
      {parsed &&
        (parsed.files.length === 0 ? (
          <p className="git-honest-note" role="note">
            No file differences from the working tree — restoring will not change anything on disk.
          </p>
        ) : (
          <>
            <p className="checkpoint-detail__diff-files">
              {parsed.files.length} file{parsed.files.length === 1 ? "" : "s"} will be overwritten:{" "}
              {parsed.files.join(", ")}
            </p>
            {parsed.unifiedDiff && <pre className="checkpoint-detail__diff-pre">{parsed.unifiedDiff}</pre>}
          </>
        ))}
    </div>
  );
}
