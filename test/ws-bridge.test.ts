// Live smoke test for the /app/ws bridge: a fake daemon WS endpoint on one
// side, a plain WebSocket client (standing in for the webview) on the other.
// Verifies the ticket gate, bun-side auth injection, verbatim piping, the
// client-auth-frame drop, and the distinguishable daemon-disconnect close code.

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWsBridge } from "../src/bun/ws-bridge.ts";
import { startUiServer } from "../src/bun/ui-server.ts";
import type { DaemonHandle } from "../src/bun/daemon-manager.ts";
import {
  APP_HEADER,
  APP_HEADER_VALUE,
  WS_BRIDGE_PATH,
  WS_TICKET_PATH,
  WS_CLOSE_DAEMON_DISCONNECTED,
  type WsTicket,
} from "../src/shared/app-contract.ts";

const TEST_TOKEN = "test-daemon-token";

interface FakeDaemon {
  url: string;
  received: string[];
  /** Resolves each time a frame arrives (rearmed per await). */
  nextFrame: () => Promise<string>;
  send: (frame: string) => void;
  closeClient: () => void;
  stop: () => void;
}

function startFakeDaemon(): FakeDaemon {
  const received: string[] = [];
  const waiters: ((frame: string) => void)[] = [];
  let live: Bun.ServerWebSocket<undefined> | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    websocket: {
      open(ws) {
        live = ws;
      },
      message(_ws, message) {
        const frame = typeof message === "string" ? message : message.toString();
        received.push(frame);
        waiters.shift()?.(frame);
      },
      close() {
        live = null;
      },
    },
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/api/control-plane/ws" && srv.upgrade(req)) return undefined;
      return new Response("Not found", { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    received,
    nextFrame: () =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for daemon-side frame")), 3000);
        waiters.push((frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
      }),
    send: (frame) => live?.send(frame),
    closeClient: () => live?.close(),
    stop: () => void server.stop(true),
  };
}

function startAppServer(daemonBaseUrl: string) {
  const daemon: DaemonHandle = {
    info: { mode: "external", baseUrl: daemonBaseUrl },
    token: TEST_TOKEN,
  };
  const wsBridge = createWsBridge(daemon);
  return startUiServer({
    assetsDir: mkdtempSync(join(tmpdir(), "gv-app-test-")),
    daemon,
    appVersion: "0.0.0-test",
    wsBridge,
  });
}

async function fetchTicket(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}${WS_TICKET_PATH}`, {
    headers: { [APP_HEADER]: APP_HEADER_VALUE },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as WsTicket;
  expect(body.expiresInMs).toBeGreaterThan(0);
  return body.ticket;
}

function connect(baseUrl: string, ticket: string): WebSocket {
  return new WebSocket(`${baseUrl.replace("http://", "ws://")}${WS_BRIDGE_PATH}?ticket=${ticket}`);
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("websocket failed to open")));
  });
}

function closed(ws: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => ws.addEventListener("close", (ev) => resolve(ev as CloseEvent)));
}

describe("ws bridge", () => {
  test("ticket flow, auth injection, verbatim piping, auth-frame drop, daemon-close code", async () => {
    const daemon = startFakeDaemon();
    const app = startAppServer(daemon.url);
    try {
      // Ticket endpoint is header-gated like every other /app route.
      const bare = await fetch(`${app.url}${WS_TICKET_PATH}`);
      expect(bare.status).toBe(403);

      const ticket = await fetchTicket(app.url);
      const ws = connect(app.url, ticket);
      await opened(ws);

      // Bun side authenticates first, with the daemon token the webview never saw.
      const authFrame = JSON.parse(await daemon.nextFrame()) as { type: string; token: string };
      expect(authFrame.type).toBe("auth");
      expect(authFrame.token).toBe(TEST_TOKEN);

      // Client frames pipe through verbatim (auth already sent, order preserved).
      ws.send(JSON.stringify({ type: "subscribe", domains: ["tasks"] }));
      expect(JSON.parse(await daemon.nextFrame())).toEqual({ type: "subscribe", domains: ["tasks"] });

      // Client-sent auth frames are dropped, not forwarded.
      ws.send(JSON.stringify({ type: "auth", token: "spoofed" }));
      ws.send(JSON.stringify({ type: "ping" }));
      expect(JSON.parse(await daemon.nextFrame())).toEqual({ type: "ping" });
      expect(daemon.received.some((f) => f.includes("spoofed"))).toBe(false);

      // Daemon frames pipe back verbatim.
      const gotEvent = new Promise<string>((resolve) =>
        ws.addEventListener("message", (ev) => resolve(String((ev as MessageEvent).data)), { once: true }),
      );
      daemon.send(JSON.stringify({ type: "event", event: "task-update", payload: { id: 1 } }));
      expect(JSON.parse(await gotEvent)).toEqual({ type: "event", event: "task-update", payload: { id: 1 } });

      // Daemon disconnect surfaces as the distinguishable close code.
      const closeEvent = closed(ws);
      daemon.closeClient();
      expect((await closeEvent).code).toBe(WS_CLOSE_DAEMON_DISCONNECTED);
    } finally {
      app.stop();
      daemon.stop();
    }
  });

  test("tickets are single-use and required", async () => {
    const daemon = startFakeDaemon();
    const app = startAppServer(daemon.url);
    try {
      const noTicket = connect(app.url, "");
      await expect(opened(noTicket)).rejects.toThrow();

      const ticket = await fetchTicket(app.url);
      const first = connect(app.url, ticket);
      await opened(first);
      // Drain the bridge's auth frame so the fake daemon state is clean.
      await daemon.nextFrame();

      const reused = connect(app.url, ticket);
      await expect(opened(reused)).rejects.toThrow();
      first.close();
    } finally {
      app.stop();
      daemon.stop();
    }
  });
});
