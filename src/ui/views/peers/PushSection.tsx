// Push panel — web-push subscriptions for PWA companions (docs/FEATURES.md
// §21 row 6, docs/GAPS.md top-10 gap #5). All five methods are ws-only;
// gv.invoke handles that transparently over the /app/ws bridge (lib/gv.ts) —
// this panel degrades honestly (UnavailableState) when the bridge is down or
// the daemon build lacks push.*, same as every other ws-only surface in this
// view. push.subscriptions.create is deliberately NOT exposed here: it is
// the PWA companion's own registration call, not an operator action — this
// app uses native desktop notifications (docs/FEATURES.md §21 row 6 note).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { compactJson, formatAbsolute, formatRelative } from "./peers-model.ts";
import {
  normalizeVerifyReceipt,
  pushSubscriptionsFromResponse,
  vapidPublicKeyFromResponse,
  type PushSubscription,
} from "./push-model.ts";

const PUSH_POLL_MS = 30_000; // push.* is not on the realtime invalidation stream

const pushKeys = {
  all: ["peers", "push"] as const,
  vapid: ["peers", "push", "vapid"] as const,
  subscriptions: ["peers", "push", "subscriptions"] as const,
} as const;

function isCapabilityGap(error: unknown): boolean {
  return isMethodUnavailableError(error) || isWsBridgeUnavailableError(error);
}

function capabilityLabel(methodId: string, error: unknown): string {
  return isWsBridgeUnavailableError(error) ? `${methodId} (ws bridge not connected)` : methodId;
}

export function PushSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<PushSubscription | null>(null);
  const [verifyResultId, setVerifyResultId] = useState<string | null>(null);

  const vapid = useQuery({
    queryKey: pushKeys.vapid,
    queryFn: () => gv.invoke("push.vapid.get"),
    staleTime: 5 * 60_000, // the public key does not rotate on its own
    retry: false,
  });

  const list = useQuery({
    queryKey: pushKeys.subscriptions,
    queryFn: () => gv.invoke("push.subscriptions.list"),
    refetchInterval: PUSH_POLL_MS,
    retry: false,
  });
  const rows = pushSubscriptionsFromResponse(list.data);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: pushKeys.all });

  const verify = useMutation({
    mutationFn: (subscriptionId: string) =>
      gv.invoke("push.subscriptions.verify", { body: { subscriptionId } }),
    onSuccess: async (result, subscriptionId) => {
      const receipt = normalizeVerifyReceipt(result);
      setVerifyResultId(subscriptionId);
      await invalidate();
      toast({
        title: `Verify: ${receipt.outcome}`,
        description: receipt.detail || `${receipt.endpointOrigin || "endpoint"} — HTTP ${receipt.httpStatus ?? "?"}`,
        tone: receipt.outcome === "delivered" || receipt.outcome === "ok" ? "success" : "info",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Verify failed", description: formatError(error), tone: "danger" });
    },
  });

  const remove = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      gv.invoke("push.subscriptions.delete", { body: { subscriptionId: id, ...meta } }),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidate();
      toast({ title: "Subscription deleted", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    },
  });

  const vapidUnavailable = vapid.isError && isCapabilityGap(vapid.error);
  const listUnavailable = list.isError && isCapabilityGap(list.error);

  return (
    <section className="peers-section" aria-label="Push">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <BellRing size={14} aria-hidden="true" /> Push
          {list.isSuccess ? ` · ${rows.length} subscription${rows.length === 1 ? "" : "s"}` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh push subscriptions"
          onClick={() => {
            void vapid.refetch();
            void list.refetch();
          }}
        >
          <RefreshCw
            size={15}
            aria-hidden="true"
            className={vapid.isFetching || list.isFetching ? "spinning" : undefined}
          />
        </button>
      </div>

      <div className="push-vapid">
        <span className="push-vapid__label">
          <KeyRound size={13} aria-hidden="true" /> VAPID public key
        </span>
        {vapid.isPending && <SkeletonBlock variant="text" lines={1} />}
        {vapidUnavailable && (
          <UnavailableState
            capability={capabilityLabel("push.vapid.get", vapid.error)}
            description="the VAPID public key cannot be read — PWA companions cannot register for push here."
          />
        )}
        {vapid.isError && !vapidUnavailable && (
          <ErrorState error={vapid.error} onRetry={() => void vapid.refetch()} title="Failed to load VAPID key" />
        )}
        {vapid.isSuccess &&
          (() => {
            const key = vapidPublicKeyFromResponse(vapid.data);
            return key ? (
              <code className="push-vapid__key" title="Base64url-encoded VAPID public key">
                {key}
              </code>
            ) : (
              <span className="peer-detail__note">No public key reported.</span>
            );
          })()}
      </div>

      {list.isPending && <SkeletonBlock variant="text" lines={3} />}

      {listUnavailable && (
        <UnavailableState
          capability={capabilityLabel("push.subscriptions.list", list.error)}
          description="registered push subscriptions cannot be listed, verified, or removed."
        />
      )}

      {list.isError && !listUnavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load push subscriptions" />
      )}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<BellRing size={28} aria-hidden="true" />}
          title="No push subscriptions"
          description="When a PWA companion registers for push notifications, its subscription lands here for inspection, verification, or removal. This app itself uses native desktop notifications, not web push."
        />
      )}

      {list.isSuccess && rows.length > 0 && (
        <ul className="push-rows">
          {rows.map((sub) => (
            <li key={sub.id} className="push-row">
              <div className="push-row__main">
                <span className="push-row__origin" title={sub.id}>
                  {sub.endpointOrigin || sub.id}
                </span>
                {sub.lastOutcome && <StatusBadge value={sub.lastOutcome} />}
                {sub.principalId && <span className="push-row__meta">principal: {sub.principalId}</span>}
                {sub.createdAt !== undefined && (
                  <span className="push-row__meta" title={formatAbsolute(sub.createdAt)}>
                    created {formatRelative(sub.createdAt)}
                  </span>
                )}
                {sub.lastDeliveryAt !== undefined && (
                  <span className="push-row__meta" title={formatAbsolute(sub.lastDeliveryAt)}>
                    last delivery {formatRelative(sub.lastDeliveryAt)}
                  </span>
                )}
              </div>
              <div className="push-row__actions">
                <button
                  type="button"
                  className="peers-btn"
                  onClick={() => verify.mutate(sub.id)}
                  disabled={verify.isPending && verifyResultId === sub.id}
                  title="Send a verification push to this endpoint"
                >
                  <ShieldCheck size={13} aria-hidden="true" /> Verify
                </button>
                <button
                  type="button"
                  className="peers-btn peers-btn--danger"
                  onClick={() => setDeleteTarget(sub)}
                >
                  <Trash2 size={13} aria-hidden="true" /> Delete
                </button>
              </div>
              <details className="peer-detail__raw">
                <summary>Raw record</summary>
                <pre>{compactJson(sub.raw)}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}

      <ConfirmSurface
        open={deleteTarget !== null}
        danger
        action="Delete push subscription"
        target={deleteTarget ? deleteTarget.endpointOrigin || deleteTarget.id : ""}
        blastRadius="This subscription is removed permanently. The PWA companion stops receiving push notifications until it registers a new subscription itself."
        confirmLabel={remove.isPending ? "Deleting…" : "Delete subscription"}
        onConfirm={(meta) => {
          if (deleteTarget) remove.mutate({ id: deleteTarget.id, meta });
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
