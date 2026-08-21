// wake-models.ts, how this webview gets the pinned wake-word models.
//
// NOT FROM THE INTERNET, and not from the daemon's chunked verb either, when
// this app can avoid it. goodvibes-webui's tab has no choice: it fetches a
// browser-hostile release asset through `voice.wake.model.get`, base64
// chunks over the operator API, because a tab has no other way to reach
// bytes that live on the daemon's disk.
//
// This app is different: its Bun process is often the SAME machine as the
// daemon (docs pointer: the wake-word port's ruled design). So the primary
// path here is SAME-ORIGIN: GET /app/wake/model/:component
// (src/bun/wake-models.ts), which reads the file directly and returns the
// whole thing in one response with its sha256 in a header, no base64, no
// chunking loop. Only when that route refuses with
// APP_WAKE_MODEL_REMOTE_DAEMON (the connected daemon is not this machine)
// does this module fall back to the original chunked `voice.wake.model.get`
// path, ported from goodvibes-webui's loadWakeModel, so a shared/remote
// daemon still works, just without the same-origin shortcut.
//
// SO THE CHECKSUM IS VERIFIED HERE EITHER WAY, on the assembled bytes,
// before a session is created from them. Trusting a `verified: true` flag,
// or a size header, without re-hashing the ACTUAL bytes received is exactly
// the kind of silent failure this whole subsystem is built to refuse: a
// dropped byte, a truncated same-origin body, a swapped file mid-read, none
// of them produce an HTTP error, they produce a model that loads and then
// never detects anything, which is indistinguishable from a microphone that
// is not working.
//
// Verified bytes are cached in the Cache API under a key that carries the
// model version AND the sha256, so a reload does not re-fetch multiple MB
// and a pin change cannot be served a stale hit, a different pin is a
// different key.

import { appFetch } from "../http.ts";

export type WakeModelComponent = "classifier" | "embedding" | "vad";

/** Why a component could not be loaded, as a named state rather than a message. */
export type WakeModelFailure =
  /** The assembled bytes did not match the pin the server stated for them. */
  | "checksum-mismatch"
  /** The chunked (fallback) read did not progress, or answered inconsistent totals. */
  | "truncated-download"
  /** The daemon or the same-origin route refused or failed the read. */
  | "read-failed";

export class WakeModelError extends Error {
  readonly failure: WakeModelFailure;
  readonly component: WakeModelComponent;
  constructor(failure: WakeModelFailure, component: WakeModelComponent, message: string) {
    super(message);
    this.name = "WakeModelError";
    this.failure = failure;
    this.component = component;
  }
}

/** A verified component, ready to become an inference session. */
export interface LoadedWakeModel {
  readonly component: WakeModelComponent;
  readonly bytes: Uint8Array;
  /** The digest the bytes were verified against, lower-case hex. */
  readonly sha256: string;
  /** True when the bytes came from this webview's cache rather than a fetch. */
  readonly fromCache: boolean;
}

/** One bounded chunk of a component, exactly as `voice.wake.model.get` answers
 * (the chunked fallback path only). */
export interface WakeModelChunk {
  readonly component: WakeModelComponent;
  readonly offset: number;
  readonly bytes: number;
  readonly totalBytes: number;
  readonly sha256: string;
  readonly dataBase64: string;
  readonly complete: boolean;
}

/** Reads one chunk via the daemon verb. Only used for the remote-daemon fallback. */
export type WakeModelChunkReader = (input: { component: WakeModelComponent; offset: number }) => Promise<WakeModelChunk>;

/** SHA-256 of some bytes, lower-case hex. Injected so a test needs no WebCrypto. */
export type WakeModelDigest = (bytes: Uint8Array) => Promise<string>;

