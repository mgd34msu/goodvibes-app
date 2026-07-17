// Tolerant readers + display helpers for fleet.snapshot / fleet.list [ws].
// Ported from goodvibes-webui src/lib/fleet.ts, with one adaptation: the ws
// bridge returns `unknown`, so the snapshot is NORMALIZED field-by-field
// (never cast) against the installed contract artifact's fleet.snapshot
// output schema. kind/state/costState are read as OPEN STRINGS even though
// the wire enum is closed — a daemon newer than this client may introduce a
// value we have never seen; render it verbatim, never drop it.

import { asArray, asRecord, firstString, readPath } from "../../lib/wire.ts";
import type { TaskSummary } from "../../lib/approvals.ts";

/** PROCESS_KIND_SCHEMA at the time of writing (contract v1, operator 1.3.1).
 * 'acp-agent' (a third-party coding agent hosted via acp.sessions.create) and
 * 'observed-external' (a foreign coding-agent session goodvibes did not spawn
 * — visibility only, see isObservedKind below) arrived in operator contract
 * 1.11. */
export const KNOWN_PROCESS_KINDS = [
  "agent",
  "wrfc-chain",
  "wrfc-subtask",
  "workflow",
  "trigger",
  "schedule",
  "watcher",
  "background-process",
  "workstream",
  "phase",
  "work-item",
  "acp-agent",
  "observed-external",
  "code-index",
] as const;

/** No wire event exists for fleet.* — poll while visible (docs/UX.md §6).
 * Shared by every fleet-domain query (snapshot, attempts, conflicts) so they
 * stay on the same cadence. */
export const FLEET_POLL_INTERVAL_MS = 5_000;

/** PROCESS_STATE_SCHEMA at the time of writing. */
export const KNOWN_PROCESS_STATES = [
  "thinking",
  "executing-tool",
  "awaiting-approval",
  "streaming",
  "stalled",
  "retrying",
  "done",
  "failed",
  "killed",
  "interrupted",
  "idle",
  "queued",
  "paused",
] as const;

const TERMINAL_STATES = new Set(["done", "failed", "killed", "interrupted"]);

/** The workstream sub-filter's kinds (orchestration nodes). */
export const WORKSTREAM_KINDS = new Set(["workstream", "phase", "work-item"]);

export interface FleetNodeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  llmCallCount: number;
  turnCount: number;
  toolCallCount: number;
}

export interface FleetNodeActivity {
  kind: string;
  text: string;
  toolName: string;
  at: number;
}

export interface FleetNodeCapabilities {
  interruptible: boolean;
  killable: boolean;
  pausable: boolean;
  resumable: boolean;
  steerable: boolean;
}

/** ProcessAttention (contract 1.11) — every way a node can be waiting on a
 * human is a first-class reason here: 'approval' | 'input' | 'pick' |
 * 'conflict'. Read as an open string (see attentionReasonLabel). */
export interface FleetAttentionMarker {
  reason: string;
  detail: string;
}

/** ProcessAttemptGroup (contract 1.11) — present only on a work-item node
 * that is one sibling of a best-of-N group; lets FleetView collapse the N
 * siblings into one group entry driven by fleet.attempts.list. */
export interface FleetAttemptGroupRef {
  groupId: string;
  index: number;
  total: number;
  held: boolean;
  /** True once the WHOLE group is ready for a winner pick. */
  ready: boolean;
}

export interface FleetObservedLiveness {
  /** 'active' | 'quiet' (open string) — 'quiet' is NOT proof of idleness,
   * only that no CPU was burned in the interval; `detail` says so verbatim. */
  state: string;
  cpuSeconds: number;
  detail: string;
}

/** ObservedSteerChannel (contract 1.11) — a genuine channel carries what a
 * surface needs to dispatch through it (kind 'tmux'); kind 'none' carries
 * the plain reason there is no channel. Read tolerantly: an unrecognized/
 * absent shape reads as kind "" (render as "no channel", never a dead
 * button standing in for a missing field). */
export interface FleetObservedSteerChannel {
  kind: string;
  paneId: string;
  tty: string;
  reason: string;
}

/** ProcessObserved (contract 1.11) — present only on an 'observed-external'
 * node (a foreign coding-agent session goodvibes did not spawn). Visibility
 * only: never killable/interruptible/pausable/resumable, steer only via the
 * row's own drill-in detail and only over a genuine channel. */
