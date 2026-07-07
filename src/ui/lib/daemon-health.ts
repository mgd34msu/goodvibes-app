// Three-axis daemon health (Reachable / Signed-in / Working) — pure types and
// helpers ported from goodvibes-webui src/lib/daemon-health.ts, with the
// REACHABLE axis re-sourced from this app's /app/health endpoint (the Bun
// side probes the daemon; the webview asks the Bun side).

import { useQuery } from "@tanstack/react-query";
import type { AppHealth } from "../../shared/app-contract.ts";
import { fetchAppHealth, queryKeys } from "./queries.ts";
import { gv } from "./gv.ts";
import { countFrom, asRecord, firstString } from "./wire.ts";
import { errorStatus } from "./errors.ts";
import { useSseRetryAt, useSseState } from "./realtime.ts";
import { usePendingApprovalsCount } from "./approvals.ts";

/**
 * REACHABLE axis. The daemon answered its /status probe — this says nothing
 * about auth. Label is "Reachable", never "Connected": a 401ing daemon is
 * still reachable while everything else fails.
 */
export type ConnectionState = "connected" | "reconnecting" | "down";

/** SIGNED-IN axis: the proxy-injected token is accepted (200) vs rejected (401). */
export type AuthState = "signed-in" | "signed-out" | "unknown";

/** WORKING axis: an authed read succeeded without 401 (catches scope-less tokens). */
export type WorkingState = "working" | "blocked" | "unknown";

export type SseState = "active" | "connecting" | "error" | "disabled";

export interface DaemonHealth {
  connection: ConnectionState;
  signedIn: AuthState;
  working: WorkingState;
  latencyMs: number | null;
  sse: SseState;
  /** Epoch ms of the next SSE reconnect attempt; null unless sse === "error". */
  sseRetryAt: number | null;
  activeTurns: number;
  queuedTasks: number;
  /** Approvals awaiting a human decision (pending or claimed). */
  pendingApprovals: number;
  /** Present when the daemon is incompatible/unreachable — user-facing detail. */
  detail: string | null;
  daemonMode: AppHealth["daemon"]["mode"] | null;
  daemonVersion: string | null;
}

export const DAEMON_HEALTH_DEFAULTS: DaemonHealth = {
  connection: "down",
  signedIn: "unknown",
  working: "unknown",
  latencyMs: null,
  sse: "disabled",
  sseRetryAt: null,
  activeTurns: 0,
  queuedTasks: 0,
  pendingApprovals: 0,
  detail: null,
  daemonMode: null,
  daemonVersion: null,
};

export function clampLatency(ms: number): number | null {
  if (ms < 0) return null;
  return Math.min(ms, 9999);
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 10) return "<10ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "Reachable";
    case "reconnecting":
      return "Reconnecting";
    case "down":
      return "Offline";
  }
}

export function authLabel(state: AuthState): string {
  switch (state) {
    case "signed-in":
      return "Signed in";
    case "signed-out":
      return "Signed out";
    case "unknown":
      return "Auth ?";
  }
}

export function workingLabel(state: WorkingState): string {
  switch (state) {
    case "working":
      return "Working";
    case "blocked":
      return "No access";
    case "unknown":
      return "Idle";
  }
}

export function sseLabel(state: SseState): string {
  switch (state) {
    case "active":
      return "Live";
    case "connecting":
      return "SSE…";
    case "error":
      return "Paused";
    case "disabled":
      return "SSE off";
  }
}

/**
 * SSE chip text with a reconnect countdown while paused: "Paused · retry 4s".
 * `now` is a parameter (not Date.now()) so the caller owns the tick cadence.
 */
export function sseDetailLabel(state: SseState, retryAt: number | null, now: number): string {
  if (state !== "error" || retryAt === null) return sseLabel(state);
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return seconds > 0 ? `Paused · retry ${seconds}s` : "Paused · retrying…";
}

/** Derive the REACHABLE axis from /app/health's daemon mode. */
export function connectionFromMode(mode: AppHealth["daemon"]["mode"] | null): ConnectionState {
  if (mode === "external" || mode === "spawned") return "connected";
  if (mode === "unreachable" || mode === "incompatible") return "down";
  return "down";
}

