// "Devices & pairing" — umbrella mount point inside PeersView for the four
// pairing.*/tailscale.* sections (per-device tokens, hand-off QR, origin
// posture, tailscale serve). Kept as one file's import surface so PeersView
// only grows by one line; each concern still lives in its own section file.

import { PairingPostureSection } from "./PairingPostureSection.tsx";
import { PairingTokensSection } from "./PairingTokensSection.tsx";
import { PairingHandoffSection } from "./PairingHandoffSection.tsx";
import { TailscaleSection } from "./TailscaleSection.tsx";

export function DevicesPairingSection() {
  return (
    <>
      <PairingPostureSection />
      <PairingTokensSection />
      <PairingHandoffSection />
      <TailscaleSection />
    </>
  );
}
