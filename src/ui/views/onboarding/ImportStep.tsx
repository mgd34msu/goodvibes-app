// Import-bridge entry point (docs/GAPS.md §22 row 8). The bridge itself is
// owned by the Routines/Personas/Skills wave; this view only links to it —
// cross-directory IMPORT of the modal is allowed, editing it is not.

import { useState } from "react";
import { DownloadCloud } from "lucide-react";
import { ImportBridgeModal } from "../routines/ImportBridgeModal.tsx";

export function ImportStep() {
  const [open, setOpen] = useState(false);

  return (
    <div className="onboarding-section">
      <h3 className="onboarding-section__title">
        <DownloadCloud size={14} aria-hidden="true" /> Import from an existing install
      </h3>
      <p className="onboarding-section__hint">
        Already running the goodvibes TUI or agent on this machine? Copy routines, personas, skills, or
        profiles over — their stores are only read, never modified.
      </p>
      <button type="button" className="onboarding-fix__action" onClick={() => setOpen(true)}>
        Open import
      </button>
      <ImportBridgeModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
