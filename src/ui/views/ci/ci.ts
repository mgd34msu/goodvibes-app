// Tolerant readers + display helpers for ci.status / ci.watches.* (contract
// 1.11, all plain HTTP — see generated/operator-routes.ts, ws:false on every
// ci.* row, so none of the ws-bridge-down handling FleetView/CheckpointsView
// need applies here). Shapes below are read field-by-field against the
// installed contract artifact's ci.* schemas (operator-contract.json),
// never cast — an older/newer daemon that omits or renames a field degrades
// to the honest fallback ("" / 0 / []), not a crash.
//
// Per this view's honesty bar (docs/UX.md §4): a CI report's `overall` is
// the DAEMON's own rollup (never re-derived client-side), but the detail
// still renders every job individually — the daemon's rollup is shown
// alongside the per-job list, never instead of it.

import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

export interface CiJob {
  name: string;
  status: string;
  /** null = not yet concluded (queued/in_progress); "" only for a malformed record. */
  conclusion: string | null;
  continueOnError: boolean;
  url: string;
}

export interface CiReport {
  repo: string;
  ref: string;
  prNumber: number | undefined;
  overall: string;
  jobs: CiJob[];
  violations: string[];
  checkedAt: number;
}

export interface CiWatch {
  id: string;
  repo: string;
  ref: string;
  prNumber: number | undefined;
  deliveryChannel: string;
  triggerFixSession: boolean;
  /** "" when the watch has never been checked yet — never fabricate a verdict. */
  lastOverall: string;
  createdAt: number;
  updatedAt: number;
}

export interface CiWatchRunResult {
  report: CiReport;
  notified: boolean;
  notificationId: string;
  fixSessionTriggered: boolean;
  /** fixSessionId / fixSessionError are mutually exclusive on the wire when
   * fixSessionTriggered is true — a real attachable session, or an honest
   * failure reason, never both and never a dead id. */
  fixSessionId: string;
  fixSessionError: string;
  fixSessionOffered: boolean;
  /** True once this watch has been auto-retired (e.g. the PR closed/merged)
   * — the daemon's own signal that no further checks will run for it. */
  retired: boolean;
}

function parseJob(value: unknown): CiJob {
  const record = asRecord(value);
  const rawConclusion = record["conclusion"];
  return {
    name: firstString(record, ["name"]),
    status: firstString(record, ["status"]),
    conclusion: typeof rawConclusion === "string" ? rawConclusion : null,
    continueOnError: record["continueOnError"] === true,
    url: firstString(record, ["url"]),
  };
}

export function parseCiReport(value: unknown): CiReport {
  // Both ci.status and ci.watches.run wrap the report in a {report} envelope;
  // tolerate a bare report object too (defensive, matches checkpoints-model's
  // envelope-or-bare-value pattern).
  const outer = asRecord(value);
  const record = asRecord(outer["report"] ?? value);
  return {
    repo: firstString(record, ["repo"]),
    ref: firstString(record, ["ref"]),
    prNumber: firstNumber(record, ["prNumber"]),
    overall: firstString(record, ["overall"]) || "unknown",
    jobs: asArray(record["jobs"]).map(parseJob),
    violations: asArray(record["violations"]).filter((v): v is string => typeof v === "string"),
    checkedAt: firstNumber(record, ["checkedAt"]) ?? 0,
  };
}

export function parseCiWatch(value: unknown): CiWatch {
  const record = asRecord(value);
  return {
    id: firstString(record, ["id", "watchId"]),
    repo: firstString(record, ["repo"]),
    ref: firstString(record, ["ref"]),
    prNumber: firstNumber(record, ["prNumber"]),
    deliveryChannel: firstString(record, ["deliveryChannel"]),
    triggerFixSession: record["triggerFixSession"] === true,
    lastOverall: firstString(record, ["lastOverall"]),
    createdAt: firstNumber(record, ["createdAt"]) ?? 0,
    updatedAt: firstNumber(record, ["updatedAt"]) ?? 0,
  };
}

export function parseCiWatchList(value: unknown): CiWatch[] {
  const record = asRecord(value);
  return asArray(record["watches"])
    .map(parseCiWatch)
    .filter((w) => w.id !== "");
}

export function parseCiWatchRunResult(value: unknown): CiWatchRunResult {
  const record = asRecord(value);
  return {
    report: parseCiReport(record["report"]),
    notified: record["notified"] === true,
    notificationId: firstString(record, ["notificationId"]),
    fixSessionTriggered: record["fixSessionTriggered"] === true,
    fixSessionId: firstString(record, ["fixSessionId"]),
    fixSessionError: firstString(record, ["fixSessionError"]),
    fixSessionOffered: record["fixSessionOffered"] === true,
    retired: record["retired"] === true,
  };
}

export function parseCiWatchDeleteResult(value: unknown): { deleted: boolean } {
  const record = asRecord(value);
  return { deleted: record["deleted"] === true };
}

/** "owner/repo #123" | "owner/repo@ref" | "owner/repo" — the compact row label. */
export function watchLabel(watch: Pick<CiWatch, "repo" | "ref" | "prNumber">): string {
  if (watch.prNumber !== undefined) return `${watch.repo} #${watch.prNumber}`;
  if (watch.ref) return `${watch.repo}@${watch.ref}`;
  return watch.repo;
}

export function reportLabel(report: Pick<CiReport, "repo" | "ref" | "prNumber">): string {
  if (report.prNumber !== undefined) return `${report.repo} #${report.prNumber}`;
  if (report.ref) return `${report.repo}@${report.ref}`;
  return report.repo;
}

/** overall/conclusion -> the shared badge tone classes (components.css). */
export function ciTone(value: string): "ok" | "bad" | "warning" | "neutral" {
  if (value === "passed" || value === "success") return "ok";
  if (value === "failed" || value === "failure" || value === "cancelled" || value === "timed_out") return "bad";
  if (value === "pending" || value === "queued" || value === "in_progress") return "warning";
  return "neutral";
}
