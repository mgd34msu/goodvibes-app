// Pure logic for the daemon's self-update posture (update.status / update.check).
//
// ── The four things this has to be able to say ─────────────────────────────
//  1. A release is DOWNLOADED AND VERIFIED and waiting for a moment with no
//     work in flight (`pendingVersion`). Nothing has been installed yet.
//  2. A release was installed here, failed to start, and was ROLLED BACK
//     (`rejectedVersion`). It is deliberately not reinstalled, so this state
//     persists until something else changes, and it must not read as "up to
//     date".
//  3. Checks are running on schedule and FAILING every time
//     (`failedCheckCount` + `lastCheckFailure`). This is the state that used to
//     be invisible, because it looks exactly like having nothing to update to.
//  4. No loop is armed at all (`armed: false`), with `offReason` naming which
//     gate stopped it.
//
// Rendering any of those as "up to date" would be the lie this surface exists
// to prevent, so `describeUpdatePosture` returns a discriminated posture rather
// than a boolean.

import { asRecord, firstNumber, firstString } from "../../lib/wire.ts";

export interface DaemonUpdateStatus {
  /** False whenever no update loop is running; offReason says which gate. */
  armed: boolean;
  offReason: string;
  currentVersion: string;
  releasesUrl: string;
  checkIntervalMs: number | undefined;
  firstCheckDelayMs: number | undefined;
  failedCheckCount: number;
  lastCheckFailure: string;
  /** Downloaded and verified, waiting for a quiet moment. Not yet installed. */
  pendingVersion: string;
  /** Installed here, failed to start, rolled back, and not reinstalled. */
  rejectedVersion: string;
}

export function parseUpdateStatus(value: unknown): DaemonUpdateStatus {
  const record = asRecord(value);
  return {
    armed: record["armed"] === true,
    offReason: firstString(record, ["offReason"]),
    currentVersion: firstString(record, ["currentVersion"]),
    releasesUrl: firstString(record, ["releasesUrl"]),
    checkIntervalMs: firstNumber(record, ["checkIntervalMs"]),
    firstCheckDelayMs: firstNumber(record, ["firstCheckDelayMs"]),
    failedCheckCount: firstNumber(record, ["failedCheckCount"]) ?? 0,
    lastCheckFailure: firstString(record, ["lastCheckFailure"]),
    pendingVersion: firstString(record, ["pendingVersion"]),
    rejectedVersion: firstString(record, ["rejectedVersion"]),
  };
}

export type UpdatePostureKind = "staged" | "rolled-back" | "failing" | "off" | "current";

export interface UpdatePosture {
  kind: UpdatePostureKind;
  tone: "ok" | "info" | "warning" | "danger";
  headline: string;
  detail: string;
}

/** "every 1h" / "every 30m" / "" when the daemon reported no interval. */
export function formatInterval(ms: number | undefined): string {
  if (ms === undefined || ms <= 0) return "";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `every ${minutes}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `every ${hours}h` : `every ${hours.toFixed(1)}h`;
}

/**
 * The single posture to render.
 *
 * Order matters and is not arbitrary: a staged release and a rolled-back one
 * are facts about specific versions and outrank both the failure counter and
 * the armed flag, because an unarmed loop with a release already staged still
 * has a release staged.
 */
export function describeUpdatePosture(status: DaemonUpdateStatus): UpdatePosture {
  const version = status.currentVersion || "an unreported version";
  if (status.rejectedVersion) {
    return {
      kind: "rolled-back",
      tone: "danger",
      headline: `${status.rejectedVersion} was rolled back`,
      detail: `That release was installed here, failed to start, and was rolled back. It is deliberately not reinstalled. The daemon is running ${version}.`,
    };
  }
  if (status.pendingVersion) {
    return {
      kind: "staged",
      tone: "info",
      headline: `${status.pendingVersion} is staged`,
      detail: `Downloaded and verified, waiting for a moment when no work is in flight. Nothing has been installed yet; the daemon is still running ${version}.`,
    };
  }
  if (status.failedCheckCount > 0) {
    return {
      kind: "failing",
      tone: "warning",
      headline: `${status.failedCheckCount} update check${status.failedCheckCount === 1 ? "" : "s"} failed`,
      // Without this the daemon looks exactly like one with nothing to update to.
      detail: status.lastCheckFailure
        ? `Last failure: ${status.lastCheckFailure}`
        : "The daemon reported failures without a reason.",
    };
  }
  if (!status.armed) {
    return {
      kind: "off",
      tone: "warning",
      headline: "Not keeping itself current",
      detail: status.offReason || "No update loop is running and the daemon gave no reason.",
    };
  }
  const interval = formatInterval(status.checkIntervalMs);
  return {
    kind: "current",
    tone: "ok",
    headline: `Running ${version}, nothing staged`,
    detail: interval ? `Checking for releases ${interval}.` : "Checking for releases on its own schedule.",
  };
}
