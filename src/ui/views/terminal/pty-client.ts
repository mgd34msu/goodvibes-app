// Client for the /app/pty/* Bun service (src/bun/pty.ts). Session lifecycle
// over plain fetch, plus a reconnecting reader for the per-session SSE output
// stream. On every (re)connect the server replays the full server-side
// scrollback (bounded ~2 MB) as the first `output` frame, so the connector
// signals onReset() before replay and the emulator is rebuilt idempotently —
// no double-rendering across reconnects or view switches.

import { appFetch, appJson } from "../../lib/http.ts";
import { createSseParser } from "../../lib/sse.ts";

export interface PtySessionSummary {
  id: string;
  pid: number;
  title: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  createdAt: number;
  alive: boolean;
  exitCode: number | null;
  signal: string | null;
}

export interface PtyError {
  error: string;
  code: string;
  detail?: string;
}

export async function listSessions(): Promise<PtySessionSummary[]> {
  const body = await appJson<{ sessions: PtySessionSummary[] }>("/app/pty/sessions");
  return body.sessions;
}

export interface CreateSessionOpts {
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}

/** Create a session. Throws PtyUnavailableError when the host can't allocate a pty. */
export async function createSession(opts: CreateSessionOpts): Promise<PtySessionSummary> {
  const res = await appFetch("/app/pty/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as PtyError | null;
    if (res.status === 501 && err?.code === "PTY_UNSUPPORTED") {
      throw new PtyUnavailableError(err.error, err.detail);
    }
    throw new Error(err?.error ?? `Failed to create terminal session (HTTP ${res.status})`);
  }
  return (await res.json()) as PtySessionSummary;
}

export class PtyUnavailableError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "PtyUnavailableError";
  }
}

export async function killSession(id: string): Promise<void> {
  await appFetch(`/app/pty/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function sendInput(id: string, data: string): Promise<void> {
  await appFetch(`/app/pty/sessions/${encodeURIComponent(id)}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
}

export async function resizeSession(id: string, cols: number, rows: number): Promise<void> {
  await appFetch(`/app/pty/sessions/${encodeURIComponent(id)}/resize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cols, rows }),
  });
}

export interface StreamHandlers {
  /** Fired on every (re)connect, before any replayed output. Reset the emulator. */
  onReset: () => void;
  onOutput: (bytes: Uint8Array) => void;
  onReady?: (summary: PtySessionSummary) => void;
  onExit: (exitCode: number | null, signal: string | null) => void;
  /** Live connection dropped; a reconnect is scheduled. */
  onDisconnect?: () => void;
}

export type StreamDispose = () => void;

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Connect (and keep reconnecting) to a session's output stream until the child
 * exits or dispose() is called. Reconnect uses capped exponential backoff.
 */
export function connectStream(id: string, handlers: StreamHandlers): StreamDispose {
  let disposed = false;
  let exited = false;
  let attempt = 0;
  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const run = async (): Promise<void> => {
    if (disposed || exited) return;
    controller = new AbortController();
    const parser = createSseParser((frame) => {
      if (frame.event === "output") {
        handlers.onOutput(decodeBase64(frame.data));
      } else if (frame.event === "ready") {
        try {
          handlers.onReady?.(JSON.parse(frame.data) as PtySessionSummary);
        } catch {
          /* ignore malformed ready */
        }
      } else if (frame.event === "exit") {
        exited = true;
        try {
          const info = JSON.parse(frame.data) as { exitCode: number | null; signal: string | null };
          handlers.onExit(info.exitCode, info.signal);
        } catch {
          handlers.onExit(null, null);
        }
      }
    });

    try {
      const res = await appFetch(`/app/pty/sessions/${encodeURIComponent(id)}/stream`, {
        signal: controller.signal,
        headers: { accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) {
        // 404 => session is gone for good; stop.
        if (res.status === 404) {
          exited = true;
          handlers.onExit(null, null);
          return;
        }
        throw new Error(`stream HTTP ${res.status}`);
      }
      attempt = 0;
      handlers.onReset(); // fresh connection: server will replay full scrollback
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser(decoder.decode(value, { stream: true }));
        if (exited) return;
      }
    } catch {
      if (disposed || exited) return;
    }
    // Stream ended without an exit frame (network blip): reconnect.
    if (disposed || exited) return;
    handlers.onDisconnect?.();
    scheduleRetry();
  };

  const scheduleRetry = (): void => {
    if (disposed || exited) return;
    const delay = Math.min(500 * 2 ** attempt, 5_000);
    attempt++;
    retryTimer = setTimeout(() => void run(), delay);
  };

  void run();

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller?.abort();
  };
}
