// Pair requests inbox — remote.pair.requests.list/approve/reject
// (docs/FEATURES.md §21 row 3). Pending requests surface first with
// approve/reject actions; resolved requests (approved/verified/rejected/
// expired) stay visible below as a short history so an operator can see what
// happened to a request after deciding it. Approve's confirm and success
// toast both echo the requester identity back, per the gap brief.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Inbox, RefreshCw, X } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import {
  formatRelative,
  isPendingPairRequest,
  pairRequestsFromResponse,
  peersKeys,
  REMOTE_POLL_MS,
  type PairRequestRecord,
} from "./peers-model.ts";

function requesterIdentity(request: PairRequestRecord): string {
  return `${request.label || request.requestedId} (${request.peerKind})`;
}

export function PairRequestsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [approveTarget, setApproveTarget] = useState<PairRequestRecord | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PairRequestRecord | null>(null);

  const list = useQuery({
    queryKey: peersKeys.pairRequests,
    queryFn: () => gv.invoke("remote.pair.requests.list"),
    refetchInterval: REMOTE_POLL_MS,
  });
  const rows = pairRequestsFromResponse(list.data);
  const pending = rows.filter(isPendingPairRequest).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const resolved = rows.filter((r) => !isPendingPairRequest(r)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: peersKeys.all });

  const approve = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      gv.invoke("remote.pair.requests.approve", { params: { requestId: id }, body: { ...meta } }),
    onSuccess: async (_result, variables) => {
      setApproveTarget(null);
      await invalidate();
      const identity = approveTarget ? requesterIdentity(approveTarget) : variables.id;
      toast({ title: `Approved pairing for ${identity}`, tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Approve failed (admin scope required)", description: formatError(error), tone: "danger" });
    },
  });

  const reject = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      gv.invoke("remote.pair.requests.reject", { params: { requestId: id }, body: { ...meta } }),
    onSuccess: async () => {
      setRejectTarget(null);
      await invalidate();
      toast({ title: "Pairing request rejected", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Reject failed (admin scope required)", description: formatError(error), tone: "danger" });
    },
  });

  const unavailable = list.isError && isMethodUnavailableError(list.error);

  return (
    <section className="peers-section" aria-label="Pair requests">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Inbox size={14} aria-hidden="true" /> Pair requests
          {list.isSuccess ? ` · ${pending.length} pending` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh pair requests"
          onClick={() => void list.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {list.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState
          capability="remote.pair.requests.list"
          description="incoming pairing requests from nodes and devices cannot be listed or decided."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load pair requests" />
      )}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<Inbox size={28} aria-hidden="true" />}
          title="No pairing requests"
          description="When another goodvibes node or a companion device asks to pair with this daemon, its request lands here for approval before it becomes a peer."
        />
      )}

      {list.isSuccess && pending.length > 0 && (
        <ul className="pair-request-rows">
          {pending.map((request) => (
            <li key={request.id} className="pair-request-row">
              <div className="pair-request-row__main">
                <span className="pair-request-row__label">{request.label || request.requestedId}</span>
                <span className="badge neutral">{request.peerKind}</span>
                <span className="badge info">requested by {request.requestedBy}</span>
                {request.platform && <span className="pair-request-row__meta">{request.platform}</span>}
                <span className="pair-request-row__meta">{formatRelative(request.createdAt)}</span>
              </div>
              {request.commands.length > 0 && (
                <div className="pair-request-row__tags">
                  {request.commands.map((c) => (
                    <span key={c} className="badge neutral">
                      {c}
                    </span>
                  ))}
                </div>
              )}
              <div className="pair-request-row__actions">
                <button type="button" className="peers-btn peers-btn--primary" onClick={() => setApproveTarget(request)}>
                  <Check size={13} aria-hidden="true" /> Approve
                </button>
                <button type="button" className="peers-btn peers-btn--danger" onClick={() => setRejectTarget(request)}>
                  <X size={13} aria-hidden="true" /> Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {list.isSuccess && resolved.length > 0 && (
        <details className="pair-request-history">
          <summary>Resolved requests ({resolved.length})</summary>
          <ul className="pair-request-rows pair-request-rows--history">
            {resolved.map((request) => (
              <li key={request.id} className="pair-request-row pair-request-row--history">
                <span className="pair-request-row__label">{request.label || request.requestedId}</span>
                <StatusBadge value={request.status} />
                <span className="pair-request-row__meta">{formatRelative(request.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmSurface
        open={approveTarget !== null}
        action="Approve pairing request"
        target={approveTarget ? requesterIdentity(approveTarget) : ""}
        blastRadius="This node/device becomes a peer once it completes verification: it can send status and location updates, receive queued work, and use the token issued to it. It shows up in the Peers list from then on."
        confirmLabel="Approve"
        onConfirm={(meta) => {
          if (approveTarget) approve.mutate({ id: approveTarget.id, meta });
        }}
        onCancel={() => setApproveTarget(null)}
      />

      <ConfirmSurface
        open={rejectTarget !== null}
        action="Reject pairing request"
        target={rejectTarget ? requesterIdentity(rejectTarget) : ""}
        blastRadius="The request is marked rejected and the requester never becomes a peer. It can send a new request later if it retries."
        confirmLabel="Reject"
        onConfirm={(meta) => {
          if (rejectTarget) reject.mutate({ id: rejectTarget.id, meta });
        }}
        onCancel={() => setRejectTarget(null)}
      />
    </section>
  );
}
