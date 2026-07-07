// Daemon gate — rendered OVER the still-mounted shell (never remounts the
// workspace: drafts survive outages — docs/UX.md §1.2) when the daemon is
// unreachable or version-incompatible. Shows the Bun-side detail text, a
// retry that re-probes /app/health, and a jump into the Doctor overlay
// (views/onboarding/) which carries the full three-check fix guidance.

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AppHealth } from "../../../shared/app-contract.ts";
import { queryKeys } from "../../lib/queries.ts";
import { announce } from "../../lib/announcer.ts";

export interface DaemonGateProps {
  health: AppHealth | undefined;
  /** True while /app/health itself is unreachable (app server down). */
  appUnreachable: boolean;
  /** Opens the Doctor overlay (three live checks + fix guidance). */
  onOpenDoctor?: () => void;
}

export function shouldGate(health: AppHealth | undefined, appUnreachable: boolean): boolean {
  if (appUnreachable) return true;
  if (!health) return false; // first load — shell skeleton paints, no scary overlay yet
  return health.daemon.mode === "unreachable" || health.daemon.mode === "incompatible";
}

export function DaemonGate({ health, appUnreachable, onOpenDoctor }: DaemonGateProps) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  const mode = health?.daemon.mode;
  const title = appUnreachable
    ? "App server unreachable"
    : mode === "incompatible"
      ? "Daemon version incompatible"
      : "Daemon unreachable";
  const detail = appUnreachable
    ? "The app's own local server is not answering — the window may have outlived its process. Relaunch the app."
    : (health?.daemon.detail ??
      `No GoodVibes daemon is answering at ${health?.daemon.baseUrl ?? "the configured address"}.`);

  const retry = async () => {
    setRetrying(true);
    announce("Re-probing daemon…");
    try {
      await queryClient.refetchQueries({ queryKey: queryKeys.appHealth });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="daemon-gate" role="alertdialog" aria-modal="false" aria-label={title}>
      <div className="daemon-gate__panel">
        <h2 className="daemon-gate__title">{title}</h2>
        <p className="daemon-gate__detail">{detail}</p>
        {health?.daemon.version && mode === "incompatible" && (
          <p className="daemon-gate__detail">
            Daemon reports version <code>{health.daemon.version}</code>.
          </p>
        )}
        <p className="daemon-gate__note">
          Your workspace stays mounted underneath — drafts and view state are safe. The probe also retries
          automatically every few seconds.
        </p>
        <div className="daemon-gate__actions">
          <button type="button" className="daemon-gate__retry" onClick={() => void retry()} disabled={retrying}>
            <RefreshCw size={14} aria-hidden="true" className={retrying ? "spinning" : undefined} />
            {retrying ? "Probing…" : "Retry now"}
          </button>
          {onOpenDoctor && (
            <button type="button" className="daemon-gate__doctor" onClick={onOpenDoctor}>
              Run Doctor
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
