// Deliveries (docs/FEATURES.md §13 row 12 / docs/GAPS.md top-10 gap #6):
// deliveries.list rendered as a filterable master list (status, target
// surface) with a detail peek (deliveries.get) that shows the failure reason
// verbatim. Read-only: the generated route table has no deliveries.retry (or
// any deliveries.* mutating verb at all — see channels-wire.ts's header note)
// on this pin, so this panel says so plainly instead of drawing a button that
// would no-op or 404.
//
// Freshness: the `deliveries` realtime domain (lib/realtime.ts) invalidates
// queryKeys.deliveries — this panel nests its own keys under that SAME shared
// prefix (imported, not reinvented) so the fast-path event reaches it, exactly
// like AwayDigest.tsx's `[...queryKeys.deliveries, "away"]`.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Inbox as InboxIcon, Send } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatRelative } from "../../lib/wire.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { ErrorState, SkeletonBlock } from "../../components/feedback.tsx";
import { QueryPanel } from "./QueryPanel.tsx";
import { readDeliveries, readDeliveryDetail, type DeliveryRecord } from "./channels-wire.ts";

const DELIVERIES_QUERY_KEY = [...queryKeys.deliveries, "channels-panel"] as const;
const DELIVERY_STATUS_OPTIONS = ["pending", "sending", "sent", "failed", "dead_lettered"] as const;

type DeliveryTone = "ok" | "warning" | "bad" | "neutral";

/** Local tone ruling — classifyBadgeTone's generic word-matching doesn't know
 * "dead_lettered" is worse than "failed", so this panel rules it directly
 * rather than mis-classify through the shared heuristic. */
function deliveryStatusTone(status: string): DeliveryTone {
  if (status === "sent") return "ok";
  if (status === "failed" || status === "dead_lettered") return "bad";
  if (status === "pending" || status === "sending") return "warning";
  return "neutral";
}

function DeliveryStatusBadge({ status }: { status: string }) {
  return <span className={`badge ${deliveryStatusTone(status)}`}>{status}</span>;
}

/** Detail peek — deliveries.get rendered field-by-field, failure reason
 * verbatim, plus the honest no-retry note (channels-wire.ts header). */
function DeliveryDetailPeek({ deliveryId }: { deliveryId: string }) {
  const detail = useQuery({
    queryKey: [...DELIVERIES_QUERY_KEY, "detail", deliveryId],
    queryFn: () => invoke("deliveries.get", { params: { deliveryId } }),
    select: readDeliveryDetail,
  });

  if (detail.isPending) return <SkeletonBlock variant="text" lines={8} />;
  if (detail.isError) {
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="Failed to load delivery" />;
  }

  const delivery = detail.data;
  return (
    <div className="channels-delivery-detail">
      <div className="channels-delivery-detail__row">
        <span>Status</span>
        <DeliveryStatusBadge status={delivery.status} />
      </div>
      <div className="channels-delivery-detail__row">
        <span>Target</span>
        <span>
          {delivery.target.surfaceKind || delivery.target.kind}
          {delivery.target.label ? ` · ${delivery.target.label}` : ""}
          {delivery.target.address ? ` · ${delivery.target.address}` : ""}
        </span>
      </div>
      {delivery.target.routeId && (
        <div className="channels-delivery-detail__row">
          <span>Route</span>
          <code>{delivery.target.routeId}</code>
        </div>
      )}
      <div className="channels-delivery-detail__row">
        <span>Run / Job</span>
        <code>
          {delivery.runId || "—"} / {delivery.jobId || "—"}
        </code>
      </div>
      <div className="channels-delivery-detail__row">
        <span>Started</span>
        <span>{delivery.startedAt !== undefined ? formatRelative(delivery.startedAt) : "unknown"}</span>
      </div>
      <div className="channels-delivery-detail__row">
        <span>Ended</span>
        <span>{delivery.endedAt !== undefined ? formatRelative(delivery.endedAt) : "still open"}</span>
      </div>
      {delivery.responseId && (
        <div className="channels-delivery-detail__row">
          <span>Response id</span>
          <code>{delivery.responseId}</code>
        </div>
      )}
      {delivery.error && (
        <div className="channels-delivery-detail__error">
          <strong>Failure reason (verbatim)</strong>
          <pre>{delivery.error}</pre>
        </div>
      )}
      <p className="channels-delivery-detail__note" role="note">
        This daemon has no `deliveries.retry` (or any other deliveries.* mutating verb) in its method table — resending
        isn't possible from here. If the underlying job/schedule can be re-run, do that instead.
      </p>
    </div>
  );
}

