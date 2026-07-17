// Persistent bottom status strip — the ambient observability surface
// (docs/UX.md §1.4). Three honest daemon-health axes (Reachable / Signed-in /
// Working — they can disagree and the strip never collapses them), latency,
// SSE state with a reconnect countdown, active work, pending approvals, a
// sleep-inhibitor chip (visible only while actually held), and a
// session-cost slot. Every chip is a real button that deep-links to the view
// that explains it (router navigation supplied by AppShell — one router
// instance owns URL state). Ported from goodvibes-webui
// src/components/status/StatusStrip.tsx over this app's /app/health-backed
// useDaemonHealth. The inhibitor chip reads power.status.get directly (its
// own sparse poll, not routed through useDaemonHealth) — see
// views/observability/PowerPanel.tsx and obs-wire.ts for the full snapshot.

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, BadgeCheck, CircleDollarSign, KeyRound, Moon, Radio, ShieldCheck, Zap } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import {
  authLabel,
  connectionLabel,
  formatLatency,
  sseDetailLabel,
  sseLabel,
  useDaemonHealth,
  workingLabel,
  type ConnectionState,
} from "../../lib/daemon-health.ts";
import {
  contractGlyphForAuth,
  contractGlyphForConnection,
  contractGlyphForSse,
  contractGlyphForWorking,
} from "../../lib/presentation-bridge.ts";
import type { ViewId } from "../../lib/router.ts";
import { powerHeldTooltip, readPowerStatus } from "../../views/observability/obs-wire.ts";

export interface StatusStripProps {
  /** Router navigation from the shell's single useUrlState instance. */
  onNavigate: (view: ViewId) => void;
  /** Opens the Doctor overlay (auth/daemon chips route fixes there). */
  onOpenDoctor: () => void;
}

function ConnectionDot({ state }: { state: ConnectionState }) {
  return <span className={`status-strip__dot status-strip__dot--${state}`} aria-hidden="true" />;
}

