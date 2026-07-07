// Channels — omnichannel operations (docs/FEATURES.md §13, all 15 rows minus
// the delivery-receipts row which lives with the deliveries surface).
// Tabbed observability page: Status board (per-surface health + doctor/
// setup/lifecycle/repairs drill-in), Inbox, Accounts, Catalog (actions/
// tools/agent tools/capabilities/directory), Policies (+ audit), Drafts,
// Routing — every mutating verb confirm-gated (see each panel's docblock).
//
// Freshness: the `communication` realtime domain invalidates the ["channels"]
// key prefix (lib/realtime.ts) that every local key extends (keys.ts); the
// status board and inbox add slow polls as the no-event floor.
//
// Deep links: ?filter[channels-tab]=<tab> selects a tab so palette jumps and
// notifications compose (docs/UX.md §2).
//
// Companion pairing (QR) is the header action — see PairingModal.tsx +
// src/bun/pairing.ts.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QrCode, RefreshCw } from "lucide-react";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useUrlState } from "../../lib/router.ts";
import { useViewActions } from "../../components/shell/Topbar.tsx";
import { channelsKeys } from "./keys.ts";
import { StatusBoard } from "./StatusBoard.tsx";
import { InboxPanel } from "./InboxPanel.tsx";
import { AccountsPanel } from "./AccountsPanel.tsx";
import { CatalogPanel } from "./CatalogPanel.tsx";
import { PoliciesPanel } from "./PoliciesPanel.tsx";
import { DraftsPanel } from "./DraftsPanel.tsx";
import { RoutingPanel } from "./RoutingPanel.tsx";
import { PairingModal } from "./PairingModal.tsx";

type ChannelsTab = "status" | "inbox" | "accounts" | "catalog" | "policies" | "drafts" | "routing";

const TAB_LABELS: Record<ChannelsTab, string> = {
  status: "Status",
  inbox: "Inbox",
  accounts: "Accounts",
  catalog: "Actions & tools",
  policies: "Policies",
  drafts: "Drafts",
  routing: "Routing",
};

const TAB_IDS = Object.keys(TAB_LABELS) as ChannelsTab[];

function isChannelsTab(value: string): value is ChannelsTab {
  return (TAB_IDS as string[]).includes(value);
}

export function ChannelsView() {
  const queryClient = useQueryClient();
  const { filters, setFilters } = useUrlState();
  const setViewActions = useViewActions();
  const [pairingOpen, setPairingOpen] = useState(false);

  const rawTab = filters["channels-tab"] ?? "";
  const tab: ChannelsTab = isChannelsTab(rawTab) ? rawTab : "status";

  function selectTab(next: ChannelsTab): void {
    // Tab selection is not a history-worthy step — replace, don't push.
    setFilters({ "channels-tab": next === "status" ? undefined : next }, { replace: true });
  }

  // Topbar view-scoped actions (the view unmounts when hidden — keepAlive:false).
  useEffect(() => {
    setViewActions(
      <>
        <button
          type="button"
          className="channels-btn"
          onClick={() => void queryClient.invalidateQueries({ queryKey: channelsKeys.all })}
          aria-label="Refresh channels data"
        >
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
        <button type="button" className="channels-btn channels-btn--primary" onClick={() => setPairingOpen(true)}>
          <QrCode size={14} aria-hidden="true" /> Pair companion
        </button>
      </>,
    );
    return () => setViewActions(null);
  }, [setViewActions, queryClient]);

  // Palette commands — live only while the view is mounted.
  useEffect(() => {
    registerCommand({
      id: "channels.refresh",
      title: "Refresh Channels",
      group: "automate",
      keywords: ["channels", "reload", "surfaces", "inbox"],
      run: () => void queryClient.invalidateQueries({ queryKey: channelsKeys.all }),
    });
    registerCommand({
      id: "channels.pair",
      title: "Pair Companion (QR)",
      group: "automate",
      keywords: ["channels", "pairing", "qr", "phone", "companion", "connect"],
      run: () => setPairingOpen(true),
    });
    return () => {
      unregisterCommand("channels.refresh");
      unregisterCommand("channels.pair");
    };
  }, [queryClient]);

  return (
    <div className="channels-view">
      <div className="channels-tabs" role="tablist" aria-label="Channels sections">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "channels-tab channels-tab--active" : "channels-tab"}
            onClick={() => selectTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {tab === "status" && <StatusBoard />}
      {tab === "inbox" && <InboxPanel />}
      {tab === "accounts" && <AccountsPanel />}
      {tab === "catalog" && <CatalogPanel />}
      {tab === "policies" && <PoliciesPanel />}
      {tab === "drafts" && <DraftsPanel />}
      {tab === "routing" && <RoutingPanel />}

      <PairingModal open={pairingOpen} onClose={() => setPairingOpen(false)} />
    </div>
  );
}
