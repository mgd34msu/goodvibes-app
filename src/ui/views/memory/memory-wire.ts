// memory-wire.ts — types, defensive wire parsers, pure helpers, and local
// query keys for the Memory view (docs/FEATURES.md §7).
//
// Wire shapes are hand-checked against the SDK's own runtime schemas
// (goodvibes-sdk packages/sdk/src/platform/control-plane/
// operator-contract-schemas-runtime.ts: MEMORY_RECORD_SCHEMA,
// MEMORY_RECORD_SEARCH_OUTPUT_SCHEMA, MEMORY_LINK_SCHEMA,
// MEMORY_BUNDLE_SCHEMA, MEMORY_IMPORT_RESULT_SCHEMA,
// MEMORY_VECTOR_STATS_SCHEMA, MEMORY_DOCTOR_REPORT_SCHEMA) but every reader
// is defensive — a field missing on an older daemon degrades to a rendered
// "—", never a crash.

import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

// ─── Vocabularies (form constants; rendering treats them as open strings) ────

export const MEMORY_CLASSES = [
  "decision",
  "constraint",
  "incident",
  "pattern",
  "fact",
  "risk",
  "runbook",
  "architecture",
  "ownership",
] as const;
export type MemoryClass = (typeof MEMORY_CLASSES)[number];

