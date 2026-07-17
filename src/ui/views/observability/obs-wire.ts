// Defensive readers shared across the Observability sections. The daemon's
// telemetry/control/health payload shapes are not pinned by the contracts
// package for this pin, so every reader here degrades to an honest fallback
// ("unknown", empty string, undefined) rather than throwing — matching the
// wire-or-delete discipline in lib/wire.ts, which this module extends.

import { asRecord, compactJson, firstArray, firstNumber, firstString } from "../../lib/wire.ts";

export type Severity = "critical" | "error" | "warning" | "info" | "debug" | "unknown";

export function normalizeSeverity(value: string): Severity {
  const v = value.toLowerCase();
  if (v === "critical" || v === "fatal") return "critical";
  if (v === "error" || v === "err") return "error";
  if (v === "warning" || v === "warn") return "warning";
  if (v === "info" || v === "notice") return "info";
  if (v === "debug" || v === "trace" || v === "verbose") return "debug";
  return "unknown";
}

/** Badge tone class (styles/components.css .badge.*) for a severity bucket. */
export function severityBadgeTone(severity: Severity): "ok" | "warning" | "bad" | "info" | "neutral" {
  switch (severity) {
    case "critical":
    case "error":
      return "bad";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "debug":
      return "neutral";
    default:
      return "neutral";
  }
}

export function formatTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Accept both ms and seconds epoch — seconds values are ~13 digits shorter.
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
    return value;
  }
  return "unknown time";
}

export interface EventRow {
  id: string;
  domain: string;
  type: string;
  severity: Severity;
  traceId: string;
  sessionId: string;
  turnId: string;
  agentId: string;
  taskId: string;
  timestamp: unknown;
  raw: unknown;
}

export function readEventRows(payload: unknown): EventRow[] {
  const rows = firstArray(payload, ["items", "events", "data", "results"]);
  return rows.map((row, index) => {
    const record = asRecord(row);
    return {
      id: firstString(record, ["id", "eventId"]) || `event-${index}`,
      domain: firstString(record, ["domain"]) || "unknown",
      type: firstString(record, ["type", "eventType", "kind"]) || "unknown",
      severity: normalizeSeverity(firstString(record, ["severity", "level"])),
      traceId: firstString(record, ["traceId", "trace_id"]),
      sessionId: firstString(record, ["sessionId", "session_id", "session"]),
      turnId: firstString(record, ["turnId", "turn_id", "turn"]),
      agentId: firstString(record, ["agentId", "agent_id", "agent"]),
      taskId: firstString(record, ["taskId", "task_id", "task"]),
      timestamp: record["timestamp"] ?? record["ts"] ?? record["time"] ?? record["occurredAt"],
      raw: row,
    };
  });
}

export interface ErrorRow {
  id: string;
  message: string;
  code: string;
  domain: string;
  severity: Severity;
  sessionId: string;
  traceId: string;
  timestamp: unknown;
  raw: unknown;
}

export function readErrorRows(payload: unknown): ErrorRow[] {
  const rows = firstArray(payload, ["items", "errors", "data", "results"]);
  return rows.map((row, index) => {
    const record = asRecord(row);
    return {
      id: firstString(record, ["id", "errorId"]) || `error-${index}`,
      message: firstString(record, ["message", "error", "summary"]) || "(no message)",
      code: firstString(record, ["code", "errorCode"]),
      domain: firstString(record, ["domain"]) || "unknown",
      severity: normalizeSeverity(firstString(record, ["severity", "level"]) || "error"),
      sessionId: firstString(record, ["sessionId", "session_id", "session"]),
      traceId: firstString(record, ["traceId", "trace_id"]),
      timestamp: record["timestamp"] ?? record["ts"] ?? record["time"] ?? record["occurredAt"],
      raw: row,
    };
  });
}

export interface TraceRow {
  id: string;
  name: string;
  status: string;
  spanCount: number;
  durationMs: number | undefined;
  sessionId: string;
  timestamp: unknown;
  raw: unknown;
}

