// Pure, tolerant readers for the cross-surface session union — ported from
// goodvibes-webui src/lib/sessions-union.ts. kind/status/project are read as
// OPEN STRINGS even though the wire enum is closed: a daemon newer than the
// pinned contract can return a kind we have never seen and we render it
// verbatim rather than crash or drop it.

import { asArray, asRecord, firstString, readPath } from "../../lib/wire.ts";

/** This surface's participant identity — stamped on steer/followUp/create,
 * and the surfaceId sessions.detach removes. */
export const APP_SURFACE_KIND = "app";
export const APP_SURFACE_ID = "goodvibes-app";

/** The kinds the pinned wire enum declares (SHARED_SESSION_KINDS) plus 'app'. */
export const KNOWN_SESSION_KINDS = [
  "tui",
  "agent",
  "webui",
  "app",
  "companion-task",
  "companion-chat",
  "automation",
] as const;

/** GET /api/sessions ignores ?limit/?cursor — the daemon caps the union at 50. */
export const SESSIONS_SNAPSHOT_CAP = 50;

export interface UnionSessionRecord {
  id: string;
  kind: string;
  project: string;
  title: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** null when the wire omitted it — absence means FULLY RETAINED, never inferred loss. */
  retainedMessageCount: number | null;
  pendingInputCount: number;
  surfaceKinds: string[];
  activeAgentId: string;
  lastError: string;
  /** metadata.closeReason ('idle-reaped' | 'user' | 'surface') — empty when absent. */
  closeReason: string;
  raw: unknown;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  return asArray(record[key]).filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Normalize one raw record (already unwrapped from any envelope). */
export function unionSessionFromRecord(value: unknown): UnionSessionRecord {
  const record = asRecord(value);
  const id = firstString(record, ["id", "sessionId"]);
  const closeReason = readPath(record, ["metadata", "closeReason"]);
  return {
    id,
    kind: firstString(record, ["kind"]),
    project: firstString(record, ["project"]),
    title: firstString(record, ["title", "name", "label"]) || id || "Untitled session",
    status: firstString(record, ["status", "state"]),
    createdAt: numberField(record, "createdAt"),
    updatedAt:
      numberField(record, "updatedAt") || numberField(record, "lastActivityAt") || numberField(record, "createdAt"),
    messageCount: numberField(record, "messageCount"),
    retainedMessageCount: optionalNumberField(record, "retainedMessageCount"),
    pendingInputCount: numberField(record, "pendingInputCount"),
    surfaceKinds: stringArrayField(record, "surfaceKinds"),
    activeAgentId: firstString(record, ["activeAgentId"]),
    lastError: firstString(record, ["lastError"]),
    closeReason: typeof closeReason === "string" ? closeReason : "",
    raw: value,
  };
}

/** Unwrap {totals, sessions} / bare-array envelopes and normalize every entry. */
export function unionSessionsFromListResponse(value: unknown): UnionSessionRecord[] {
  const candidates: unknown[] = [
    value,
    readPath(value, ["sessions"]),
    readPath(value, ["items"]),
    readPath(value, ["data"]),
    readPath(value, ["result", "sessions"]),
    readPath(value, ["data", "sessions"]),
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(unionSessionFromRecord);
  }
  return [];
}

/** Total reported by the snapshot envelope, if present (for the capped-50 honesty note). */
export function unionSessionsTotal(value: unknown): number | null {
  const totals = asRecord(readPath(value, ["totals"]));
  for (const key of ["sessions", "total", "all", "count"]) {
    const candidate = totals[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  const flat = asRecord(value)["total"];
  return typeof flat === "number" && Number.isFinite(flat) ? flat : null;
}

export function isKnownKind(kind: string): boolean {
  return (KNOWN_SESSION_KINDS as readonly string[]).includes(kind);
}

export function kindLabel(kind: string): string {
  return kind.trim() || "unknown";
}

/** 'unknown' for home-scoped / absent projects — never a blank badge. */
export function projectLabel(project: string): string {
  return project.trim() || "unknown";
}

export function isClosedStatus(status: string): boolean {
  return status.trim().toLowerCase() === "closed";
}

export function statusLabel(status: string): string {
  return status.trim() || "active";
}

/**
 * An idle-reaped closed session auto-reopens on the next heartbeat from any
 * participant — GC housekeeping, not a deliberate close, so it gets its own
 * badge instead of folding into "closed · history".
 */
export function isReapedStatus(record: Pick<UnionSessionRecord, "status" | "closeReason">): boolean {
  return isClosedStatus(record.status) && record.closeReason === "idle-reaped";
}

/**
 * The retention honesty marker: "N of M retained" ONLY when the wire reported
 * retainedMessageCount strictly less than messageCount. Never infers loss
 * from absence.
 */
export function retentionLabel(record: UnionSessionRecord): string | null {
  const { messageCount, retainedMessageCount } = record;
  if (retainedMessageCount === null) return null;
  if (retainedMessageCount >= messageCount) return null;
  return `${retainedMessageCount} of ${messageCount} retained`;
}

/** Steer only while an agent is bound and the session is open; otherwise the
 * composer offers follow-up (queue a turn) instead. */
export function canSteer(record: UnionSessionRecord): boolean {
  return !isClosedStatus(record.status) && record.activeAgentId.trim().length > 0;
}

/** Newest-first by updatedAt (falling back to createdAt). */
export function sortUnionSessions(records: UnionSessionRecord[]): UnionSessionRecord[] {
  return [...records].sort((left, right) => (right.updatedAt || right.createdAt) - (left.updatedAt || left.createdAt));
}

// ---------------------------------------------------------------------------
// sessions.search [ws] — result readers (same record field names as the union
// list, so unionSessionFromRecord applies to each entry).
// ---------------------------------------------------------------------------

export interface SessionSearchPage {
  records: UnionSessionRecord[];
  /** Opaque cursor for the next disjoint page; empty when this page is last. */
  nextCursor: string;
}

export function searchSessionsFromResponse(value: unknown): SessionSearchPage {
  const record = asRecord(value);
  const rows = asArray(record["sessions"]);
  return {
    records: rows.map(unionSessionFromRecord),
    nextCursor: firstString(record, ["nextCursor", "cursor"]),
  };
}

// ---------------------------------------------------------------------------
// Session transcript + input-queue readers
// ---------------------------------------------------------------------------

export interface SessionMessage {
  id: string;
  role: string;
  body: string;
  createdAt: number;
  surfaceKind: string;
  agentId: string;
  raw: unknown;
}

export function sessionMessagesFromResponse(value: unknown): SessionMessage[] {
  const candidates: unknown[] = [value, readPath(value, ["messages"]), readPath(value, ["items"])];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.map((entry, index) => {
      const record = asRecord(entry);
      return {
        id: firstString(record, ["id", "messageId"]) || `message-${index}`,
        role: firstString(record, ["role", "author", "kind"]) || "message",
        body: firstString(record, ["body", "content", "text", "message"]),
        createdAt: numberField(record, "createdAt"),
        surfaceKind: firstString(record, ["surfaceKind"]),
        agentId: firstString(record, ["agentId"]),
        raw: entry,
      };
    });
  }
  return [];
}

export interface SessionQueuedInput {
  id: string;
  intent: string;
  state: string;
  body: string;
  createdAt: number;
  raw: unknown;
}

/** States the wire treats as still actionable (deliver/cancel make sense). */
export function isPendingInputState(state: string): boolean {
  return state === "queued" || state === "delivered";
}

export function sessionInputsFromResponse(value: unknown): SessionQueuedInput[] {
  return asArray(readPath(value, ["inputs"])).map((entry, index) => {
    const record = asRecord(entry);
    return {
      id: firstString(record, ["id", "inputId"]) || `input-${index}`,
      intent: firstString(record, ["intent"]) || "input",
      state: firstString(record, ["state", "status"]) || "unknown",
      body: firstString(record, ["body", "text"]),
      createdAt: numberField(record, "createdAt"),
      raw: entry,
    };
  });
}
