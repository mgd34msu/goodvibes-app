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