export interface FleetObserved {
  externalKind: string;
  pid: number;
  cwd: string;
  liveness: FleetObservedLiveness;
  steer: FleetObservedSteerChannel;
  steerDrillInOnly: boolean;
}

export interface FleetNode {
  id: string;
  kind: string;
  parentId: string;
  label: string;
  task: string;
  state: string;
  startedAt: number | null;
  elapsedMs: number | null;
  model: string;
  provider: string;
  /** null when the wire sent null/omitted it — costState says why. */
  costUsd: number | null;
  costState: string;
  usage: FleetNodeUsage | null;
  currentActivity: FleetNodeActivity | null;
  capabilities: FleetNodeCapabilities;
  sessionId: string;
  agentId: string;
  /** Derived "blocked on a human" marker — null when the node needs nothing. */
  attention: FleetAttentionMarker | null;
  /** Best-of-N sibling grouping — null on every ordinary (single-attempt) node. */
  attemptGroup: FleetAttemptGroupRef | null;
  /** Foreign-agent facts — null on every node goodvibes owns/hosts. */
  observed: FleetObserved | null;
  raw: unknown;
}

export interface FleetSnapshot {
  capturedAt: number | null;
  nodes: FleetNode[];
  truncated: boolean;
  totalCount: number | null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function normalizeNode(value: unknown): FleetNode {
  const record = asRecord(value);
  const capabilities = asRecord(record["capabilities"]);
  const usageRecord = record["usage"] !== undefined ? asRecord(record["usage"]) : null;
  const activityRecord = record["currentActivity"] !== undefined ? asRecord(record["currentActivity"]) : null;
  const sessionRef = asRecord(record["sessionRef"]);
  const attentionRecord = record["needsAttention"] !== undefined ? asRecord(record["needsAttention"]) : null;
  const attemptGroupRecord = record["attemptGroup"] !== undefined ? asRecord(record["attemptGroup"]) : null;
  const observedRecord = record["observed"] !== undefined ? asRecord(record["observed"]) : null;
  const id = firstString(record, ["id", "nodeId"]);
  return {
    id,
    kind: firstString(record, ["kind"]),
    parentId: firstString(record, ["parentId"]),
    label: firstString(record, ["label", "title", "name"]) || id,
    task: firstString(record, ["task"]),
    state: firstString(record, ["state", "status"]),
    startedAt: optionalNumber(record["startedAt"]),
    elapsedMs: optionalNumber(record["elapsedMs"]),
    model: firstString(record, ["model"]),
    provider: firstString(record, ["provider"]),
    costUsd: optionalNumber(record["costUsd"]),
    costState: firstString(record, ["costState"]),
    usage:
      usageRecord && Object.keys(usageRecord).length > 0
        ? {
            inputTokens: optionalNumber(usageRecord["inputTokens"]) ?? 0,
            outputTokens: optionalNumber(usageRecord["outputTokens"]) ?? 0,
            cacheReadTokens: optionalNumber(usageRecord["cacheReadTokens"]) ?? 0,
            cacheWriteTokens: optionalNumber(usageRecord["cacheWriteTokens"]) ?? 0,
            llmCallCount: optionalNumber(usageRecord["llmCallCount"]) ?? 0,
            turnCount: optionalNumber(usageRecord["turnCount"]) ?? 0,
            toolCallCount: optionalNumber(usageRecord["toolCallCount"]) ?? 0,
          }
        : null,
    currentActivity:
      activityRecord && Object.keys(activityRecord).length > 0
        ? {
            kind: firstString(activityRecord, ["kind"]),
            text: firstString(activityRecord, ["text"]),
            toolName: firstString(activityRecord, ["toolName"]),
            at: optionalNumber(activityRecord["at"]) ?? 0,
          }
        : null,
    capabilities: {
      interruptible: booleanField(capabilities, "interruptible"),
      killable: booleanField(capabilities, "killable"),
      pausable: booleanField(capabilities, "pausable"),
      resumable: booleanField(capabilities, "resumable"),
      steerable: booleanField(capabilities, "steerable"),
    },
    sessionId: firstString(sessionRef, ["sessionId"]),
    agentId: firstString(sessionRef, ["agentId"]),
    attention:
      attentionRecord && firstString(attentionRecord, ["reason"])
        ? { reason: firstString(attentionRecord, ["reason"]), detail: firstString(attentionRecord, ["detail"]) }
        : null,
    attemptGroup:
      attemptGroupRecord && firstString(attemptGroupRecord, ["groupId"])
        ? {
            groupId: firstString(attemptGroupRecord, ["groupId"]),
            index: optionalNumber(attemptGroupRecord["index"]) ?? 0,
            total: optionalNumber(attemptGroupRecord["total"]) ?? 0,
            held: attemptGroupRecord["held"] === true,
            ready: attemptGroupRecord["ready"] === true,
          }
        : null,
    observed:
      observedRecord && Object.keys(observedRecord).length > 0
        ? {
            externalKind: firstString(observedRecord, ["externalKind"]),
            pid: optionalNumber(observedRecord["pid"]) ?? 0,
            cwd: firstString(observedRecord, ["cwd"]),
            liveness: (() => {
              const liveRecord = asRecord(observedRecord["liveness"]);
              return {
                state: firstString(liveRecord, ["state"]),
                cpuSeconds: optionalNumber(liveRecord["cpuSeconds"]) ?? 0,
                detail: firstString(liveRecord, ["detail"]),
              };
            })(),
            steer: (() => {
              const steerRecord = asRecord(observedRecord["steer"]);
              return {
                kind: firstString(steerRecord, ["kind"]),
                paneId: firstString(steerRecord, ["paneId"]),
                tty: firstString(steerRecord, ["tty"]),
                reason: firstString(steerRecord, ["reason"]),
              };
            })(),
            steerDrillInOnly: observedRecord["steerDrillInOnly"] !== false,
          }
        : null,
    raw: value,
  };
}

export function normalizeFleetSnapshot(value: unknown): FleetSnapshot {
  const record = asRecord(value);
  return {
    capturedAt: optionalNumber(record["capturedAt"]),
    nodes: asArray(record["nodes"]).map(normalizeNode),
    truncated: record["truncated"] === true,
    totalCount: optionalNumber(record["totalCount"]),
  };
}

export function isKnownProcessKind(kind: string): boolean {
  return (KNOWN_PROCESS_KINDS as readonly string[]).includes(kind);
}

/** The one fleet kind goodvibes did not spawn or host — a foreign coding-
 * agent session detected read-only. Never counted in "own agent" totals,
 * never killable/interruptible/pausable/resumable, steerable only via the
 * row's own drill-in detail over a genuine channel. */
export function isObservedKind(kind: string): boolean {
  return kind === "observed-external";
}

export function isKnownProcessState(state: string): boolean {
  return (KNOWN_PROCESS_STATES as readonly string[]).includes(state);
}

export function kindLabel(kind: string): string {
  return kind.trim() || "unknown";
}

export function stateLabel(state: string): string {
  return state.trim() || "unknown";
}

export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state.trim());
}

