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
