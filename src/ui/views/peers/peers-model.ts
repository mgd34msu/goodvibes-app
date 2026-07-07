// Remote & Peers view — data layer (docs/FEATURES.md §21 / docs/GAPS.md gap
// #1). 12 remote.* wire methods, none on the realtime invalidation stream
// (lib/realtime.ts DOMAIN_INVALIDATIONS has no `remote` domain) — every list
// here polls at REMOTE_POLL_MS while the view is mounted, same as
// watchers/fleet/checkpoints.
//
// Wire shapes verified against the daemon's actual contract (NOT guessed):
// @pellux/goodvibes-sdk platform/runtime/remote/distributed-runtime-types.d.ts
// (DistributedPeerRecord / DistributedRuntimePairRequest / DistributedPendingWork
// / DistributedRuntimeAuditRecord / DistributedNodeHostContract) plus the
// generated operator contract's per-method input/output JSON Schemas
// (contracts/artifacts/operator-contract.json, methods remote.*). Records are
// read defensively (asRecord/firstString/…) because outputSchema marks every
// object `additionalProperties: true` — daemon builds may add fields.
//
// `remote.snapshot` is NOT a "node identity" document — its real shape is a
// runtime health snapshot: daemon transport state, the ACP bridge, the
// sandbox/runner registry, the local supervisor, and a `distributed` block
// that mirrors peers/pairRequests/work PLUS an audit trail with no dedicated
// list method. The Overview section renders exactly those fields, honestly
// labeled, rather than inventing an "identity" concept the wire doesn't have.

import { asRecord, compactJson, firstArray, firstNumber, firstString, formatRelative } from "../../lib/wire.ts";

// ─── Query keys (local — lib/queries.ts is not ours to edit; every key is
// prefixed "peers" so one invalidate({queryKey: peersKeys.all}) fans out to
// every query this view owns) ─────────────────────────────────────────────

export const peersKeys = {
  all: ["peers"] as const,
  snapshot: ["peers", "snapshot"] as const,
  list: ["peers", "list"] as const,
  pairRequests: ["peers", "pair-requests"] as const,
  work: ["peers", "work"] as const,
  contract: ["peers", "contract"] as const,
} as const;

/** No `remote` domain on the invalidation stream — poll while mounted (docs/UX.md rule for wire-less domains, matches watchers/fleet). */
export const REMOTE_POLL_MS = 20_000;

function firstBoolean(value: unknown, keys: string[]): boolean | undefined {
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "boolean") return item;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  return firstArray({ v: value }, ["v"]).filter((item): item is string => typeof item === "string");
}

// ─── Peers ───────────────────────────────────────────────────────────────────

export interface PeerToken {
  id: string;
  label: string;
  scopes: string[];
  issuedAt?: number;
  lastUsedAt?: number;
  rotatedAt?: number;
  revokedAt?: number;
  fingerprint: string;
}

export interface PeerRecord {
  id: string;
  kind: string; // "node" | "device"
  label: string;
  requestedId: string;
  platform: string;
  deviceFamily: string;
  version: string;
  clientMode: string;
  capabilities: string[];
  commands: string[];
  permissions: Record<string, boolean>;
  status: string; // "paired" | "connected" | "idle" | "disconnected" | "revoked"
  pairedAt?: number;
  verifiedAt?: number;
  lastSeenAt?: number;
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
  lastRemoteAddress: string;
  activeTokenId: string;
  tokens: PeerToken[];
  metadata: Record<string, unknown>;
  raw: unknown;
}

function normalizePeerToken(value: unknown): PeerToken {
  const r = asRecord(value);
  return {
    id: firstString(r, ["id"]),
    label: firstString(r, ["label"]),
    scopes: stringArray(r["scopes"]),
    issuedAt: firstNumber(r, ["issuedAt"]),
    lastUsedAt: firstNumber(r, ["lastUsedAt"]),
    rotatedAt: firstNumber(r, ["rotatedAt"]),
    revokedAt: firstNumber(r, ["revokedAt"]),
    fingerprint: firstString(r, ["fingerprint"]),
  };
}