/** The subset of the Cache API this module uses. */
export interface WakeModelCache {
  match(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | undefined>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

/** The same-origin fetcher's shape, narrower than `typeof fetch` (path is
 * always a string here), matching `appFetch` (lib/http.ts) exactly. */
export type WakeSameOriginFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface WakeModelLoaderDeps {
  /** Same-origin fetcher, injected so a test never touches a real network stack.
   * Defaults to `appFetch` (lib/http.ts), which stamps the app header the
   * /app/* routes require. */
  readonly fetchSameOrigin?: WakeSameOriginFetch | undefined;
  /** Chunked daemon-verb reader, the remote-daemon fallback. */
  readonly readChunk: WakeModelChunkReader;
  /** `voice.wake.status().modelVersion`, part of the chunked fallback's cache
   * key. Only consulted when the same-origin route reports a remote daemon;
   * the same-origin path reads its own version from a response header. */
  readonly modelVersion?: (() => Promise<string | null>) | undefined;
  readonly digest?: WakeModelDigest | undefined;
  readonly cache?: WakeModelCache | undefined;
  readonly warn?: ((message: string, meta?: Readonly<Record<string, unknown>>) => void) | undefined;
}

/** Cap on chunk iterations, so a daemon that never sets `complete` cannot spin. */
const MAX_CHUNKS = 256;

/** Bump when the stored representation changes, never for a new model version. */
const CACHE_NAME = "goodvibes-wake-models-v1";

const SAME_ORIGIN_HEADER_SHA256 = "x-goodvibes-wake-sha256";
const SAME_ORIGIN_HEADER_VERSION = "x-goodvibes-wake-model-version";
const SAME_ORIGIN_HEADER_ERROR_CODE = "x-goodvibes-wake-error-code";

/** The code the Bun route answers when the connected daemon is not this machine. */
export const WAKE_MODEL_REMOTE_DAEMON_CODE = "APP_WAKE_MODEL_REMOTE_DAEMON";

export function wakeModelCacheKey(
  component: WakeModelComponent,
  modelVersion: string | null | undefined,
  sha256: string,
): string {
  // A synthetic same-origin URL: the Cache API keys on request URLs, and
  // these are never fetched, the version and the digest are both in the
  // path so a pin change is a different entry rather than a stale hit.
  return `/__goodvibes-wake-model/${modelVersion ?? "unversioned"}/${component}/${sha256}`;
}

/** Lower-case hex of a digest computed with WebCrypto. */
export async function webCryptoDigest(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as {
    crypto?: { subtle?: { digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer> } };
  }).crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is unavailable, so model bytes cannot be verified.");
  // A fresh copy: subtle.digest takes a BufferSource and a subarray view of a
  // larger buffer would hash the wrong span.
  const digest = await subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Decode base64 without Buffer (this runs in a webview). */
export function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  const maybeBuffer = (globalThis as {
    Buffer?: { from(data: string, encoding: string): Uint8Array };
  }).Buffer;
  if (maybeBuffer) return maybeBuffer.from(value, "base64");
  throw new Error("No base64 decoder is available in this environment.");
}

/** This webview's Cache API, or undefined where it is not available (or blocked). */
export async function openWakeModelCache(): Promise<WakeModelCache | undefined> {
  const caches = (globalThis as { caches?: { open(name: string): Promise<CacheLike> } }).caches;
  if (!caches) return undefined;
  try {
    const cache = await caches.open(CACHE_NAME);
    return {
      match: async (key) => await cache.match(key),
      put: async (key, bytes) => {
        // A copy, because `put` may hold the buffer past this call.
        await cache.put(key, new Response(bytes.slice(), { headers: { "content-type": "application/octet-stream" } }));
      },
    };
  } catch {
    return undefined;
  }
}

interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

/**
 * Try the same-origin route (src/bun/wake-models.ts). Returns null (never
 * throws) when the daemon is not local, the ONE case this loader falls back
 * for; any other failure is a real {@link WakeModelError}.
 */
async function loadWakeModelSameOrigin(
  component: WakeModelComponent,
  deps: Required<Pick<WakeModelLoaderDeps, "fetchSameOrigin">> & Pick<WakeModelLoaderDeps, "digest" | "cache" | "warn">,
): Promise<LoadedWakeModel | null> {
  const digest = deps.digest ?? webCryptoDigest;
  const url = `/app/wake/model/${component}`;

  const head = await deps.fetchSameOrigin(url, { method: "HEAD" }).catch((error: unknown) => {
    throw new WakeModelError(
      "read-failed",
      component,
      `The same-origin wake-model route did not answer: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  if (!head.ok) {
    // The error code travels in a header (not the JSON body): a HEAD
    // response carries no body on the wire, so the body is never read here.
    if (head.status === 409 && head.headers.get(SAME_ORIGIN_HEADER_ERROR_CODE) === WAKE_MODEL_REMOTE_DAEMON_CODE) {
      return null;
    }
    throw new WakeModelError(
      "read-failed",
      component,
      `The ${component} model could not be read: HTTP ${head.status} `
      + `(${head.headers.get(SAME_ORIGIN_HEADER_ERROR_CODE) ?? "no error code"}).`,
    );
  }

  const pinnedSha256 = head.headers.get(SAME_ORIGIN_HEADER_SHA256) ?? "";
  const modelVersion = head.headers.get(SAME_ORIGIN_HEADER_VERSION) || null;
  if (!pinnedSha256) {
    throw new WakeModelError("read-failed", component, `The ${component} model route answered without a checksum header.`);
  }

  const cacheKey = wakeModelCacheKey(component, modelVersion, pinnedSha256);
  if (deps.cache) {
    try {
      const hit = await deps.cache.match(cacheKey);
      if (hit) {
        const cached = new Uint8Array(await hit.arrayBuffer());
        // Re-verified on read, not trusted for having been written once: a
        // cache is storage like any other and a torn entry must not become a
        // model that loads and never fires.
        const cachedDigest = await digest(cached);
        if (cachedDigest === pinnedSha256) {
          return { component, bytes: cached, sha256: pinnedSha256, fromCache: true };
        }
        deps.warn?.("cached wake model failed verification and was ignored", { component, cacheKey });
      }
    } catch (error) {
      deps.warn?.("wake model cache read failed", { component, error: String(error) });
    }
  }

  const res = await deps.fetchSameOrigin(url, { method: "GET" }).catch((error: unknown) => {
    throw new WakeModelError(
      "read-failed",
      component,
      `The ${component} model could not be fetched: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (!res.ok) {
    throw new WakeModelError("read-failed", component, `The ${component} model fetch answered HTTP ${res.status}.`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const receivedSha256 = res.headers.get(SAME_ORIGIN_HEADER_SHA256) ?? pinnedSha256;
  const actual = await digest(bytes);
  if (actual !== receivedSha256) {
    throw new WakeModelError(
      "checksum-mismatch",
      component,
      `The ${component} model failed verification: the route stated sha256 ${receivedSha256}, the bytes received `
      + `hash to ${actual}. No session was created from it.`,
    );
  }

  if (deps.cache) {
    try {
      await deps.cache.put(cacheKey, bytes);
    } catch (error) {
      deps.warn?.("wake model cache write failed", { component, error: String(error) });
    }
  }

  return { component, bytes, sha256: actual, fromCache: false };
}

/**
 * Download one component in chunks over the daemon verb, and verify it
 * against the pinned sha256 the daemon returned. Ported from
 * goodvibes-webui's loadWakeModel; unchanged except for its name, this is
 * the remote-daemon fallback so the same-origin route stays the primary
 * path above.
 */
async function loadWakeModelChunked(
  component: WakeModelComponent,
  deps: Required<Pick<WakeModelLoaderDeps, "readChunk">> & Pick<WakeModelLoaderDeps, "digest" | "cache" | "warn" | "modelVersion">,
): Promise<LoadedWakeModel> {
  const digest = deps.digest ?? webCryptoDigest;

  let first: WakeModelChunk;
  try {
    first = await deps.readChunk({ component, offset: 0 });
  } catch (error) {
    throw new WakeModelError(
      "read-failed",
      component,
      `The daemon could not read the ${component} model: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const modelVersion = deps.modelVersion ? await deps.modelVersion().catch(() => null) : null;
  const cacheKey = wakeModelCacheKey(component, modelVersion, first.sha256);
  if (deps.cache) {
    try {
      const hit = await deps.cache.match(cacheKey);
      if (hit) {
        const cached = new Uint8Array(await hit.arrayBuffer());
        const cachedDigest = await digest(cached);
        if (cachedDigest === first.sha256 && cached.length === first.totalBytes) {
          return { component, bytes: cached, sha256: first.sha256, fromCache: true };
        }
        deps.warn?.("cached wake model failed verification and was ignored", { component, cacheKey });
      }
    } catch (error) {
      deps.warn?.("wake model cache read failed", { component, error: String(error) });
    }
  }

  const parts: Uint8Array[] = [];
  let chunk = first;
  let received = 0;
  for (let iteration = 0; iteration < MAX_CHUNKS; iteration += 1) {
    if (chunk.offset !== received) {
      throw new WakeModelError(
        "truncated-download",
        component,
        `The ${component} model read jumped to offset ${chunk.offset} with ${received} bytes assembled.`,
      );
    }
    const bytes = base64ToBytes(chunk.dataBase64);
    parts.push(bytes);
    received += bytes.length;
    if (chunk.complete) break;
    if (bytes.length === 0) {
      throw new WakeModelError(
        "truncated-download",
        component,
        `The ${component} model read returned no bytes at offset ${chunk.offset} without completing.`,
      );
    }
    try {
      chunk = await deps.readChunk({ component, offset: received });
    } catch (error) {
      throw new WakeModelError(
        "read-failed",
        component,
        `The ${component} model read failed at offset ${received}: `
        + (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  if (!chunk.complete) {
    throw new WakeModelError(
      "truncated-download",
      component,
      `The ${component} model did not finish within ${MAX_CHUNKS} reads.`,
    );
  }
  if (chunk.totalBytes !== received) {
    throw new WakeModelError(
      "truncated-download",
      component,
      `The ${component} model assembled ${received} bytes, but the daemon reported ${chunk.totalBytes}.`,
    );
  }

  const assembled = concatBytes(parts, received);
  const actual = await digest(assembled);
  if (actual !== chunk.sha256) {
    throw new WakeModelError(
      "checksum-mismatch",
      component,
      `The ${component} model failed verification: expected sha256 ${chunk.sha256}, assembled ${actual}. `
      + "No session was created from it. A model that loads but never matches the pin would look exactly like a "
      + "microphone that is not working.",
    );
  }

  if (deps.cache) {
    try {
      await deps.cache.put(cacheKey, assembled);
    } catch (error) {
      deps.warn?.("wake model cache write failed", { component, error: String(error) });
    }
  }

  return { component, bytes: assembled, sha256: chunk.sha256, fromCache: false };
}

function concatBytes(parts: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Load and verify one pinned wake artifact: same-origin first
 * (src/bun/wake-models.ts), the chunked daemon verb when that route reports
 * the connected daemon is not this machine. Either branch throws
 * {@link WakeModelError} rather than returning a partial result.
 */
export async function loadWakeModel(component: WakeModelComponent, deps: WakeModelLoaderDeps): Promise<LoadedWakeModel> {
  const fetchSameOrigin = deps.fetchSameOrigin ?? appFetch;
  const sameOrigin = await loadWakeModelSameOrigin(component, { ...deps, fetchSameOrigin });
  if (sameOrigin) return sameOrigin;
  deps.warn?.(`wake model "${component}": same-origin route reports a remote daemon, falling back to the chunked daemon verb`, { component });
  return loadWakeModelChunked(component, deps);
}
