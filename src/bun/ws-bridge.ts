// WebSocket bridge: webview /app/ws ⇄ daemon /api/control-plane/ws.
// The Bun side opens the daemon-side socket, sends the auth frame itself
// (the bearer token never reaches the webview), then pipes frames verbatim
// both ways. The UI speaks the daemon WS protocol minus auth
// (docs/ARCHITECTURE.md §2, §7; wire contract in src/shared/app-contract.ts).
//
// Browser WebSocket handshakes cannot carry the x-gv-app header, so /app/ws
// is guarded by a single-use short-lived ticket issued at GET /app/ws-ticket
// (which IS header-checked by ui-server.ts).

import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { DaemonHandle } from "./daemon-manager.ts";
import {
  WS_CLOSE_BACKPRESSURE_OVERFLOW,
  WS_CLOSE_DAEMON_DISCONNECTED,
  type WsTicket,
} from "../shared/app-contract.ts";

const DAEMON_WS_PATH = "/api/control-plane/ws";
const TICKET_TTL_MS = 30_000;
/** Outstanding-ticket cap: unredeemed tickets past this evict oldest-first. */
const MAX_PENDING_TICKETS = 64;
/**
 * Backpressure cap per direction. When either peer stops draining past this,
 * we close both sockets instead of buffering unboundedly; the UI reconnects
 * fresh (snapshot → subscribe) rather than trusting a gappy stream.
 */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

interface BridgeConnection {
  daemonWs: WebSocket;
  /** Webview frames queued while the daemon socket is still CONNECTING. */
  pending: (string | Uint8Array)[];
  pendingBytes: number;
  webviewClosed: boolean;
}

export interface BridgeSocketData {
  /** Assigned in open(); absent only between upgrade and open. */
  conn?: BridgeConnection;
}

export interface WsBridge {
  issueTicket(): WsTicket;
  /** Returns undefined when the socket was upgraded, else an error response. */
  handleUpgrade(req: Request, url: URL, server: Server<BridgeSocketData>): Response | undefined;
  websocket: WebSocketHandler<BridgeSocketData>;
}

function frameByteLength(frame: string | Uint8Array): number {
  return typeof frame === "string" ? Buffer.byteLength(frame) : frame.byteLength;
}

/**
 * True for any {type:"auth"} frame the webview might send — in either text or
 * binary encoding. The Bun side owns auth (open() sends it exactly once), so the
 * webview must never be able to (re-)auth or de-auth the bridged connection. We
 * decode and JSON-parse rather than substring-match: a substring pre-filter is
 * defeated by a unicode-escaped payload (`{"type":"auth"}` contains no
 * literal `"auth"` yet parses to {type:"auth"}) and by a binary-framed payload
 * (which is never a string). Frames larger than the scan cap cannot be a real
 * auth frame (which is a few dozen bytes) and are passed through unparsed to
 * keep the hot path cheap.
 */
const MAX_AUTH_SCAN_BYTES = 1 << 20; // 1 MiB — an auth frame is tiny; this only bounds parse cost.
function isAuthFrame(frame: string | Uint8Array): boolean {
  if (frameByteLength(frame) > MAX_AUTH_SCAN_BYTES) return false;
  const text = typeof frame === "string" ? frame : new TextDecoder().decode(frame);
  try {
    const parsed = JSON.parse(text) as { type?: unknown };
    return parsed !== null && typeof parsed === "object" && parsed.type === "auth";
  } catch {
    return false;
  }
}