export function isStalledState(state: string): boolean {
  return state.trim() === "stalled";
}

export function isAwaitingApprovalState(state: string): boolean {
  return state.trim() === "awaiting-approval";
}

/**
 * Honest cost label. costState ∈ 'priced' | 'unpriced' | 'estimated' —
 * never show $0.00 for a node the daemon could not price.
 */
export function costLabel(node: Pick<FleetNode, "costUsd" | "costState">): string {
  if (node.costState === "unpriced") return "unpriced";
  if (node.costUsd == null) return node.costState === "estimated" ? "estimating…" : "unpriced";
  const amount = `$${node.costUsd.toFixed(node.costUsd < 1 ? 4 : 2)}`;
  return node.costState === "estimated" ? `~${amount}` : amount;
}

export function formatDurationMs(ms: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "unknown";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export interface FleetRow {
  readonly node: FleetNode;
  readonly depth: number;
}

/**
 * Flatten the flat, parentId-linked node list into a depth-annotated display
 * order: roots first, each followed by its descendants (depth-first,
 * newest-started-first within siblings). Cycle-guarded so a malformed
 * snapshot degrades to a flat list instead of hanging the view.
 */
export function buildFleetRows(nodes: readonly FleetNode[]): FleetRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const childrenByParent = new Map<string, FleetNode[]>();
  const roots: FleetNode[] = [];

  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      const bucket = childrenByParent.get(node.parentId) ?? [];
      bucket.push(node);
      childrenByParent.set(node.parentId, bucket);
    } else {
      roots.push(node);
    }
  }

  // Attention-first, then newest-started-first: a node the daemon flagged as
  // blocked on a human (attention) floats to the TOP of its sibling group so
  // the operator sees what is waiting on them before anything else, without
  // reordering across the tree (parent/child structure is preserved).
  const byAttentionThenRecency = (a: FleetNode, b: FleetNode) => {
    const attentionDelta = Number(Boolean(b.attention)) - Number(Boolean(a.attention));
    if (attentionDelta !== 0) return attentionDelta;
    return (b.startedAt ?? 0) - (a.startedAt ?? 0);
  };
  roots.sort(byAttentionThenRecency);
  for (const bucket of childrenByParent.values()) bucket.sort(byAttentionThenRecency);

  const rows: FleetRow[] = [];
  const visited = new Set<string>();

  function visit(node: FleetNode, depth: number): void {
    if (visited.has(node.id)) return; // cycle guard
    visited.add(node.id);
    rows.push({ node, depth });
    for (const child of childrenByParent.get(node.id) ?? []) visit(child, depth + 1);
  }

  for (const root of roots) visit(root, 0);
  // A node whose parent chain cycles still renders (at depth 0) rather than
  // silently vanishing.
  for (const node of nodes) {
    if (!visited.has(node.id)) visit(node, 0);
  }

  return rows;
}

