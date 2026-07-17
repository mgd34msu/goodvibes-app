// Ops & observability — subtabs: Power, Memory, Runtime, Quota, Cost
// attribution, Flags graduation. Subtab selection is URL-addressable
// (?filter[obs-ops]=…), same pattern as SystemSection's subtabs.

import { useUrlState } from "../../lib/router.ts";
import { PowerPanel } from "./PowerPanel.tsx";
import { MemoryPanel } from "./MemoryPanel.tsx";
import { RuntimePanel } from "./RuntimePanel.tsx";
import { QuotaPanel } from "./QuotaPanel.tsx";
import { CostAttributionPanel } from "./CostAttributionPanel.tsx";
import { FlagsGraduationPanel } from "./FlagsGraduationPanel.tsx";

type OpsTab = "power" | "memory" | "runtime" | "quota" | "cost-attribution" | "flags";

const TAB_LABELS: Record<OpsTab, string> = {
  power: "Power",
  memory: "Memory",
  runtime: "Runtime",
  quota: "Quota",
  "cost-attribution": "Cost attribution",
  flags: "Flags graduation",
};

const TAB_IDS = Object.keys(TAB_LABELS) as OpsTab[];

function isOpsTab(value: string): value is OpsTab {
  return (TAB_IDS as string[]).includes(value);
}

export function OpsSection() {
  const { filters, setFilters } = useUrlState();
  const rawTab = filters["obs-ops"] ?? "";
  const tab: OpsTab = isOpsTab(rawTab) ? rawTab : "power";

  function selectTab(next: OpsTab): void {
    setFilters({ "obs-ops": next === "power" ? undefined : next }, { replace: true });
  }

  return (
    <div className="obs-system-section">
      <div className="obs-subtabs" role="tablist" aria-label="Ops sections">
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

      {tab === "power" && <PowerPanel />}
      {tab === "memory" && <MemoryPanel />}
      {tab === "runtime" && <RuntimePanel />}
      {tab === "quota" && <QuotaPanel />}
      {tab === "cost-attribution" && <CostAttributionPanel />}
      {tab === "flags" && <FlagsGraduationPanel />}
    </div>
  );
}