/** Extract active/queued counts from a tasks.list response (verbatim statuses). */
export function taskCountsFromList(response: unknown): { activeTurns: number; queuedTasks: number } {
  const record = asRecord(response);
  const items = (record["tasks"] ?? record["items"] ?? record["data"]) as unknown;
  if (!Array.isArray(items)) return { activeTurns: 0, queuedTasks: 0 };
  let activeTurns = 0;
  let queuedTasks = 0;
  for (const item of items) {
    const s = firstString(item, ["status", "state"]).toLowerCase();
    if (s === "running" || s === "active" || s === "in_progress") activeTurns++;
    else if (s === "queued" || s === "pending" || s === "waiting") queuedTasks++;
  }
  return { activeTurns, queuedTasks };
}

/** Read active-turn/session totals off control.snapshot, shape-defensively. */
export function activeTurnsFromControlSnapshot(snapshot: unknown): number {
  const record = asRecord(snapshot);
  const totals = asRecord(record["totals"] ?? record["sessions"] ?? record);
  return countFrom(totals, ["activeTurns", "active", "activeSessions", "running"]);
}

const HEALTH_PROBE_INTERVAL_MS = 5_000;
const AUTHED_PROBE_INTERVAL_MS = 15_000;

/**
 * Live daemon health for the status strip.
 * - REACHABLE + latency: /app/health (Bun-side probe result) every 5 s.
 * - SIGNED-IN + WORKING: one authed read (control.snapshot) every 15 s;
 *   200 → signed-in+working, 401 → signed-out/blocked, else unknown.
 * - Active turns: control.snapshot totals (placeholder until turn events land).
 * - Pending approvals: shared queryKeys.approvals cache (the permissions SSE
 *   domain invalidates it — the strip badge updates live without polling fast).
 * - SSE axis + reconnect deadline: the module store lib/realtime.ts maintains.
 */
export function useDaemonHealth(): DaemonHealth {
  const sse = useSseState();
  const sseRetryAt = useSseRetryAt();

  const health = useQuery({
    queryKey: queryKeys.appHealth,
    queryFn: fetchAppHealth,
    refetchInterval: HEALTH_PROBE_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: 0,
    staleTime: HEALTH_PROBE_INTERVAL_MS / 2,
  });

  const daemon = health.data?.daemon ?? null;
  const connection: ConnectionState = health.isError
    ? "down"
    : health.data
      ? connectionFromMode(daemon?.mode ?? null)
      : "reconnecting";

  const snapshotProbe = useQuery({
    queryKey: [...queryKeys.control, "health-probe"],
    queryFn: async () => {
      try {
        const snapshot = await gv.control.snapshot();
        return { ok: true as const, status: 200, snapshot };
      } catch (error) {
        return { ok: false as const, status: errorStatus(error) ?? null, snapshot: null };
      }
    },
    enabled: connection === "connected",
    refetchInterval: AUTHED_PROBE_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: 0,
    staleTime: AUTHED_PROBE_INTERVAL_MS / 2,
  });

  const probe = snapshotProbe.data;
  const signedIn: AuthState = !probe ? "unknown" : probe.ok ? "signed-in" : probe.status === 401 ? "signed-out" : "unknown";
  const working: WorkingState = !probe ? "unknown" : probe.ok ? "working" : probe.status === 401 ? "blocked" : "unknown";

  const tasksProbe = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => gv.tasks.list(),
    enabled: connection === "connected" && signedIn === "signed-in",
    refetchInterval: AUTHED_PROBE_INTERVAL_MS,
    retry: 0,
    staleTime: AUTHED_PROBE_INTERVAL_MS / 2,
  });

  // Shared with the Approvals view (lib/approvals.ts owns the parsing).
  const pendingApprovals = usePendingApprovalsCount(connection === "connected" && signedIn === "signed-in");

  const { activeTurns: taskTurns, queuedTasks } = tasksProbe.isSuccess
    ? taskCountsFromList(tasksProbe.data)
    : { activeTurns: 0, queuedTasks: 0 };
  const snapshotTurns = probe?.ok ? activeTurnsFromControlSnapshot(probe.snapshot) : 0;

  return {
    connection,
    signedIn,
    working,
    latencyMs: daemon?.probeMs != null ? clampLatency(daemon.probeMs) : null,
    sse,
    sseRetryAt,
    activeTurns: Math.max(taskTurns, snapshotTurns),
    queuedTasks,
    pendingApprovals: pendingApprovals ?? 0,
    detail: daemon?.detail ?? (health.isError ? "App server unreachable" : null),
    daemonMode: daemon?.mode ?? null,
    daemonVersion: daemon?.version ?? null,
  };
}