/** "N active" — an OWN-agent count. Observed foreign agents are excluded
 * outright: goodvibes did not spawn them, so counting them would overstate
 * its own workload. Their liveness is a separate, honestly-rendered signal
 * per row (ObservedBadge), never folded into this total. */
export function activeCount(nodes: readonly FleetNode[]): number {
  return nodes.filter((n) => !isTerminalState(n.state) && !isObservedKind(n.kind)).length;
}

/** Total nodes goodvibes actually owns/hosts — observed rows excluded. */
export function ownNodeCount(nodes: readonly FleetNode[]): number {
  return nodes.filter((n) => !isObservedKind(n.kind)).length;
}

/** Count of observed (externally-launched) foreign-agent rows in this snapshot. */
export function observedNodeCount(nodes: readonly FleetNode[]): number {
  return nodes.filter((n) => isObservedKind(n.kind)).length;
}

// ─── Attention (needs-a-human) ────────────────────────────────────────────────
//
// fleet.snapshot nodes carry a DERIVED `needsAttention` marker (contract
// 1.11) — a projection of the node's blocked-on-a-human state, recomputed on
// every snapshot and never persisted. 'pick' (a ready best-of-N group) and
// 'conflict' (a merge conflict) are the newest two reasons, alongside the
// pre-existing 'approval'/'input' — ONE waiting-on-human class; only the
// human-facing label is reason-specific.

/** Human-facing label for the attention reason. Verbatim for an unknown future reason. */
export function attentionReasonLabel(reason: string): string {
  if (reason === "approval") return "Needs approval";
  if (reason === "input") return "Needs input";
  if (reason === "pick") return "Needs your pick";
  if (reason === "conflict") return "Merge conflict waiting on you";
  return reason.trim() || "Needs attention";
}

/** How many nodes in this snapshot are blocked on a human right now. */
export function attentionCount(nodes: readonly FleetNode[]): number {
  return nodes.reduce((total, node) => (node.attention ? total + 1 : total), 0);
}

// ─── Best-of-N attempt siblings ────────────────────────────────────────────────
//
// A fleet node that is one attempt of a best-of-N group carries an
// `attemptGroup` marker. This only lets the view collapse the sibling nodes
// into one group node and know which group they belong to — the
// authoritative candidate/diff/judgment data lives in fleet.attempts.list.

/** The set of best-of-N group ids present among these nodes as attempt-
 * sibling markers — FleetView excludes these siblings from the main tree so
 * a group renders as ONE collapsible entry (driven by fleet.attempts.list)
 * rather than N loose rows. */
export function attemptGroupIds(nodes: readonly FleetNode[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.attemptGroup) ids.add(node.attemptGroup.groupId);
  }
  return ids;
}

