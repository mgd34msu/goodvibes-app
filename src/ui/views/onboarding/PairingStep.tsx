// Companion QR pairing entry point (docs/GAPS.md §22 row 9). The pairing
// surface itself is owned by the Channels view; this view only links to it —
// cross-directory IMPORT of the modal is allowed, editing it is not.

import { useState } from "react";
import { QrCode } from "lucide-react";
import { PairingModal } from "../channels/PairingModal.tsx";

export function PairingStep() {
  const [open, setOpen] = useState(false);

  return (
    <div className="onboarding-section">
      <h3 className="onboarding-section__title">
        <QrCode size={14} aria-hidden="true" /> Pair a mobile companion
      </h3>
      <p className="onboarding-section__hint">
        Scan a QR code from a GoodVibes companion app to connect it to this same daemon. Treat the code
        like a password — it carries a live access token.
      </p>
      <button type="button" className="onboarding-fix__action" onClick={() => setOpen(true)}>
        Show pairing code
      </button>
      <PairingModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
