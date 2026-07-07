// The ONE shared confirmation surface for confirm-gated daemon methods
// (docs/UX.md §4): names the exact action, target, and blast radius, and
// emits `confirm: true` + `explicitUserRequest` metadata for the caller to
// pass through on the wire — no auto-confirm path exists. Never a native
// confirm(). Optional typed-confirmation for destructive operations.

import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "./Modal.tsx";
import { announce } from "../lib/announcer.ts";

/** Metadata the caller must forward verbatim on the confirmed call. */
export interface ConfirmMetadata {
  confirm: true;
  explicitUserRequest: true;
}

export interface ConfirmSurfaceProps {
  open: boolean;
  /** The exact action, verb-first: "Delete schedule", "Restore checkpoint". */
  action: string;
  /** The exact target: name/id of what the action hits. */
  target: string;
  /** What else is affected — plain words, no euphemisms. */
  blastRadius: string;
  /** Marks an irreversible action (danger styling + stronger wording). */
  danger?: boolean;
  /** Require the user to type this exact text to enable Confirm. */
  requireTypedText?: string;
  /** Extra detail rows (e.g. a diff summary). */
  children?: ReactNode;
  confirmLabel?: string;
  onConfirm: (meta: ConfirmMetadata) => void;
  onCancel: () => void;
}

export function ConfirmSurface({
  open,
  action,
  target,
  blastRadius,
  danger = false,
  requireTypedText,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmSurfaceProps) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const typedOk = !requireTypedText || typed === requireTypedText;

  return (
    <Modal open={open} onClose={onCancel} title={action} size="md">
      <div className={danger ? "confirm-surface confirm-surface--danger" : "confirm-surface"}>
        <dl className="confirm-surface__facts">
          <dt>Action</dt>
          <dd>{action}</dd>
          <dt>Target</dt>
          <dd className="confirm-surface__target">{target}</dd>
          <dt>Blast radius</dt>
          <dd>{blastRadius}</dd>
        </dl>

        {children}

        {requireTypedText && (
          <label className="confirm-surface__typed">
            <span>
              Type <code>{requireTypedText}</code> to confirm
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label={`Type ${requireTypedText} to confirm`}
            />
          </label>
        )}

        <div className="confirm-surface__actions">
          <button type="button" className="confirm-surface__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? "confirm-surface__confirm confirm-surface__confirm--danger" : "confirm-surface__confirm"}
            disabled={!typedOk}
            onClick={() => {
              announce(`Confirmed: ${action} — ${target}`, "assertive");
              onConfirm({ confirm: true, explicitUserRequest: true });
            }}
          >
            {confirmLabel ?? action}
          </button>
        </div>
      </div>
    </Modal>
  );
}
