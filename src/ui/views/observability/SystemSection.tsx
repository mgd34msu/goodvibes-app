// System section — subtabs: Health, Control, Routes, Surfaces, Continuity,
// Scheduler, OTLP. Subtab selection is URL-addressable
// (?filter[obs-system]=…).

import { useUrlState } from "../../lib/router.ts";
import { HealthPanel } from "./HealthPanel.tsx";
import { ControlPanel } from "./ControlPanel.tsx";
import { RoutesPanel } from "./RoutesPanel.tsx";
import { ContinuityPanel, OtlpPanel, SchedulerPanel, SurfacesPanel } from "./SystemMiscPanels.tsx";

type SystemTab = "health" | "control" | "routes" | "surfaces" | "continuity" | "scheduler" | "otlp";

const TAB_LABELS: Record<SystemTab, string> = {
  health: "Health",
  control: "Control",
  routes: "Routes",
  surfaces: "Surfaces",
  continuity: "Continuity",
  scheduler: "Scheduler",
  otlp: "OTLP",
};

const TAB_IDS = Object.keys(TAB_LABELS) as SystemTab[];

function isSystemTab(value: string): value is SystemTab {
  return (TAB_IDS as string[]).includes(value);
}

export function SystemSection() {
  const { filters, setFilters } = useUrlState();
  const rawTab = filters["obs-system"] ?? "";
  const tab: SystemTab = isSystemTab(rawTab) ? rawTab : "health";

  function selectTab(next: SystemTab): void {
    setFilters({ "obs-system": next === "health" ? undefined : next }, { replace: true });
  }

  return (
    <div className="obs-system-section">
      <div className="obs-subtabs" role="tablist" aria-label="System sections">
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

      {tab === "health" && <HealthPanel />}
      {tab === "control" && <ControlPanel />}
      {tab === "routes" && <RoutesPanel />}
      {tab === "surfaces" && <SurfacesPanel />}
      {tab === "continuity" && <ContinuityPanel />}
      {tab === "scheduler" && <SchedulerPanel />}
      {tab === "otlp" && <OtlpPanel />}
    </div>
  );
}
