// Delivery-target picker data layer (docs/GAPS.md §5 row 8): the daemon's
// ACTUAL wire schema for the `delivery` field on automation.jobs.create /
// automation.schedules.create (goodvibes-sdk
// platform/control-plane/operator-contract-schemas-admin.js
// AUTOMATION_DELIVERY_POLICY_SCHEMA + AUTOMATION_DELIVERY_TARGET_SCHEMA) —
// NOT the older, simpler AutomationDeliveryPolicy shape the automation
// manager's internal types.d.ts still carries; the operator-contract schema
// is the one ajv validates against on this route.
//
//   AUTOMATION_DELIVERY_POLICY_SCHEMA (all six keys required once `delivery`
//   is sent at all): { mode, targets: DeliveryTarget[], fallbackTargets:
//   DeliveryTarget[], includeSummary, includeTranscript, includeLinks,
//   replyToRouteId? }
//   AUTOMATION_DELIVERY_TARGET_SCHEMA: { kind (required), surfaceKind?,
//   address?, routeId?, label? }
//   AUTOMATION_DELIVERY_MODE_SCHEMA: none | webhook | surface | integration | link
//   AUTOMATION_SURFACE_KIND_SCHEMA: the enum below.
//
// Surface options and per-surface directory entries are read straight off
// channels.status / channels.directory.query — the SAME wire calls the
// Channels view uses, called directly here (never importing that view's own
// files, which are owned by a different agent's brief).

import { asArray, asRecord, firstString } from "../../lib/wire.ts";

/** AUTOMATION_SURFACE_KIND_SCHEMA at the time of writing. Rendered as an open
 * list — a daemon reporting a channels.status surface not in this set still
 * gets offered (channelsFromStatus is the primary source; this is only the
 * fallback when channels.status is unavailable). */
export const DELIVERY_SURFACE_KINDS = [
  "tui",
  "web",
  "slack",
  "discord",
  "ntfy",
  "webhook",
  "homeassistant",
  "telegram",
  "google-chat",
  "signal",
  "whatsapp",
  "telephony",
  "imessage",
  "msteams",
  "bluebubbles",
  "mattermost",
  "matrix",
  "service",
] as const;

/** AUTOMATION_DELIVERY_MODE_SCHEMA. */
export const DELIVERY_MODES = ["none", "webhook", "surface", "integration", "link"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** Per-target kinds worth offering in the picker — 'none' only makes sense as the policy-level mode. */
export const DELIVERY_TARGET_KINDS = ["surface", "webhook", "integration", "link"] as const satisfies readonly DeliveryMode[];

export interface DeliveryTargetDraft {
  kind: DeliveryMode;
  surfaceKind: string;
  address: string;
  routeId: string;
  label: string;
}

export function emptyDeliveryTarget(): DeliveryTargetDraft {
  return { kind: "surface", surfaceKind: "", address: "", routeId: "", label: "" };
}

/** AUTOMATION_DELIVERY_TARGET_SCHEMA wire shape — omit empty optional fields; 'kind' is the only required key. */
export function targetToWire(draft: DeliveryTargetDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: draft.kind };
  if (draft.surfaceKind.trim()) out.surfaceKind = draft.surfaceKind.trim();
  if (draft.address.trim()) out.address = draft.address.trim();
  if (draft.routeId.trim()) out.routeId = draft.routeId.trim();
  if (draft.label.trim()) out.label = draft.label.trim();
  return out;
}

/** What the picker itself won't let a target submit as — the daemon may reject more, but never lie about a clear miss. */
export function targetProblem(draft: DeliveryTargetDraft): string | null {
  if (draft.kind === "webhook" && !draft.address.trim()) return "Webhook targets need a URL.";
  if (draft.kind === "surface" && !draft.surfaceKind.trim()) return "Surface targets need a surface kind.";
  if (draft.kind === "surface" && !draft.address.trim() && !draft.routeId.trim()) {
    return "Surface targets need a channel (from the directory or typed in) or a route id.";
  }
  if (draft.kind === "integration" && !draft.address.trim()) return "Integration targets need an address.";
  return null;
}

export interface DeliveryPolicyDraft {
  mode: DeliveryMode;
  targets: DeliveryTargetDraft[];
  includeSummary: boolean;
  includeTranscript: boolean;
  includeLinks: boolean;
}

export function emptyDeliveryPolicy(): DeliveryPolicyDraft {
  return { mode: "none", targets: [], includeSummary: true, includeTranscript: false, includeLinks: true };
}

/** Only ride the wire with a `delivery` field once the user has actually configured something — an inert default stays omitted. */
export function deliveryPolicyIsConfigured(draft: DeliveryPolicyDraft): boolean {
  return draft.mode !== "none" || draft.targets.length > 0;
}

export function deliveryPolicyProblem(draft: DeliveryPolicyDraft): string | null {
  for (const target of draft.targets) {
    const problem = targetProblem(target);
    if (problem) return problem;
  }
  return null;
}

/** AUTOMATION_DELIVERY_POLICY_SCHEMA wire shape — every key the schema marks
 * required is present, even when empty (fallbackTargets: this picker has no
 * fallback-target UI yet, so it always sends an honest empty array, never a
 * guess). */
export function deliveryPolicyToWire(draft: DeliveryPolicyDraft): Record<string, unknown> {
  return {
    mode: draft.mode,
    targets: draft.targets.map(targetToWire),
    fallbackTargets: [],
    includeSummary: draft.includeSummary,
    includeTranscript: draft.includeTranscript,
    includeLinks: draft.includeLinks,
  };
}

// ─── channels.status (reused directly — GET /api/channels/status) ──────────

export interface DeliverySurfaceOption {
  surface: string;
  label: string;
  enabled: boolean;
}

export function surfacesFromChannelsStatus(data: unknown): DeliverySurfaceOption[] {
  return asArray(asRecord(data)["channels"])
    .map((row) => ({
      surface: firstString(row, ["surface"]),
      label: firstString(row, ["label"]) || firstString(row, ["surface"]),
      enabled: asRecord(row)["enabled"] === true,
    }))
    .filter((row) => row.surface.length > 0);
}

// ─── channels.directory.query (reused directly — GET /api/channels/directory/{surface}) ──

export interface DeliveryDirectoryOption {
  id: string;
  label: string;
  handle: string;
}

export function directoryOptionsFromResponse(data: unknown): DeliveryDirectoryOption[] {
  return asArray(asRecord(data)["entries"])
    .map((row) => ({
      id: firstString(row, ["id"]),
      label: firstString(row, ["label"]) || firstString(row, ["handle", "id"]),
      handle: firstString(row, ["handle"]),
    }))
    .filter((row) => row.id.length > 0 || row.handle.length > 0);
}
