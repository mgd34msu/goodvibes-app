// Loopback HTTP server: serves the bundled UI and reverse-proxies daemon routes
// with the bearer token injected server-side. The token never reaches the webview.
// docs/ARCHITECTURE.md §2.

import { join } from "node:path";
import { existsSync } from "node:fs";
import type { DaemonHandle } from "./daemon-manager.ts";
import type { WsBridge, BridgeSocketData } from "./ws-bridge.ts";
import {
  APP_HEADER,
  APP_HEADER_VALUE,
  WS_BRIDGE_PATH,
  WS_TICKET_PATH,
  type AppHealth,
} from "../shared/app-contract.ts";

/** Route prefixes forwarded verbatim to the daemon (see daemon route catalog). */
const PROXY_PREFIXES = ["/api/", "/login", "/status", "/task", "/config", "/webhook/"];

/** Hop-by-hop / recomputed headers we must not forward back to the webview. */
const STRIP_RESPONSE_HEADERS = ["content-length", "content-encoding", "transfer-encoding", "connection"];

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export interface UiServerOptions {
  assetsDir: string;
  daemon: DaemonHandle;
  appVersion: string;
  /** WebSocket bridge to the daemon control-plane socket (src/bun/ws-bridge.ts). */
  wsBridge: WsBridge;
  /** Extra same-origin route handlers (app-local services register here). */
  appRoutes?: Record<string, (req: Request, url: URL) => Response | Promise<Response>>;
  /** Reported in /app/health so the UI knows to start its dev-driver module. */
  devDriver?: boolean;
}

export interface UiServerHandle {
  url: string;
  stop: () => void;
  server: Bun.Server<BridgeSocketData>;
}

function isProxied(pathname: string): boolean {
  return PROXY_PREFIXES.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`)));
}

async function proxyToDaemon(req: Request, url: URL, daemon: DaemonHandle): Promise<Response> {
  if (daemon.token === "") {
    return Response.json(
      { error: "Daemon connection still being established", code: "APP_PROXY_CONNECTING" },
      { status: 503, headers: { "retry-after": "1" } },
    );
  }
  const target = new URL(url.pathname + url.search, daemon.info.baseUrl);
  const headers = new Headers(req.headers);
  headers.set("authorization", `Bearer ${daemon.token}`);
  headers.delete("host");
  headers.delete(APP_HEADER);

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.body,
      // SSE and long polls must not be buffered or timed out here.
      signal: req.signal,
      redirect: "manual",
    });
    const outHeaders = new Headers(upstream.headers);
    for (const h of STRIP_RESPONSE_HEADERS) outHeaders.delete(h);
    // WebKitGTK aborts fetch streams that stay byte-silent for ~12s, and the
    // daemon's quiet SSE domains can idle far longer. Inject SSE comment
    // heartbeats (ignored by every spec-compliant parser) to keep the webview's
    // network stack from reaping live-but-quiet streams.
    const isSse = (outHeaders.get("content-type") ?? "").includes("text/event-stream");
    if (isSse && upstream.body) {
      return new Response(withSseHeartbeat(upstream.body), {
        status: upstream.status,
        headers: outHeaders,
      });
    }
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  } catch (err) {
    return Response.json(
      {
        error: "Daemon unreachable through app proxy",
        code: "APP_PROXY_DAEMON_UNREACHABLE",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}

const SSE_HEARTBEAT_MS = 8_000;
const SSE_HEARTBEAT_CHUNK = new TextEncoder().encode(":hb\n\n");

/** Pipe an SSE body through, emitting comment heartbeats during quiet spells. */
function withSseHeartbeat(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setInterval> | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        try {
          controller.enqueue(SSE_HEARTBEAT_CHUNK);
        } catch {
          if (timer !== null) clearInterval(timer);
        }
      }, SSE_HEARTBEAT_MS);
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          if (timer !== null) clearInterval(timer);
        }
      })();
    },
    cancel(reason) {
      if (timer !== null) clearInterval(timer);
      void reader.cancel(reason);
    },
  });
}

function serveAsset(assetsDir: string, pathname: string): Response {
  const rel = pathname === "/" ? "/index.html" : pathname;
  // Normalize and refuse traversal.
  if (rel.includes("..")) return new Response("Bad request", { status: 400 });
  const filePath = join(assetsDir, rel);
  if (!existsSync(filePath)) {
    // SPA fallback: unknown paths render the shell (client routes by query string).
    const index = join(assetsDir, "index.html");
    if (existsSync(index)) {
      return new Response(Bun.file(index), { headers: { "content-type": MIME[".html"]! } });
    }
    return new Response("Not found", { status: 404 });
  }
  const ext = rel.slice(rel.lastIndexOf("."));
  const type = MIME[ext] ?? "application/octet-stream";
  return new Response(Bun.file(filePath), { headers: { "content-type": type } });
}

export function startUiServer(opts: UiServerOptions): UiServerHandle {
  const startedAt = Date.now();
  // Computed per request: daemon adoption resolves after the server starts and
  // mutates opts.daemon in place (src/bun/index.ts boot order).
  const health = (): AppHealth => ({
    app: { name: "goodvibes-app", version: opts.appVersion },
    daemon: opts.daemon.info,
    startedAt,
    devDriver: opts.devDriver === true,
  });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0, // SSE streams stay open indefinitely
    websocket: opts.wsBridge.websocket,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const { pathname } = url;

      // WebSocket handshakes cannot carry the app header; /app/ws is guarded
      // by the single-use ticket instead (issued below, header-checked).
      if (pathname === WS_BRIDGE_PATH) {
        return opts.wsBridge.handleUpgrade(req, url, srv);
      }

      if (pathname.startsWith("/app/") || isProxied(pathname)) {
        // Defense in depth: only our webview bootstrap stamps this header.
        if (req.headers.get(APP_HEADER) !== APP_HEADER_VALUE) {
          return new Response("Forbidden", { status: 403 });
        }
      }

      if (pathname === "/app/health") return Response.json(health());

      if (pathname === WS_TICKET_PATH) {
        if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
        return Response.json(opts.wsBridge.issueTicket());
      }

      if (opts.appRoutes) {
        for (const [prefix, handler] of Object.entries(opts.appRoutes)) {
          if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
            return handler(req, url);
          }
        }
      }

      if (isProxied(pathname)) return proxyToDaemon(req, url, opts.daemon);

      if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
      return serveAsset(opts.assetsDir, pathname);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
    server,
  };
}