export function DeliveriesPanel() {
  const peek = usePeek();
  const [statusFilter, setStatusFilter] = useState("");
  const [surfaceFilter, setSurfaceFilter] = useState("");

  const deliveries = useQuery({
    queryKey: DELIVERIES_QUERY_KEY,
    queryFn: () => invoke("deliveries.list"),
    select: readDeliveries,
  });

  const surfaceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const delivery of deliveries.data?.deliveries ?? []) {
      if (delivery.target.surfaceKind) set.add(delivery.target.surfaceKind);
    }
    if (surfaceFilter) set.add(surfaceFilter);
    return [...set].sort();
  }, [deliveries.data, surfaceFilter]);

  const filtered = useMemo(() => {
    const rows = deliveries.data?.deliveries ?? [];
    return rows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (surfaceFilter && row.target.surfaceKind !== surfaceFilter) return false;
      return true;
    });
  }, [deliveries.data, statusFilter, surfaceFilter]);

  const totals = deliveries.data?.totals ?? null;

  return (
    <div className="channels-deliveries">
      <div className="channels-filter-row">
        <label className="channels-filter">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            {DELIVERY_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="channels-filter">
          <span>Target surface</span>
          <select value={surfaceFilter} onChange={(event) => setSurfaceFilter(event.target.value)}>
            <option value="">All surfaces</option>
            {surfaceOptions.map((surface) => (
              <option key={surface} value={surface}>
                {surface}
              </option>
            ))}
          </select>
        </label>
        {deliveries.isSuccess && (
          <span className="channels-filter-row__summary">
            {filtered.length} of {deliveries.data.deliveries.length}
          </span>
        )}
      </div>

      {totals && (
        <div className="channels-delivery-totals" aria-label="Delivery totals">
          <span className="badge neutral">{totals.queued} queued</span>
          <span className="badge warning">{totals.started} in flight</span>
          <span className="badge ok">{totals.succeeded} succeeded</span>
          <span className="badge bad">{totals.failed} failed</span>
          {totals.deadLettered > 0 && (
            <span className="badge bad">
              <AlertTriangle size={11} aria-hidden="true" /> {totals.deadLettered} dead-lettered
            </span>
          )}
        </div>
      )}

      <QueryPanel
        query={deliveries}
        capability="deliveries.list"
        unavailableDescription="delivery receipts cannot be listed by this daemon."
        errorTitle="Failed to load deliveries"
        isEmpty={() => filtered.length === 0}
        emptyIcon={<InboxIcon size={28} aria-hidden="true" />}
        emptyTitle={statusFilter || surfaceFilter ? "No deliveries match" : "No deliveries yet"}
        emptyDescription={
          statusFilter || surfaceFilter
            ? "Try clearing a filter."
            : "Outbound sends to channel surfaces, webhooks, and integrations appear here as they happen."
        }
        skeletonLines={6}
      >
        {() => (
          <ul className="channels-catalog__list" aria-label="Deliveries">
            {filtered.map((delivery) => (
              <li key={delivery.id} className="channels-catalog__row">
                <div className="channels-catalog__text">
                  <span className="channels-catalog__label">
                    <Send size={13} aria-hidden="true" />
                    {delivery.target.surfaceKind || delivery.target.kind || "delivery"}
                    <DeliveryStatusBadge status={delivery.status} />
                  </span>
                  <span className="channels-catalog__desc">
                    {delivery.target.label || delivery.target.address || delivery.id}
                  </span>
                  <span className="channels-audit__meta">
                    {delivery.target.routeId && <code>route {delivery.target.routeId}</code>}
                    <span>
                      {delivery.startedAt !== undefined ? formatRelative(delivery.startedAt) : "start unknown"}
                    </span>
                  </span>
                  {delivery.error && <span className="channels-deliveries__error">{delivery.error}</span>}
                </div>
                <div className="channels-catalog__row-actions">
                  <button
                    type="button"
                    className="channels-btn"
                    onClick={() =>
                      peek.open({
                        title: delivery.target.label || `Delivery ${delivery.id}`,
                        content: <DeliveryDetailPeek deliveryId={delivery.id} />,
                      })
                    }
                  >
                    View
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryPanel>
    </div>
  );
}
