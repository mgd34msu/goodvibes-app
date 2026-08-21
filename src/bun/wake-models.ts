// /app/wake, same-origin serving of the pinned wake-word model bytes for a
// LOCAL daemon (docs/ARCHITECTURE.md wake-word port: ruled design). The Bun
// process runs on the same machine as a local daemon, so once
// voice.wake.status has content-verified an artifact this process reads it
// straight off disk and hands it to the webview, rather than asking the
// daemon to re-encode 2-4 MB of it as base64 chunks (voice.wake.model.get).
//
// A daemon that is NOT this machine (voice.wake.surfaces.app pointed at a
// shared daemon over the network, see src/bun/daemon-manager.ts's
// controlPlane.host) has its files on a filesystem this process cannot read.
// That case refuses honestly (409 APP_WAKE_MODEL_REMOTE_DAEMON) instead of
// pretending; src/ui/lib/wake/wake-models.ts falls back to
// voice.wake.model.get, the chunked daemon verb, exactly the way
// goodvibes-webui's tab has always fetched these bytes.
//
// GET  /app/wake/model/:component  component ∈ classifier | embedding | vad
// HEAD /app/wake/model/:component  same headers, no body, a cheap way for
//                                   the UI-side cache (src/ui/lib/wake/
//                                   wake-models.ts) to learn the current
//                                   sha256 before deciding whether a cached
//                                   copy is still current, without
//                                   re-downloading 2-4 MB it may already have.
//
// verified:true from voice.wake.status is not trusted blindly: this route
// re-reads the file fresh for every request (a status read and a file read
// are two separate moments) and refuses to serve a file whose size no longer
// matches what the daemon just reported, rather than a size it never
// verified. The sha256 of the bytes actually sent is computed here and
// carried in a response header so the tab verifies the SAME bytes it
// received, not merely trusts that this hop did. HEAD pays the same disk
// read and hash to answer that header honestly, it never reports a digest it
// has not just computed.

import { createHash } from "node:crypto";
import type { AppRouteHandler, AppServices } from "./app-routes.ts";
import { isLocalDaemonUrl } from "./daemon-manager.ts";

const WAKE_COMPONENTS = ["classifier", "embedding", "vad"] as const;
type WakeComponent = (typeof WAKE_COMPONENTS)[number];

function isWakeComponent(value: string): value is WakeComponent {
  return (WAKE_COMPONENTS as readonly string[]).includes(value);
}

interface WakeArtifactStatus {
  readonly path: string;
  readonly verified: boolean;
  readonly corrupt: boolean;
  readonly bytes: number;
}

interface WakeProvisionStatus {
  readonly classifier: WakeArtifactStatus;
  readonly embedding: WakeArtifactStatus;
  readonly vad: WakeArtifactStatus;
  readonly modelVersion: string | null;
}

function isArtifactStatus(value: unknown): value is WakeArtifactStatus {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r["path"] === "string" && typeof r["verified"] === "boolean"
    && typeof r["corrupt"] === "boolean" && typeof r["bytes"] === "number";
}

/**
 * Error responses carry their `code` in a header too
 * (`x-goodvibes-wake-error-code`), not only the JSON body: a HEAD request has
 * no body on the wire, and src/ui/lib/wake/wake-models.ts's HEAD probe (the
 * cache-freshness check) needs to distinguish APP_WAKE_MODEL_REMOTE_DAEMON
 * from every other failure without one.
 */
function json(body: { code: string; error: string; detail?: string }, status = 200, isHead = false): Response {
  return new Response(isHead ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-goodvibes-wake-error-code": body.code,
    },
  });
}

/** GET /api/voice/wake/status, direct (bearer-token) fetch, same call shape
 * as src/bun/pairing.ts and src/bun/ui-server.ts's own daemon proxy, no
 * operator client is instantiated Bun-side for this one read. */
async function fetchWakeStatus(services: AppServices): Promise<WakeProvisionStatus> {
  const { daemon } = services;
  const target = new URL("/api/voice/wake/status", daemon.info.baseUrl);
  const res = await fetch(target, { headers: { authorization: `Bearer ${daemon.token}` } });
  if (!res.ok) throw new Error(`voice.wake.status answered HTTP ${res.status}`);
  return (await res.json()) as WakeProvisionStatus;
}

export function createWakeModelRoutes(services: AppServices): AppRouteHandler {
  return async (req, url) => {
    const isHead = req.method === "HEAD";
    if (req.method !== "GET" && !isHead) return new Response("Method not allowed", { status: 405 });
    // Every early-exit below reuses this so a HEAD probe (the UI's
    // cache-freshness check) gets the same status + error-code header a GET
    // would, with no JSON body on the wire.
    const respond = (body: { code: string; error: string; detail?: string }, status: number) => json(body, status, isHead);

    const sub = url.pathname.slice("/app/wake".length); // "/model/classifier"
    const match = /^\/model\/([a-z-]+)$/.exec(sub);
    if (!match || !match[1]) return respond({ error: "Not found", code: "APP_WAKE_NOT_FOUND" }, 404);
    const component = match[1];
    if (!isWakeComponent(component)) {
      return respond(
        { error: `Unknown wake component "${component}".`, code: "APP_WAKE_MODEL_UNKNOWN_COMPONENT" },
        400,
      );
    }

    const { daemon } = services;
    if (!daemon.token || !daemon.info.baseUrl) {
      return respond(
        { error: "Daemon connection still being established", code: "APP_PROXY_CONNECTING" },
        503,
      );
    }

    if (!isLocalDaemonUrl(daemon.info.baseUrl)) {
      return respond(
        {
          error: `Same-origin wake-model serving needs a daemon on this machine; the connected daemon is remote `
            + `at ${daemon.info.baseUrl}. Use voice.wake.model.get instead.`,
          code: "APP_WAKE_MODEL_REMOTE_DAEMON",
        },
        409,
      );
    }

    let status: WakeProvisionStatus;
    try {
      status = await fetchWakeStatus(services);
    } catch (err) {
      return respond(
        {
          error: "Could not read voice.wake.status from the daemon.",
          code: "APP_WAKE_MODEL_STATUS_FAILED",
          detail: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }

    const artifact = status[component];
    if (!isArtifactStatus(artifact) || !artifact.verified || artifact.corrupt) {
      return respond(
        {
          error: `The ${component} wake-word artifact is not provisioned or failed content verification on this `
            + "daemon. Run voice.wake.provision.",
          code: "APP_WAKE_MODEL_UNAVAILABLE",
        },
        404,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await Bun.file(artifact.path).arrayBuffer());
    } catch (err) {
      return respond(
        {
          error: `Could not read the ${component} model file.`,
          code: "APP_WAKE_MODEL_READ_FAILED",
          detail: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }

    if (bytes.length !== artifact.bytes) {
      // The file changed on disk between the status read above and this read.
      // Refuse rather than serve a size the daemon never verified.
      return respond(
        {
          error: `The ${component} model changed on disk while it was being read; try again.`,
          code: "APP_WAKE_MODEL_CHANGED",
        },
        409,
      );
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const headers = {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.length),
      "cache-control": "no-store",
      "x-goodvibes-wake-sha256": sha256,
      "x-goodvibes-wake-model-version": status.modelVersion ?? "",
    };
    // bun-types' BodyInit wants Uint8Array<ArrayBuffer> specifically; the
    // ArrayBufferLike a fresh Uint8Array(await blob.arrayBuffer()) carries is
    // a real ArrayBuffer at runtime, this is TS's generic strictness, not an
    // actual body-type mismatch.
    return new Response(isHead ? null : (bytes as BodyInit), { headers });
  };
}
