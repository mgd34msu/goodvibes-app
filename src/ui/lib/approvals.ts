// Approvals + tasks wire readers, display helpers, shared hooks, and the
// cross-view jump plumbing. Ported from goodvibes-webui src/lib/approvals.ts.
//
// PARITY CONTRACT (webui/TUI agreement): this module never computes a
// modified-edit result. It only reads hunks for display and packages a
// selected-index array for `approvals.approve` — the daemon's
// buildModifiedEditArgs is the single source of the applied result.
//
// Statuses, categories, and risk levels are OPEN strings rendered verbatim: a
// daemon newer than this client may report a value we have never seen —
// render it, never drop it.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { gv } from "./gv.ts";
import { queryKeys } from "./queries.ts";
import { asArray, asRecord, firstArray, firstNumber, firstString } from "./wire.ts";
import { runCommand } from "./commands.ts";
import { getCurrentUrlState, replaceState } from "./router.ts";

// ─── Types (superset-tolerant mirrors of the wire shapes) ────────────────────

export interface ApprovalEditHunk {
  readonly path: string;
  readonly find: string;
  readonly replace: string;
  readonly id?: string;
}

export interface ApprovalAnalysis {
  readonly classification: string;
  readonly riskLevel: string;
  readonly summary: string;
  readonly reasons: readonly string[];
  readonly target?: string;
  readonly blastRadius?: string;
  readonly sideEffects?: readonly string[];
}

export interface ApprovalRequest {
  readonly callId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly category: string;
  readonly analysis: ApprovalAnalysis;
  readonly workingDirectory?: string;
}

export interface ApprovalDecision {
  readonly approved: boolean;
  readonly modifiedArgs?: Record<string, unknown>;
}

export interface ApprovalAuditRecord {
  readonly id: string;
  readonly action: string;
  readonly actor: string;
  readonly actorSurface?: string;
  readonly createdAt: number;
  readonly note?: string;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly callId: string;
  readonly sessionId?: string;
  readonly status: string;
  readonly request: ApprovalRequest;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly claimedBy?: string;
  readonly resolvedAt?: number;
  readonly resolvedBy?: string;
  readonly decision?: ApprovalDecision;
  /** Absent on a mixed-version/pre-audit record — "not reported here", never an error. */
  readonly audit?: readonly ApprovalAuditRecord[];
}

export interface ApprovalsSnapshot {
  readonly awaitingDecision: boolean;
  readonly mode: string;
  readonly approvals: readonly ApprovalRecord[];
}

export interface TaskSummary {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  /** Verbatim daemon status — no invented progress, no synthesized ETA. */
  readonly status: string;
  readonly owner: string;
  readonly cancellable?: boolean;
  readonly parentTaskId?: string;
  readonly sessionId?: string;
  readonly queuedAt?: number;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly error?: string;
}

export interface TasksSnapshot {
  readonly queued?: number;
  readonly running?: number;
  readonly blocked?: number;
  readonly tasks: readonly TaskSummary[];
}

export interface TaskDetail {
  readonly task: TaskSummary | null;
  /** The unparsed wire payload — the peek renders it verbatim for honesty. */
  readonly raw: unknown;
}

// ─── Defensive parsers (boot snapshot primes the cache with RAW payloads, so
//     every consumer parses via useQuery `select`) ───────────────────────────

function optionalString(record: Record<string, unknown>, keys: string[]): string | undefined {
  const value = firstString(record, keys);
  return value || undefined;
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

function parseAuditEntry(value: unknown): ApprovalAuditRecord | null {
  const record = asRecord(value);
  const id = firstString(record, ["id"]);
  const action = firstString(record, ["action"]);
  if (!id && !action) return null;
  return {
    id: id || action,
    action: action || "unknown",
    actor: firstString(record, ["actor"]) || "unknown",
    actorSurface: optionalString(record, ["actorSurface"]),
    createdAt: firstNumber(record, ["createdAt"]) ?? 0,
    note: optionalString(record, ["note"]),
  };
}

function parseDecision(value: unknown): ApprovalDecision | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = asRecord(value);
  const modifiedArgs = record["modifiedArgs"];
  return {
    approved: record["approved"] === true,
    ...(modifiedArgs && typeof modifiedArgs === "object" ? { modifiedArgs: asRecord(modifiedArgs) } : {}),
  };
}

