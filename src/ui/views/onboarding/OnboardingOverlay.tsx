// First-run onboarding / Doctor overlay — rendered OVER the still-mounted
// shell (drafts and view state survive, docs/UX.md §1.2). One screen, three
// live checks (OnboardingChecks), every check repairable inline and skippable
// to a degraded-but-honest workspace. Re-runnable anytime via the "Doctor"
// palette command. "Start chatting" enables the moment all checks pass.

import { useCallback, useEffect, useState } from "react";
import { Stethoscope } from "lucide-react";
import { useFocusTrap } from "../../lib/focus-trap.ts";
import { announce } from "../../lib/announcer.ts";
import { OnboardingChecks } from "./OnboardingChecks.tsx";
import { setOnboarded } from "./checks.ts";

export type OnboardingMode = "first-run" | "doctor";

export interface OnboardingOverlayProps {
  mode: OnboardingMode;
  /** Close the overlay (both "Start chatting" and skip/close land here). */
  onClose: () => void;
  /** Jump to the chat view — wired to "Start chatting". */
  onStartChat: () => void;
}

export function OnboardingOverlay({ mode, onClose, onStartChat }: OnboardingOverlayProps) {
  const [allPass, setAllPass] = useState(false);
  const panelRef = useFocusTrap<HTMLDivElement>(true);

  const firstRun = mode === "first-run";
  const title = firstRun ? "Welcome to GoodVibes" : "Doctor";

  useEffect(() => {
    announce(firstRun ? "First-run checks running" : "Doctor checks running");
  }, [firstRun]);

  const finish = useCallback(
    (startChat: boolean) => {
      setOnboarded();
      onClose();
      if (startChat) onStartChat();
    },
    [onClose, onStartChat],
  );

  // Escape skips — the overlay never blocks the workspace hostage-style.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      finish(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [finish]);

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="onboarding-panel" ref={panelRef}>
        <div className="onboarding-panel__header">
          <Stethoscope size={18} aria-hidden="true" className="onboarding-panel__icon" />
          <div>
            <h2 className="onboarding-panel__title">{title}</h2>
            <p className="onboarding-panel__subtitle">
              {firstRun
                ? "Three checks stand between you and a working chat. Everything is repairable inline — or skip and fix later from the Doctor."
                : "The same three live checks as first run — re-run any time. Failures name their next action."}
            </p>
          </div>
        </div>

        <OnboardingChecks onStatus={setAllPass} />

        <div className="onboarding-panel__actions">
          <button type="button" className="onboarding-panel__skip" onClick={() => finish(false)}>
            {firstRun ? "Skip for now" : "Close"}
          </button>
          <button
            type="button"
            className="onboarding-panel__start"
            disabled={!allPass}
            title={allPass ? undefined : "Enabled when all three checks pass"}
            onClick={() => finish(true)}
          >
            Start chatting
          </button>
        </div>
        {!allPass && (
          <p className="onboarding-panel__note">
            Skipping lands you in the workspace with honest degraded states — nothing is hidden, failing
            surfaces say why.
          </p>
        )}
      </div>
    </div>
  );
}
