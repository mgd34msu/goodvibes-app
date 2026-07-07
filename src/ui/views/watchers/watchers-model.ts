// Watchers view data layer — local query keys and defensive wire readers.
//
// Wire shape verified against the daemon implementation (goodvibes-sdk
// packages/daemon-sdk/src/system-routes.ts + the SDK watcher domain store):
//   GET    /api/watchers                    → { watchers: [...] }        (authenticated)
//   POST   /api/watchers                    → 201 WatcherRecord          (admin)
//   PATCH  /api/watchers/{id}               → WatcherRecord              (admin)
//   POST   /api/watchers/{id}/start|stop|run → WatcherRecord             (admin)
//   DELETE /api/watchers/{id}               → { removed, id } (dangerous, admin)
// Record: { id, label, kind (webhook|polling|filesystem|socket|integration|manual),
//   state (stopped|starting|running|degraded|failed), source { kind, label,
//   enabled, metadata }, intervalMs?, lastHeartbeatAt?, sourceStatus?,
//   degradedReason?, lastError?, lastCheckpoint?, metadata } — read
// defensively; the registry boundary types the list as unknown[].

import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";

// Prefixed ["watchers"] to match queryKeys.watchers in lib/queries.ts (defined
// locally — lib/queries.ts is not ours to edit). No `watchers` domain exists on
// the invalidation stream (lib/realtime.ts), so the list polls while visible.
export const watchersKeys = {
  all: ["watchers"] as const,
  list: ["watchers", "list"] as const,
} as const;

/** No wire event for watchers.* — poll while the view is mounted. */
export const WATCHERS_POLL_MS = 15_000;

/** Daemon-accepted kinds on create/update (system-routes WATCHER_KIND_VALUES). */
export const WATCHER_KINDS = ["polling", "webhook", "filesystem", "socket", "integration"] as const;

export interface WatcherRow {
  id: string;
  label: string;
  kind: string;
  /** Verbatim daemon state (stopped|starting|running|degraded|failed|…). */
  state: string;
  sourceKind: string;
  sourceEnabled: boolean;
  intervalMs?: number;
  lastHeartbeatAt?: number;
  sourceStatus: string;
  degradedReason: string;
  lastError: string;
  lastCheckpoint: string;
  /** Merged source metadata (url/method/path/endpoint/address/headers/…). */
  metadata: Record<string, unknown>;
  raw: unknown;
}

export function normalizeWatcher(value: unknown): WatcherRow {
  const record = asRecord(value);
  const source = asRecord(record["source"]);
  const metadata = {
    ...asRecord(record["metadata"]),
    ...asRecord(source["metadata"]),
  };
  return {
    id: firstString(record, ["id", "watcherId"]),
    label: firstString(record, ["label", "id"]) || "unnamed watcher",
    kind: firstString(record, ["kind"]) || "unknown",
    state: firstString(record, ["state", "status"]) || "unknown",
    sourceKind: firstString(source, ["kind"]),
    sourceEnabled: source["enabled"] !== false,
    ...(firstNumber(record, ["intervalMs"]) !== undefined ? { intervalMs: firstNumber(record, ["intervalMs"]) } : {}),
    ...(firstNumber(record, ["lastHeartbeatAt"]) !== undefined
      ? { lastHeartbeatAt: firstNumber(record, ["lastHeartbeatAt"]) }
      : {}),
    sourceStatus: firstString(record, ["sourceStatus"]),
    degradedReason: firstString(record, ["degradedReason"]),
    lastError: firstString(record, ["lastError"]),
    lastCheckpoint: firstString(record, ["lastCheckpoint"]),
    metadata,
    raw: value,
  };
}

export function watchersFromResponse(value: unknown): WatcherRow[] {
  return firstArray(value, ["watchers", "items"]).map(normalizeWatcher);
}

// ─── Secret masking (docs rule: secrets masked by default) ───────────────────

const SECRET_KEY_PATTERN = /token|secret|key|password|authorization|auth|credential|bearer|cookie/i;

/** True when a metadata key (or any header name) likely carries a credential. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function maskValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  if (text.length <= 4) return "••••";
  return `${text.slice(0, 2)}••••${text.slice(-2)}`;
}
