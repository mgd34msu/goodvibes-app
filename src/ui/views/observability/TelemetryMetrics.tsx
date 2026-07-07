// Metrics — telemetry.metrics.get. Shape is not pinned, so this renders
// whatever key/value or key/series structure comes back as a generic
// metric-tile grid (numeric leaf values) plus the raw payload for anything
// deeper (histograms, series arrays) that a tile can't represent honestly.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, compactJson } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { obsKeys } from "./keys.ts";

function numericLeaves(value: unknown, prefix = ""): Array<{ label: string; value: number }> {
  const record = asRecord(value);
  const out: Array<{ label: string; value: number }> = [];
  for (const [key, v] of Object.entries(record)) {
    const label = prefix ? `${prefix}.${key}` : key;
    if (typeof v === "number" && Number.isFinite(v)) {
      out.push({ label, value: v });
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...numericLeaves(v, label));
    }
  }
  return out;
}

export function TelemetryMetrics() {
  const metrics = useQuery({
    queryKey: obsKeys.telemetryMetrics,
    queryFn: () => gv.invoke("telemetry.metrics.get"),
    refetchInterval: 20_000,
    retry: false,
  });

  const leaves = useMemo(() => numericLeaves(metrics.data), [metrics.data]);
  const unavailable = metrics.isError && isMethodUnavailableError(metrics.error);

  if (metrics.isPending) return <SkeletonBlock variant="text" lines={4} />;
  if (unavailable) {
    return <UnavailableState capability="telemetry.metrics.get" description="metrics are not exposed by this daemon." />;
  }
  if (metrics.isError) {
    return <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} title="Failed to load metrics" />;
  }
  if (leaves.length === 0) {
    return <EmptyState title="No numeric metrics reported" description="The daemon returned no metric values to display." />;
  }

  return (
    <div className="obs-metrics">
      <div className="obs-stat-row" role="list" aria-label="Metrics">
        {leaves.map((leaf) => (
          <div key={leaf.label} className="obs-stat-tile obs-stat-tile--compact" role="listitem">
            <span className="obs-stat-tile__value">{leaf.value.toLocaleString()}</span>
            <span className="obs-stat-tile__label">{leaf.label}</span>
          </div>
        ))}
      </div>
      <details className="obs-raw-panel">
        <summary>Raw telemetry.metrics.get payload</summary>
        <pre>{compactJson(metrics.data)}</pre>
      </details>
    </div>
  );
}
