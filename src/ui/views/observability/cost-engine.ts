// App-local cost analytics engine (docs/FEATURES.md §17): 4 disjoint token
// buckets (input/output/cache-read/cache-write) plus an "Ephemeral" rollup
// bucket for sessions with no stable project identity — the desktop autopsy
// (docs/research/desktop-prior-art.md §3, Theme 4) flagged the prior art for
// showing ephemeral wf_* work-dirs as real "projects" and cumulative token
// counts with no framing at all. This engine ports that praised 4-bucket +
// dedup + dated-pricing shape over the wire (providers.usage.get + telemetry
// usage events) instead of a local SQLite scan, and keeps every ephemeral
// rollup under one clearly-labeled bucket instead of inflating named projects.
//
// Pure, side-effect-free — the view layer owns fetching and rendering.

import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";

export interface TokenBuckets {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const ZERO_BUCKETS: TokenBuckets = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addBuckets(a: TokenBuckets, b: TokenBuckets): TokenBuckets {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

export function bucketsTotal(b: TokenBuckets): number {
  return b.input + b.output + b.cacheRead + b.cacheWrite;
}

// ---------------------------------------------------------------------------
// Dated pricing table — USD per 1M tokens. A small hand-maintained snapshot,
// NOT a live catalog fetch: honesty-over-false-precision per docs/UX.md §1.
// Cache-write/-read ratios follow the common provider convention (cache
// write ≈ 1.25x base input, cache read ≈ 0.1x base input) applied to the
// input price when a model has no explicit cache pricing of its own.
// ---------------------------------------------------------------------------

export const PRICING_AS_OF = "2026-06-01";

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface BasePricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

function deriveCachePricing(base: BasePricing): ModelPricing {
  return {
    input: base.input,
    output: base.output,
    cacheRead: base.cacheRead ?? Math.round(base.input * 0.1 * 1000) / 1000,
    cacheWrite: base.cacheWrite ?? Math.round(base.input * 1.25 * 1000) / 1000,
  };
}

const STATIC_PRICING_TABLE: Record<string, BasePricing> = {
  "openrouter/free": { input: 0, output: 0 },
  "mercury-2": { input: 0.5, output: 1.5 },
  "mercury-edit": { input: 0.5, output: 1.5 },
  "gpt-5.4": { input: 5, output: 15 },
  "gpt-5.3-chat-latest": { input: 3, output: 10 },
  "gpt-5-mini": { input: 0.15, output: 0.6 },
  "gpt-5-nano": { input: 0.05, output: 0.2 },
  "gpt-oss-120b": { input: 0, output: 0 },
  "claude-opus-4-6": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  "gemini-3.1-pro": { input: 1.25, output: 5 },
  "gemini-3-flash": { input: 0.075, output: 0.3 },
  "gemini-3.1-flash-lite": { input: 0.02, output: 0.1 },
  "gemini-2.5-pro": { input: 1.25, output: 5 },
};

export interface PricingResult {
  pricing: ModelPricing;
  /** False when no entry in the table recognizes this model — cost renders as "unpriced", never a silent zero framed as real. */
  priced: boolean;
}

export function resolvePricing(modelId: string): PricingResult {
  const id = modelId || "unknown";
  if (id.endsWith(":free")) return { pricing: deriveCachePricing({ input: 0, output: 0 }), priced: true };

  const exact = STATIC_PRICING_TABLE[id];
  if (exact) return { pricing: deriveCachePricing(exact), priced: true };

  for (const [key, base] of Object.entries(STATIC_PRICING_TABLE)) {
    if (id.startsWith(key) || id.includes(key)) return { pricing: deriveCachePricing(base), priced: true };
  }

  return { pricing: deriveCachePricing({ input: 0, output: 0 }), priced: false };
}

export function costForBuckets(tokens: TokenBuckets, modelId: string): { usd: number; priced: boolean } {
  const { pricing, priced } = resolvePricing(modelId);
  const usd =
    (tokens.input * pricing.input +
      tokens.output * pricing.output +
      tokens.cacheRead * pricing.cacheRead +
      tokens.cacheWrite * pricing.cacheWrite) /
    1_000_000;
  return { usd, priced };
}

// ---------------------------------------------------------------------------
// Usage records — normalized shape extracted defensively from wire payloads
// whose exact field names are not pinned by the contracts package.
// ---------------------------------------------------------------------------

export interface UsageRecord {
  dedupeKey: string;
  provider: string;
  model: string;
  sessionId: string;
  /** "" when the source event carries no stable project identity. */
  projectId: string;
  timestampMs: number | undefined;
  tokens: TokenBuckets;
}

/** Label for the rollup bucket holding every record with no stable project id. */
export const EPHEMERAL_PROJECT_LABEL = "Ephemeral";

const EPHEMERAL_ID_PATTERN = /^(wf_|tmp[-_]|ephemeral|session-only|unknown)/i;

export function projectBucketLabel(projectId: string): string {
  const trimmed = projectId.trim();
  if (!trimmed || EPHEMERAL_ID_PATTERN.test(trimmed)) return EPHEMERAL_PROJECT_LABEL;
  return trimmed;
}

function readTokenBuckets(value: unknown): TokenBuckets {
  const record = asRecord(value);
  const usage = asRecord(record["usage"] ?? record["tokens"] ?? record);
  return {
    input: firstNumber(usage, ["inputTokens", "input_tokens", "input", "promptTokens", "prompt_tokens"]) ?? 0,
    output: firstNumber(usage, ["outputTokens", "output_tokens", "output", "completionTokens", "completion_tokens"]) ?? 0,
    cacheRead:
      firstNumber(usage, ["cacheReadTokens", "cache_read_tokens", "cacheReadInputTokens", "cache_read_input_tokens"]) ?? 0,
    cacheWrite:
      firstNumber(usage, [
        "cacheWriteTokens",
        "cache_write_tokens",
        "cacheCreationTokens",
        "cache_creation_input_tokens",
      ]) ?? 0,
  };
}

/**
 * Extract usage records from a `telemetry.events.list` payload. Every event
 * that carries no recognizable token field contributes ZERO_BUCKETS (never
 * skipped outright — the caller can still see it in the raw events browser),
 * so a shape this reader doesn't anticipate degrades to an honest zero
 * instead of a thrown error.
 */
export function usageRecordsFromTelemetryEvents(payload: unknown): UsageRecord[] {
  const rows = firstArray(payload, ["items", "events", "data", "results"]);
  return rows.map((row, index) => {
    const record = asRecord(row);
    const messageId = firstString(record, ["messageId", "message_id", "id"]);
    const requestId = firstString(record, ["requestId", "request_id", "traceId", "trace_id"]);
    return {
      dedupeKey: messageId || requestId ? `${messageId}|${requestId}` : `event-${index}`,
      provider: firstString(record, ["provider", "providerId", "provider_id"]) || "unknown",
      model: firstString(record, ["model", "modelId", "model_id"]) || "unknown",
      sessionId: firstString(record, ["sessionId", "session_id", "session"]),
      projectId: firstString(record, ["projectId", "project_id", "project", "cwd", "workspace"]),
      timestampMs: firstNumber(record, ["timestamp", "ts", "time", "occurredAt"]),
      tokens: readTokenBuckets(record),
    };
  });
}

/**
 * Extract a synthetic usage record from a `providers.usage.get` payload —
 * this is a provider-level rollup already, so it becomes one record with the
 * daemon's own dedup key (there is nothing to dedupe against downstream).
 */
export function usageRecordFromProviderSummary(payload: unknown, providerId: string): UsageRecord | undefined {
  const record = asRecord(payload);
  const tokens = readTokenBuckets(record);
  if (bucketsTotal(tokens) === 0) return undefined;
  return {
    dedupeKey: `provider-summary:${providerId}`,
    provider: providerId,
    model: firstString(record, ["model", "modelId", "defaultModel"]) || "unknown",
    sessionId: "",
    projectId: "",
    timestampMs: firstNumber(record, ["updatedAt", "asOf", "timestamp"]),
    tokens,
  };
}

export function dedupeRecords(records: readonly UsageRecord[]): UsageRecord[] {
  const seen = new Set<string>();
  const out: UsageRecord[] = [];
  for (const record of records) {
    if (seen.has(record.dedupeKey)) continue;
    seen.add(record.dedupeKey);
    out.push(record);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

export interface Rollup {
  key: string;
  tokens: TokenBuckets;
  costUsd: number;
  recordCount: number;
  /** True when at least one contributing record used an unrecognized model — the total understates the true cost. */
  hasUnpriced: boolean;
}

function rollupBy(records: readonly UsageRecord[], keyFn: (r: UsageRecord) => string): Rollup[] {
  const byKey = new Map<string, Rollup>();
  for (const record of records) {
    const key = keyFn(record) || "unknown";
    const existing = byKey.get(key) ?? { key, tokens: ZERO_BUCKETS, costUsd: 0, recordCount: 0, hasUnpriced: false };
    const { usd, priced } = costForBuckets(record.tokens, record.model);
    byKey.set(key, {
      key,
      tokens: addBuckets(existing.tokens, record.tokens),
      costUsd: existing.costUsd + usd,
      recordCount: existing.recordCount + 1,
      hasUnpriced: existing.hasUnpriced || !priced,
    });
  }
  return [...byKey.values()].sort((a, b) => b.costUsd - a.costUsd);
}

export function rollupByProvider(records: readonly UsageRecord[]): Rollup[] {
  return rollupBy(records, (r) => r.provider);
}

export function rollupBySession(records: readonly UsageRecord[]): Rollup[] {
  return rollupBy(records, (r) => r.sessionId || "(no session)");
}

export function rollupByProject(records: readonly UsageRecord[]): Rollup[] {
  return rollupBy(records, (r) => projectBucketLabel(r.projectId));
}

export function totalRollup(records: readonly UsageRecord[]): Rollup {
  const [only] = rollupBy(records, () => "total");
  return only ?? { key: "total", tokens: ZERO_BUCKETS, costUsd: 0, recordCount: 0, hasUnpriced: false };
}

// ---------------------------------------------------------------------------
// Formatting — every number gets a label/frame (docs/UX.md Principle #2).
// ---------------------------------------------------------------------------

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}
