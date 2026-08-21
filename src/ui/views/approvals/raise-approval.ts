// Pure logic behind approvals.raise: draft validation, the contract-shaped
// body, and reading the pending record back.
//
// ── What raising an ask actually does ──────────────────────────────────────
// approvals.list/claim/approve/deny/cancel could only ever act on asks the
// daemon's own in-process callers had created. `approvals.raise` is the write
// counterpart: it puts an ask INTO the shared broker from a surface that is not
// the daemon's process, so the record becomes one every surface can see and
// decide, and the daemon's attention machinery (web push, blocked-on-user) fans
// it out. This app is exactly such a surface.
//
// It returns the PENDING record immediately and does NOT block on an answer:
// it deliberately does not park a request across a person's attention span. The
// decision arrives on the control.approval_update event in the `permissions`
// domain, which is already what invalidates the approvals query here, so the
// raised row updates itself without this module polling anything.
//
// An identical ask already in flight (same session, tool and args) COALESCES
// onto the existing record: one prompt, one decision, `coalesced: true`, and
// the record handed back is the earlier one. That is a successful outcome with
// a different sentence, never a duplicate and never an error.

import { asRecord, firstString } from "../../lib/wire.ts";

/** The contract's category enum, rendered in this order. */
export const APPROVAL_CATEGORIES = ["read", "write", "execute", "delegate"] as const;
export type ApprovalCategory = (typeof APPROVAL_CATEGORIES)[number];

/** The contract's riskLevel enum. */
export const APPROVAL_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type ApprovalRiskLevel = (typeof APPROVAL_RISK_LEVELS)[number];

/** The daemon clamps timeoutMs to 12h; the form offers minutes. */
export const MAX_TIMEOUT_MINUTES = 12 * 60;

export interface RaiseApprovalDraft {
  tool: string;
  category: ApprovalCategory;
  riskLevel: ApprovalRiskLevel;
  classification: string;
  summary: string;
  /** One reason per line in the form; empty lines are dropped. */
  reasons: string;
  /** Optional JSON object of tool arguments; blank means no arguments. */
  argsJson: string;
  /** Optional: scope the ask to a session so its surface can answer it. */
  sessionId: string;
  /** Optional: expire the ask if nobody answers. Blank means never. */
  timeoutMinutes: string;
}

export const EMPTY_RAISE_DRAFT: RaiseApprovalDraft = {
  tool: "",
  category: "execute",
  riskLevel: "medium",
  classification: "",
  summary: "",
  reasons: "",
  argsJson: "",
  sessionId: "",
  timeoutMinutes: "",
};

export function splitReasons(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Parse the optional args JSON. `{}` for blank; an error string when unusable. */
export function parseArgs(argsJson: string): { args: Record<string, unknown> } | { error: string } {
  const trimmed = argsJson.trim();
  if (!trimmed) return { args: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { error: `Arguments must be valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Arguments must be a JSON object (the contract types args as a key/value map)." };
  }
  return { args: parsed as Record<string, unknown> };
}

/** Everything wrong with a draft, in the order the form shows the fields. */
export function validateRaiseDraft(draft: RaiseApprovalDraft): string[] {
  const errors: string[] = [];
  if (!draft.tool.trim()) errors.push("Name the tool the ask is about.");
  if (!draft.classification.trim()) errors.push("Classification is required (what kind of action this is).");
  if (!draft.summary.trim()) errors.push("Summary is required: it is the line the decider reads.");
  if (splitReasons(draft.reasons).length === 0) errors.push("Give at least one reason.");
  const args = parseArgs(draft.argsJson);
  if ("error" in args) errors.push(args.error);
  const minutes = draft.timeoutMinutes.trim();
  if (minutes) {
    const parsed = Number(minutes);
    if (!Number.isFinite(parsed) || parsed <= 0) errors.push("Timeout must be a positive number of minutes.");
    else if (parsed > MAX_TIMEOUT_MINUTES) {
      errors.push(`The daemon clamps a timeout to 12 hours (${MAX_TIMEOUT_MINUTES} minutes).`);
    }
  }
  return errors;
}

/**
 * The approvals.raise body. Every field on the wire is one the contract
 * declares (the input schema is additionalProperties:false at both levels), and
 * optional fields are OMITTED rather than sent empty, so an unset session is an
 * absent key rather than an empty-string session id nothing matches.
 */
export function buildRaiseInput(draft: RaiseApprovalDraft, callId: string): Record<string, unknown> {
  const args = parseArgs(draft.argsJson);
  const minutes = Number(draft.timeoutMinutes.trim());
  const timeoutMs =
    draft.timeoutMinutes.trim() && Number.isFinite(minutes) && minutes > 0
      ? Math.round(Math.min(minutes, MAX_TIMEOUT_MINUTES) * 60_000)
      : undefined;
  return {
    request: {
      callId,
      tool: draft.tool.trim(),
      args: "error" in args ? {} : args.args,
      category: draft.category,
      analysis: {
        classification: draft.classification.trim(),
        riskLevel: draft.riskLevel,
        summary: draft.summary.trim(),
        reasons: splitReasons(draft.reasons),
      },
    },
    ...(draft.sessionId.trim() ? { sessionId: draft.sessionId.trim() } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

export interface RaisedApproval {
  id: string;
  status: string;
  /** True when this ask merged onto an identical one already in flight. */
  coalesced: boolean;
  /** True only when a decision was actually made before the call returned. */
  decided: boolean;
}

export function readRaisedApproval(value: unknown): RaisedApproval {
  const record = asRecord(value);
  const approval = asRecord(record["approval"]);
  return {
    id: firstString(approval, ["id"]),
    status: firstString(approval, ["status"]) || "pending",
    coalesced: record["coalesced"] === true,
    decided: record["decided"] === true,
  };
}

/** The sentence to show after a successful raise. */
export function describeRaise(raised: RaisedApproval): string {
  if (raised.coalesced) {
    return `An identical ask was already in flight, so this merged onto ${raised.id || "it"}: one prompt, one decision.`;
  }
  if (raised.decided) return `Already ${raised.status}.`;
  return "Pending on every surface this daemon serves; the decision lands here as soon as anyone makes it.";
}