// ─── Actions this app can genuinely back over the wire ───────────────────────
//
// fleet.snapshot's per-node `capabilities` describe what the underlying
// process CAN do — but the daemon performs interrupt/kill/pause/resume with
// direct in-process calls; only PART of that is an operator wire verb today:
//   - steer: sessions.steer, for an 'agent' node with a live sessionRef.sessionId.
//   - detach: sessions.detach — a session-level action, any node with a sessionId.
//   - stop/start/run: watchers.{stop,start,run}, for a 'watcher' node only
//     (WatcherRecord.id IS the node id; no other kind's node id maps to a
//     verb-addressable entity). start/run are offered unconditionally, same
//     as the Watchers view itself (adaptWatcher's `killable` flag only says
//     "currently alive", not "may be started/run" — the daemon is the one
//     that accepts or rejects an invalid transition).
//   - AGENT CONTROL (GAPS.md §3 row 7, was EXCLUDED): any node with a live
//     sessionRef.sessionId also gets a real, session-level control surface,
//     rendered by FleetAgentControl.tsx —
//       * steer / follow-up: sessions.steer / sessions.followUp (mid-turn
//         guidance vs. queuing the next instruction on a busy agent).
//       * interrupt: sessions.inputs.list + sessions.inputs.cancel — cancels
//         a still-queued instruction before it is ever delivered.
//       * stop: sessions.close (ends the session) or the gentler
//         sessions.detach (keeps it running unattended).
//       * resume: sessions.reopen, once the session's own status is 'closed'.
//     None of this is driven by the capability flags below — closing/
//     reopening/queuing an input isn't described by any FleetNodeCapabilities
//     field, it is a plain fact of whether the node carries a sessionId.
//     There is still NO wire verb for a true freeze-and-thaw PAUSE anywhere —
//     never render a control labeled "Pause".
// Every other true capability flag (kill on a non-session process, pause
// anywhere) is real but UNBACKED — the honest note below says so instead of
// a button that would no-op or 404.
export type FleetWireAction = "steer" | "detach" | "stop" | "start" | "run";

// Local query-key namespace for the session-level Agent Control surface
// (FleetAgentControl.tsx) — deliberately NOT in lib/queries.ts's shared
// registry; these mirror queryKeys.sessionInputs/sessionDetail in shape but
// stay fleet-local so this view can invalidate/refetch them without reaching
// into another view's key space.
export const fleetControlKeys = {
  session: (sessionId: string) => ["fleet-control", "session", sessionId] as const,
  inputs: (sessionId: string) => ["fleet-control", "inputs", sessionId] as const,
} as const;

export function wireBackedActions(node: FleetNode): ReadonlySet<FleetWireAction> {
  const actions = new Set<FleetWireAction>();
  // Observed foreign agents are visibility-only — steer is a SEPARATE
  // drill-in verb (fleet.observed.steer, gated on node.observed.steer.kind),
  // never one of these session-level actions, even if a sessionId happened
  // to ride the node.
  if (isObservedKind(node.kind)) return actions;
  const hasSession = node.sessionId.length > 0;
  if (node.kind === "agent" && node.capabilities.steerable && hasSession) actions.add("steer");
  if (hasSession) actions.add("detach");
  if (node.kind === "watcher") {
    if (node.capabilities.killable) actions.add("stop");
    actions.add("start");
    actions.add("run");
  }
  return actions;
}

/**
 * The honest note for capabilities the daemon reports but this app cannot act
 * on over the wire — null when every true flag is wire-backed. Never silently
 * drops the gap; never fabricates a button.
 *
 * Stop/interrupt/resume are now genuinely wire-backed for any node with a
 * live sessionId (FleetAgentControl.tsx: sessions.close/detach,
 * sessions.inputs.cancel, sessions.reopen) — so those flags only surface here
 * for a session-less node (e.g. a bare background-process). Pause has NO
 * wire verb anywhere, session or not — it always surfaces here when true.
 */
