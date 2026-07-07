// Cost analytics — docs/FEATURES.md §17: app-local 4-bucket token accounting
// (input/output/cache-read/cache-write) + an "Ephemeral" project-rollup
// bucket, dated pricing (cost-engine.ts), dedup, per-project/session/provider
// rollups, a budget-threshold banner reading config key
// GOODVIBES_COST_BUDGET_USD, and a token/context console. Sources:
// providers.usage.get per known provider + telemetry.events.list (usage-
// shaped events) — merged, deduped by messageId|requestId, then rolled up.
//
// Every total is FRAMED (docs/UX.md Principle #2: "every number has a label
// and a frame of reference") — never a bare digit. Unpriced-model usage is
// called out explicitly rather than silently costed at $0.

import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { AlertTriangle, DollarSign } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { errorStatus, isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, bestId, firstNumber } from "../../lib/wire.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { obsKeys } from "./keys.ts";
import {
  bucketsTotal,
  dedupeRecords,
  EPHEMERAL_PROJECT_LABEL,
  formatTokenCount,
  formatUsd,
  PRICING_AS_OF,
  rollupByProject,
  rollupByProvider,
  rollupBySession,
  totalRollup,
  usageRecordFromProviderSummary,
  usageRecordsFromTelemetryEvents,
  type Rollup,
  type UsageRecord,
} from "./cost-engine.ts";

const BUDGET_CONFIG_KEY = "GOODVIBES_COST_BUDGET_USD";

function readBudgetUsd(configPayload: unknown): number | undefined {
  const record = asRecord(configPayload);
  // Try flat top-level, then a couple of plausible nested shapes — config.get's
  // exact envelope isn't pinned for this daemon build.
  const direct = firstNumber(record, [BUDGET_CONFIG_KEY]);
  if (direct !== undefined) return direct;
  const env = asRecord(record["env"]);
  const envHit = firstNumber(env, [BUDGET_CONFIG_KEY]);
  if (envHit !== undefined) return envHit;
  const nested = asRecord(record["config"]);
  return firstNumber(nested, [BUDGET_CONFIG_KEY]);
}