export function normalizePeer(value: unknown): PeerRecord {
  const r = asRecord(value);
  const permissionsRaw = asRecord(r["permissions"]);
  const permissions: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(permissionsRaw)) {
    if (typeof val === "boolean") permissions[key] = val;
  }
  return {
    id: firstString(r, ["id", "peerId"]),
    kind: firstString(r, ["kind"]) || "node",
    label: firstString(r, ["label", "requestedId", "id"]) || "unnamed peer",
    requestedId: firstString(r, ["requestedId"]),
    platform: firstString(r, ["platform"]),
    deviceFamily: firstString(r, ["deviceFamily"]),
    version: firstString(r, ["version"]),
    clientMode: firstString(r, ["clientMode"]),
    capabilities: stringArray(r["capabilities"]),
    commands: stringArray(r["commands"]),
    permissions,
    status: firstString(r, ["status"]) || "unknown",
    pairedAt: firstNumber(r, ["pairedAt"]),
    verifiedAt: firstNumber(r, ["verifiedAt"]),
    lastSeenAt: firstNumber(r, ["lastSeenAt"]),
    lastConnectedAt: firstNumber(r, ["lastConnectedAt"]),
    lastDisconnectedAt: firstNumber(r, ["lastDisconnectedAt"]),
    lastRemoteAddress: firstString(r, ["lastRemoteAddress"]),
    activeTokenId: firstString(r, ["activeTokenId"]),
    tokens: firstArray(r, ["tokens"]).map(normalizePeerToken),
    metadata: asRecord(r["metadata"]),
    raw: value,
  };
}

export function peersFromResponse(value: unknown): PeerRecord[] {
  return firstArray(value, ["peers", "items"]).map(normalizePeer);
}

/** Connected/idle/paired peers can still receive work; disconnected/revoked cannot. */
export function isPeerReachable(peer: PeerRecord): boolean {
  return peer.status === "connected" || peer.status === "idle" || peer.status === "paired";
}

// ─── Pair requests ───────────────────────────────────────────────────────────

export interface PairRequestRecord {
  id: string;
  peerKind: string;
  requestedId: string;
  label: string;
  platform: string;
  deviceFamily: string;
  version: string;
  clientMode: string;
  capabilities: string[];
  commands: string[];
  requestedBy: string; // "remote" | "operator"
  status: string; // "pending" | "approved" | "verified" | "rejected" | "expired"
  challengePreview: string;
  createdAt?: number;
  updatedAt?: number;
  approvedAt?: number;
  verifiedAt?: number;
  rejectedAt?: number;
  expiresAt?: number;
  peerId: string;
  remoteAddress: string;
  metadata: Record<string, unknown>;
  raw: unknown;
}

export function normalizePairRequest(value: unknown): PairRequestRecord {
  const r = asRecord(value);
  return {
    id: firstString(r, ["id"]),
    peerKind: firstString(r, ["peerKind"]) || "node",
    requestedId: firstString(r, ["requestedId"]),
    label: firstString(r, ["label", "requestedId"]) || "unnamed request",
    platform: firstString(r, ["platform"]),
    deviceFamily: firstString(r, ["deviceFamily"]),
    version: firstString(r, ["version"]),
    clientMode: firstString(r, ["clientMode"]),
    capabilities: stringArray(r["capabilities"]),
    commands: stringArray(r["commands"]),
    requestedBy: firstString(r, ["requestedBy"]) || "remote",
    status: firstString(r, ["status"]) || "pending",
    challengePreview: firstString(r, ["challengePreview"]),
    createdAt: firstNumber(r, ["createdAt"]),
    updatedAt: firstNumber(r, ["updatedAt"]),
    approvedAt: firstNumber(r, ["approvedAt"]),
    verifiedAt: firstNumber(r, ["verifiedAt"]),
    rejectedAt: firstNumber(r, ["rejectedAt"]),
    expiresAt: firstNumber(r, ["expiresAt"]),
    peerId: firstString(r, ["peerId"]),
    remoteAddress: firstString(r, ["remoteAddress"]),
    metadata: asRecord(r["metadata"]),
    raw: value,
  };
}

export function pairRequestsFromResponse(value: unknown): PairRequestRecord[] {
  return firstArray(value, ["requests", "items"]).map(normalizePairRequest);
}

