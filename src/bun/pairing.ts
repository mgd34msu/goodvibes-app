// Companion pairing route (Bun side). Builds the QR-encodable connection
// payload for pairing a phone/companion to the daemon this app adopted, using
// the SDK's own pairing helpers — the exact payload format the TUI/daemon
// print in their standalone connection block. platform/* subpaths are legal
// ONLY here in src/bun (docs/ARCHITECTURE.md §5); the webview receives the
// encoded payload plus a pre-rendered QR matrix so src/ui needs no QR encoder
// and no platform import.
//
// GET /app/pairing/connection →
//   { payload, url, username, surface, version, qr: { size, modules } }
//
// The payload embeds the daemon bearer token BY DESIGN — that is what pairing
// is (docs/FEATURES.md §13 "Companion pairing (QR)"). The UI treats it as a
// secret: QR-first, raw text masked behind an explicit reveal.

import {
  buildCompanionConnectionInfo,
  encodeConnectionPayload,
  generateQrMatrix,
} from "@pellux/goodvibes-sdk/platform/pairing";
import type { AppRouteHandler, AppServices } from "./app-routes.ts";

export function createPairingRoutes(services: AppServices): AppRouteHandler {
  return (req, url) => {
    if (url.pathname !== "/app/pairing/connection") {
      return Response.json({ error: "Not found", code: "APP_PAIRING_NOT_FOUND" }, { status: 404 });
    }
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { daemon } = services;
    if (!daemon.token || !daemon.info.baseUrl) {
      // Same degradation shape as the proxy while adoption is in flight.
      return Response.json(
        { error: "Daemon connection still being established", code: "APP_PAIRING_NOT_READY" },
        { status: 503, headers: { "retry-after": "1" } },
      );
    }

    try {
      const info = buildCompanionConnectionInfo({
        daemonUrl: daemon.info.baseUrl,
        token: daemon.token,
        version: daemon.info.version,
      });
      const payload = encodeConnectionPayload(info);
      const qr = generateQrMatrix(payload);
      return Response.json({
        payload,
        url: info.url,
        username: info.username,
        surface: info.surface,
        version: info.version,
        qr: { size: qr.size, modules: qr.modules },
      });
    } catch (err) {
      return Response.json(
        {
          error: "Failed to build pairing payload",
          code: "APP_PAIRING_FAILED",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
  };
}
