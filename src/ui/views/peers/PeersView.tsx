// Remote & Peers (docs/FEATURES.md §21 / docs/GAPS.md gap #1) — 12 remote.*
// wire methods with zero prior UI surface. Stacked sections (approvals/tasks
// idiom) rather than tabs: Overview (remote.snapshot), Peers
// (list/disconnect/token rotate+revoke), Pair requests
// (list/approve/reject), Work queue (list/cancel), the node-host contract
// viewer, a Push panel (5 push.* methods — §21 row 6, Wave F), and an
// advanced invoke-on-peer console. None of the remote.* methods are on the
// realtime invalidation stream (lib/realtime.ts DOMAIN_INVALIDATIONS has no
// `remote` domain) — every section polls at REMOTE_POLL_MS (peers-model.ts)
// while this view is mounted; Push polls independently at its own interval
// (push-model.ts is a separate wire family, not remote.*).

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { OverviewSection } from "./OverviewSection.tsx";
import { PeersSection } from "./PeersSection.tsx";
import { PairRequestsSection } from "./PairRequestsSection.tsx";
import { WorkSection } from "./WorkSection.tsx";
import { NodeHostContractSection } from "./NodeHostContractSection.tsx";
import { PushSection } from "./PushSection.tsx";
import { InvokeConsole } from "./InvokeConsole.tsx";
import { peersKeys } from "./peers-model.ts";

export function PeersView() {
  const queryClient = useQueryClient();

  useEffect(() => {
    registerCommand({
      id: "peers.refresh",
      title: "Refresh Remote & Peers",
      group: "system",
      keywords: ["remote", "peers", "pairing", "nodes", "devices", "reload"],
      run: () => void queryClient.invalidateQueries({ queryKey: peersKeys.all }),
    });
    return () => unregisterCommand("peers.refresh");
  }, [queryClient]);

  return (
    <div className="peers-view">
      <OverviewSection />
      <PeersSection />
      <PairRequestsSection />
      <WorkSection />
      <NodeHostContractSection />
      <PushSection />
      <InvokeConsole />
    </div>
  );
}
