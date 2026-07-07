// Telemetry section — subtabs: Dashboard, Events, Errors, Traces, Metrics,
// Live stream. Subtab selection is URL-addressable (?filter[obs-telemetry]=…)
// so palette jumps / notifications / deep links compose (docs/UX.md §2).

import { useUrlState } from "../../lib/router.ts";
import { TelemetryDashboard } from "./TelemetryDashboard.tsx";
import { TelemetryEvents } from "./TelemetryEvents.tsx";
import { TelemetryErrors } from "./TelemetryErrors.tsx";
import { TelemetryTraces } from "./TelemetryTraces.tsx";
import { TelemetryMetrics } from "./TelemetryMetrics.tsx";
import { TelemetryLiveStream } from "./TelemetryLiveStream.tsx";

type TelemetryTab = "dashboard" | "events" | "errors" | "traces" | "metrics" | "stream";

const TAB_LABELS: Record<TelemetryTab, string> = {
  dashboard: "Dashboard",
  events: "Events",
  errors: "Errors",
  traces: "Traces",
  metrics: "Metrics",
  stream: "Live stream",
};

const TAB_IDS = Object.keys(TAB_LABELS) as TelemetryTab[];

function isTelemetryTab(value: string): value is TelemetryTab {
  return (TAB_IDS as string[]).includes(value);
}

export function TelemetrySection() {
  const { filters, setFilters } = useUrlState();
  const rawTab = filters["obs-telemetry"] ?? "";
  const tab: TelemetryTab = isTelemetryTab(rawTab) ? rawTab : "dashboard";

  function selectTab(next: TelemetryTab): void {
    setFilters({ "obs-telemetry": next === "dashboard" ? undefined : next }, { replace: true });
  }

  return (
    <div className="obs-telemetry-section">
      <div className="obs-subtabs" role="tablist" aria-label="Telemetry sections">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "obs-subtab obs-subtab--active" : "obs-subtab"}
            onClick={() => selectTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <TelemetryDashboard />}
      {tab === "events" && <TelemetryEvents />}
      {tab === "errors" && <TelemetryErrors />}
      {tab === "traces" && <TelemetryTraces />}
      {tab === "metrics" && <TelemetryMetrics />}
      {tab === "stream" && <TelemetryLiveStream />}
    </div>
  );
}
