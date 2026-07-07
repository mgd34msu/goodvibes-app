// Two read-only Coding/Dev snapshot tiles (docs/FEATURES.md §15 rows 8/12,
// docs/GAPS.md same rows): `intelligence.snapshot` (LSP/tree-sitter/
// diagnostics posture) and `review.snapshot` (API families + counts). Both
// are declared on the wire (operator-contract.json) but were never invoked
// anywhere in src/ui before this file — confirmed by grep before writing a
// line of UI. Shapes below mirror the contract's outputSchema exactly;
// parsed defensively anyway (daemon builds may add fields — every object
// schema is `additionalProperties: true`/`false` per method, never assumed).

import { asRecord, firstNumber, firstString, firstArray } from "../../lib/wire.ts";

// ─── intelligence.snapshot ───────────────────────────────────────────────────

export interface IntelligenceSnapshot {
  diagnosticsStatus: string;
  symbolSearchStatus: string;
  completionsStatus: string;
  hoverStatus: string;
  errorCount: number;
  warningCount: number;
  totalRequests: number;
  avgLatencyMs: number;
  raw: unknown;
}

export function normalizeIntelligenceSnapshot(value: unknown): IntelligenceSnapshot {
  const r = asRecord(value);
  return {
    diagnosticsStatus: firstString(r, ["diagnosticsStatus"]) || "unknown",
    symbolSearchStatus: firstString(r, ["symbolSearchStatus"]) || "unknown",
    completionsStatus: firstString(r, ["completionsStatus"]) || "unknown",
    hoverStatus: firstString(r, ["hoverStatus"]) || "unknown",
    errorCount: firstNumber(r, ["errorCount"]) ?? 0,
    warningCount: firstNumber(r, ["warningCount"]) ?? 0,
    totalRequests: firstNumber(r, ["totalRequests"]) ?? 0,
    avgLatencyMs: firstNumber(r, ["avgLatencyMs"]) ?? 0,
    raw: value,
  };
}

/** "ok"/"healthy"/"ready"/"up" family reads as posture-good; anything naming
 * an outage reads as bad; everything else (including genuinely unknown
 * strings the daemon might report) is neutral rather than guessed. */
export function statusTone(status: string): "ok" | "bad" | "neutral" {
  const s = status.toLowerCase();
  if (["ok", "healthy", "ready", "up", "active", "running"].includes(s)) return "ok";
  if (["down", "error", "failed", "unavailable", "offline", "degraded"].includes(s)) return "bad";
  return "neutral";
}

// ─── review.snapshot ──────────────────────────────────────────────────────────

export interface ReviewSnapshot {
  apiFamilies: string[];
  routes: string[];
  sessions: number;
  tasks: number;
  pendingApprovals: number;
  remoteContracts: number;
  panels: number;
  raw: unknown;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function normalizeReviewSnapshot(value: unknown): ReviewSnapshot {
  const r = asRecord(value);
  return {
    apiFamilies: stringArray(firstArray(r, ["apiFamilies"])),
    routes: stringArray(firstArray(r, ["routes"])),
    sessions: firstNumber(r, ["sessions"]) ?? 0,
    tasks: firstNumber(r, ["tasks"]) ?? 0,
    pendingApprovals: firstNumber(r, ["pendingApprovals"]) ?? 0,
    remoteContracts: firstNumber(r, ["remoteContracts"]) ?? 0,
    panels: firstNumber(r, ["panels"]) ?? 0,
    raw: value,
  };
}
