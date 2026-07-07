// Remote work queue — remote.work.list/cancel (docs/FEATURES.md §21 row 4).
// Work items are commands and automation runs dispatched to peers; only
// queued/claimed items are cancellable (the daemon's own transition guard —
// completed/failed/cancelled/expired are terminal). A peek-free detail
// <details> shows payload/result/error/telemetry inline since work rows are
// already compact.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListTodo, RefreshCw, XCircle } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import {
  compactJson,
  formatRelative,
  isCancellableWork,
  peersKeys,
  REMOTE_POLL_MS,
  workFromResponse,
  type WorkRecord,
} from "./peers-model.ts";

export function WorkSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [cancelTarget, setCancelTarget] = useState<WorkRecord | null>(null);

  const list = useQuery({
    queryKey: peersKeys.work,
    queryFn: () => gv.invoke("remote.work.list"),
    refetchInterval: REMOTE_POLL_MS,
  });
  const rows = [...workFromResponse(list.data)].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const cancel = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      gv.invoke("remote.work.cancel", { params: { workId: id }, body: { ...meta } }),
    onSuccess: async () => {
      setCancelTarget(null);
      await queryClient.invalidateQueries({ queryKey: peersKeys.all });
      toast({ title: "Work cancelled", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Cancel failed (admin scope required)", description: formatError(error), tone: "danger" });
    },
  });

  const unavailable = list.isError && isMethodUnavailableError(list.error);

  return (
    <section className="peers-section" aria-label="Remote work queue">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <ListTodo size={14} aria-hidden="true" /> Work queue
          {list.isSuccess ? ` · ${rows.length} items` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh work queue"
          onClick={() => void list.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {list.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState
          capability="remote.work.list"
          description="commands and automation runs dispatched to peers cannot be listed or cancelled."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load work queue" />
      )}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<ListTodo size={28} aria-hidden="true" />}
          title="No remote work queued"
          description="Commands, status/location requests, and automation runs dispatched to peers appear here — queued, claimed, completed, and failed alike."
        />
      )}

      {list.isSuccess && rows.length > 0 && (
        <ul className="work-rows">
          {rows.map((work) => (
            <li key={work.id} className="work-row">
              <div className="work-row__main">
                <span className="work-row__command">{work.command || work.type}</span>
                <span className="badge neutral">{work.type}</span>
                <StatusBadge value={work.status} />
                {work.priority !== "default" && <span className="badge info">{work.priority}</span>}
                <span className="work-row__meta">peer {work.peerId || "—"}</span>
                <span className="work-row__meta">{formatRelative(work.createdAt)}</span>
              </div>
              {work.error && <p className="work-row__error">{work.error}</p>}
              <div className="work-row__foot">
                <details className="work-row__details">
                  <summary>Payload / result</summary>
                  <pre>{compactJson({ payload: work.payload, result: work.result, telemetry: work.telemetry })}</pre>
                </details>
                {isCancellableWork(work) && (
                  <button type="button" className="peers-btn peers-btn--danger" onClick={() => setCancelTarget(work)}>
                    <XCircle size={13} aria-hidden="true" /> Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmSurface
        open={cancelTarget !== null}
        action="Cancel work item"
        target={cancelTarget ? `${cancelTarget.command || cancelTarget.type} (${cancelTarget.id})` : ""}
        blastRadius="The item is marked cancelled and removed from the peer's work queue. If the peer already claimed it, work in progress on the peer's side is not forcibly stopped — only the daemon's record of it."
        confirmLabel="Cancel work"
        onConfirm={(meta) => {
          if (cancelTarget) cancel.mutate({ id: cancelTarget.id, meta });
        }}
        onCancel={() => setCancelTarget(null)}
      />
    </section>
  );
}