export function unbackedCapabilityNote(node: FleetNode): string | null {
  const backed = wireBackedActions(node);
  const hasSession = node.sessionId.length > 0;
  const hasUnbackedKill = node.capabilities.killable && !hasSession && !(node.kind === "watcher" && backed.has("stop"));
  const hasUnbackedInterrupt = node.capabilities.interruptible && !hasSession;
  const hasUnbackedResume = node.capabilities.resumable && !hasSession;
  const hasUnbackedPause = node.capabilities.pausable; // no freeze/thaw verb exists on the wire at all
  if (!hasUnbackedKill && !hasUnbackedInterrupt && !hasUnbackedResume && !hasUnbackedPause) return null;
  const verbs = [
    hasUnbackedKill && "stop/kill",
    hasUnbackedInterrupt && "interrupt",
    hasUnbackedPause && "pause",
    hasUnbackedResume && "resume",
  ].filter((v): v is string => Boolean(v));
  return (
    `The daemon reports this ${kindLabel(node.kind)} process as ${verbs.join("/")}-able, ` +
    `but no operator wire verb exists for '${node.kind}' processes yet — use the TUI for those controls.`
  );
}

// ─── Approvals correlation ────────────────────────────────────────────────────

export interface FleetApproval {
  id: string;
  sessionId: string;
  status: string;
  tool: string;
  category: string;
  riskLevel: string;
  summary: string;
  metadataAgentId: string;
  createdAt: number;
  raw: unknown;
}

/** Tolerant reader over approvals.list's {approvals} envelope. */
export function approvalsFromListResponse(value: unknown): FleetApproval[] {
  const rows = asArray(readPath(value, ["approvals"]));
  return rows.map((entry) => {
    const record = asRecord(entry);
    const request = asRecord(record["request"]);
    const analysis = asRecord(request["analysis"]);
    const metadata = asRecord(record["metadata"]);
    return {
      id: firstString(record, ["id", "approvalId"]),
      sessionId: firstString(record, ["sessionId"]),
      status: firstString(record, ["status"]),
      tool: firstString(request, ["tool"]),
      category: firstString(request, ["category"]),
      riskLevel: firstString(analysis, ["riskLevel"]),
      summary: firstString(analysis, ["summary"]),
      metadataAgentId: firstString(metadata, ["agentId"]),
      createdAt: optionalNumber(record["createdAt"]) ?? 0,
      raw: entry,
    };
  });
}

/**
 * Correlate a fleet node to pending approvals — the SAME two signals the
 * daemon's own fleet registry uses to derive 'awaiting-approval':
 * approval.sessionId === node.sessionId, or (agent nodes) metadata.agentId ===
 * node.id. Not a guess.
 */
export function approvalsForNode(node: FleetNode, approvals: readonly FleetApproval[]): FleetApproval[] {
  return approvals.filter((approval) => {
    if (approval.status !== "pending" && approval.status !== "claimed") return false;
    if (node.sessionId && approval.sessionId === node.sessionId) return true;
    if (node.kind === "agent" && approval.metadataAgentId && approval.metadataAgentId === node.id) return true;
    return false;
  });
}

// ─── Worktree label (GAPS.md §3 row 11) ───────────────────────────────────────
//
// AgentRecord.workingDirectory (goodvibes-sdk platform/tools/agent/manager)
// is the per-agent tool working-directory override — set to the agent's
// isolated git worktree path when the orchestrator spawned it into one.
// fleet's agent adapter puts the WHOLE AgentRecord onto ProcessNode.raw, so
// the field rides the wire honestly; this reads it defensively (never cast)
// and renders NOTHING when the daemon didn't set it (main-tree agents, or an
// older daemon that predates the field) — never a fabricated label.

/** The agent's worktree directory, or "" when the node/daemon doesn't report one. */
export function agentWorkingDirectory(node: FleetNode): string {
  return firstString(asRecord(node.raw), ["workingDirectory"]);
}

/** Last path segment of the working directory — a short, glanceable label; "" when absent. */
export function worktreeLabel(node: FleetNode): string {
  const dir = agentWorkingDirectory(node);
  if (!dir) return "";
  const segments = dir.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? dir;
}