function RollupTable({ title, rows, labelHeader }: { title: string; rows: Rollup[]; labelHeader: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="obs-cost-rollup">
      <h3>{title}</h3>
      <div className="obs-table-wrap">
        <table className="obs-table">
          <thead>
            <tr>
              <th>{labelHeader}</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Records</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.key === EPHEMERAL_PROJECT_LABEL ? "obs-table__row--ephemeral" : undefined}>
                <td>
                  {row.key}
                  {row.key === EPHEMERAL_PROJECT_LABEL && (
                    <span className="obs-cost-rollup__note" title="Sessions with no stable project identity — grouped here instead of inflating a named project.">
                      {" "}
                      (no stable project id)
                    </span>
                  )}
                </td>
                <td>{formatTokenCount(bucketsTotal(row.tokens))}</td>
                <td>
                  {formatUsd(row.costUsd)}
                  {row.hasUnpriced && <span title="Includes usage from an unrecognized model — true cost may be higher.">*</span>}
                </td>
                <td>{row.recordCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CostSection() {
  const providers = useQuery({ queryKey: queryKeys.providers, queryFn: () => gv.providers.list(), retry: false });

  const providerIds = useMemo(() => {
    const list = asRecord(providers.data)["providers"] ?? providers.data;
    return Array.isArray(list) ? list.map((p) => bestId(p)).filter(Boolean) : [];
  }, [providers.data]);

  const usageQueries = useQueries({
    queries: providerIds.map((id) => ({
      queryKey: obsKeys.costUsage(id),
      queryFn: () => gv.providers.usage(id),
      retry: false,
      enabled: providers.isSuccess,
    })),
  });

  const events = useQuery({
    queryKey: obsKeys.telemetryEvents({}),
    queryFn: () => gv.invoke("telemetry.events.list"),
    // No wire event for telemetry — floor poll while cost analytics is visible.
    refetchInterval: 30_000,
    retry: false,
  });

  const budgetConfig = useQuery({
    queryKey: obsKeys.costBudgetConfig,
    queryFn: () => gv.config.get(),
    retry: false,
  });

  const records: UsageRecord[] = useMemo(() => {
    const fromProviders = providerIds
      .map((id, index) => usageRecordFromProviderSummary(usageQueries[index]?.data, id))
      .filter((r): r is UsageRecord => r !== undefined);
    const fromEvents = events.isSuccess ? usageRecordsFromTelemetryEvents(events.data) : [];
    return dedupeRecords([...fromProviders, ...fromEvents]);
  }, [providerIds, usageQueries, events.isSuccess, events.data]);

  const total = useMemo(() => totalRollup(records), [records]);
  const byProvider = useMemo(() => rollupByProvider(records), [records]);
  const byProject = useMemo(() => rollupByProject(records), [records]);
  const bySession = useMemo(() => rollupBySession(records), [records]);

  const budgetUsd = readBudgetUsd(budgetConfig.data);
  const budgetConfigForbidden = budgetConfig.isError && errorStatus(budgetConfig.error) === 403;
  const budgetConfigUnavailable = budgetConfig.isError && isMethodUnavailableError(budgetConfig.error);
  const overBudget = budgetUsd !== undefined && budgetUsd > 0 && total.costUsd > budgetUsd;

  const eventsUnavailable = events.isError && isMethodUnavailableError(events.error);
  const stillLoading = providers.isPending || events.isPending;

  return (
    <div className="obs-cost">
      <p className="obs-cost__pricing-caption">
        Pricing snapshot as of {PRICING_AS_OF} — a small hardcoded table, not a live catalog fetch. Treat these
        totals as estimates; verify exact charges against each provider's own billing.
      </p>

      {overBudget && (
        <div className="obs-cost__budget-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            Over budget: {formatUsd(total.costUsd)} tracked against a {formatUsd(budgetUsd ?? 0)} threshold
            (<code>{BUDGET_CONFIG_KEY}</code>).
          </span>
        </div>
      )}

      {!overBudget && budgetUsd !== undefined && budgetUsd > 0 && (
        <p className="obs-cost__budget-note">
          Budget threshold: {formatUsd(budgetUsd)} (<code>{BUDGET_CONFIG_KEY}</code>) — currently at {formatUsd(total.costUsd)}.
        </p>
      )}

      {budgetConfigForbidden && (
        <p className="obs-cost__budget-note">Budget threshold hidden — reading config requires an admin-scoped principal.</p>
      )}

      {budgetConfigUnavailable && (
        <p className="obs-cost__budget-note">This daemon does not expose config.get — no budget threshold available.</p>
      )}

      {stillLoading && <SkeletonBlock variant="text" lines={4} />}

      {eventsUnavailable && providerIds.length === 0 && (
        <UnavailableState
          capability="telemetry.events.list"
          description="neither telemetry usage events nor any provider usage summary are available — cost analytics has nothing to compute from."
        />
      )}

      {events.isError && !eventsUnavailable && providerIds.length === 0 && (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} title="Failed to load usage data" />
      )}

      {!stillLoading && records.length > 0 && (
        <>
          <div className="obs-stat-row" role="list" aria-label="Cost totals">
            <div className="obs-stat-tile" role="listitem">
              <span className="obs-stat-tile__icon" aria-hidden="true">
                <DollarSign size={16} aria-hidden="true" />
              </span>
              <span className="obs-stat-tile__value">{formatUsd(total.costUsd)}</span>
              <span className="obs-stat-tile__label">Total cost, {total.recordCount} usage record{total.recordCount === 1 ? "" : "s"} seen</span>
            </div>
            <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
              <span className="obs-stat-tile__value">{formatTokenCount(total.tokens.input)}</span>
              <span className="obs-stat-tile__label">Input tokens</span>
            </div>
            <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
              <span className="obs-stat-tile__value">{formatTokenCount(total.tokens.output)}</span>
              <span className="obs-stat-tile__label">Output tokens</span>
            </div>
            <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
              <span className="obs-stat-tile__value">{formatTokenCount(total.tokens.cacheRead)}</span>
              <span className="obs-stat-tile__label">Cache-read tokens</span>
            </div>
            <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
              <span className="obs-stat-tile__value">{formatTokenCount(total.tokens.cacheWrite)}</span>
              <span className="obs-stat-tile__label">Cache-write tokens</span>
            </div>
          </div>

          {total.hasUnpriced && (
            <p className="obs-cost__unpriced-note">
              * Some usage used a model this app's pricing table doesn't recognize — its contribution is counted as
              $0, so the true total may be higher.
            </p>
          )}

          <RollupTable title="By provider" rows={byProvider} labelHeader="Provider" />
          <RollupTable title="By project" rows={byProject} labelHeader="Project" />
          <RollupTable title="By session (token / context console)" rows={bySession} labelHeader="Session" />
        </>
      )}

      {!stillLoading && records.length === 0 && providerIds.length > 0 && (
        <p className="obs-cost__empty">No usage recorded yet for any known provider.</p>
      )}
    </div>
  );
}
