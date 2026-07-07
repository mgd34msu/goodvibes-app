// Automation view data layer — local query keys, defensive wire normalizers,
// and time/duration formatting (docs/FEATURES.md §5).
//
// Wire shapes verified against the daemon implementation
// (goodvibes-sdk packages/daemon-sdk/src/runtime-automation-routes.ts):
//   GET  /api/automation                       → { totals, jobs, recentRuns }
//   GET  /api/automation/jobs                  → { jobs: AutomationJob[] }
//   GET  /api/automation/schedules             → { jobs, runs }   (same job store)
//   GET  /api/automation/runs                  → { runs: AutomationRun[] } newest-first
//   GET  /api/automation/runs/{id}             → { run, deliveries }
//   POST cancel → { run } · retry → 202 { run } · delete → { removed, id }
//   GET  /api/automation/heartbeat             → { pending: [] }
// Statuses are daemon-defined open vocabularies (enabled|paused|error|archived,
// queued|running|completed|failed|cancelled) — rendered VERBATIM, never mapped.

import {
  asArray,
  asRecord,
  firstArray,
  firstNumber,
  firstString,
} from "../../lib/wire.ts";

// ─── Query keys ──────────────────────────────────────────────────────────────
// All prefixed ["automation"] to align with queryKeys.automation in
// lib/queries.ts (defined locally here — lib/queries.ts is not ours to edit).
// There is NO `automation` domain in DOMAIN_INVALIDATIONS (lib/realtime.ts),
// so these keys are refreshed by a 15s visible-only poll + refetch-on-mutation.

export const automationKeys = {
  all: ["automation"] as const,
  snapshot: ["automation", "integration"] as const,
  jobs: ["automation", "jobs"] as const,
  schedules: ["automation", "schedules"] as const,
  runs: ["automation", "runs"] as const,
  runDetail: (runId: string) => ["automation", "runs", runId] as const,
  heartbeat: ["automation", "heartbeat"] as const,
} as const;

/** No wire event exists for automation.* — poll while the view is mounted
 * (views without keepAlive unmount on switch, so this only runs while visible). */
export const AUTOMATION_POLL_MS = 15_000;

// ─── Records ─────────────────────────────────────────────────────────────────

export interface JobRecord {
  id: string;
  name: string;
  /** Verbatim daemon status (enabled|paused|error|archived|…). */
  status: string;
  enabled: boolean;
  scheduleKind: string;
  /** Human summary of the schedule definition (expression / interval / at). */
  scheduleSummary: string;
  timezone: string;
  nextRunAt?: number;
  lastRunAt?: number;
  lastRunId: string;
  runCount?: number;
  successCount?: number;
  failureCount?: number;
  pausedReason: string;
  description: string;
  createdAt?: number;
  raw: unknown;
}

export interface RunRecord {
  id: string;
  jobId: string;
  /** Verbatim daemon status (queued|running|completed|failed|cancelled|…). */
  status: string;
  trigger: string;
  agentId: string;
  sessionId: string;
  scheduleKind: string;
  queuedAt?: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  attempt?: number;
  error: string;
  cancelledReason: string;
  raw: unknown;
}

export interface SnapshotTotals {
  jobs?: number;
  enabled?: number;
  paused?: number;
  runs?: number;
}

