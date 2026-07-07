// Telemetry dashboard subtab — telemetry.snapshot. The daemon's snapshot
// shape isn't pinned by the contracts package for this pin, so every stat
// tile probes several candidate field names and simply doesn't render when
// none match (never a fabricated zero) — the raw snapshot is always shown
// underneath so nothing the daemon actually sent is lost to a guessed key.

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, GitBranch, Radio } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, compactJson, firstNumber } from "../../lib/wire.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { obsKeys } from "./keys.ts";

interface StatDef {
  label: string;
  candidates: string[];
  icon: React.ReactNode;
}

const STAT_DEFS: StatDef[] = [
  { label: "Events", candidates: ["totalEvents", "eventCount", "events"], icon: <Activity size={16} aria-hidden="true" /> },
  { label: "Errors", candidates: ["totalErrors", "errorCount", "errors"], icon: <AlertTriangle size={16} aria-hidden="true" /> },
  { label: "Traces", candidates: ["totalTraces", "traceCount", "traces"], icon: <GitBranch size={16} aria-hidden="true" /> },
  {
    label: "Live subscribers",
    candidates: ["streamSubscribers", "subscribers", "activeStreams"],
    icon: <Radio size={16} aria-hidden="true" />,
  },
];

function readStat(record: Record<string, unknown>, def: StatDef): number | undefined {
  return firstNumber(record, def.candidates);
}

export function TelemetryDashboard() {
  const snapshot = useQuery({
    queryKey: obsKeys.telemetrySnapshot,
    queryFn: () => gv.invoke("telemetry.snapshot"),
    // No wire event for telemetry — floor poll while the dashboard is visible.
    refetchInterval: 20_000,
    retry: false,
  });

  const unavailable = snapshot.isError && isMethodUnavailableError(snapshot.error);

  if (snapshot.isPending) return <SkeletonBlock variant="text" lines={4} />;
  if (unavailable) {
    return (
      <UnavailableState
        capability="telemetry.snapshot"
        description="the connected daemon does not serve a telemetry overview."
      />
    );
  }
  if (snapshot.isError) {
    return <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} title="Failed to load telemetry snapshot" />;
  }

  const record = asRecord(snapshot.data);
  const stats = STAT_DEFS.map((def) => ({ def, value: readStat(record, def) })).filter((s) => s.value !== undefined);

  return (
    <div className="obs-dashboard">
      {stats.length > 0 ? (
        <div className="obs-stat-row" role="list" aria-label="Telemetry totals">
          {stats.map(({ def, value }) => (
            <div key={def.label} className="obs-stat-tile" role="listitem">
              <span className="obs-stat-tile__icon" aria-hidden="true">
                {def.icon}
              </span>
              <span className="obs-stat-tile__value">{value?.toLocaleString()}</span>
              <span className="obs-stat-tile__label">{def.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="obs-dashboard__note">
          The daemon's snapshot didn't match any known summary field — the raw payload is below.
        </p>
      )}

      <details className="obs-raw-panel">
        <summary>Raw telemetry.snapshot payload</summary>
        <pre>{compactJson(snapshot.data)}</pre>
      </details>
    </div>
  );
}
