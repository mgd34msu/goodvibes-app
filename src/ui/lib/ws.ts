// Call multiplexer over the /app/ws bridge (src/bun side bridges to the
// daemon's /api/control-plane/ws and sends the auth frame itself — the token
// never enters the webview). UI wire protocol = daemon protocol minus auth:
//   send    {type:'call', id, methodId, body?, query?}
//           {type:'subscribe'|'unsubscribe', domains}
//   receive {type:'response', id, ok, status, body}
//           {type:'event', event, payload}
//           {type:'auth', ok} (informational)
// WebSocket upgrades cannot carry the x-gv-app header, so we first fetch a
// one-shot ticket from /app/ws/ticket (a normal appFetch request that CAN
// carry it) and pass it as ?ticket=. A bridge without the ticket endpoint
// (404) gets a bare connect attempt so older bun-side builds still work.

import { appFetch } from "./http.ts";
import { HttpError } from "./http.ts";
import { asRecord, firstString } from "./wire.ts";

const CALL_TIMEOUT_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export type WsBridgeState = "idle" | "connecting" | "open" | "closed";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

type EventListener = (event: string, payload: unknown) => void;

let socket: WebSocket | null = null;
let state: WsBridgeState = "idle";
let connectPromise: Promise<WebSocket> | null = null;
let reconnectAttempt = 0;
let callSeq = 0;
const pending = new Map<string, PendingCall>();
const eventListeners = new Set<EventListener>();
const subscribedDomains = new Set<string>();

function bridgeUnavailable(detail: string): HttpError {
  // Shaped so errors.ts classifiers see a code — never a bare string.
  return new HttpError(
    503,
    "/app/ws",
    JSON.stringify({ error: "WS bridge unavailable", code: "APP_WS_BRIDGE_UNAVAILABLE", detail }),
  );
}

async function fetchTicket(): Promise<string | null> {
  try {
    const res = await appFetch("/app/ws/ticket", { method: "POST" });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as unknown;
    const ticket = firstString(body, ["ticket", "token"]);
    return ticket || null;
  } catch {
    return null;
  }
}

function wsUrl(ticket: string | null): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const base = `${proto}://${window.location.host}/app/ws`;
  return ticket ? `${base}?ticket=${encodeURIComponent(ticket)}` : base;
}

function failAllPending(error: unknown): void {
  for (const [, call] of pending) {
    clearTimeout(call.timer);
    call.reject(error);
  }
  pending.clear();
}

function handleMessage(raw: unknown): void {
  let frame: unknown;
  try {
    frame = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return;
  }
  const record = asRecord(frame);
  const type = record["type"];

  if (type === "response") {
    const id = firstString(record, ["id"]);
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    clearTimeout(call.timer);
    if (record["ok"] === true) {
      call.resolve(record["body"]);
    } else {
      const status = typeof record["status"] === "number" ? record["status"] : 500;
      call.reject(new HttpError(status, `ws:${id}`, JSON.stringify(record["body"] ?? {})));
    }
    return;
  }

  if (type === "event") {
    const event = firstString(record, ["event"]);
    for (const listener of eventListeners) listener(event, record["payload"]);
    return;
  }
  // 'auth' frames are informational — the bridge already authenticated.
}

function connect(): Promise<WebSocket> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (connectPromise) return connectPromise;

  state = "connecting";
  connectPromise = (async () => {
    const ticket = await fetchTicket();
    return await new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl(ticket));
      } catch (error) {
        state = "closed";
        reject(bridgeUnavailable(error instanceof Error ? error.message : String(error)));
        return;
      }

      ws.onopen = () => {
        settled = true;
        socket = ws;
        state = "open";
        reconnectAttempt = 0;
        // Re-arm domain subscriptions across reconnects.
        if (subscribedDomains.size > 0) {
          ws.send(JSON.stringify({ type: "subscribe", domains: [...subscribedDomains] }));
        }
        resolve(ws);
      };
      ws.onmessage = (event) => handleMessage(event.data);
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          state = "closed";
          reject(bridgeUnavailable("connection failed"));
        }
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        state = "closed";
        failAllPending(bridgeUnavailable("connection closed"));
        if (!settled) {
          settled = true;
          reject(bridgeUnavailable("connection closed before open"));
        }
      };
    });
  })();

  connectPromise.catch(() => undefined).finally(() => {
    connectPromise = null;
  });
  return connectPromise;
}

export function wsBridgeState(): WsBridgeState {
  return state;
}

export interface WsCallOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

/** Invoke a WS-only method through the bridge. Rejects with a classified
 * APP_WS_BRIDGE_UNAVAILABLE HttpError when the bridge cannot be reached. */
export async function wsCall(methodId: string, options?: WsCallOptions): Promise<unknown> {
  let ws: WebSocket;
  try {
    ws = await connect();
  } catch (error) {
    // One retry after a fresh backoff step: transient bridge restarts recover.
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    await new Promise((r) => setTimeout(r, delay));
    try {
      ws = await connect();
    } catch {
      throw error;
    }
  }

  callSeq += 1;
  const id = `c${callSeq}`;
  const query =
    options?.query &&
    Object.fromEntries(
      Object.entries(options.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );

  return await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new HttpError(504, `ws:${methodId}`, JSON.stringify({ error: "WS call timed out", code: "APP_WS_TIMEOUT" })));
    }, options?.timeoutMs ?? CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    ws.send(
      JSON.stringify({
        type: "call",
        id,
        methodId,
        ...(options?.body !== undefined ? { body: options.body } : {}),
        ...(query && Object.keys(query).length > 0 ? { query } : {}),
      }),
    );
  });
}

/** Subscribe to daemon event domains over the bridge. Returns unsubscribe. */
export function wsSubscribe(domains: string[], listener: EventListener): () => void {
  eventListeners.add(listener);
  const added = domains.filter((d) => !subscribedDomains.has(d));
  for (const d of domains) subscribedDomains.add(d);
  void connect()
    .then((ws) => {
      if (added.length > 0) ws.send(JSON.stringify({ type: "subscribe", domains: added }));
    })
    .catch(() => undefined);

  return () => {
    eventListeners.delete(listener);
    // Domains stay subscribed for the session — other listeners may share them
    // and re-subscription churn on the daemon is worse than a few spare frames.
  };
}
