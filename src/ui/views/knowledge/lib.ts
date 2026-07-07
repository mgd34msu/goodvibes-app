// Knowledge view — local query keys + shared readers (docs/FEATURES.md §6).
//
// Key discipline: every key here is prefixed ["knowledge", …] so one
// mutation-side `invalidateQueries({ queryKey: ["knowledge"] })` fans out to
// the whole domain. The four keys that already exist in lib/queries.ts
// (status / sources / nodes / issues) are re-exported from there so the
// `knowledge` domain SSE invalidation (lib/realtime.ts DOMAIN_INVALIDATIONS)
// hits exactly the same arrays. Everything else is view-local — the daemon
// emits NO wire events for jobs/candidates/refinement/etc., so those queries
// poll (comments at each use site).

import { queryKeys } from "../../lib/queries.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";

export const KNOWLEDGE_PREFIX = ["knowledge"] as const;

export const kKeys = {
  // Aligned with lib/queries.ts — invalidated live by the `knowledge` domain.
  status: queryKeys.knowledgeStatus,
  sources: queryKeys.knowledgeSources,
  nodes: queryKeys.knowledgeNodes,
  issues: queryKeys.knowledgeIssues,
  // View-local (no wire events — poll or refetch-on-mutation).
  map: (filter: string) => ["knowledge", "map", filter] as const,
  item: (id: string) => ["knowledge", "item", id] as const,
  jobs: ["knowledge", "jobs"] as const,
  jobRuns: ["knowledge", "job-runs"] as const,
  schedules: ["knowledge", "schedules"] as const,
  candidates: ["knowledge", "candidates"] as const,
  refinementTasks: ["knowledge", "refinement", "tasks"] as const,
  projections: ["knowledge", "projections"] as const,
  reports: ["knowledge", "reports"] as const,
  reportDetail: (id: string) => ["knowledge", "reports", id] as const,
  usage: ["knowledge", "usage"] as const,
  extractions: ["knowledge", "extractions"] as const,
  extractionDetail: (id: string) => ["knowledge", "extractions", id] as const,
  connectors: ["knowledge", "connectors"] as const,
  connectorDoctor: (id: string) => ["knowledge", "connectors", id, "doctor"] as const,
  graphqlSchema: ["knowledge", "graphql", "schema"] as const,
  agentScopeProbe: ["knowledge", "agent-scope-probe"] as const,
} as const;

/** Client-side page window over a fully-fetched list (webui pattern). */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

export function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Best-effort record id for knowledge rows (sources/nodes/issues/candidates). */
export function knowledgeId(value: unknown): string {
  return firstString(value, ["id", "sourceId", "nodeId", "issueId", "slug"]);
}

export function knowledgeTitle(value: unknown, fallback = "Untitled"): string {
  return (
    firstString(value, ["title", "label", "name", "slug", "summary", "sourceUri", "canonicalUri", "id"]) || fallback
  );
}

export function knowledgeStatusText(value: unknown): string {
  return firstString(value, ["status", "state", "severity", "health"]) || "unknown";
}

/** Numeric count off knowledge.status, undefined while unknown. */
export function statusCount(status: unknown, key: string): number | undefined {
  return firstNumber(status, [key]);
}

/** The list array for a knowledge list response, tolerant of envelope drift. */
export function knowledgeList(value: unknown, primary: string): unknown[] {
  return firstArray(value, [primary, "items", "data", "results"]);
}

export function formatEpoch(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toLocaleString();
  }
  if (typeof value === "string" && value.trim()) return value;
  return "";
}

/** Flat scalar entries of a record — for key/value fact grids. */
export function scalarEntries(value: unknown): Array<[string, string]> {
  const record = asRecord(value);
  const out: Array<[string, string]> = [];
  for (const [key, item] of Object.entries(record)) {
    if (item === null || item === undefined) continue;
    if (typeof item === "string" && item.trim()) out.push([key, item]);
    else if (typeof item === "number" && Number.isFinite(item)) out.push([key, String(item)]);
    else if (typeof item === "boolean") out.push([key, String(item)]);
  }
  return out;
}
