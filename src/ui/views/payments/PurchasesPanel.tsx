// Purchases: the daemon's own audit ledger, rendered as it recorded it.
//
// Nothing is summarised into a friendlier word. A refused purchase shows its
// refusal reason, an unanswered window shows which window ran and how it
// ended, and a stepped-down delivery says so, those are the facts that
// explain why a purchase went the way it did, and a row without them is a row
// that cannot be audited.
//
// `merchantRecognised` is in every row for the same reason: it is the fact
// that decided what SILENCE meant. A merchant with established recourse gets a
// veto window (silence means go ahead); one without gets an approval window
// (silence means no). Without that column a reader can see that one purchase
// asked and another did not, and cannot see why.
//
// The instrument on a row is `cardLast4` and nothing else, which is all the
// ledger holds.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt, RefreshCw } from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  PAYMENTS_POLL_MS,
  formatMinorUnits,
  formatUtc,
  outcomeTone,
  paymentsApi,
  paymentsRefusal,
  recourseNote,
  type Purchase,
} from "./payments-data.ts";

const PAGE_LIMIT = 25;

export function PurchasesPanel() {
  const [dayKey, setDayKey] = useState("");

  const purchases = useQuery({
    queryKey: queryKeys.paymentsPurchases(PAGE_LIMIT, dayKey),
    queryFn: () => paymentsApi.purchases(PAGE_LIMIT, dayKey),
    retry: false,
    refetchInterval: PAYMENTS_POLL_MS,
  });

  const refusal = purchases.isError ? paymentsRefusal(purchases.error, "payments.purchases.list") : null;
  const rows = purchases.data?.purchases ?? [];
  const total = purchases.data?.total ?? 0;

  return (
    <section className="payments-section" aria-labelledby="payments-purchases-heading">
      <div className="payments-section__header">
        <h2 id="payments-purchases-heading">Purchases</h2>
        <div className="payments-section__meta">
          <label className="payments-daykey">
            <span>Day</span>
            <input
              type="text"
              value={dayKey}
              placeholder="all days"
              aria-label="Filter purchases by day key"
              onChange={(event) => setDayKey(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="payments-icon-button"
            title="Refresh"
            aria-label="Refresh purchases"
            onClick={() => void purchases.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={purchases.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      {purchases.isPending && <SkeletonBlock variant="text" lines={4} />}
      {refusal && <UnavailableState capability={refusal.capability} description={refusal.description} />}
      {purchases.isError && !refusal && (
        <ErrorState
          error={purchases.error}
          onRetry={() => void purchases.refetch()}
          title="Failed to load purchases"
        />
      )}

      {purchases.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<Receipt size={20} aria-hidden="true" />}
          title={dayKey ? `Nothing recorded for ${dayKey}` : "Nothing bought yet"}
          description="Every purchase the capability attempts lands here, including the ones it refused."
        />
      )}

      {rows.length > 0 && (
        <>
          <ul className="payments-purchase-list">
            {rows.map((purchase) => (
              <PurchaseRow key={purchase.purchaseId} purchase={purchase} />
            ))}
          </ul>
          {/* `total` is the ledger's own count. When it exceeds what came back
              the difference is stated rather than left for the reader to
              assume this page is everything. */}
          {total > rows.length && (
            <p className="payments-purchase-more">
              Showing the most recent {rows.length} of {total} recorded.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PurchaseRow({ purchase }: { purchase: Purchase }) {
  const tone = outcomeTone(purchase.outcome);

  return (
    <li className="payments-purchase-row">
      <div className="payments-purchase-row__main">
        <div className="payments-purchase-row__titles">
          <span className="payments-purchase-row__item">{purchase.item || "Unnamed item"}</span>
          <span className="payments-purchase-row__merchant">{purchase.merchantDomain}</span>
        </div>
        <div className="payments-purchase-row__badges">
          <span className={`badge ${tone}`}>{purchase.outcome || "unstated"}</span>
          {purchase.steppedDown && <span className="badge warning">Delivery stepped down</span>}
          {purchase.refundedAt && <span className="badge neutral">Refunded</span>}
          {purchase.merchantDiscovered && <span className="badge neutral">Storefront found while browsing</span>}
        </div>
      </div>

      <div className="payments-purchase-row__amounts">
        <span className="payments-purchase-row__total">
          {formatMinorUnits(purchase.totalMinorUnits, purchase.currency)}
        </span>
        <span className="payments-purchase-row__breakdown">
          item {formatMinorUnits(purchase.itemMinorUnits, purchase.currency)} · tax{" "}
          {formatMinorUnits(purchase.taxMinorUnits, purchase.currency)} · fees{" "}
          {formatMinorUnits(purchase.feesMinorUnits, purchase.currency)} · shipping{" "}
          {formatMinorUnits(purchase.shippingMinorUnits, purchase.currency)}
        </span>
      </div>

      <div className="payments-purchase-row__facts">
        <span>{formatUtc(purchase.atUtc)}</span>
        {purchase.cardLast4 && <span>Card ···{purchase.cardLast4}</span>}
        <span>
          Shipping {purchase.shippingTierUsed || "unstated"}
          {purchase.shippingTierRequested && purchase.shippingTierRequested !== purchase.shippingTierUsed
            ? ` (asked for ${purchase.shippingTierRequested})`
            : ""}
        </span>
        {purchase.merchantOrderId && <span>Order {purchase.merchantOrderId}</span>}
      </div>

      <p className="payments-purchase-row__window">
        {purchase.windowKind === "none"
          ? "No window ran on this purchase."
          : `${purchase.windowKind} window: ${purchase.windowOutcome || "unstated"}${
              purchase.answeredBy ? `, answered on ${purchase.answeredBy}` : ", unanswered"
            }.`}{" "}
        {recourseNote(purchase)}
      </p>

      {purchase.refusalReason && (
        <p className="payments-purchase-row__refusal">{purchase.refusalReason}</p>
      )}
    </li>
  );
}
