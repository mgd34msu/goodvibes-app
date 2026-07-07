// Fetch-based SSE client. EventSource cannot set request headers, and every
// same-origin request must carry the x-gv-app header (src/bun/ui-server.ts),
// so we parse text/event-stream off a fetch ReadableStream instead.
// Features: Last-Event-ID resume, exponential reconnect backoff, clean dispose.

import { appFetch } from "./http.ts";

export interface SseHandlers {
  /** Headers received and the stream is flowing. */
  onReady?: () => void;
  /** One parsed frame. `event` defaults to "message" per the SSE spec. */
  onEvent: (event: string, data: unknown, id: string | null) => void;
  /** A connection attempt failed or the stream broke; a reconnect is scheduled. */
  onError?: (error: unknown) => void;
  /** Fired right after onError with the backoff delay chosen for the retry. */
  onReconnectScheduled?: (delayMs: number, attempt: number) => void;
  /** Disposed for good (dispose() called) — no further callbacks. */
  onTerminate?: () => void;
}

export interface SseOptions {
  /** Initial reconnect delay in ms (doubles per failure). */
  reconnectBaseMs?: number;
  /** Reconnect delay ceiling in ms. */
  reconnectMaxMs?: number;
}

export type SseDispose = () => void;

interface Frame {
  event: string;
  data: string;
  id: string | null;
}

/** Incremental text/event-stream parser. Feed chunks, get complete frames. */
export function createSseParser(onFrame: (frame: Frame) => void): (chunk: string) => void {
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let id: string | null = null;

  const dispatch = () => {
    if (data.length > 0 || event) {
      onFrame({ event: event || "message", data: data.join("\n"), id });
    }
    event = "";
    data = [];
  };

  return (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        dispatch();
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
        else if (field === "id" && !value.includes("\0")) id = value;
        // `retry` is intentionally ignored — we own backoff locally.
      }
      newlineIndex = buffer.indexOf("\n");
    }
  };
}

function parseData(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * Open a resilient SSE stream at `path` (same-origin, appFetch headers apply).
 * Returns a dispose function. Reconnects forever with capped backoff until
 * disposed; resumes with Last-Event-ID when the server sent frame ids.
 */
export function openSse(path: string, handlers: SseHandlers, options?: SseOptions): SseDispose {
  const baseMs = options?.reconnectBaseMs ?? 1_000;
  const maxMs = options?.reconnectMaxMs ?? 30_000;

  let disposed = false;
  let attempt = 0;
  let lastEventId: string | null = null;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = (error: unknown) => {
    if (disposed) return;
    handlers.onError?.(error);
    const delay = Math.min(maxMs, baseMs * 2 ** attempt);
    attempt += 1;
    handlers.onReconnectScheduled?.(delay, attempt);
    timer = setTimeout(() => void connect(), delay);
  };

  const connect = async () => {
    if (disposed) return;
    controller = new AbortController();
    try {
      const headers: Record<string, string> = { accept: "text/event-stream" };
      if (lastEventId !== null) headers["last-event-id"] = lastEventId;
      const res = await appFetch(path, { headers, signal: controller.signal });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw Object.assign(new Error(`SSE ${res.status} for ${path}`), { status: res.status, body });
      }

      attempt = 0;
      handlers.onReady?.();

      const parse = createSseParser((frame) => {
        if (disposed) return;
        if (frame.id !== null) lastEventId = frame.id;
        handlers.onEvent(frame.event, parseData(frame.data), frame.id);
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parse(decoder.decode(value, { stream: true }));
      }
      // Server closed cleanly — still a break in liveness; reconnect.
      scheduleReconnect(new Error("SSE stream ended"));
    } catch (error) {
      if (disposed) return;
      scheduleReconnect(error);
    }
  };

  void connect();

  return () => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    controller?.abort();
    handlers.onTerminate?.();
  };
}
