// CI Watches — ci.status one-shot lookups + persistent ci.watches.* that
// notify (and optionally auto-start a fix session) when a repo/ref/PR's
// checks finish. Crib: goodvibes-webui src/views/ci/CiWatchesView.tsx.
// Wave: SDK-1.11 adoption (agent C owns this file).

import { ComingSoon } from "../ComingSoon.tsx";

export function CiWatchesView() {
  return (
    <ComingSoon
      title="CI Watches"
      wave="SDK-1.11 adoption"
      description="Watch a repo, ref, or PR's checks; get notified — or auto-start a fix session — on failure."
    />
  );
}