export const MEMORY_SCOPES = ["session", "project", "team"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_REVIEW_STATES = ["fresh", "reviewed", "stale", "contradicted"] as const;
export type MemoryReviewState = (typeof MEMORY_REVIEW_STATES)[number];

/** Directed-relation suggestions for the link form (open vocabulary — the
 * daemon accepts any string; these are the relations the TUI uses). */
export const MEMORY_LINK_RELATIONS = ["supersedes", "caused", "relates-to", "duplicates", "refines"] as const;

// ─── Local query keys — everything under the ["memory"] prefix so one
// invalidateQueries({queryKey: ["memory"]}) after a mutation refetches the
// list, every open detail/links query, the review queue, and the admin
// panels in one shot. Matches lib/queries.ts memoryList/memoryReviewQueue
// prefixes; memory has NO wire event domain, so nothing else invalidates it.

export const memoryKeys = {
  all: ["memory"] as const,
  list: (filters: unknown) => ["memory", "list", filters] as const,
  semantic: (filters: unknown) => ["memory", "semantic", filters] as const,
  record: (id: string) => ["memory", "record", id] as const,
  links: (id: string) => ["memory", "links", id] as const,
  reviewQueue: ["memory", "review-queue"] as const,
  vector: ["memory", "vector"] as const,
  doctor: ["memory", "doctor"] as const,
  // Matches lib/queries.ts's queryKeys.memoryConsolidation/memoryProjections
  // tuples so both stay under the ["memory"] invalidation prefix.
  consolidation: ["memory", "consolidation"] as const,
  projections: ["memory", "projections"] as const,
  projection: (id: string) => ["memory", "projections", id] as const,
} as const;

// ─── Wire types ───────────────────────────────────────────────────────────────

export interface MemoryProvenanceLink {
  kind: string;
  ref: string;
  label?: string;
}

export interface MemoryRecord {
  id: string;
  /** Open strings on read (daemon-defined vocabulary rendered verbatim). */
  scope: string;
  cls: string;
  summary: string;
  detail?: string;
  tags: string[];
  provenance: MemoryProvenanceLink[];
  reviewState: string;
  confidence: number;
  reviewedAt?: number;
  reviewedBy?: string;
  staleReason?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** The recall-honesty envelope memory.records.search returns verbatim
 * (HonestMemorySearchResult on the wire). `mode` is the path that ACTUALLY
 * ran; `indexUnavailableReason` is non-null only when semantic was requested
 * but could not be consulted. */
export interface MemorySearchEnvelope {
  records: MemoryRecord[];
  mode: "literal" | "semantic";
  requestedSemantic: boolean;
  indexUnavailableReason: string | null;
  caveat: string | null;
  recallFiltered: boolean;
  excludedFlaggedCount: number;
  excludedBelowFloorCount: number;
  totalBeforeRecallFilter: number;
  /** The store's configured recall confidence floor, carried on the wire so
   * labels never hardcode a number. undefined when an older daemon omits it. */
  recallFloor?: number;
}

export interface MemoryLink {
  fromId: string;
  toId: string;
  relation: string;
  createdAt?: number;
}

export interface MemoryVectorStats {
  backend: string;
  enabled: boolean;
  available: boolean;
  path: string;
  dimensions?: number;
  indexedRecords?: number;
  embeddingProviderId: string;
  embeddingProviderLabel: string;
  error?: string;
  platformLimitReason?: string;
}

export interface MemoryEmbeddingProviderStatus {
  id: string;
  label: string;
  state: string;
  dimensions?: number;
  configured: boolean;
  deterministic?: boolean;
  detail?: string;
}

export interface MemoryEmbeddingsReport {
  activeProviderId: string;
  providers: MemoryEmbeddingProviderStatus[];
  warnings: string[];
}

export interface MemoryDoctorReport {
  vector: MemoryVectorStats | null;
  embeddings: MemoryEmbeddingsReport | null;
  checkedAt?: number;
}

export interface MemoryImportCounts {
  importedRecords: number;
  skippedRecords: number;
  importedLinks: number;
}

/** Search/browse filters this view applies (the wire's shared filter fields
 * plus the search-only `recall` flag). */
export interface MemoryFilters {
  query?: string;
  semantic?: boolean;
  scope?: string;
  cls?: string;
  tags?: string[];
  recall?: boolean;
  limit: number;
}

// ─── Defensive parsers ────────────────────────────────────────────────────────

function parseProvenance(value: unknown): MemoryProvenanceLink[] {
  return asArray(value).flatMap((item) => {
    const record = asRecord(item);
    const ref = firstString(record, ["ref"]);
    if (!ref) return [];
    const label = firstString(record, ["label"]);
    return [{ kind: firstString(record, ["kind"]) || "ref", ref, ...(label ? { label } : {}) }];
  });
}

function parseStrings(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

export function parseMemoryRecord(value: unknown): MemoryRecord | null {
  const record = asRecord(value);
  const id = firstString(record, ["id"]);
  if (!id) return null;
  const detail = firstString(record, ["detail"]);
  const reviewedBy = firstString(record, ["reviewedBy"]);
  const staleReason = firstString(record, ["staleReason"]);
  return {
    id,
    scope: firstString(record, ["scope"]) || "unknown",
    cls: firstString(record, ["cls"]) || "unknown",
    summary: firstString(record, ["summary"]) || "(no summary)",
    ...(detail ? { detail } : {}),
    tags: parseStrings(record["tags"]),
    provenance: parseProvenance(record["provenance"]),
    reviewState: firstString(record, ["reviewState"]) || "unknown",
    confidence: firstNumber(record, ["confidence"]) ?? 0,
    ...(firstNumber(record, ["reviewedAt"]) !== undefined ? { reviewedAt: firstNumber(record, ["reviewedAt"]) } : {}),
    ...(reviewedBy ? { reviewedBy } : {}),
    ...(staleReason ? { staleReason } : {}),
    ...(firstNumber(record, ["createdAt"]) !== undefined ? { createdAt: firstNumber(record, ["createdAt"]) } : {}),
    ...(firstNumber(record, ["updatedAt"]) !== undefined ? { updatedAt: firstNumber(record, ["updatedAt"]) } : {}),
  };
}

export function parseMemoryRecords(value: unknown): MemoryRecord[] {
  return asArray(value).flatMap((item) => {
    const parsed = parseMemoryRecord(item);
    return parsed ? [parsed] : [];
  });
}

/** Unwrap entity envelopes: {record: {...}} or a bare record. */
export function parseRecordEntity(value: unknown): MemoryRecord | null {
  const outer = asRecord(value);
  return parseMemoryRecord(outer["record"] ?? value);
}

export function parseSearchEnvelope(value: unknown): MemorySearchEnvelope {
  const record = asRecord(value);
  const floor = firstNumber(record, ["recallFloor"]);
  return {
    records: parseMemoryRecords(record["records"]),
    mode: record["mode"] === "semantic" ? "semantic" : "literal",
    requestedSemantic: record["requestedSemantic"] === true,
    indexUnavailableReason:
      typeof record["indexUnavailableReason"] === "string" && record["indexUnavailableReason"].trim()
        ? record["indexUnavailableReason"]
        : null,
    caveat: typeof record["caveat"] === "string" && record["caveat"].trim() ? record["caveat"] : null,
    recallFiltered: record["recallFiltered"] === true,
    excludedFlaggedCount: firstNumber(record, ["excludedFlaggedCount"]) ?? 0,
    excludedBelowFloorCount: firstNumber(record, ["excludedBelowFloorCount"]) ?? 0,
    totalBeforeRecallFilter: firstNumber(record, ["totalBeforeRecallFilter"]) ?? 0,
    ...(floor !== undefined ? { recallFloor: floor } : {}),
  };
}

export function parseLinks(value: unknown): MemoryLink[] {
  return asArray(asRecord(value)["links"] ?? value).flatMap((item) => {
    const record = asRecord(item);
    const fromId = firstString(record, ["fromId"]);
    const toId = firstString(record, ["toId"]);
    if (!fromId && !toId) return [];
    const createdAt = firstNumber(record, ["createdAt"]);
    return [
      {
        fromId,
        toId,
        relation: firstString(record, ["relation"]) || "related",
        ...(createdAt !== undefined ? { createdAt } : {}),
      },
    ];
  });
}

/** memory.records.search-semantic result → id → similarity (0..1). */
export function parseSemanticScores(value: unknown): Map<string, number> {
  const scores = new Map<string, number>();
  for (const item of asArray(asRecord(value)["results"])) {
    const row = asRecord(item);
    const id = firstString(asRecord(row["record"]), ["id"]);
    const similarity = firstNumber(row, ["similarity"]);
    if (id && similarity !== undefined) scores.set(id, similarity);
  }
  return scores;
}

export function parseVectorStats(value: unknown): MemoryVectorStats | null {
  const outer = asRecord(value);
  const record = asRecord(outer["vector"] ?? value);
  if (Object.keys(record).length === 0) return null;
  const error = firstString(record, ["error"]);
  const platformLimitReason = firstString(record, ["platformLimitReason"]);
  return {
    backend: firstString(record, ["backend"]) || "unknown",
    enabled: record["enabled"] === true,
    available: record["available"] === true,
    path: firstString(record, ["path"]),
    ...(firstNumber(record, ["dimensions"]) !== undefined ? { dimensions: firstNumber(record, ["dimensions"]) } : {}),
    ...(firstNumber(record, ["indexedRecords"]) !== undefined
      ? { indexedRecords: firstNumber(record, ["indexedRecords"]) }
      : {}),
    embeddingProviderId: firstString(record, ["embeddingProviderId"]),
    embeddingProviderLabel: firstString(record, ["embeddingProviderLabel"]),
    ...(error ? { error } : {}),
    ...(platformLimitReason ? { platformLimitReason } : {}),
  };
}

export function parseDoctorReport(value: unknown): MemoryDoctorReport {
  const record = asRecord(value);
  const embeddings = asRecord(record["embeddings"]);
  const hasEmbeddings = Object.keys(embeddings).length > 0;
  const checkedAt = firstNumber(record, ["checkedAt"]);
  return {
    vector: parseVectorStats(record["vector"]),
    embeddings: hasEmbeddings
      ? {
          activeProviderId: firstString(embeddings, ["activeProviderId"]),
          providers: asArray(embeddings["providers"]).map((item) => {
            const provider = asRecord(item);
            const detail = firstString(provider, ["detail"]);
            return {
              id: firstString(provider, ["id"]),
              label: firstString(provider, ["label"]) || firstString(provider, ["id"]),
              state: firstString(provider, ["state"]) || "unknown",
              ...(firstNumber(provider, ["dimensions"]) !== undefined
                ? { dimensions: firstNumber(provider, ["dimensions"]) }
                : {}),
              configured: provider["configured"] === true,
              ...(typeof provider["deterministic"] === "boolean"
                ? { deterministic: provider["deterministic"] }
                : {}),
              ...(detail ? { detail } : {}),
            };
          }),
          warnings: parseStrings(embeddings["warnings"]),
        }
      : null,
    ...(checkedAt !== undefined ? { checkedAt } : {}),
  };
}

export function parseImportCounts(value: unknown): MemoryImportCounts {
  const outer = asRecord(value);
  const record = asRecord(outer["result"] ?? value);
  return {
    importedRecords: firstNumber(record, ["importedRecords"]) ?? 0,
    skippedRecords: firstNumber(record, ["skippedRecords"]) ?? 0,
    importedLinks: firstNumber(record, ["importedLinks"]) ?? 0,
  };
}

// ─── Pure helpers (ported from goodvibes-webui views/memory/memory-helpers.ts) ─

/** Comma separated, trimmed, blanks dropped. */
export function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Review-state badge tone: stale/contradicted are the flagged states the
 * recall contract excludes outright regardless of confidence. */
export function reviewStateTone(state: string): "ok" | "warning" | "bad" | "neutral" {
  switch (state) {
    case "reviewed":
      return "ok";
    case "stale":
      return "warning";
    case "contradicted":
      return "bad";
    default:
      return "neutral";
  }
}

export function isFlaggedReviewState(state: string): boolean {
  return state === "stale" || state === "contradicted";
}

/** Below the store's recall floor a record is never injected into a prompt
 * even when unflagged. `recallFloor` is the LIVE wire value the search result
 * carried — when an older daemon omits it we make no below-floor claim. */
export function isBelowRecallFloor(record: MemoryRecord, recallFloor: number | undefined): boolean {
  return recallFloor !== undefined && record.confidence < recallFloor;
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence)}%`;
}

// ─── Learning-review triage buckets (docs/GAPS.md §8 row 12 — the memory-side
// half: client-side buckets over the SAME review-queue data, using the
// review-state transitions memory.records.update-review already ships. No
// new wire verb; this is purely a client-side lens over memory.review-queue). ─

/** Below this, a record is "low confidence" for triage purposes — a fixed,
 * documented threshold (matches the AddMemoryForm default of 60), NOT the
 * dynamic per-search recallFloor (the review queue response carries no
 * recallFloor of its own to compare against). */
export const LOW_CONFIDENCE_TRIAGE_THRESHOLD = 60;

export function isStaleRecord(record: MemoryRecord): boolean {
  return record.reviewState === "stale";
}

export function isLowConfidenceRecord(record: MemoryRecord): boolean {
  return record.confidence < LOW_CONFIDENCE_TRIAGE_THRESHOLD;
}

/** Normalize a summary for duplicate grouping: lowercase, collapse whitespace,
 * strip trailing punctuation — a heuristic, not a semantic match. */
function normalizeSummary(summary: string): string {
  return summary.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
}

/** Ids of records that share a normalized summary + class with at least one
 * OTHER record in the same list — a cheap duplicate-candidate heuristic
 * (exact-ish text match, not embeddings) over whatever page of records the
 * review queue returned. */
export function findDuplicateRecordIds(records: readonly MemoryRecord[]): ReadonlySet<string> {
  const groups = new Map<string, string[]>();
  for (const record of records) {
    const key = `${record.cls}|${normalizeSummary(record.summary)}`;
    const group = groups.get(key);
    if (group) group.push(record.id);
    else groups.set(key, [record.id]);
  }
  const duplicateIds = new Set<string>();
  for (const group of groups.values()) {
    if (group.length > 1) for (const id of group) duplicateIds.add(id);
  }
  return duplicateIds;
}

export const REVIEW_TRIAGE_BUCKETS = ["all", "stale", "low-confidence", "duplicates"] as const;
export type ReviewTriageBucket = (typeof REVIEW_TRIAGE_BUCKETS)[number];

export function isReviewTriageBucket(value: string): value is ReviewTriageBucket {
  return (REVIEW_TRIAGE_BUCKETS as readonly string[]).includes(value);
}

export const REVIEW_TRIAGE_LABELS: ReadonlyArray<[ReviewTriageBucket, string]> = [
  ["all", "All"],
  ["stale", "Stale"],
  ["low-confidence", "Low confidence"],
  ["duplicates", "Possible duplicates"],
];

export function formatSimilarity(similarity: number): string {
  return `${Math.round(similarity * 100)}% match`;
}

export function formatProvenanceLink(link: MemoryProvenanceLink): string {
  return link.label ? `${link.label} (${link.kind}: ${link.ref})` : `${link.kind}: ${link.ref}`;
}

export function formatTimestamp(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Date(value).toLocaleString();
}

/** Build the search/export body from applied filters, dropping empties.
 * `includeRecall=false` for memory.records.export — `recall` is search-only
 * on the wire (MEMORY_SEARCH_FILTER_FIELDS has no recall). */
export function filtersToBody(filters: MemoryFilters, includeRecall: boolean): Record<string, unknown> {
  return {
    limit: filters.limit,
    ...(filters.query ? { query: filters.query } : {}),
    ...(filters.semantic ? { semantic: true } : {}),
    ...(filters.scope ? { scope: filters.scope } : {}),
    ...(filters.cls ? { cls: filters.cls } : {}),
    ...(filters.tags && filters.tags.length ? { tags: filters.tags } : {}),
    ...(includeRecall && filters.recall ? { recall: true } : {}),
  };
}

/** Extract + sanity-check a bundle from a parsed import file: accepts either
 * the raw bundle or an export download wrapped as {bundle}. Returns null when
 * the shape is not a memory bundle at all. */
export function extractBundle(
  value: unknown,
): { bundle: Record<string, unknown>; recordCount: number; linkCount: number } | null {
  const outer = asRecord(value);
  const bundle = asRecord(outer["bundle"] ?? value);
  const records = asArray(bundle["records"]);
  const links = asArray(bundle["links"]);
  if (!Array.isArray(bundle["records"])) return null;
  return { bundle, recordCount: records.length, linkCount: links.length };
}

// ─── Consolidation receipts (memory.consolidation.receipts) ───────────────────
//
// Idle/scheduled consolidation performs only REVERSIBLE operations on its own
// (merge exact duplicates, decay never-referenced aged records); anything
// needing a human call (contradiction, cross-scope duplicate, stale-delete)
// is emitted as a PROPOSAL instead. The records a proposal references are
// already marked into the review queue by the consolidation pass itself —
// this is purely a legibility layer (what kind, which records, why) with a
// jump to the review queue below, never a second resolution path.

export type ConsolidationProposalKind = "contradiction" | "cross-scope-duplicate" | "stale-delete";

export interface ConsolidationProposal {
  kind: ConsolidationProposalKind | string;
  ids: string[];
  /** An internal agent-tool invocation string on the wire — never a link. */
  route: string;
  reason: string;
}

export interface ConsolidationRunReceipt {
  runId: string;
  ranAt: string;
  trigger: string;
  idle: boolean;
  scanned: number;
  merged: unknown[];
  archived: unknown[];
  decayed: unknown[];
  proposed: ConsolidationProposal[];
  usageSignalAvailable: boolean;
  note: string;
}

export interface ConsolidationReceiptsResult {
  receipts: ConsolidationRunReceipt[];
  pendingProposals: ConsolidationProposal[];
}

export const CONSOLIDATION_PROPOSAL_KIND_LABEL: Record<string, string> = {
  contradiction: "Contradiction",
  "cross-scope-duplicate": "Cross-scope duplicate",
  "stale-delete": "Stale — propose delete",
};

function parseConsolidationProposal(value: unknown): ConsolidationProposal | null {
  const record = asRecord(value);
  const reason = firstString(record, ["reason"]);
  const ids = parseStrings(record["ids"]);
  if (!reason && ids.length === 0) return null;
  return {
    kind: firstString(record, ["kind"]) || "unknown",
    ids,
    route: firstString(record, ["route"]),
    reason,
  };
}

function parseConsolidationRunReceipt(value: unknown): ConsolidationRunReceipt | null {
  const record = asRecord(value);
  const runId = firstString(record, ["runId"]);
  if (!runId) return null;
  return {
    runId,
    ranAt: firstString(record, ["ranAt"]),
    trigger: firstString(record, ["trigger"]) || "unknown",
    idle: record["idle"] === true,
    scanned: firstNumber(record, ["scanned"]) ?? 0,
    merged: asArray(record["merged"]),
    archived: asArray(record["archived"]),
    decayed: asArray(record["decayed"]),
    proposed: asArray(record["proposed"]).flatMap((item) => {
      const parsed = parseConsolidationProposal(item);
      return parsed ? [parsed] : [];
    }),
    usageSignalAvailable: record["usageSignalAvailable"] === true,
    note: firstString(record, ["note"]),
  };
}

export function parseConsolidationReceipts(value: unknown): ConsolidationReceiptsResult {
  const record = asRecord(value);
  return {
    receipts: asArray(record["receipts"]).flatMap((item) => {
      const parsed = parseConsolidationRunReceipt(item);
      return parsed ? [parsed] : [];
    }),
    pendingProposals: asArray(record["pendingProposals"]).flatMap((item) => {
      const parsed = parseConsolidationProposal(item);
      return parsed ? [parsed] : [];
    }),
  };
}

export function formatConsolidationRunAt(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : value || "—";
}

// ─── Standing-memory projections (memory.projections.list/get) ────────────────
//
// The live markdown projection of standing (project/team-scope) memory
// records — computed from the store on EVERY call, never read from disk or
// cached. A projection entry is present even when expired (status:"expired"),
// never silently dropped.

export const MEMORY_PROJECTION_STATUSES = ["active", "pending", "expired"] as const;
export type MemoryProjectionStatus = (typeof MEMORY_PROJECTION_STATUSES)[number];

export interface MemoryProjectionMeta {
  id: string;
  filename: string;
  scope: string;
  cls: string;
  summary: string;
  tags: string[];
  confidence: number;
  reviewState: string;
  validFrom?: number;
  validUntil?: number;
  status: string;
}

export interface MemoryProjectionDetail {
  projection: MemoryProjectionMeta;
  markdown: string;
}

function parseProjectionMeta(value: unknown): MemoryProjectionMeta | null {
  const record = asRecord(value);
  const id = firstString(record, ["id"]);
  if (!id) return null;
  const validFrom = firstNumber(record, ["validFrom"]);
  const validUntil = firstNumber(record, ["validUntil"]);
  return {
    id,
    filename: firstString(record, ["filename"]),
    scope: firstString(record, ["scope"]) || "unknown",
    cls: firstString(record, ["cls"]) || "unknown",
    summary: firstString(record, ["summary"]) || "(no summary)",
    tags: parseStrings(record["tags"]),
    confidence: firstNumber(record, ["confidence"]) ?? 0,
    reviewState: firstString(record, ["reviewState"]) || "unknown",
    ...(validFrom !== undefined ? { validFrom } : {}),
    ...(validUntil !== undefined ? { validUntil } : {}),
    status: firstString(record, ["status"]) || "unknown",
  };
}

export function parseMemoryProjections(value: unknown): MemoryProjectionMeta[] {
  const record = asRecord(value);
  return asArray(record["projections"] ?? value).flatMap((item) => {
    const parsed = parseProjectionMeta(item);
    return parsed ? [parsed] : [];
  });
}

export function parseMemoryProjectionDetail(value: unknown): MemoryProjectionDetail | null {
  const outer = asRecord(value);
  const projection = parseProjectionMeta(outer["projection"]);
  if (!projection) return null;
  return { projection, markdown: firstString(outer, ["markdown"]) };
}

export function projectionStatusTone(status: string): "ok" | "warning" | "neutral" {
  if (status === "active") return "ok";
  if (status === "expired") return "warning";
  return "neutral";
}

/** JSON file download via a Blob object URL (no daemon file writes). */
export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
