// checkin-wire.ts — types, defensive wire parsers, and pure helpers for the
// Check-in view (checkin.config.get/set, checkin.receipts.list, checkin.run).
//
// TRAP (do not conflate): checkin.receipts.list's outcome enum includes
// skipped-disabled / skipped-quiet-hours (two DISTINCT reasons a scheduled
// run declined to contact), while checkin.run's outcome enum collapses both
// into a single generic "skipped" (a manual run-now either goes through the
// judge or is refused outright — there's no quiet-hours window to skip on a
// deliberate manual trigger the same way). The wordings below are kept
// deliberately separate per source so a manual run's "Skipped" is never
// mistaken for the specific enums a scheduled receipt reports.

import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

export interface CheckinConfig {
  enabled: boolean;
  cadence: string;
  deliveryChannel: string;
  quietHours: string;
}

export const CHECKIN_RECEIPT_OUTCOMES = [
  "delivered",
  "quiet",
  "skipped-disabled",
  "skipped-quiet-hours",
  "error",
] as const;

export interface CheckinReceipt {
  id: string;
  ranAt: number;
  trigger: "scheduled" | "manual" | string;
  outcome: (typeof CHECKIN_RECEIPT_OUTCOMES)[number] | string;
  briefingSummary: string;
  decisionReason?: string;
  deliveredMessage?: string;
  deliveryChannel?: string;
  deliveryId?: string;
  error?: string;
}

export const CHECKIN_RUN_OUTCOMES = ["delivered", "quiet", "skipped", "error"] as const;

export interface CheckinRunResult {
  outcome: (typeof CHECKIN_RUN_OUTCOMES)[number] | string;
  summary: string;
  deliveryId?: string;
}

export function parseCheckinConfig(value: unknown): CheckinConfig {
  const outer = asRecord(value);
  const record = asRecord(outer["config"] ?? value);
  return {
    enabled: record["enabled"] === true,
    cadence: firstString(record, ["cadence"]),
    deliveryChannel: firstString(record, ["deliveryChannel"]),
    quietHours: firstString(record, ["quietHours"]),
  };
}

function parseCheckinReceipt(value: unknown): CheckinReceipt | null {
  const record = asRecord(value);
  const id = firstString(record, ["id"]);
  if (!id) return null;
  const decisionReason = firstString(record, ["decisionReason"]);
  const deliveredMessage = firstString(record, ["deliveredMessage"]);
  const deliveryChannel = firstString(record, ["deliveryChannel"]);
  const deliveryId = firstString(record, ["deliveryId"]);
  const error = firstString(record, ["error"]);
  return {
    id,
    ranAt: firstNumber(record, ["ranAt"]) ?? 0,
    trigger: firstString(record, ["trigger"]) || "unknown",
    outcome: firstString(record, ["outcome"]) || "unknown",
    briefingSummary: firstString(record, ["briefingSummary"]),
    ...(decisionReason ? { decisionReason } : {}),
    ...(deliveredMessage ? { deliveredMessage } : {}),
    ...(deliveryChannel ? { deliveryChannel } : {}),
    ...(deliveryId ? { deliveryId } : {}),
    ...(error ? { error } : {}),
  };
}

export function parseCheckinReceipts(value: unknown): CheckinReceipt[] {
  const outer = asRecord(value);
  return asArray(outer["receipts"] ?? value).flatMap((item) => {
    const parsed = parseCheckinReceipt(item);
    return parsed ? [parsed] : [];
  });
}

export function parseCheckinRunResult(value: unknown): CheckinRunResult {
  const record = asRecord(value);
  const deliveryId = firstString(record, ["deliveryId"]);
  return {
    outcome: firstString(record, ["outcome"]) || "unknown",
    summary: firstString(record, ["summary"]),
    ...(deliveryId ? { deliveryId } : {}),
  };
}

/** Receipt-list wording — keep distinct from runOutcomeLabel (the TRAP). */
export function receiptOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case "delivered":
      return "Delivered";
    case "quiet":
      return "Ran quiet — nothing worth surfacing";
    case "skipped-disabled":
      return "Skipped — check-in was disabled";
    case "skipped-quiet-hours":
      return "Skipped — within quiet hours";
    case "error":
      return "Error";
    default:
      return outcome;
  }
}

/** Manual run-now wording — the generic "skipped" is intentionally vaguer
 * than the receipt-list enums; never borrow their specific phrasing here. */
export function runOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case "delivered":
      return "Delivered";
    case "quiet":
      return "Ran quiet — nothing worth surfacing";
    case "skipped":
      return "Skipped";
    case "error":
      return "Error";
    default:
      return outcome;
  }
}

export function outcomeTone(outcome: string): "ok" | "bad" | "neutral" {
  if (outcome === "delivered") return "ok";
  if (outcome === "error") return "bad";
  return "neutral";
}

export function formatCheckinTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Date(value).toLocaleString();
}