// ─── WRFC chain badges (GAPS.md §3 row 10) ────────────────────────────────────
//
// Neither WrfcChain nor WrfcSubtask (goodvibes-sdk platform/agents/wrfc-types)
// carries a ready-made "c:N/M" or SAT/UNS/UNV field — those are DERIVED here
// from real arrays the wire does send on ProcessNode.raw (the raw WrfcChain /
// WrfcSubtask), never fabricated:
//   - "c:N/M" — subtask completion progress on a compound chain: N of M
//     entries in chain.subtasks have reached a terminal state (passed/failed).
//     A chain with no subtasks array (a simple, non-compound chain) has
//     nothing to count — renders nothing, not "c:0/0".
//   - SAT/UNS/UNV — reviewer constraintFindings tallied by
//     ConstraintFinding.satisfied, with any constraintId present in the
//     chain's own systemUnsatisfiableConstraintIds (constraints the fan-out
//     collapse made impossible for any fix agent to ever satisfy — see
//     WrfcChain.systemUnsatisfiableConstraintIds) reclassified out of
//     UNS into UNV. Absent constraintFindings (no review has run yet) → null,
//     never a zeroed-out tally.

export interface WrfcChainProgress {
  readonly completed: number;
  readonly total: number;
}

const TERMINAL_SUBTASK_STATES = new Set(["passed", "failed"]);

/** "c:N/M" data for a wrfc-chain node with subtasks; null when there is nothing to count. */
export function wrfcChainProgress(node: FleetNode): WrfcChainProgress | null {
  if (node.kind !== "wrfc-chain") return null;
  const subtasks = asArray(readPath(node.raw, ["subtasks"]));
  if (subtasks.length === 0) return null;
  const completed = subtasks.filter((subtask) => TERMINAL_SUBTASK_STATES.has(firstString(subtask, ["state"]))).length;
  return { completed, total: subtasks.length };
}

export interface WrfcConstraintTally {
  readonly sat: number;
  readonly uns: number;
  readonly unv: number;
}

/** Every constraintFindings entry reachable from this node's raw chain/subtask data. */
function collectConstraintFindings(raw: unknown): unknown[] {
  const direct = asArray(readPath(raw, ["reviewerReport", "constraintFindings"]));
  const fromSubtasks = asArray(readPath(raw, ["subtasks"])).flatMap((subtask) =>
    asArray(readPath(subtask, ["reviewerReport", "constraintFindings"])),
  );
  return [...direct, ...fromSubtasks];
}

/** SAT/UNS/UNV tally for a wrfc-chain or wrfc-subtask node; null when no review has reported findings. */
export function wrfcConstraintTally(node: FleetNode): WrfcConstraintTally | null {
  if (node.kind !== "wrfc-chain" && node.kind !== "wrfc-subtask") return null;
  const findings = collectConstraintFindings(node.raw);
  if (findings.length === 0) return null;
  const systemUnsatisfiable = new Set(
    asArray(readPath(node.raw, ["systemUnsatisfiableConstraintIds"])).filter(
      (id): id is string => typeof id === "string",
    ),
  );
  let sat = 0;
  let uns = 0;
  let unv = 0;
  for (const finding of findings) {
    const record = asRecord(finding);
    const constraintId = firstString(record, ["constraintId"]);
    if (constraintId && systemUnsatisfiable.has(constraintId)) unv += 1;
    else if (record["satisfied"] === true) sat += 1;
    else uns += 1;
  }
  return { sat, uns, unv };
}

// ─── Task correlation (GAPS.md §3 row 6) ──────────────────────────────────────
//
// fleet.snapshot never emits a 'task' node kind — tasks.* is a separate
// runtime registry (goodvibes-sdk platform/runtime/tasks). The one genuine,
// provable link between a fleet node and a RuntimeTask is the 'agent' kind:
// AgentTaskAdapter.wrapAgent (platform/runtime/tasks/adapters/agent-adapter)
// creates every kind:'agent' RuntimeTask with `owner: agentId`, and an
// 'agent' fleet node's id IS that agentId. No other node kind's id maps to a
// task field at all — never fabricate a task action for one.

/** The RuntimeTask backing this 'agent' node, or null when there isn't one (no task, or a non-agent node). */
export function taskForNode(node: FleetNode, tasks: readonly TaskSummary[]): TaskSummary | null {
  if (node.kind !== "agent" || !node.id) return null;
  return tasks.find((task) => task.kind === "agent" && task.owner === node.id) ?? null;
}

/** Same transition guard the daemon itself enforces (TasksSection.tsx parity): retry only from a terminal failure/cancellation. */
export function canRetryTask(task: TaskSummary): boolean {
  return task.status === "failed" || task.status === "cancelled";
}