export function isPendingPairRequest(request: PairRequestRecord): boolean {
  return request.status === "pending";
}

// ─── Work ────────────────────────────────────────────────────────────────────

export interface WorkRecord {
  id: string;
  peerId: string;
  peerKind: string;
  type: string;
  command: string;
  priority: string;
  status: string; // "queued" | "claimed" | "completed" | "failed" | "cancelled" | "expired"
  payload: unknown;
  createdAt?: number;
  updatedAt?: number;
  queuedBy: string;
  claimedAt?: number;
  leaseExpiresAt?: number;
  completedAt?: number;
  timeoutMs?: number;
  sessionId: string;
  routeId: string;
  automationRunId: string;
  automationJobId: string;
  approvalId: string;
  result: unknown;
  error: string;
  telemetry: unknown;
  metadata: Record<string, unknown>;
  raw: unknown;
}

export function normalizeWork(value: unknown): WorkRecord {
  const r = asRecord(value);
  return {
    id: firstString(r, ["id"]),
    peerId: firstString(r, ["peerId"]),
    peerKind: firstString(r, ["peerKind"]) || "node",
    type: firstString(r, ["type"]) || "invoke",
    command: firstString(r, ["command"]),
    priority: firstString(r, ["priority"]) || "default",
    status: firstString(r, ["status"]) || "queued",
    payload: r["payload"],
    createdAt: firstNumber(r, ["createdAt"]),
    updatedAt: firstNumber(r, ["updatedAt"]),
    queuedBy: firstString(r, ["queuedBy"]),
    claimedAt: firstNumber(r, ["claimedAt"]),
    leaseExpiresAt: firstNumber(r, ["leaseExpiresAt"]),
    completedAt: firstNumber(r, ["completedAt"]),
    timeoutMs: firstNumber(r, ["timeoutMs"]),
    sessionId: firstString(r, ["sessionId"]),
    routeId: firstString(r, ["routeId"]),
    automationRunId: firstString(r, ["automationRunId"]),
    automationJobId: firstString(r, ["automationJobId"]),
    approvalId: firstString(r, ["approvalId"]),
    result: r["result"],
    error: firstString(r, ["error"]),
    telemetry: r["telemetry"],
    metadata: asRecord(r["metadata"]),
    raw: value,
  };
}

export function workFromResponse(value: unknown): WorkRecord[] {
  return firstArray(value, ["work", "items"]).map(normalizeWork);
}

export function isCancellableWork(work: WorkRecord): boolean {
  return work.status === "queued" || work.status === "claimed";
}

// ─── Audit (no dedicated list method — only surfaced via remote.snapshot) ───

export interface AuditRecord {
  id: string;
  action: string;
  actor: string;
  peerId: string;
  requestId: string;
  workId: string;
  createdAt?: number;
  note: string;
  metadata: Record<string, unknown>;
  raw: unknown;
}

export function normalizeAudit(value: unknown): AuditRecord {
  const r = asRecord(value);
  return {
    id: firstString(r, ["id"]),
    action: firstString(r, ["action"]) || "unknown",
    actor: firstString(r, ["actor"]),
    peerId: firstString(r, ["peerId"]),
    requestId: firstString(r, ["requestId"]),
    workId: firstString(r, ["workId"]),
    createdAt: firstNumber(r, ["createdAt"]),
    note: firstString(r, ["note"]),
    metadata: asRecord(r["metadata"]),
    raw: value,
  };
}

// ─── Snapshot (remote.snapshot — runtime health, NOT peer identity) ─────────

export interface RemoteSnapshot {
  daemon: {
    transportState: string;
    isRunning?: boolean;
    reconnectAttempts?: number;
    runningJobCount?: number;
    lastError: string;
  };
  acp: {
    transportState: string;
    activeConnectionIds: string[];
    totalSpawned?: number;
    totalFailed?: number;
    lastError: string;
  };
  registry: {
    pools?: number;
    contracts?: number;
    artifacts?: number;
  };
  supervisor: {
    sessions?: number;
    degraded?: number;
    capturedAt?: number;
  };
  peers: PeerRecord[];
  pairRequests: PairRequestRecord[];
  work: WorkRecord[];
  audit: AuditRecord[];
  raw: unknown;
}