export interface AutomationSnapshot {
  totals: SnapshotTotals;
  jobs: JobRecord[];
  recentRuns: RunRecord[];
  raw: unknown;
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

export function humanizeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return `${ms}ms`;
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

function summarizeSchedule(schedule: unknown): { kind: string; summary: string; timezone: string } {
  const record = asRecord(schedule);
  const kind = firstString(record, ["kind"]) || "unknown";
  const timezone = firstString(record, ["timezone"]);
  if (kind === "cron") {
    const expression = firstString(record, ["expression", "cron"]);
    return { kind, summary: expression || "cron", timezone };
  }
  if (kind === "every") {
    const intervalMs = firstNumber(record, ["intervalMs"]);
    return { kind, summary: intervalMs !== undefined ? `every ${humanizeMs(intervalMs)}` : "every", timezone };
  }
  if (kind === "at") {
    const at = firstNumber(record, ["at"]);
    return { kind, summary: at !== undefined ? `at ${formatAbsolute(at)}` : "at", timezone };
  }
  return { kind, summary: kind, timezone };
}

export function normalizeJob(value: unknown): JobRecord {
  const record = asRecord(value);
  const { kind, summary, timezone } = summarizeSchedule(record["schedule"]);
  const enabledRaw = record["enabled"];
  return {
    id: firstString(record, ["id", "jobId"]),
    name: firstString(record, ["name", "id"]) || "unnamed job",
    status: firstString(record, ["status"]) || (enabledRaw === false ? "paused" : "enabled"),
    enabled: enabledRaw !== false,
    scheduleKind: kind,
    scheduleSummary: summary,
    timezone,
    ...(firstNumber(record, ["nextRunAt"]) !== undefined ? { nextRunAt: firstNumber(record, ["nextRunAt"]) } : {}),
    ...(firstNumber(record, ["lastRunAt"]) !== undefined ? { lastRunAt: firstNumber(record, ["lastRunAt"]) } : {}),
    lastRunId: firstString(record, ["lastRunId"]),
    ...(firstNumber(record, ["runCount"]) !== undefined ? { runCount: firstNumber(record, ["runCount"]) } : {}),
    ...(firstNumber(record, ["successCount"]) !== undefined
      ? { successCount: firstNumber(record, ["successCount"]) }
      : {}),
    ...(firstNumber(record, ["failureCount"]) !== undefined
      ? { failureCount: firstNumber(record, ["failureCount"]) }
      : {}),
    pausedReason: firstString(record, ["pausedReason"]),
    description: firstString(record, ["description", "prompt"]),
    ...(firstNumber(record, ["createdAt"]) !== undefined ? { createdAt: firstNumber(record, ["createdAt"]) } : {}),
    raw: value,
  };
}

export function normalizeRun(value: unknown): RunRecord {
  const record = asRecord(value);
  const startedAt = firstNumber(record, ["startedAt"]);
  const endedAt = firstNumber(record, ["endedAt", "completedAt", "finishedAt"]);
  const durationMs =
    firstNumber(record, ["durationMs"]) ??
    (startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt ? endedAt - startedAt : undefined);
  const triggeredBy = asRecord(record["triggeredBy"]);
  return {
    id: firstString(record, ["id", "runId"]),
    jobId: firstString(record, ["jobId"]),
    status: firstString(record, ["status"]) || "unknown",
    trigger: firstString(record, ["trigger"]) || firstString(triggeredBy, ["kind"]),
    agentId: firstString(record, ["agentId"]),
    sessionId: firstString(record, ["sessionId"]),
    scheduleKind: firstString(record, ["scheduleKind"]),
    ...(firstNumber(record, ["queuedAt"]) !== undefined ? { queuedAt: firstNumber(record, ["queuedAt"]) } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(firstNumber(record, ["attempt"]) !== undefined ? { attempt: firstNumber(record, ["attempt"]) } : {}),
    error: firstString(record, ["error"]),
    cancelledReason: firstString(record, ["cancelledReason"]),
    raw: value,
  };
}

export function jobsFromResponse(value: unknown): JobRecord[] {
  return firstArray(value, ["jobs", "items"]).map(normalizeJob);
}

export function runsFromResponse(value: unknown): RunRecord[] {
  return firstArray(value, ["runs", "items"]).map(normalizeRun);
}

export function normalizeSnapshot(value: unknown): AutomationSnapshot {
  const record = asRecord(value);
  const totals = asRecord(record["totals"]);
  return {
    totals: {
      ...(firstNumber(totals, ["jobs"]) !== undefined ? { jobs: firstNumber(totals, ["jobs"]) } : {}),
      ...(firstNumber(totals, ["enabled"]) !== undefined ? { enabled: firstNumber(totals, ["enabled"]) } : {}),
      ...(firstNumber(totals, ["paused"]) !== undefined ? { paused: firstNumber(totals, ["paused"]) } : {}),
      ...(firstNumber(totals, ["runs"]) !== undefined ? { runs: firstNumber(totals, ["runs"]) } : {}),
    },
    jobs: asArray(record["jobs"]).map(normalizeJob),
    recentRuns: firstArray(record, ["recentRuns", "runs"]).map(normalizeRun),
    raw: value,
  };
}

// ─── Time formatting ─────────────────────────────────────────────────────────

export function formatAbsolute(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "in 5m" / "3h ago" — paired with the absolute form, never alone
 * (docs/UX.md: every number has a frame of reference). */
export function formatRelative(epochMs: number, now: number = Date.now()): string {
  const diff = epochMs - now;
  const abs = Math.abs(diff);
  const unit =
    abs < 60_000
      ? `${Math.max(1, Math.round(abs / 1_000))}s`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`;
}
