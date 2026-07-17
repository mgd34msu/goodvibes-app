// "Identities" tab — umbrella mount point inside ChannelsView for the
// principals/channel-profiles/test-send trio (contract 1.11, all three
// previously without any UI surface). Kept as one file so ChannelsView only
// grows by one import + one tab entry; each concern still lives in its own
// panel file.

import { PrincipalsPanel } from "./PrincipalsPanel.tsx";
import { ChannelProfilesPanel } from "./ChannelProfilesPanel.tsx";
import { TestSendPanel } from "./TestSendPanel.tsx";

export function IdentitiesPanel() {
  return (
    <div className="channels-identities">
      <PrincipalsPanel />
      <ChannelProfilesPanel />
      <TestSendPanel />
    </div>
  );
}