export function parseApproval(value: unknown): ApprovalRecord | null {
  const record = asRecord(value);
  const id = firstString(record, ["id", "approvalId"]);
  if (!id) return null;
  const request = asRecord(record["request"]);
  const analysis = asRecord(request["analysis"]);
  const auditRaw = record["audit"];
  const audit = Array.isArray(auditRaw)
    ? auditRaw.map(parseAuditEntry).filter((entry): entry is ApprovalAuditRecord => entry !== null)
    : undefined;
  const decision = parseDecision(record["decision"]);
  return {
    id,
    callId: firstString(record, ["callId"]),
    sessionId: optionalString(record, ["sessionId"]),
    status: firstString(record, ["status"]) || "unknown",
    request: {
      callId: firstString(request, ["callId"]),
      tool: firstString(request, ["tool"]) || "unknown",
      args: asRecord(request["args"]),
      category: firstString(request, ["category"]) || "uncategorized",
      analysis: {
        classification: firstString(analysis, ["classification"]),
        riskLevel: firstString(analysis, ["riskLevel"]) || "unknown",
        summary: firstString(analysis, ["summary"]),
        reasons: stringArray(analysis["reasons"]),
        target: optionalString(analysis, ["target"]),
        blastRadius: optionalString(analysis, ["blastRadius"]),
        sideEffects: Array.isArray(analysis["sideEffects"]) ? stringArray(analysis["sideEffects"]) : undefined,
      },
      workingDirectory: optionalString(request, ["workingDirectory"]),
    },
    createdAt: firstNumber(record, ["createdAt"]) ?? 0,
    updatedAt: firstNumber(record, ["updatedAt"]) ?? 0,
    claimedBy: optionalString(record, ["claimedBy"]),
    resolvedAt: firstNumber(record, ["resolvedAt"]),
    resolvedBy: optionalString(record, ["resolvedBy"]),
    ...(decision ? { decision } : {}),
    ...(audit ? { audit } : {}),
  };
}

export function parseApprovalsSnapshot(value: unknown): ApprovalsSnapshot {
  const record = asRecord(value);
  const approvals = firstArray(record, ["approvals", "items"])
    .map(parseApproval)
    .filter((entry): entry is ApprovalRecord => entry !== null);
  return {
    awaitingDecision: record["awaitingDecision"] === true,
    mode: firstString(record, ["mode"]),
    approvals,
  };
}

export function parseTaskSummary(value: unknown): TaskSummary | null {
  const record = asRecord(value);
  const id = firstString(record, ["id", "taskId"]);
  if (!id) return null;
  return {
    id,
    kind: firstString(record, ["kind"]) || "task",
    title: firstString(record, ["title"]),
    status: firstString(record, ["status"]) || "unknown",
    owner: firstString(record, ["owner"]),
    cancellable: typeof record["cancellable"] === "boolean" ? record["cancellable"] : undefined,
    parentTaskId: optionalString(record, ["parentTaskId"]),
    sessionId: optionalString(record, ["sessionId", "agentSessionId"]),
    queuedAt: firstNumber(record, ["queuedAt", "createdAt"]),
    startedAt: firstNumber(record, ["startedAt"]),
    endedAt: firstNumber(record, ["endedAt"]),
    error: optionalString(record, ["error"]),
  };
}

export function parseTasksSnapshot(value: unknown): TasksSnapshot {
  const record = asRecord(value);
  const tasks = firstArray(record, ["tasks", "items"])
    .map(parseTaskSummary)
    .filter((entry): entry is TaskSummary => entry !== null);
  return {
    queued: firstNumber(record, ["queued"]),
    running: firstNumber(record, ["running"]),
    blocked: firstNumber(record, ["blocked"]),
    tasks,
  };
}

/** tasks.get may answer the task bare or wrapped in a `{ task }` envelope. */
export function parseTaskDetail(value: unknown): TaskDetail {
  const record = asRecord(value);
  const envelope = record["task"] !== undefined ? record["task"] : value;
  return { task: parseTaskSummary(envelope), raw: value };
}

// ─── Display helpers (webui parity) ──────────────────────────────────────────

const TERMINAL_APPROVAL_STATUSES = new Set(["approved", "denied", "cancelled", "expired"]);

export function isTerminalApprovalStatus(status: string): boolean {
  return TERMINAL_APPROVAL_STATUSES.has(status);
}

/** True only for a status this surface may act on directly (never claimed-by-another, never terminal). */
export function isActionableApproval(record: ApprovalRecord): boolean {
  return record.status === "pending";
}

function isEditHunkLike(value: unknown): value is ApprovalEditHunk {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["path"] === "string" &&
    typeof candidate["find"] === "string" &&
    typeof candidate["replace"] === "string" &&
    (candidate["id"] === undefined || typeof candidate["id"] === "string")
  );
}

/**
 * Extract a validated edit-hunk list from an approval's request args, or null
 * if the args are not edit-shaped. Mirrors the SDK's readApprovalEditHunks so
 * "this approval has hunks to render" agrees with "the daemon will accept a
 * selectedHunks index array for it".
 */
export function readApprovalEditHunks(record: ApprovalRecord): ApprovalEditHunk[] | null {
  const edits = record.request.args["edits"];
  if (!Array.isArray(edits) || edits.length === 0) return null;
  const items: ApprovalEditHunk[] = [];
  for (const entry of edits) {
    if (!isEditHunkLike(entry)) return null;
    items.push(entry);
  }
  return items;
}

