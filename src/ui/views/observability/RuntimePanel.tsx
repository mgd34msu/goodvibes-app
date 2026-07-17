// Runtime metrics — runtime.metrics.get: HTTP/LLM/auth/transport counters,
// gauges, request-duration/token histograms, and per-model/class tool-format
// telemetry (edit-tool failure classes, declared exec-expectation misses).
// Every sub-shape beyond the four top-level buckets is intentionally unpinned
// (additionalProperties:true on the wire) — this renders whatever numeric
// leaves it finds as stat tiles/tables and falls back to the raw payload for
// anything deeper, never guessing a field name that doesn't match this
// daemon build. Honest "not observed yet" empty states throughout.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, compactJson } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { numericLeaves } from "./obs-wire.ts";

function StatTiles({ label, data }: { label: string; data: unknown }) {
  const leaves = numericLeaves(data);
  if (leaves.length === 0) {
    return <p className="obs-dashboard__note">{label}: not observed yet.</p>;
  }
  return (
    <div>
      <h3>{label}</h3>
      <div className="obs-stat-row" role="list" aria-label={label}>
        {leaves.map((leaf) => (
          <div key={leaf.label} className="obs-stat-tile obs-stat-tile--compact" role="listitem">
            <span className="obs-stat-tile__value">{leaf.value.toLocaleString()}</span>
            <span className="obs-stat-tile__label">{leaf.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyedTable({ title, data }: { title: string; data: unknown }) {
  const record = asRecord(data);
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return <p className="obs-dashboard__note">{title}: not observed yet.</p>;
  }
  return (
    <div>
      <h3>{title}</h3>
      <div className="obs-table-wrap">
        <table className="obs-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Values</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const leaves = numericLeaves(record[key]);
              return (
                <tr key={key}>
                  <td className="obs-table__mono">{key}</td>
                  <td>
                    {leaves.length > 0
                      ? leaves.map((l) => `${l.label}: ${l.value.toLocaleString()}`).join(" · ")
                      : compactJson(record[key])}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RuntimePanel() {
  const metrics = useQuery({
    queryKey: queryKeys.runtimeMetrics,
    queryFn: () => gv.runtime.metrics(),
    refetchInterval: 20_000,
    retry: false,
  });

  const unavailable = metrics.isError && isMethodUnavailableError(metrics.error);
  const record = useMemo(() => asRecord(metrics.data), [metrics.data]);
  const toolFormat = useMemo(() => asRecord(record["toolFormat"]), [record]);

  const isEmpty =
    metrics.isSuccess &&
    numericLeaves(record["counters"]).length === 0 &&
    numericLeaves(record["gauges"]).length === 0 &&
    Object.keys(asRecord(record["histograms"])).length === 0 &&
    Object.keys(asRecord(toolFormat["byModel"])).length === 0 &&
    Object.keys(asRecord(toolFormat["byClass"])).length === 0;

  return (
    <section className="obs-subsection">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">Runtime metrics</span>
        <button type="button" className="obs-btn" aria-label="Refresh runtime metrics" onClick={() => void metrics.refetch()}>
          <RefreshCw size={14} aria-hidden="true" className={metrics.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      {metrics.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState capability="runtime.metrics.get" description="this daemon build reports no runtime metrics." />
      )}

      {metrics.isError && !unavailable && (
        <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} title="Failed to load runtime metrics" />
      )}

      {isEmpty && (
        <EmptyState
          title="No runtime metrics observed yet"
          description="Counters, gauges, and tool-format telemetry populate as the daemon serves traffic."
        />
      )}

      {metrics.isSuccess && !isEmpty && (
        <div className="obs-dashboard">
          <StatTiles label="Counters" data={record["counters"]} />
          <StatTiles label="Gauges" data={record["gauges"]} />
          <KeyedTable title="Histograms" data={record["histograms"]} />
          <KeyedTable title="Tool format — by model" data={toolFormat["byModel"]} />
          <KeyedTable title="Tool format — by class" data={toolFormat["byClass"]} />
          <details className="obs-raw-panel">
            <summary>Raw runtime.metrics.get payload</summary>
            <pre>{compactJson(metrics.data)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
