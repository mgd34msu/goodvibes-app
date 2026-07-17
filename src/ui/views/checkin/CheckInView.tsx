// Check-in — the proactive contact loop: config (enabled/cadence/channel/
// quiet hours), manual run-now, and the receipts every run leaves (contact
// or not). Crib: goodvibes-webui src/views/checkin/CheckInView.tsx.
// Wave: SDK-1.11 adoption (agent F owns this file).

import { ComingSoon } from "../ComingSoon.tsx";

export function CheckInView() {
  return (
    <ComingSoon
      title="Check-in"
      wave="SDK-1.11 adoption"
      description="Proactive check-ins: the daemon briefs a judge model on your fleet and reaches out first — accountably, with a receipt for every run."
    />
  );
}