/** A strip chip: a real button that deep-links to the view explaining it. */
function Chip({
  onClick,
  ariaLabel,
  className,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`status-strip__segment status-strip__chip${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function StatusStrip({ onNavigate, onOpenDoctor }: StatusStripProps) {
  const {
    connection,
    signedIn,
    working,
    latencyMs,
    sse,
    sseRetryAt,
    activeTurns,
    queuedTasks,
    pendingApprovals,
    daemonVersion,
  } = useDaemonHealth();

  // 1s tick only while a reconnect countdown is actually painted.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sse !== "error" || sseRetryAt === null) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [sse, sseRetryAt]);

  const isBusy = activeTurns > 0 || queuedTasks > 0;
  const sseText = sseDetailLabel(sse, sseRetryAt, now);

  // Power inhibitor — sparse poll (no wire-event subscription for the "ops"
  // domain exists in lib/realtime.ts yet; see ObservabilityView.tsx's note).
  // Silently absent (no chip, no error surface) when the daemon doesn't
  // serve power.status.get — this is ambient state, not a capability the
  // strip is responsible for explaining.
  const power = useQuery({
    queryKey: queryKeys.powerStatus,
    queryFn: () => gv.power.status(),
    refetchInterval: 45_000,
    retry: false,
  });
  const powerSnapshot = power.isSuccess ? readPowerStatus(power.data) : undefined;
  const inhibitorHeld = powerSnapshot?.workHeld ?? false;
  const inhibitorTooltip = powerSnapshot ? powerHeldTooltip(powerSnapshot) : "";

  return (
    <footer className="status-strip">
      {/* Live region — announces the three honest axes; never collapses them
          into one "Connected". */}
      <span className="status-strip__live-region" aria-live="polite" aria-atomic="true">
        {`${connectionLabel(connection)}, ${authLabel(signedIn)}, ${workingLabel(working)}`}
      </span>

      {/* REACHABLE axis — contract glyph painted via ::before (components.css). */}
      <Chip
        onClick={onOpenDoctor}
        ariaLabel={`Daemon: ${connectionLabel(connection)}. Open Doctor`}
        className="status-strip__segment--connection"
      >
        <ConnectionDot state={connection} />
        <span className="status-strip__label" data-contract-glyph={contractGlyphForConnection(connection)}>
          {connectionLabel(connection)}
        </span>
      </Chip>

      {/* SIGNED-IN axis */}
      <Chip
        onClick={onOpenDoctor}
        ariaLabel={`Auth: ${authLabel(signedIn)}. Open Doctor`}
        className={`status-strip__segment--auth-${signedIn}`}
      >
        <KeyRound className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label" data-contract-glyph={contractGlyphForAuth(signedIn)}>
          {authLabel(signedIn)}
        </span>
      </Chip>

      {/* WORKING axis */}
      <Chip
        onClick={onOpenDoctor}
        ariaLabel={`Access: ${workingLabel(working)}. Open Doctor`}
        className={`status-strip__segment--working-${working}`}
      >
        <ShieldCheck className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label" data-contract-glyph={contractGlyphForWorking(working)}>
          {workingLabel(working)}
        </span>
      </Chip>

      {/* Latency (last /status probe, Bun-side measurement) */}
      <Chip
        onClick={() => onNavigate("observability")}
        ariaLabel={`Latency: ${formatLatency(latencyMs)}. Open Observability`}
      >
        <Zap className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label">{formatLatency(latencyMs)}</span>
      </Chip>

      {/* Active work — control.snapshot totals + verbatim task statuses. */}
      <Chip
        onClick={() => onNavigate("sessions")}
        ariaLabel={`Active turns: ${activeTurns}, queued: ${queuedTasks}. Open Sessions`}
        className={isBusy ? "status-strip__segment--active" : undefined}
      >
        <Activity className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label">
          {activeTurns > 0 ? `${activeTurns} active` : null}
          {activeTurns > 0 && queuedTasks > 0 ? ", " : null}
          {queuedTasks > 0 ? `${queuedTasks} queued` : null}
          {!isBusy ? "Idle" : null}
        </span>
      </Chip>

      {/* Pending approvals — only painted when something needs a human. */}
      {pendingApprovals > 0 && (
        <Chip
          onClick={() => onNavigate("approvals")}
          ariaLabel={`${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} pending. Open Approvals`}
          className="status-strip__segment--approvals"
        >
          <BadgeCheck className="status-strip__icon" aria-hidden="true" size={11} />
          <span className="status-strip__label">
            {pendingApprovals} approval{pendingApprovals === 1 ? "" : "s"}
          </span>
        </Chip>
      )}

      {/* SSE health + reconnect countdown while paused */}
      <Chip
        onClick={() => onNavigate("observability")}
        ariaLabel={`Realtime stream: ${sseLabel(sse)}. Open Observability`}
        className={`status-strip__segment--sse-${sse}`}
      >
        <Radio className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label" data-contract-glyph={contractGlyphForSse(sse)}>
          {sseText}
        </span>
      </Chip>

      {/* Sleep inhibitor — visible ONLY while the daemon actually holds it
          (keep-awake or automatic work). Danger tone; tooltip is the
          daemon's own verbatim note/reasons, never a guess. */}
      {inhibitorHeld && (
        <Chip
          onClick={() => onNavigate("observability")}
          ariaLabel={`Sleep inhibitor held: ${inhibitorTooltip}. Open Observability`}
          className="status-strip__segment--power-held"
        >
          <Moon className="status-strip__icon" aria-hidden="true" size={11} />
          <span className="status-strip__label" title={inhibitorTooltip}>
            Awake
          </span>
        </Chip>
      )}

      {/* Session cost — honest placeholder until the Wave D cost engine lands;
          shows the slot (and its destination) without inventing a number. */}
      <Chip
        onClick={() => onNavigate("observability")}
        ariaLabel="Session cost: not tracked yet — cost analytics arrive in Wave D. Open Observability"
        className="status-strip__segment--cost"
      >
        <CircleDollarSign className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label" title="Session cost — cost analytics land in Wave D">
          —
        </span>
      </Chip>

      {daemonVersion !== null && (
        <div className="status-strip__segment status-strip__segment--right status-strip__segment--model">
          <span className="status-strip__label status-strip__label--mono" title={`daemon v${daemonVersion}`}>
            daemon v{daemonVersion}
          </span>
        </div>
      )}
    </footer>
  );
}
