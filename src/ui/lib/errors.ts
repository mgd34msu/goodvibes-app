// Error taxonomy for daemon calls, ported from goodvibes-webui src/lib/errors.ts.
// Every classifier reads *shape*, never instanceof-only, so it works on
// HttpError (lib/http.ts), the proxy's JSON error bodies, and plain rejections.

import { HttpError } from "./http.ts";
import { asRecord, compactJson } from "./wire.ts";

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : "";
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Parse a raw response-body string as JSON when it looks like JSON. */
function parseBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return body;
  try {
    return JSON.parse(trimmed);
  } catch {
    return body;
  }
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (!error) return {};
  if (error instanceof HttpError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      path: error.path,
      body: parseBody(error.body),
    };
  }
  if (error instanceof Error) {
    const record = asRecord(error);
    const json = typeof record["toJSON"] === "function" ? asRecord((record["toJSON"] as () => unknown)()) : {};
    return {
      name: error.name,
      message: error.message,
      ...json,
      ...record,
      body: parseBody(record["body"] ?? json["body"]),
    };
  }
  return asRecord(error);
}

export function formatError(error: unknown): string {
  if (!error) return "";

  const serialized = serializeError(error);
  const transport = asRecord(serialized["transport"]);
  const body = serialized["body"] ?? transport["body"];
  const message =
    readString(asRecord(body), "message") ||
    readString(asRecord(body), "error") ||
    readString(serialized, "message") ||
    (typeof error === "string" ? error : "Request failed");
  const status = readNumber(serialized, "status") ?? readNumber(transport, "status");
  const category = readString(serialized, "category");
  const hint = readString(serialized, "hint");

  const details = [status ? `HTTP ${status}` : "", category && category !== "unknown" ? category : "", hint].filter(
    Boolean,
  );

  return details.length ? `${message} (${details.join(" · ")})` : message;
}

export function errorCode(error: unknown): string {
  const serialized = serializeError(error);
  const transport = asRecord(serialized["transport"]);
  const body = asRecord(serialized["body"] ?? transport["body"]);
  return (
    readString(serialized, "code") || readString(body, "code") || readString(asRecord(body["error"]), "code") || ""
  );
}

export function errorStatus(error: unknown): number | undefined {
  const serialized = serializeError(error);
  const transport = asRecord(serialized["transport"]);
  return readNumber(serialized, "status") ?? readNumber(transport, "status");
}

function messageText(error: unknown): string {
  const serialized = serializeError(error);
  const transport = asRecord(serialized["transport"]);
  const body = asRecord(serialized["body"] ?? transport["body"]);
  return [readString(serialized, "message"), readString(body, "message"), readString(body, "error")]
    .join(" ")
    .toLowerCase();
}

export function isSessionNotFoundError(error: unknown): boolean {
  if (errorCode(error) === "SESSION_NOT_FOUND") return true;
  return messageText(error).includes("session not found");
}

/** The daemon's 409 SESSION_CLOSED rejection (steer/followUp on a closed session). */
export function isSessionClosedError(error: unknown): boolean {
  if (errorCode(error) === "SESSION_CLOSED") return true;
  const text = messageText(error);
  return text.includes("session is closed") || text.includes("session closed");
}

/** The daemon's 409 SESSION_ACTIVE rejection (delete requires close-first). */
export function isSessionActiveError(error: unknown): boolean {
  if (errorCode(error) === "SESSION_ACTIVE") return true;
  return messageText(error).includes("session is active");
}

/**
 * True when a gateway method id is not registered on the connected daemon at
 * all — the honest "capability not available on this daemon" signal, distinct
 * from a normal 404 on a known resource (e.g. SESSION_NOT_FOUND,
 * MEMORY_RECORD_NOT_FOUND, REMOTE_PEER_NOT_FOUND — all resource-specific
 * codes, never this generic pair). Two shapes both mean "no such capability
 * on this daemon build", both code-first:
 *   - METHOD_NOT_FOUND — the gateway dispatcher recognized the route but the
 *     methodId itself isn't cataloged (daemon handlers/register.ts's 404).
 *   - NOT_FOUND — the generic HTTP router's 404 for a path that was never
 *     wired up at all (body `{error:"Route not found", code:"NOT_FOUND",
 *     category:"not_found"}` — what email.inbox.list / calendar.events.list
 *     get back from a daemon build with no email/calendar surface routed).
 * Message-sniff fallback for pre-1.0 daemons that omit the code entirely.
 */
export function isMethodUnavailableError(error: unknown): boolean {
  // 501 "cataloged but not invokable" gets the same user-facing treatment:
  // this daemon cannot serve the method. Callers that care about the
  // distinction (wording) can additionally check isMethodNotInvokableError.
  if (isMethodNotInvokableError(error)) return true;
  if (errorStatus(error) !== 404) return false;
  const code = errorCode(error);
  if (code === "METHOD_NOT_FOUND" || code === "NOT_FOUND") return true;
  const text = messageText(error);
  return text.includes("unknown gateway method") || text.includes("route not found");
}

/**
 * 501 "cataloged but not invokable" — the daemon's contract knows the id but
 * this build has no live handler wired for it.
 */
export function isMethodNotInvokableError(error: unknown): boolean {
  return errorStatus(error) === 501;
}

/**
 * The request never reached the daemon: network failure or the app proxy's
 * own 502/503 envelopes (APP_PROXY_DAEMON_UNREACHABLE / APP_PROXY_CONNECTING
 * from src/bun/ui-server.ts). Distinct from a genuine daemon rejection.
 */
export function isDaemonUnreachableError(error: unknown): boolean {
  if (!error) return false;
  const code = errorCode(error);
  if (code === "APP_PROXY_DAEMON_UNREACHABLE" || code === "APP_PROXY_CONNECTING") return true;
  const serialized = serializeError(error);
  const transport = asRecord(serialized["transport"]);
  const category = readString(serialized, "category") || readString(transport, "category");
  if (category === "network") return true;
  const status = errorStatus(error);
  if (status === 0) return true;
  // fetch() rejections carry no status at all — a TypeError with no HTTP shape.
  if (status === undefined && error instanceof TypeError) return true;
  return false;
}

/**
 * 401 / authentication category — the daemon answered and says the injected
 * token is no longer valid. With the token proxy-side this signals a pairing
 * store problem, not a webview sign-in flow.
 */
export function isAuthExpiredError(error: unknown): boolean {
  if (!error) return false;
  const serialized = serializeError(error);
  const transport = asRecord(serialized["transport"]);
  const category = readString(serialized, "category") || readString(transport, "category");
  if (category === "authentication") return true;
  return errorStatus(error) === 401;
}

/** 412 honest refusals for unconfigured optional surfaces (calendar, email). */
export function isUnconfiguredError(error: unknown): boolean {
  const code = errorCode(error);
  if (code.endsWith("_NOT_CONFIGURED") || code.endsWith("_CREDENTIALS_MISSING")) return true;
  return errorStatus(error) === 412;
}

/**
 * The WS bridge (/app/ws) is not connected — WS-only methods degrade to an
 * honest "not reachable over this transport" state, not a scary failure.
 */
export function isWsBridgeUnavailableError(error: unknown): boolean {
  return errorCode(error) === "APP_WS_BRIDGE_UNAVAILABLE";
}

export function errorDebugValue(error: unknown): unknown {
  const serialized = serializeError(error);
  return Object.keys(serialized).length ? serialized : undefined;
}

export function compactError(error: unknown): string {
  return compactJson(serializeError(error));
}