export function normalizeSnapshot(value: unknown): RemoteSnapshot {
  const r = asRecord(value);
  const daemon = asRecord(r["daemon"]);
  const acp = asRecord(r["acp"]);
  const registry = asRecord(r["registry"]);
  const supervisor = asRecord(r["supervisor"]);
  const distributed = asRecord(r["distributed"]);
  return {
    daemon: {
      transportState: firstString(daemon, ["transportState"]) || "unknown",
      isRunning: firstBoolean(daemon, ["isRunning"]),
      reconnectAttempts: firstNumber(daemon, ["reconnectAttempts"]),
      runningJobCount: firstNumber(daemon, ["runningJobCount"]),
      lastError: firstString(daemon, ["lastError"]),
    },
    acp: {
      transportState: firstString(acp, ["transportState"]) || "unknown",
      activeConnectionIds: stringArray(acp["activeConnectionIds"]),
      totalSpawned: firstNumber(acp, ["totalSpawned"]),
      totalFailed: firstNumber(acp, ["totalFailed"]),
      lastError: firstString(acp, ["lastError"]),
    },
    registry: {
      pools: firstNumber(registry, ["pools"]),
      contracts: firstNumber(registry, ["contracts"]),
      artifacts: firstNumber(registry, ["artifacts"]),
    },
    supervisor: {
      sessions: firstNumber(supervisor, ["sessions"]),
      degraded: firstNumber(supervisor, ["degraded"]),
      capturedAt: firstNumber(supervisor, ["capturedAt"]),
    },
    peers: firstArray(distributed, ["peers"]).map(normalizePeer),
    pairRequests: firstArray(distributed, ["pairRequests"]).map(normalizePairRequest),
    work: firstArray(distributed, ["work"]).map(normalizeWork),
    audit: firstArray(distributed, ["audit"]).map(normalizeAudit),
    raw: value,
  };
}

// ─── Node-host contract ──────────────────────────────────────────────────────

export interface NodeHostEndpoint {
  id: string;
  method: string;
  path: string;
  auth: string;
  description: string;
  requiredScope: string;
}

export interface NodeHostContract {
  schemaVersion?: number;
  transport: string;
  basePath: string;
  peerKinds: string[];
  workTypes: string[];
  scopes: string[];
  recommendedHeartbeatMs?: number;
  recommendedWorkPullMs?: number;
  workCompletionStatuses: string[];
  endpoints: NodeHostEndpoint[];
  raw: unknown;
}

export function normalizeContract(value: unknown): NodeHostContract {
  const outer = asRecord(value);
  const r = asRecord(outer["contract"] ?? outer);
  return {
    schemaVersion: firstNumber(r, ["schemaVersion"]),
    transport: firstString(r, ["transport"]),
    basePath: firstString(r, ["basePath"]),
    peerKinds: stringArray(r["peerKinds"]),
    workTypes: stringArray(r["workTypes"]),
    scopes: stringArray(r["scopes"]),
    recommendedHeartbeatMs: firstNumber(r, ["recommendedHeartbeatMs"]),
    recommendedWorkPullMs: firstNumber(r, ["recommendedWorkPullMs"]),
    workCompletionStatuses: stringArray(r["workCompletionStatuses"]),
    endpoints: firstArray(r, ["endpoints"]).map((item) => {
      const e = asRecord(item);
      return {
        id: firstString(e, ["id"]),
        method: firstString(e, ["method"]),
        path: firstString(e, ["path"]),
        auth: firstString(e, ["auth"]),
        description: firstString(e, ["description"]),
        requiredScope: firstString(e, ["requiredScope"]),
      };
    }),
    raw: value,
  };
}

// ─── Misc shared helpers ─────────────────────────────────────────────────────

export function formatAbsolute(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toLocaleString();
  return "—";
}

export { formatRelative, compactJson };

/** Parse the invoke console's params textarea; empty text means "no payload". */
export function parseParamsJson(text: string): { value: unknown; error: null } | { value: null; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { value: undefined, error: null };
  try {
    return { value: JSON.parse(trimmed), error: null };
  } catch (error) {
    return { value: null, error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}