/**
 * For a resolved, approved edit approval: was it a per-hunk subset? The
 * daemon's `decision.modifiedArgs.edits` carries the filtered hunk list only
 * when a `selectedHunks` subset was sent — comparing lengths is enough for a
 * "partial (2/5 hunks)" label from data already on the record.
 */
export function partialApprovalLabel(record: ApprovalRecord): string | null {
  if (record.status !== "approved") return null;
  const originalHunks = readApprovalEditHunks(record);
  if (!originalHunks || originalHunks.length === 0) return null;
  const modifiedEdits = record.decision?.modifiedArgs?.["edits"];
  if (!Array.isArray(modifiedEdits) || modifiedEdits.length >= originalHunks.length) return null;
  return `partial (${modifiedEdits.length}/${originalHunks.length} hunks)`;
}

export function riskTone(riskLevel: string): string {
  switch (riskLevel) {
    case "critical":
      return "bad";
    case "high":
      return "warning";
    case "medium":
      return "neutral";
    default:
      return "ok";
  }
}

export function approvalStatusTone(status: string): string {
  switch (status) {
    case "pending":
      return "warning";
    case "approved":
      return "ok";
    case "denied":
    case "expired":
      return "bad";
    default:
      return "neutral";
  }
}

export function taskStatusTone(status: string): string {
  switch (status) {
    case "completed":
      return "ok";
    case "failed":
      return "bad";
    case "running":
      return "info";
    default:
      return "neutral";
  }
}

export function sortApprovalsNewestFirst(approvals: readonly ApprovalRecord[]): ApprovalRecord[] {
  return [...approvals].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The full decision trail, oldest first; absence means "not reported here". */
export function auditTrail(record: ApprovalRecord): readonly ApprovalAuditRecord[] {
  return record.audit ?? [];
}

/** One-line, human summary of a single decision-trail entry. */
export function auditEntryLabel(entry: ApprovalAuditRecord): string {
  const surface = entry.actorSurface ? ` (${entry.actorSurface})` : "";
  const note = entry.note ? `: ${entry.note}` : "";
  return `${entry.action} by ${entry.actor}${surface}${note}`;
}

// ─── Shared hooks (query cache holds the RAW wire payload; parse in select) ──

export function useApprovalsSnapshot(options?: {
  enabled?: boolean;
  refetchInterval?: number;
}): UseQueryResult<ApprovalsSnapshot> {
  return useQuery({
    queryKey: queryKeys.approvals,
    queryFn: () => gv.approvals.list(),
    select: parseApprovalsSnapshot,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  });
}

export function useTasksSnapshot(options?: { enabled?: boolean }): UseQueryResult<TasksSnapshot> {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => gv.tasks.list(),
    select: parseTasksSnapshot,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Global pending-approvals badge count for the StatusStrip / sidebar. Shares
 * the approvals query cache (realtime `permissions` invalidation keeps it
 * live); the 60s interval is the honest fallback while SSE is paused.
 * Returns null while unknown (loading, error, or daemon unreachable).
 */
export function usePendingApprovalsCount(enabled = true): number | null {
  const query = useQuery({
    queryKey: queryKeys.approvals,
    queryFn: () => gv.approvals.list(),
    select: (data: unknown) =>
      parseApprovalsSnapshot(data).approvals.filter((record) => record.status === "pending").length,
    enabled,
    refetchInterval: 60_000,
  });
  return query.data ?? null;
}

// ─── Cross-view jump plumbing ────────────────────────────────────────────────
// Navigation must go through the shell's registered nav commands (each
// useUrlState instance keeps local state; only the shell's instance drives the
// view outlet). The focus request rides a module store so the approvals view
// honors it whether it is already mounted or mounts right after the jump; the
// URL filter is ALSO written so the jump stays deep-linkable (docs/UX.md §2).

export type ApprovalFocusTarget = { approvalId: string } | { firstPending: true };

let _focusTarget: ApprovalFocusTarget | null = null;
const _focusListeners = new Set<() => void>();

export function requestApprovalFocus(target: ApprovalFocusTarget): void {
  _focusTarget = target;
  _focusListeners.forEach((fn) => fn());
}

export function consumeApprovalFocus(): ApprovalFocusTarget | null {
  const target = _focusTarget;
  _focusTarget = null;
  return target;
}

export function subscribeApprovalFocus(listener: () => void): () => void {
  _focusListeners.add(listener);
  return () => {
    _focusListeners.delete(listener);
  };
}

/** Jump to the Approvals view, optionally focusing one approval (toast → jump). */
export function jumpToApprovals(target?: ApprovalFocusTarget): void {
  runCommand("nav.approvals");
  if (target && "approvalId" in target) {
    const current = getCurrentUrlState();
    replaceState({ ...current, filters: { ...current.filters, approval: target.approvalId } });
  }
  if (target) requestApprovalFocus(target);
}

/** Jump to the Sessions view with a session selected (task/approval correlation). */
export function jumpToSession(sessionId: string): void {
  runCommand("nav.sessions");
  const current = getCurrentUrlState();
  replaceState({ ...current, session: sessionId });
}
