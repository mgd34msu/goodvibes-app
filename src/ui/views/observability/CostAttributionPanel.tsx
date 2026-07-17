// Cost attribution — cost.attribution.get (WS-only). Distinct from the Cost
// & tokens tab's app-local 4-bucket engine (cost-engine.ts): this reads the
// daemon's own windowed (24h/7d) cost attribution, grouped by dimension
// (agent/tool/hook/mcp/model/provider/session), with cache-aware pricing.
// Honest-unpriced per the contract: totalCostUsd is null when every
// contributor is unpriced — never rendered as $0.00. costSource/pricingAsOf
// ABSENT on pre-1.7 daemon records is an honest absence — the provenance
// line renders nothing for it rather than guessing.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { formatTokenCount } from "./cost-engine.ts";
import { costProvenanceLine, formatCostUsd, readCostAttribution } from "./obs-wire.ts";

type CostWindow = "24h" | "7d";
type Dimension = "agent" | "tool" | "hook" | "mcp" | "model" | "provider" | "session";

const WINDOWS: CostWindow[] = ["24h", "7d"];
const DIMENSIONS: Dimension[] = ["agent", "tool", "hook", "mcp", "model", "provider", "session"];

export function CostAttributionPanel() {
  const [costWindow, setCostWindow] = useState<CostWindow>("24h");
  const [dimension, setDimension] = useState<Dimension>("agent");

  const attribution = useQuery({
    queryKey: queryKeys.costAttribution(costWindow, dimension),
    queryFn: () => gv.cost.attribution({ window: costWindow, dimension }),
    retry: false,
  });

  const wsDown = attribution.isError && isWsBridgeUnavailableError(attribution.error);
  const unavailable = attribution.isError && (isMethodUnavailableError(attribution.error) || wsDown);

  return (
    <section className="obs-subsection">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">Cost attribution</span>
        <button
          type="button"
          className="obs-btn"
          aria-label="Refresh cost attribution"
          onClick={() => void attribution.refetch()}
        >
          <RefreshCw size={14} aria-hidden="true" className={attribution.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      <div className="obs-filter-grid">
        <label className="obs-filter-field">
          <span>Window</span>
          <select value={costWindow} onChange={(e) => setCostWindow(e.target.value as CostWindow)}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="obs-filter-field">
          <span>Dimension</span>
          <select value={dimension} onChange={(e) => setDimension(e.target.value as Dimension)}>
            {DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      {attribution.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState
          capability="cost.attribution.get"
          description={
            wsDown
              ? "cost attribution requires the realtime bridge, which is currently down."
              : "this daemon does not serve windowed cost attribution."
          }
        />
      )}

      {attribution.isError && !unavailable && (
        <ErrorState error={attribution.error} onRetry={() => void attribution.refetch()} title="Failed to load cost attribution" />
      )}

      {attribution.isSuccess &&
        (() => {
          const attr = readCostAttribution(attribution.data);
          const provenance = costProvenanceLine(attr.costSource, attr.pricingAsOf);
          const totalRecords = attr.pricedRecordCount + attr.unpricedRecordCount;
          return (
            <>
              <div className="obs-stat-row" role="list" aria-label="Cost attribution totals">
                <div className="obs-stat-tile" role="listitem">
                  <span className="obs-stat-tile__value">{formatCostUsd(attr.totalCostUsd)}</span>
                  <span className="obs-stat-tile__label">Total cost, {attr.window} window</span>
                </div>
                <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                  <span className="obs-stat-tile__value">{formatTokenCount(attr.tokens.inputTokens)}</span>
                  <span className="obs-stat-tile__label">Input tokens</span>
                </div>
                <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                  <span className="obs-stat-tile__value">{formatTokenCount(attr.tokens.outputTokens)}</span>
                  <span className="obs-stat-tile__label">Output tokens</span>
                </div>
                <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                  <span className="obs-stat-tile__value">{formatTokenCount(attr.tokens.cacheReadTokens)}</span>
                  <span className="obs-stat-tile__label">Cache-read tokens</span>
                </div>
                <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                  <span className="obs-stat-tile__value">{formatTokenCount(attr.tokens.cacheWriteTokens)}</span>
                  <span className="obs-stat-tile__label">Cache-write tokens</span>
                </div>
              </div>

              {provenance && <p className="obs-cost-attr__provenance">{provenance}</p>}

              {attr.costState === "estimated" && attr.unpricedRecordCount > 0 && totalRecords > 0 && (
                <p className="obs-cost__unpriced-note">
                  {attr.unpricedRecordCount} of {totalRecords} records unpriced — dollars shown are a floor.
                </p>
              )}
              {attr.costState === "unpriced" && (
                <p className="obs-cost__unpriced-note">Every contributing record is unpriced — price unknown.</p>
              )}

              {attr.rows.length === 0 ? (
                <p className="obs-cost__empty">No usage recorded for this window/dimension.</p>
              ) : (
                <div className="obs-table-wrap">
                  <table className="obs-table">
                    <thead>
                      <tr>
                        <th>{dimension}</th>
                        <th>Cost</th>
                        <th>Tokens</th>
                        <th>Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attr.rows.map((row) => (
                        <tr key={row.key}>
                          <td>{row.key}</td>
                          <td>{formatCostUsd(row.costUsd)}</td>
                          <td>
                            {formatTokenCount(
                              row.tokens.inputTokens +
                                row.tokens.outputTokens +
                                row.tokens.cacheReadTokens +
                                row.tokens.cacheWriteTokens,
                            )}
                          </td>
                          <td>{row.pricedRecordCount + row.unpricedRecordCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        })()}
    </section>
  );
}
