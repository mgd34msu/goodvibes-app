// fleet-graph.ts — tolerant readers + display helpers for fleet.graph.get
// (operator contract 1.11): the dependency-graph view of one workstream —
// nodes (state/cluster/files/merge state/blocked reason/orphaned/remaining
// depth/stalled/agent), edges (from depends on to), and the elastic-pool
// summary (ready/running/at-cap/cap key+size/refusal).
//
// Rendered as a VERTICAL LIST (deliberate, per the brief) — legible at any
// width; a node-link diagram earns its complexity only once this list stops
// being readable, which it is not.
//
// Node `state` is a WorkItemState (platform/orchestration/types.ts) — a
// DIFFERENT vocabulary from fleet.snapshot's ProcessState (fleet.ts): this
// client is hand-mirrored from the SDK source rather than generated, so a
// daemon newer than this client may report a state it has never seen —
// render it verbatim, never drop it. Ported from goodvibes-webui
// src/lib/fleet-graph.ts.

import { asArray, asRecord, firstString } from "../../lib/wire.ts";
import type { BadgeTone } from "../../lib/presentation-bridge.ts";

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** WorkItemState (platform/orchestration/types.ts) at the time of writing. */
export const KNOWN_GRAPH_NODE_STATES = [
  "pending",
  "awaiting-capacity",
  "in-phase",
  "passed",
  "failed",
  "blocked-budget",
  "blocked-dependency",
  "held-merge",
] as const;

export function isKnownGraphNodeState(state: string): boolean {
  return (KNOWN_GRAPH_NODE_STATES as readonly string[]).includes(state);
}

export interface FleetGraphNode {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly cluster: string;
  readonly files: readonly string[];
  readonly mergeState: string;
  readonly blockedReason: string;
  readonly orphaned: boolean;
  readonly remainingDepth: number;
  readonly stalled: boolean;
  readonly agentId: string;
}

export interface FleetGraphEdge {
  readonly from: string;
  readonly to: string;
}

export interface FleetGraphPool {
  readonly ready: number;
  readonly running: number;
  readonly atCap: boolean;
  readonly capKey: string;
  readonly maxSize: number;
  readonly refusal: string;
}

export interface FleetGraphResult {
  readonly workstreamId: string;
  readonly title: string;
  readonly nodes: readonly FleetGraphNode[];
  readonly edges: readonly FleetGraphEdge[];
  /** null when this workstream has no elastic pool (fixed-capacity/single-agent run) — never a fabricated "0 ready, 0 running". */
  readonly pool: FleetGraphPool | null;
}

function normalizeGraphNode(value: unknown): FleetGraphNode {
  const record = asRecord(value);
  const id = firstString(record, ["id"]);
  return {
    id,
    title: firstString(record, ["title"]) || id,
    state: firstString(record, ["state"]),
    cluster: firstString(record, ["cluster"]),
    files: asArray(record["files"]).filter((f): f is string => typeof f === "string"),
    mergeState: firstString(record, ["mergeState"]),
    blockedReason: firstString(record, ["blockedReason"]),
    orphaned: record["orphaned"] === true,
    remainingDepth: optionalNumber(record["remainingDepth"]) ?? 0,
    stalled: record["stalled"] === true,
    agentId: firstString(record, ["agentId"]),
  };
}

function normalizeGraphEdge(value: unknown): FleetGraphEdge {
  const record = asRecord(value);
  return { from: firstString(record, ["from"]), to: firstString(record, ["to"]) };
}

function normalizeGraphPool(value: unknown): FleetGraphPool | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  return {
    ready: optionalNumber(record["ready"]) ?? 0,
    running: optionalNumber(record["running"]) ?? 0,
    atCap: record["atCap"] === true,
    capKey: firstString(record, ["capKey"]),
    maxSize: optionalNumber(record["maxSize"]) ?? 0,
    refusal: firstString(record, ["refusal"]),
  };
}

export function normalizeFleetGraph(value: unknown): FleetGraphResult {
  const record = asRecord(value);
  return {
    workstreamId: firstString(record, ["workstreamId"]),
    title: firstString(record, ["title"]),
    nodes: asArray(record["nodes"]).map(normalizeGraphNode),
    edges: asArray(record["edges"]).map(normalizeGraphEdge),
    pool: normalizeGraphPool(record["pool"]),
  };
}

/** The plain-language "tell" a task-graph row shows for its state — matches
 * the brief's own vocabulary (ready/running/blocked/at-cap/stalled) where it
 * maps cleanly, and states an unknown value verbatim otherwise. */
export function graphNodeStateLabel(state: string): string {
  switch (state) {
    case "pending":
      return "Ready";
    case "awaiting-capacity":
      return "Ready (at cap)";
    case "in-phase":
      return "Running";
    case "passed":
      return "Done";
    case "failed":
      return "Failed";
    case "blocked-budget":
    case "blocked-dependency":
      return "Blocked";
    case "held-merge":
      return "Held (attempts)";
    default:
      return state.trim() || "unknown";
  }
}

export function graphNodeStateTone(state: string): BadgeTone {
  switch (state) {
    case "pending":
    case "passed":
      return "neutral";
    case "awaiting-capacity":
    case "blocked-budget":
    case "blocked-dependency":
    case "held-merge":
      return "warning";
    case "in-phase":
      return "ok";
    case "failed":
      return "bad";
    default:
      return "warning"; // unknown-to-this-client state — honesty warning, same stance as fleet.ts
  }
}

/** "N ready, M running[, at cap (fleet.maxSize=K)]" — verbatim in the brief's
 * own wording; the "at cap" clause only when the daemon reports it. */
export function poolSummaryLabel(pool: FleetGraphPool): string {
  const base = `${pool.ready} ready, ${pool.running} running`;
  return pool.atCap ? `${base}, at cap (fleet.maxSize=${pool.maxSize})` : base;
}

/** Titles of the nodes this node depends on (edges "from depends on to",
 * fleet.graph.get's own wording) — the dependency mentions a vertical-list
 * row shows instead of drawing an edge. */
export function dependencyTitlesForNode(
  nodeId: string,
  edges: readonly FleetGraphEdge[],
  nodesById: ReadonlyMap<string, FleetGraphNode>,
): string[] {
  return edges
    .filter((edge) => edge.from === nodeId)
    .map((edge) => nodesById.get(edge.to)?.title ?? edge.to)
    .filter((title): title is string => Boolean(title));
}