export function readTraceRows(payload: unknown): TraceRow[] {
  const rows = firstArray(payload, ["items", "traces", "data", "results"]);
  return rows.map((row, index) => {
    const record = asRecord(row);
    const spans = firstArray(record, ["spans"]);
    return {
      id: firstString(record, ["id", "traceId", "trace_id"]) || `trace-${index}`,
      name: firstString(record, ["name", "operation", "label"]) || "(unnamed trace)",
      status: firstString(record, ["status", "state"]) || "unknown",
      spanCount: firstNumber(record, ["spanCount", "span_count"]) ?? spans.length,
      durationMs: firstNumber(record, ["durationMs", "duration_ms", "duration"]),
      sessionId: firstString(record, ["sessionId", "session_id", "session"]),
      timestamp: record["timestamp"] ?? record["ts"] ?? record["startedAt"],
      raw: row,
    };
  });
}

export interface HealthCard {
  id: string;
  title: string;
  severity: Severity;
  cause: string;
  impact: string;
  nextAction: string;
  raw: unknown;
}

/** Reads either a flat health.snapshot record or a {checks:[...]} envelope into cards. */
export function readHealthCards(payload: unknown): HealthCard[] {
  const rows = firstArray(payload, ["checks", "items", "components"]);
  const source = rows.length > 0 ? rows : [payload];
  return source.map((row, index) => {
    const record = asRecord(row);
    return {
      id: firstString(record, ["id", "name", "component"]) || `check-${index}`,
      title: firstString(record, ["title", "name", "component", "label"]) || "Health check",
      severity: normalizeSeverity(firstString(record, ["severity", "status", "level"])),
      cause: firstString(record, ["cause", "reason", "detail"]),
      impact: firstString(record, ["impact", "effect"]),
      nextAction: firstString(record, ["nextAction", "next_action", "action", "remedy", "hint"]),
      raw: row,
    };
  });
}

export { compactJson };

// ---------------------------------------------------------------------------
// Power — power.status.get / power.keepAwake.set (docs/FEATURES.md §17).
// Two independent concepts on one payload: `work` is the daemon's own
// automatic sleep inhibitor (held while there is live work), `keepAwake` is
// the owner's manual toggle. Both can disagree; neither is inferred from the
// other.
// ---------------------------------------------------------------------------

