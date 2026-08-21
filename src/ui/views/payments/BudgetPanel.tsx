// Budget: the daemon's posture on what may be spent today.
//
// Every number here is the daemon's. The three pools, the day they belong to,
// the timezone that decided which day that is, and what is left after
// reservations all arrive computed. Nothing is recalculated locally, and the
// day is never derived from the browser clock: the daemon owns
// `daemon.timezone`, and a locally computed "today" is precisely how a spent
// pool appears to refill itself.
//
// Two facts on this panel are refusals in their own right rather than
// decoration, and they are rendered as sentences instead of quiet flags:
//
//  - `enabled: false` means `payments.enabled` is off and every purchase is
//    refused at the first gate. The numbers below it are still real limits,
//    but nothing will draw on them.
//  - `isPaymentsLeader: false` means this node is not the one elected to serve
//    payments, and it refuses every purchase. Today's spend does not replicate
//    across a cluster, so a second node acting would start from a clean daily
//    budget and could spend it a second time.

import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Wallet } from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  PAYMENTS_POLL_MS,
  formatMinorUnits,
  paymentsApi,
  paymentsRefusal,
  poolTone,
  type BudgetPool,
} from "./payments-data.ts";

export function BudgetPanel() {
  const budget = useQuery({
    queryKey: queryKeys.paymentsBudget,
    queryFn: paymentsApi.budget,
    retry: false,
    refetchInterval: PAYMENTS_POLL_MS,
  });

  const refusal = budget.isError ? paymentsRefusal(budget.error, "payments.budget.status") : null;
  const status = budget.data;

  return (
    <section className="payments-section" aria-labelledby="payments-budget-heading">
      <div className="payments-section__header">
        <h2 id="payments-budget-heading">Budget</h2>
        <div className="payments-section__meta">
          {status && (
            <span className="payments-section__day">
              {status.dayKey} · {status.timezone}
            </span>
          )}
          <button
            type="button"
            className="payments-icon-button"
            title="Refresh"
            aria-label="Refresh budget"
            onClick={() => void budget.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={budget.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      {budget.isPending && <SkeletonBlock variant="text" lines={4} />}
      {refusal && <UnavailableState capability={refusal.capability} description={refusal.description} />}
      {budget.isError && !refusal && (
        <ErrorState error={budget.error} onRetry={() => void budget.refetch()} title="Failed to read the budget" />
      )}

      {status && (
        <>
          {!status.enabled && (
            <p className="payments-posture payments-posture--off" role="status">
              <Wallet size={16} aria-hidden="true" />
              <span>
                Payments are switched off (<code>payments.enabled</code>), so every purchase is refused before any of
                these limits is consulted.
              </span>
            </p>
          )}

          {!status.isPaymentsLeader && (
            <p className="payments-posture payments-posture--off" role="status">
              <Wallet size={16} aria-hidden="true" />
              <span>
                This node is not the elected payments leader, so it refuses every purchase. Today&rsquo;s spend does
                not replicate between nodes, so a second one acting would start from a clean daily budget.
              </span>
            </p>
          )}

          <div className="payments-pools">
            <PoolCard
              name="Item"
              pool={status.item}
              currency={status.currency}
              note="The item price is checked against this."
            />
            <PoolCard
              name="Overage"
              pool={status.overage}
              currency={status.currency}
              note="Tax, mandatory fees, and the delivery option actually used. Never discretionary add-ons."
            />
            <PoolCard
              name="Tolerance"
              pool={status.tolerance}
              currency={status.currency}
              note="The shortfall when overage cannot cover even the cheapest delivery. Off by default."
            />
          </div>

          <p className="payments-reservations">
            {status.reservationCount === 0
              ? "No purchase is holding budget right now."
              : `${status.reservationCount} purchase${status.reservationCount === 1 ? " is" : "s are"} holding budget right now. Reserved money is unavailable to anything else until that purchase commits or releases.`}
          </p>
        </>
      )}
    </section>
  );
}

function PoolCard({
  name,
  pool,
  currency,
  note,
}: {
  name: string;
  pool: BudgetPool;
  currency: string;
  note: string;
}) {
  const tone = poolTone(pool);
  // Width comes from spent+reserved against the limit, so held money reads as
  // gone. It is presentation only: `remaining` below is the daemon's number
  // and is never inferred from this bar.
  const used = pool.limit > 0 ? Math.min(100, ((pool.spent + pool.reserved) / pool.limit) * 100) : 0;

  return (
    <div className={`payments-pool payments-pool--${tone}`}>
      <div className="payments-pool__header">
        <span className="payments-pool__name">{name}</span>
        <span className="payments-pool__remaining">{formatMinorUnits(pool.remaining, currency)} left</span>
      </div>
      <div
        className="payments-pool__bar"
        role="img"
        aria-label={`${name}: ${formatMinorUnits(pool.remaining, currency)} left of ${formatMinorUnits(pool.limit, currency)}`}
      >
        <span className="payments-pool__bar-fill" style={{ width: `${used}%` }} />
      </div>
      <dl className="payments-pool__facts">
        <div>
          <dt>Limit</dt>
          <dd>{formatMinorUnits(pool.limit, currency)}</dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>{formatMinorUnits(pool.spent, currency)}</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{formatMinorUnits(pool.reserved, currency)}</dd>
        </div>
      </dl>
      <p className="payments-pool__note">{note}</p>
      {pool.limit === 0 && (
        <p className="payments-pool__zero">
          A zero limit is a refusal, not an unset field: nothing can draw on this pool.
        </p>
      )}
    </div>
  );
}
