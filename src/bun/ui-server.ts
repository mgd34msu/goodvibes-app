// Loopback HTTP server: serves the bundled UI and reverse-proxies daemon routes
// with the bearer token injected server-side. The token never reaches the webview.
// docs/ARCHITECTURE.md §2.

import { join } from "node:path";
import { existsSync } from "node:fs";
import type { DaemonHandle } from "./daemon-manager.ts";
import { APP_HEADER, APP_HEADER_VALUE, type AppHealth } from "../shared/app-contract.ts";

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
  /** Extra same-origin route handlers (app-local services register here). */
  appRoutes?: Record<string, (req: Request, url: URL) => Response | Promise<Response>>;
}

export interface UiServerHandle {
  url: string;
  stop: () => void;
  server: ReturnType<typeof Bun.serve>;
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
  });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0, // SSE streams stay open indefinitely
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname.startsWith("/app/") || isProxied(pathname)) {
        // Defense in depth: only our webview bootstrap stamps this header.
        if (req.headers.get(APP_HEADER) !== APP_HEADER_VALUE) {
          return new Response("Forbidden", { status: 403 });
        }
      }

      if (pathname === "/app/health") return Response.json(health());

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