export function createWsBridge(daemon: DaemonHandle): WsBridge {
  // ticket -> expiry epoch ms; Map iteration order = issue order (for eviction).
  const tickets = new Map<string, number>();

  function pruneTickets(now: number): void {
    for (const [ticket, expiresAt] of tickets) {
      if (expiresAt <= now) tickets.delete(ticket);
    }
    while (tickets.size >= MAX_PENDING_TICKETS) {
      const oldest = tickets.keys().next().value;
      if (oldest === undefined) break;
      tickets.delete(oldest);
    }
  }

  function issueTicket(): WsTicket {
    const now = Date.now();
    pruneTickets(now);
    const ticket = crypto.randomUUID();
    tickets.set(ticket, now + TICKET_TTL_MS);
    return { ticket, expiresInMs: TICKET_TTL_MS };
  }

  /** Non-consuming validity check, so a 503 (daemon not ready) doesn't burn the
   *  one-time ticket and force the UI to re-fetch. */
  function ticketValid(ticket: string | null): boolean {
    if (ticket === null || ticket === "") return false;
    const expiresAt = tickets.get(ticket);
    return expiresAt !== undefined && expiresAt > Date.now();
  }

  function redeemTicket(ticket: string | null): boolean {
    if (ticket === null || ticket === "") return false;
    const expiresAt = tickets.get(ticket);
    tickets.delete(ticket); // single-use whether or not it validates
    return expiresAt !== undefined && expiresAt > Date.now();
  }

  function closeBoth(ws: ServerWebSocket<BridgeSocketData>, conn: BridgeConnection, code: number, reason: string): void {
    conn.webviewClosed = true;
    conn.pending = [];
    conn.pendingBytes = 0;
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    if (conn.daemonWs.readyState === WebSocket.OPEN || conn.daemonWs.readyState === WebSocket.CONNECTING) {
      conn.daemonWs.close();
    }
  }

  const websocket: WebSocketHandler<BridgeSocketData> = {
    // The daemon multiplexes many event domains over one socket; keep the
    // webview side open indefinitely (the UI sends {type:"ping"} keepalives).
    idleTimeout: 0,

    open(ws) {
      const target = new URL(DAEMON_WS_PATH, daemon.info.baseUrl);
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      // Daemons ≥ operator contract 1.6 authenticate the UPGRADE itself
      // (401 before the 101 without a Bearer header). Bun's WebSocket client
      // accepts handshake headers (a Bun extension the lib.dom constructor
      // type doesn't know about); the post-open auth frame below still
      // covers older daemons that only check the frame.
      const BunWebSocket = WebSocket as unknown as new (
        url: string,
        options: { headers: Record<string, string> },
      ) => WebSocket;
      const daemonWs = new BunWebSocket(target.toString(), {
        headers: { authorization: `Bearer ${daemon.token}` },
      });
      const conn: BridgeConnection = { daemonWs, pending: [], pendingBytes: 0, webviewClosed: false };
      ws.data.conn = conn;

      daemonWs.addEventListener("open", () => {
        if (conn.webviewClosed) {
          daemonWs.close();
          return;
        }
        // Auth first, always bun-side; empty domains — the UI subscribes itself.
        daemonWs.send(JSON.stringify({ type: "auth", token: daemon.token, domains: [] }));
        for (const frame of conn.pending) daemonWs.send(frame);
        conn.pending = [];
        conn.pendingBytes = 0;
      });

      daemonWs.addEventListener("message", (event: MessageEvent) => {
        if (conn.webviewClosed) return;
        const data = event.data as string | Uint8Array;
        ws.send(data);
        if (ws.getBufferedAmount() > MAX_BUFFERED_BYTES) {
          closeBoth(ws, conn, WS_CLOSE_BACKPRESSURE_OVERFLOW, "webview not draining daemon events");
        }
      });

      daemonWs.addEventListener("close", () => {
        if (!conn.webviewClosed) {
          closeBoth(ws, conn, WS_CLOSE_DAEMON_DISCONNECTED, "daemon websocket disconnected");
        }
      });
      // Bun fires close after error, but guard against error-only teardown.
      daemonWs.addEventListener("error", () => {
        if (!conn.webviewClosed) {
          closeBoth(ws, conn, WS_CLOSE_DAEMON_DISCONNECTED, "daemon websocket errored");
        }
      });
    },

    message(ws, message) {
      const conn = ws.data.conn;
      if (!conn) return;
      const frame: string | Uint8Array = typeof message === "string" ? message : new Uint8Array(message);
      // The webview must not be able to re-auth/de-auth the bridged connection.
      if (isAuthFrame(frame)) return;

      const state = conn.daemonWs.readyState;
      if (state === WebSocket.OPEN) {
        conn.daemonWs.send(frame);
        if (conn.daemonWs.bufferedAmount > MAX_BUFFERED_BYTES) {
          closeBoth(ws, conn, WS_CLOSE_BACKPRESSURE_OVERFLOW, "daemon not draining calls");
        }
        return;
      }
      if (state === WebSocket.CONNECTING) {
        conn.pendingBytes += frameByteLength(frame);
        if (conn.pendingBytes > MAX_BUFFERED_BYTES) {
          closeBoth(ws, conn, WS_CLOSE_BACKPRESSURE_OVERFLOW, "daemon connect backlog overflow");
          return;
        }
        conn.pending.push(frame);
        return;
      }
      // CLOSING/CLOSED: the daemon-side close handler races us — make sure the
      // webview learns either way.
      closeBoth(ws, conn, WS_CLOSE_DAEMON_DISCONNECTED, "daemon websocket disconnected");
    },

    close(ws) {
      const conn = ws.data.conn;
      if (!conn) return;
      conn.webviewClosed = true;
      conn.pending = [];
      conn.pendingBytes = 0;
      if (conn.daemonWs.readyState === WebSocket.OPEN || conn.daemonWs.readyState === WebSocket.CONNECTING) {
        conn.daemonWs.close();
      }
    },
  };

  function handleUpgrade(req: Request, url: URL, server: Server<BridgeSocketData>): Response | undefined {
    const ticket = url.searchParams.get("ticket");
    // Validate first WITHOUT consuming: if the daemon is still connecting we
    // return 503 with the ticket intact so the UI can retry the same ticket
    // instead of round-tripping to /app/ws-ticket again.
    if (!ticketValid(ticket)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (daemon.token === "") {
      return Response.json(
        { error: "Daemon connection still being established", code: "APP_WS_CONNECTING" },
        { status: 503, headers: { "retry-after": "1" } },
      );
    }
    // Ready: now consume the ticket (single-use) and upgrade.
    if (!redeemTicket(ticket)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (server.upgrade(req, { data: {} })) return undefined;
    return new Response("WebSocket upgrade required", { status: 426 });
  }

  return { issueTicket, handleUpgrade, websocket };
}
