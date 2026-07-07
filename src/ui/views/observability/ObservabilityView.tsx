// Observability — docs/FEATURES.md §17 (the forefront requirement), all 20
// rows minus the ambient status-strip row (owned by
// components/shell/StatusStrip, not this view). Tabbed workspace:
//   Telemetry   — dashboard, events browser, error ledger, traces browser,
//                  metrics, and a pausable live tail (telemetry.stream).
//   Cost        — app-local 4-bucket + Ephemeral cost analytics engine
//                  (cost-engine.ts), budget alert, token/context console.
//   System      — health cards, control snapshot/clients/messages, routes +
//                  bindings CRUD, surfaces, continuity, scheduler, OTLP.
//   Diagnostics — shared SSE connector state + a local rolling latency probe.
//   Contract    — searchable method/event catalog explorer.
//   Panels      — remote-open TUI panels (panels.list/.open).
//
// None of telemetry/control-plane/health/routes/surfaces/continuity/
// scheduler/panels carry a wire event (lib/realtime.ts DOMAIN_INVALIDATIONS
// has no entry for any of them), so every read here polls or refetches on
// demand; live freshness specifically comes from the dedicated pausable
// telemetry tail, not from background invalidation. Top-level tab (and each
// section's own subtab) is URL-addressable so palette jumps and deep links
// compose (docs/UX.md §2).

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useUrlState } from "../../lib/router.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useViewActions } from "../../components/shell/Topbar.tsx";
import { obsKeys } from "./keys.ts";
import { TelemetrySection } from "./TelemetrySection.tsx";
import { CostSection } from "./CostSection.tsx";
import { SystemSection } from "./SystemSection.tsx";
import { DiagnosticsSection } from "./DiagnosticsSection.tsx";
import { ContractSection } from "./ContractSection.tsx";
import { PanelsSection } from "./PanelsSection.tsx";

type ObsTab = "telemetry" | "cost" | "system" | "diagnostics" | "contract" | "panels";

const TAB_LABELS: Record<ObsTab, string> = {
  telemetry: "Telemetry",
  cost: "Cost & tokens",
  system: "System",
  diagnostics: "Diagnostics",
  contract: "Contract explorer",
  panels: "Panels",
};

const TAB_IDS = Object.keys(TAB_LABELS) as ObsTab[];

function isObsTab(value: string): value is ObsTab {
  return (TAB_IDS as string[]).includes(value);
}

export function ObservabilityView(): React.ReactElement {
  const queryClient = useQueryClient();
  const { filters, setFilters } = useUrlState();

  const rawTab = filters["obs-tab"] ?? "";
  const tab: ObsTab = isObsTab(rawTab) ? rawTab : "telemetry";

  function selectTab(next: ObsTab): void {
    setFilters({ "obs-tab": next === "telemetry" ? undefined : next }, { replace: true });
  }

  const setViewActions = useViewActions();

  useEffect(() => {
    setViewActions(
      <button
        type="button"
        className="obs-btn"
        onClick={() => void queryClient.invalidateQueries({ queryKey: obsKeys.all })}
        aria-label="Refresh observability data"
      >
        <RefreshCw size={14} aria-hidden="true" /> Refresh
      </button>,
    );
    return () => setViewActions(null);
  }, [setViewActions, queryClient]);

  useEffect(() => {
    const commands = TAB_IDS.map((id) => ({
      id: `observability.goto.${id}`,
      title: `Observability: ${TAB_LABELS[id]}`,
      group: "system" as const,
      keywords: ["observability", "telemetry", "cost", "health", "contract", "panels", id],
      run: () => selectTab(id),
    }));
    commands.forEach(registerCommand);
    registerCommand({
      id: "observability.refreshAll",
      title: "Refresh Observability",
      group: "system",
      keywords: ["observability", "reload", "refresh"],
      run: () => void queryClient.invalidateQueries({ queryKey: obsKeys.all }),
    });
    return () => {
      commands.forEach((c) => unregisterCommand(c.id));
      unregisterCommand("observability.refreshAll");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectTab is stable across renders (closes over setFilters only)
  }, [queryClient]);

  return (
    <div className="obs-view">
      <div className="obs-tabs" role="tablist" aria-label="Observability sections">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "obs-tab obs-tab--active" : "obs-tab"}
            onClick={() => selectTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {tab === "telemetry" && <TelemetrySection />}
      {tab === "cost" && <CostSection />}
      {tab === "system" && <SystemSection />}
      {tab === "diagnostics" && <DiagnosticsSection />}
      {tab === "contract" && <ContractSection />}
      {tab === "panels" && <PanelsSection />}
    </div>
  );
}