export interface PowerSnapshot {
  platform: string;
  keepAwakeEnabled: boolean;
  keepAwakeHeld: boolean;
  keepAwakeGrantedClasses: string[];
  keepAwakeDeniedClasses: string[];
  keepAwakeNote: string | null;
  workHeld: boolean;
  workReasons: string[];
  workHeldSince: number | null;
  workGrantedClasses: string[];
  workDeniedClasses: string[];
  workCapMinutes: number | undefined;
  workCapExpiresAt: number | null;
  workCapExpired: boolean;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function readPowerStatus(payload: unknown): PowerSnapshot {
  const record = asRecord(payload);
  const work = asRecord(record["work"]);
  const keepAwake = asRecord(record["keepAwake"]);
  return {
    platform: firstString(record, ["platform"]),
    keepAwakeEnabled: keepAwake["enabled"] === true,
    keepAwakeHeld: keepAwake["held"] === true,
    keepAwakeGrantedClasses: stringArray(keepAwake["grantedClasses"]),
    keepAwakeDeniedClasses: stringArray(keepAwake["deniedClasses"]),
    keepAwakeNote: typeof keepAwake["note"] === "string" ? keepAwake["note"] : null,
    workHeld: work["held"] === true,
    workReasons: stringArray(work["reasons"]),
    workHeldSince: typeof work["heldSince"] === "number" ? work["heldSince"] : null,
    workGrantedClasses: stringArray(work["grantedClasses"]),
    workDeniedClasses: stringArray(work["deniedClasses"]),
    workCapMinutes: firstNumber(work, ["capMinutes"]),
    workCapExpiresAt: typeof work["capExpiresAt"] === "number" ? work["capExpiresAt"] : null,
    workCapExpired: work["capExpired"] === true,
  };
}

/** The status-strip chip's tooltip — the daemon's own verbatim note when it
 * has one, else the live reasons the inhibitor names, never a guess. */
export function powerHeldTooltip(snapshot: PowerSnapshot): string {
  if (snapshot.keepAwakeNote) return snapshot.keepAwakeNote;
  if (snapshot.workReasons.length > 0) return snapshot.workReasons.join("; ");
  return "Sleep inhibitor held";
}

// ---------------------------------------------------------------------------
// Memory governor — ops.memory.get. Crib: goodvibes-webui
// src/components/settings/MemoryDiagnostics.tsx / lib/memory-governance.ts —
// same tier badge / budget bar / per-cache table / paused-jobs / tripwire
// shape, ported onto this app's wire helpers.
// ---------------------------------------------------------------------------

export type MemoryTier = "normal" | "elevated" | "high" | "critical";

const MEMORY_TIERS: MemoryTier[] = ["normal", "elevated", "high", "critical"];

export interface MemoryCacheRow {
  id: string;
  name: string;
  entries: number | undefined;
  estimatedBytes: number | undefined;
}

export interface MemoryTripwireState {
  armed: boolean;
  sustainedSec: number;
  rateMbPerSec: number;
}

export interface MemorySnapshot {
  tier: MemoryTier;
  budgetMb: number | undefined;
  rssMb: number | undefined;
  heapUsedMb: number | undefined;
  heapTotalMb: number | undefined;
  usedPct: number;
  clampedUsedPct: number;
  refusingExpensiveWork: boolean;
  caches: MemoryCacheRow[];
  pausedJobs: string[];
  tripwire: MemoryTripwireState;
}

export function readMemorySnapshot(payload: unknown): MemorySnapshot {
  const record = asRecord(payload);
  const tierRaw = firstString(record, ["tier"]);
  const tier: MemoryTier = (MEMORY_TIERS as string[]).includes(tierRaw) ? (tierRaw as MemoryTier) : "normal";
  const usedPct = firstNumber(record, ["usedPct"]) ?? 0;
  const caches: MemoryCacheRow[] = firstArray(record, ["caches"]).map((row, i) => {
    const c = asRecord(row);
    return {
      id: firstString(c, ["id"]) || `cache-${i}`,
      name: firstString(c, ["name"]) || firstString(c, ["id"]) || `cache ${i + 1}`,
      entries: firstNumber(c, ["entries"]),
      estimatedBytes: firstNumber(c, ["estimatedBytes"]),
    };
  });
  const tripwireRecord = asRecord(record["tripwire"]);
  return {
    tier,
    budgetMb: firstNumber(record, ["budgetMb"]),
    rssMb: firstNumber(record, ["rssMb"]),
    heapUsedMb: firstNumber(record, ["heapUsedMb"]),
    heapTotalMb: firstNumber(record, ["heapTotalMb"]),
    usedPct,
    clampedUsedPct: Number.isFinite(usedPct) ? Math.max(0, Math.min(usedPct, 100)) : 0,
    refusingExpensiveWork: record["refusingExpensiveWork"] === true,
    caches,
    pausedJobs: stringArray(record["pausedJobs"]),
    tripwire: {
      armed: tripwireRecord["armed"] === true,
      sustainedSec: firstNumber(tripwireRecord, ["sustainedSec"]) ?? 0,
      rateMbPerSec: firstNumber(tripwireRecord, ["rateMbPerSec"]) ?? 0,
    },
  };
}

/** Human-facing label for the pressure tier — never the raw enum value. */
export function memoryTierLabel(tier: MemoryTier): string {
  switch (tier) {
    case "normal":
      return "Normal";
    case "elevated":
      return "Elevated";
    case "high":
      return "High";
    case "critical":
      return "Critical";
  }
}

/** This app's own .badge tone (components.css .badge.ok/.warning/.bad/
 * .neutral/.info) for a pressure tier — 'elevated' maps to 'info' (still
 * working, worth a glance, not yet a problem); 'high'/'critical' get the two
 * genuine severities. */
export function memoryTierBadgeClass(tier: MemoryTier): "neutral" | "info" | "warning" | "bad" {
  switch (tier) {
    case "normal":
      return "neutral";
    case "elevated":
      return "info";
    case "high":
      return "warning";
    case "critical":
      return "bad";
  }
}

/** Values are already in MB on the wire — this only rounds and labels. Never
 * "0 MB" for a value the daemon didn't report — that's an em-dash. */
export function formatMb(mb: number | undefined): string {
  if (typeof mb !== "number" || !Number.isFinite(mb)) return "—";
  return `${Math.round(mb)} MB`;
}

/** Em-dash for a cache footprint the daemon didn't report — never a
 * fabricated 0. */
export function formatBytesOrDash(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** One human line for the tripwire state — armed (with its live rate/
 * duration) or not. */
export function tripwireLine(tripwire: MemoryTripwireState): string {
  if (!tripwire.armed) return "Leak tripwire: not armed.";
  return `Leak tripwire: armed — sustained growth of ${tripwire.rateMbPerSec.toFixed(1)} MB/s for ${tripwire.sustainedSec}s.`;
}

// ---------------------------------------------------------------------------
// Runtime metrics — runtime.metrics.get. Every sub-shape beyond the four
// top-level buckets is unpinned (additionalProperties:true on the wire) —
// this extracts numeric leaves generically rather than guessing field names.
// ---------------------------------------------------------------------------

export function numericLeaves(value: unknown, prefix = ""): Array<{ label: string; value: number }> {
  const record = asRecord(value);
  const out: Array<{ label: string; value: number }> = [];
  for (const [key, v] of Object.entries(record)) {
    const label = prefix ? `${prefix}.${key}` : key;
    if (typeof v === "number" && Number.isFinite(v)) {
      out.push({ label, value: v });
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...numericLeaves(v, label));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quota — quota.snapshot.get / quota.fanout.get (WS-only). hasSignal:false is
// an honest "no observation yet" — never render a fabricated full/empty
// quota. verdict:"unknown" is likewise honest, not an error.
// ---------------------------------------------------------------------------

export interface QuotaSnapshot {
  hasSignal: boolean;
  remaining: number | undefined;
  limit: number | undefined;
  resetAt: number | undefined;
  activeCooldownMs: number | undefined;
  recentRateLimitCount: number;
}

export function readQuotaSnapshot(payload: unknown): QuotaSnapshot {
  const record = asRecord(payload);
  return {
    hasSignal: record["hasSignal"] === true,
    remaining: firstNumber(record, ["remaining"]),
    limit: firstNumber(record, ["limit"]),
    resetAt: firstNumber(record, ["resetAt"]),
    activeCooldownMs: firstNumber(record, ["activeCooldownMs"]),
    recentRateLimitCount: firstNumber(record, ["recentRateLimitCount"]) ?? 0,
  };
}

export type QuotaFanoutVerdict = "likely-exhausts" | "unlikely" | "unknown";

export interface QuotaFanoutResult {
  verdict: QuotaFanoutVerdict;
  reason: string;
}

export function readQuotaFanoutResult(payload: unknown): QuotaFanoutResult {
  const record = asRecord(payload);
  const verdictRaw = firstString(record, ["verdict"]);
  const verdict: QuotaFanoutVerdict =
    verdictRaw === "likely-exhausts" || verdictRaw === "unlikely" ? verdictRaw : "unknown";
  return { verdict, reason: firstString(record, ["reason"]) || "No reason reported." };
}

export function formatEpoch(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}

// ---------------------------------------------------------------------------
// Cost attribution — cost.attribution.get (WS-only). Honest-unpriced per the
// contract: totalCostUsd/costUsd is null when a contributor is unpriced,
// never a fabricated amount. costSource/pricingAsOf ABSENT on pre-1.7
// daemon records is an honest absence — costProvenanceLine renders nothing
// for it, never a guessed provenance line.
// ---------------------------------------------------------------------------

export interface CostTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type CostState = "priced" | "estimated" | "unpriced";
export type CostSource = "user" | "provider" | "catalog" | "mixed" | null;

export interface CostAttributionRow {
  key: string;
  costUsd: number | null;
  costState: CostState;
  costSource: CostSource;
  pricingAsOf: string | null;
  pricedRecordCount: number;
  unpricedRecordCount: number;
  tokens: CostTokens;
}

export interface CostAttribution {
  window: string;
  dimension: string;
  totalCostUsd: number | null;
  costState: CostState;
  costSource: CostSource;
  pricingAsOf: string | null;
  pricedRecordCount: number;
  unpricedRecordCount: number;
  tokens: CostTokens;
  rows: CostAttributionRow[];
}

function readCostTokens(value: unknown): CostTokens {
  const record = asRecord(value);
  return {
    inputTokens: firstNumber(record, ["inputTokens"]) ?? 0,
    outputTokens: firstNumber(record, ["outputTokens"]) ?? 0,
    cacheReadTokens: firstNumber(record, ["cacheReadTokens"]) ?? 0,
    cacheWriteTokens: firstNumber(record, ["cacheWriteTokens"]) ?? 0,
  };
}

function readCostState(value: unknown): CostState {
  return value === "priced" || value === "estimated" || value === "unpriced" ? value : "unpriced";
}

function readCostSource(value: unknown): CostSource {
  return value === "user" || value === "provider" || value === "catalog" || value === "mixed" ? value : null;
}

function readCostAttributionRow(value: unknown): CostAttributionRow {
  const record = asRecord(value);
  return {
    key: firstString(record, ["key"]) || "unknown",
    costUsd: typeof record["costUsd"] === "number" ? record["costUsd"] : null,
    costState: readCostState(record["costState"]),
    costSource: readCostSource(record["costSource"]),
    pricingAsOf: typeof record["pricingAsOf"] === "string" ? record["pricingAsOf"] : null,
    pricedRecordCount: firstNumber(record, ["pricedRecordCount"]) ?? 0,
    unpricedRecordCount: firstNumber(record, ["unpricedRecordCount"]) ?? 0,
    tokens: readCostTokens(record["tokens"]),
  };
}

export function readCostAttribution(payload: unknown): CostAttribution {
  const record = asRecord(payload);
  return {
    window: firstString(record, ["window"]) || "24h",
    dimension: firstString(record, ["dimension"]) || "",
    totalCostUsd: typeof record["totalCostUsd"] === "number" ? record["totalCostUsd"] : null,
    costState: readCostState(record["costState"]),
    costSource: readCostSource(record["costSource"]),
    pricingAsOf: typeof record["pricingAsOf"] === "string" ? record["pricingAsOf"] : null,
    pricedRecordCount: firstNumber(record, ["pricedRecordCount"]) ?? 0,
    unpricedRecordCount: firstNumber(record, ["unpricedRecordCount"]) ?? 0,
    tokens: readCostTokens(record["tokens"]),
    rows: firstArray(record, ["rows"]).map(readCostAttributionRow),
  };
}

/** Never $0.00 for an unpriced total — "price unknown" instead. */
export function formatCostUsd(value: number | null): string {
  if (value === null) return "price unknown";
  if (value === 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** "your price"/"provider-served"/"catalog, as of DATE"/"mixed sources" — or
 * null when the daemon didn't report a source at all (pre-1.7 record): the
 * caller renders nothing for that case, never a guessed provenance line. */
export function costProvenanceLine(source: CostSource, pricingAsOf: string | null): string | null {
  if (source === null) return null;
  if (source === "user") return "Pricing: your price.";
  if (source === "provider") return "Pricing: provider-served.";
  if (source === "mixed") return "Pricing: mixed sources.";
  if (source === "catalog") return pricingAsOf ? `Pricing: catalog, as of ${pricingAsOf}.` : "Pricing: catalog.";
  return null;
}

// ---------------------------------------------------------------------------
// Flags graduation — flags.graduation.report (WS-only, read-only reporting;
// no reference implementation existed anywhere for this contract shape).
// Evidence is real-only: "no evidence collected" is an honest state, never a
// fabricated readiness signal.
// ---------------------------------------------------------------------------

export type FlagState = "dark" | "soaking" | "graduate-candidate" | "graduated" | "blocked";

export const FLAG_STATES: FlagState[] = ["dark", "soaking", "graduate-candidate", "graduated", "blocked"];

export interface FlagDivergence {
  divergenceRate: number;
  totalEvaluations: number;
  gateStatus: "allowed" | "blocked" | "no_data";
}

export interface FlagEvidence {
  instrumentation: "divergence-simulation" | "none";
  divergence: FlagDivergence | null;
  note: string;
}

export interface FlagBlocker {
  reason: string;
  date: string;
}

export interface FlagEntry {
  flagId: string;
  name: string;
  tier: number;
  currentDefault: "enabled" | "disabled" | "killed";
  runtimeToggleable: boolean;
  state: FlagState;
  evidence: FlagEvidence;
  blocker: FlagBlocker | null;
  note: string | null;
}

export interface FlagsGraduationSummary {
  total: number;
  dark: number;
  soaking: number;
  graduateCandidate: number;
  graduated: number;
  blocked: number;
}

export interface FlagsGraduationReport {
  generatedAt: number;
  entries: FlagEntry[];
  summary: FlagsGraduationSummary;
  releaseBlockers: string[];
}

function readFlagEntry(value: unknown): FlagEntry {
  const record = asRecord(value);
  const evidenceRecord = asRecord(record["evidence"]);
  const divergenceValue = evidenceRecord["divergence"];
  const blockerValue = record["blocker"];
  const stateRaw = firstString(record, ["state"]);
  const defaultRaw = firstString(record, ["currentDefault"]);
  return {
    flagId: firstString(record, ["flagId"]) || "unknown",
    name: firstString(record, ["name"]) || firstString(record, ["flagId"]) || "Unnamed capability",
    tier: firstNumber(record, ["tier"]) ?? 0,
    currentDefault:
      defaultRaw === "enabled" || defaultRaw === "disabled" || defaultRaw === "killed" ? defaultRaw : "disabled",
    runtimeToggleable: record["runtimeToggleable"] === true,
    state: (FLAG_STATES as string[]).includes(stateRaw) ? (stateRaw as FlagState) : "dark",
    evidence: {
      instrumentation: evidenceRecord["instrumentation"] === "divergence-simulation" ? "divergence-simulation" : "none",
      divergence:
        divergenceValue && typeof divergenceValue === "object"
          ? {
              divergenceRate: firstNumber(asRecord(divergenceValue), ["divergenceRate"]) ?? 0,
              totalEvaluations: firstNumber(asRecord(divergenceValue), ["totalEvaluations"]) ?? 0,
              gateStatus:
                (firstString(asRecord(divergenceValue), ["gateStatus"]) as FlagDivergence["gateStatus"]) || "no_data",
            }
          : null,
      note: firstString(evidenceRecord, ["note"]) || "No evidence collected.",
    },
    blocker:
      blockerValue && typeof blockerValue === "object"
        ? { reason: firstString(asRecord(blockerValue), ["reason"]), date: firstString(asRecord(blockerValue), ["date"]) }
        : null,
    note: typeof record["note"] === "string" ? record["note"] : null,
  };
}

export function readFlagsGraduationReport(payload: unknown): FlagsGraduationReport {
  const record = asRecord(payload);
  const summaryRecord = asRecord(record["summary"]);
  return {
    generatedAt: firstNumber(record, ["generatedAt"]) ?? Date.now(),
    entries: firstArray(record, ["entries"]).map(readFlagEntry),
    summary: {
      total: firstNumber(summaryRecord, ["total"]) ?? 0,
      dark: firstNumber(summaryRecord, ["dark"]) ?? 0,
      soaking: firstNumber(summaryRecord, ["soaking"]) ?? 0,
      graduateCandidate: firstNumber(summaryRecord, ["graduateCandidate"]) ?? 0,
      graduated: firstNumber(summaryRecord, ["graduated"]) ?? 0,
      blocked: firstNumber(summaryRecord, ["blocked"]) ?? 0,
    },
    releaseBlockers: stringArray(record["releaseBlockers"]),
  };
}

export function groupFlagEntries(entries: readonly FlagEntry[]): Record<FlagState, FlagEntry[]> {
  const grouped: Record<FlagState, FlagEntry[]> = {
    dark: [],
    soaking: [],
    "graduate-candidate": [],
    graduated: [],
    blocked: [],
  };
  for (const entry of entries) grouped[entry.state].push(entry);
  return grouped;
}

export function flagStateLabel(state: FlagState): string {
  switch (state) {
    case "dark":
      return "Dark";
    case "soaking":
      return "Soaking";
    case "graduate-candidate":
      return "Graduate candidate";
    case "graduated":
      return "Graduated";
    case "blocked":
      return "Blocked";
  }
}

export function flagStateBadgeTone(state: FlagState): "neutral" | "info" | "warning" | "bad" | "ok" {
  switch (state) {
    case "dark":
      return "neutral";
    case "soaking":
      return "info";
    case "graduate-candidate":
      return "warning";
    case "graduated":
      return "ok";
    case "blocked":
      return "bad";
  }
}
