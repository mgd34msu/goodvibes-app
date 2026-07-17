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
  // undefined = the daemon didn't report this field — never collapsed into a
  // fabricated 0 (a real zero errors/requests looks identical to "unreported"
  // otherwise; callers render an honest "—" for the undefined case).
  errorCount: number | undefined;
  warningCount: number | undefined;
  totalRequests: number | undefined;
  avgLatencyMs: number | undefined;
  raw: unknown;
}

export function normalizeIntelligenceSnapshot(value: unknown): IntelligenceSnapshot {
  const r = asRecord(value);
  return {
    diagnosticsStatus: firstString(r, ["diagnosticsStatus"]) || "unknown",
    symbolSearchStatus: firstString(r, ["symbolSearchStatus"]) || "unknown",
    completionsStatus: firstString(r, ["completionsStatus"]) || "unknown",
    hoverStatus: firstString(r, ["hoverStatus"]) || "unknown",
    errorCount: firstNumber(r, ["errorCount"]),
    warningCount: firstNumber(r, ["warningCount"]),
    totalRequests: firstNumber(r, ["totalRequests"]),
    avgLatencyMs: firstNumber(r, ["avgLatencyMs"]),
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
  // undefined = not reported by this daemon — never a fabricated 0; see
  // IntelligenceSnapshot's header comment for the same rule.
  sessions: number | undefined;
  tasks: number | undefined;
  pendingApprovals: number | undefined;
  remoteContracts: number | undefined;
  panels: number | undefined;
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
    sessions: firstNumber(r, ["sessions"]),
    tasks: firstNumber(r, ["tasks"]),
    pendingApprovals: firstNumber(r, ["pendingApprovals"]),
    remoteContracts: firstNumber(r, ["remoteContracts"]),
    panels: firstNumber(r, ["panels"]),
    raw: value,
  };
}
