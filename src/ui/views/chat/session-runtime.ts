// Shared helpers for the contract-1.11 session-runtime verb family this
// view's turn controls use: sessions.contextUsage.get, sessions.permissionMode
// .get/.set, sessions.queuedMessages.list/edit/delete, sessions.toolCalls
// .cancel (lib/gv.ts's `sessions` namespace). Every one of them answers ONLY
// for the daemon's own live local runtime session — any other session id is
// an honest 404 SESSION_NOT_LOCAL, never a real failure.
//
// AMBIGUITY THIS VIEW RESOLVES (see A2 brief): the ids these verbs are
// documented against ("the daemon's live local runtime session") are not
// necessarily the SAME id space as a companion-chat session id
// (companion.chat.sessions.*). goodvibes-webui's ChatView passes its
// companion-chat activeSessionId straight into this same sessions.* family
// (src/views/ChatView.tsx -> QueuedMessagesPanel) and leans on SESSION_NOT_LOCAL
// to degrade honestly when they don't line up — there is no live daemon
// available here to confirm the id spaces are identical for every server
// build. This view follows that precedent: pass the companion-chat session id
// straight through and hide the control (never render a scary error) on
// SESSION_NOT_LOCAL. Flagged for the integration gate in case a daemon probe
// later shows a different id is needed.
//
// isSessionNotLocalError is NOT in this app's lib/errors.ts (out of scope for
// this agent to add — lib/** is off-limits per the brief), so it is
// reimplemented here from the exported primitives, ported from
// goodvibes-webui src/lib/errors.ts's isSessionNotLocalError.

import { errorCode, serializeError } from "../../lib/errors.ts";
import { asRecord, firstString } from "../../lib/wire.ts";

/** True for the daemon's honest 404 SESSION_NOT_LOCAL refusal — the session id
 * is real, but this daemon is not the one hosting its live runtime. */
export function isSessionNotLocalError(error: unknown): boolean {
  if (errorCode(error) === "SESSION_NOT_LOCAL") return true;
  const serialized = serializeError(error);
  const transport = asRecord(serialized["transport"]);
  const body = asRecord(serialized["body"] ?? transport["body"]);
  const text = [
    firstString(serialized, ["message"]),
    firstString(body, ["message"]),
    firstString(body, ["error"]),
  ]
    .join(" ")
    .toLowerCase();
  return text.includes("does not host a live runtime") || text.includes("session_not_local");
}

/** The daemon's 404 TOOL_CALL_NOT_RUNNING — the call already settled (its
 * tool_result frame is on the way, or already arrived) before the cancel
 * request landed. Benign: never a failure to report. */
export function isToolCallNotRunningError(error: unknown): boolean {
  return errorCode(error) === "TOOL_CALL_NOT_RUNNING";
}

/** The daemon's 404 MESSAGE_NOT_QUEUED — a queued-message edit/delete raced a
 * delivery (the message was handed to the model just before the request
 * landed). Benign: the row is simply gone from the list on next refetch. */
export function isMessageNotQueuedError(error: unknown): boolean {
  return errorCode(error) === "MESSAGE_NOT_QUEUED";
}

// ─── Permission-mode vocabulary ─────────────────────────────────────────────
// Ported from goodvibes-webui src/lib/permission-mode.ts (that module lives
// under webui's lib/, off-limits for this agent to add here — reproduced
// locally instead since it is pure vocabulary, not wire plumbing).

export const PERMISSION_MODES = ["plan", "normal", "accept-edits", "auto", "custom"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** The subset `sessions.permissionMode.set` actually accepts — 'custom' is
 * read-only wire state (a bespoke rule set), never a settable value. */
export const SETTABLE_PERMISSION_MODES = ["plan", "normal", "accept-edits", "auto"] as const;
export type SettablePermissionMode = (typeof SETTABLE_PERMISSION_MODES)[number];

export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  plan: "Plan",
  normal: "Normal",
  "accept-edits": "Accept edits",
  auto: "Auto",
  custom: "Custom",
};

export function permissionModeLabel(mode: string): string {
  return isPermissionMode(mode) ? PERMISSION_MODE_LABELS[mode] : mode || "Unknown";
}
