// Types shared between the Bun main process (src/bun) and the webview UI (src/ui).
// This file must stay runtime-neutral: no Bun globals, no DOM globals.

/** How the app is connected to a GoodVibes daemon. */
export type DaemonMode = "external" | "spawned" | "unreachable" | "incompatible";

export interface DaemonInfo {
  mode: DaemonMode;
  baseUrl: string;
  /** Daemon-reported version from GET /status (absent when unreachable). */
  version?: string;
  /** Present when mode is unreachable/incompatible: user-facing explanation. */
  detail?: string;
  /** Milliseconds the last /status probe took. */
  probeMs?: number;
}

export interface AppHealth {
  app: { name: string; version: string };
  daemon: DaemonInfo;
  startedAt: number;
}

/** Header the UI stamps on every /api and /app request (defense in depth). */
export const APP_HEADER = "x-gv-app";
export const APP_HEADER_VALUE = "goodvibes-app";

// --- /app/ws bridge (src/bun/ws-bridge.ts) ---------------------------------
// Browser WebSocket handshakes cannot carry custom headers, so the app-header
// check is replaced by a one-time ticket: GET /app/ws-ticket (header-checked)
// returns a WsTicket, then the UI connects to `${WS_BRIDGE_PATH}?ticket=…`.
// Tickets are single-use and expire after ~30s. The Bun side authenticates to
// the daemon itself (token never reaches the webview); the UI speaks the
// daemon WS protocol minus the auth frame.

export const WS_BRIDGE_PATH = "/app/ws";
export const WS_TICKET_PATH = "/app/ws-ticket";

export interface WsTicket {
  ticket: string;
  /** Milliseconds from issue until the ticket stops being redeemable. */
  expiresInMs: number;
}

/** Close codes the bridge sends so the UI can distinguish causes. */
export const WS_CLOSE_DAEMON_DISCONNECTED = 4001; // daemon-side socket closed; reconnect when healthy
export const WS_CLOSE_BACKPRESSURE_OVERFLOW = 4002; // a side stopped draining; reconnect fresh
