// Research view data layer (docs/FEATURES.md §10) — three backends:
//  1. Daemon web search: web_search.providers.list + web_search.query via gv.invoke.
//  2. Daemon runtime tasks: tasks.create/.get/.status/.list/.cancel/.retry via
//     gv.tasks.* (docs/GAPS.md §10 row 3) — a run's live status/cancel/retry
//     ride the same RuntimeTask registry Approvals & Tasks and Fleet use.
//  3. App-local research-runs registry: /app/registries/research-runs (the Bun
//     side implements the collection contract; this module codes to it) — now
//     ANNOTATION ONLY (question, notes, findings, log, checkpoints) for
//     task-backed runs. The daemon task is the source of truth for run state.
// Records are superset-tolerant: parse defensively, mutate copies of the raw
// record so unknown fields survive the PUT round-trip.

import { appJson } from "../../lib/http.ts";
import type { TaskSummary } from "../../lib/approvals.ts";
import {
  asRecord,
  firstArrayAtPath,
  firstString,
  type AnyRecord,
} from "../../lib/wire.ts";

/** Epoch millis from a numeric or ISO-string timestamp field — the app-local
 * registry store writes ISO strings (src/bun/registries/store.ts nowIso), so
 * lib/wire.ts firstNumber alone would drop every createdAt. */
export function firstTimestamp(value: unknown, keys: string[]): number | undefined {
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item === "string" && item.trim()) {
      const parsed = Date.parse(item);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

// ─── Query keys (LOCAL, unique "research" prefix — not in lib/queries.ts) ────

export const researchKeys = {
  all: ["research"] as const,
  runs: ["research", "runs"] as const,
  searchProviders: ["research", "web-search", "providers"] as const,
  search: (provider: string, query: string) => ["research", "web-search", "query", provider, query] as const,
  capability: (methodId: string) => ["research", "capability", methodId] as const,
  inspect: (url: string) => ["research", "inspect", url] as const,
};

// ─── Runtime-task backing (docs/GAPS.md §10 row 3) ───────────────────────────
// Note: task-detail/task-list reads deliberately use lib/queries.ts's shared
// `queryKeys.tasks` / `queryKeys.taskDetail` (NOT a local "research" key) so
// this view rides the same `tasks` SSE-domain invalidation as Approvals &
// Tasks / Fleet (lib/realtime.ts DOMAIN_INVALIDATIONS) instead of a second,
// disconnected cache entry for the same wire record.

// ─── research-runs registry client ───────────────────────────────────────────

const RUNS_BASE = "/app/registries/research-runs";

const JSON_HEADERS = { "content-type": "application/json" } as const;

export async function listRuns(): Promise<AnyRecord[]> {
  const res = await appJson<unknown>(RUNS_BASE);
  return firstArrayAtPath(res, [["items"], ["data"]]).map(asRecord);
}

export async function createRun(item: AnyRecord): Promise<AnyRecord> {
  const res = await appJson<unknown>(RUNS_BASE, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ item }),
  });
  return asRecord(asRecord(res)["item"]);
}

export async function updateRun(id: string, item: AnyRecord): Promise<AnyRecord> {
  const res = await appJson<unknown>(`${RUNS_BASE}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ item }),
  });
  return asRecord(asRecord(res)["item"]);
}

export async function deleteRun(id: string): Promise<void> {
  await appJson<unknown>(`${RUNS_BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Parsed shapes (docs/research/agent-map.md §1b research-runs) ────────────

export const CREDIBILITY_LEVELS = ["high", "medium", "low", "unknown"] as const;
export type Credibility = (typeof CREDIBILITY_LEVELS)[number];

export interface ResearchFinding {
  url: string;
  title: string;
  note: string;
  credibility: Credibility;
  /** Raw finding record — unknown extra fields survive round-trips. */
  raw: AnyRecord;
}

export interface ResearchRun {
  id: string;
  question: string;
  status: string;
  findings: ResearchFinding[];
  reportArtifactId: string;
  createdAt: number | undefined;
  /** Timestamped status/finding/checkpoint/report history — see the
   * "Findings log + checkpoints" section below. Superset field: absent on
   * runs created before this shipped, populated going forward. */
  log: RunLogEntry[];
  /** Named findings snapshots taken by the "Checkpoint" action. */
  checkpoints: RunCheckpoint[];
  /** The RuntimeTask id backing this run (docs/GAPS.md §10 row 3) — the
   * daemon is the source of truth for status/cancel/retry once this is set.
   * Absent on runs created before this shipped ("legacy" — see isLegacyRun). */
  taskId: string | undefined;
  /** The agentId `tasks.create` (POST /task) acknowledged with, kept until
   * `taskId` resolves (owner === agentId in tasks.list — the same link
   * AgentTaskAdapter/fleet.ts's taskForNode use). Present without taskId
   * means "submitted, not yet linked" — see runLinkState. */
  agentId: string | undefined;
  /** Raw item record — the PUT payload is built from this. */
  raw: AnyRecord;
}

/** "legacy" = pre-task-era row (neither field — status/cancel is local-only,
 * never resumable, render read-only). "linking" = tasks.create acknowledged
 * but the RuntimeTask registry hasn't been observed to carry the link yet
 * (should self-resolve within a beat; offer a manual retry). "linked" = a
 * real cancellable/retryable RuntimeTask backs this run. */
export type RunLinkState = "legacy" | "linking" | "linked";

export function runLinkState(run: ResearchRun): RunLinkState {
  if (run.taskId) return "linked";
  if (run.agentId) return "linking";
  return "legacy";
}

export function isLegacyRun(run: ResearchRun): boolean {
  return runLinkState(run) === "legacy";
}

/** The RuntimeTask id owned by this agentId, per tasks.list — the link
 * AgentTaskAdapter establishes server-side (owner: agentId) and fleet.ts's
 * taskForNode reads client-side for the Fleet view's agent nodes. */
export function findRuntimeTaskIdForAgent(tasks: readonly TaskSummary[], agentId: string): string | undefined {
  return tasks.find((task) => task.kind === "agent" && task.owner === agentId)?.id;
}

/** Same transition guard the daemon enforces (TasksSection.tsx / fleet.ts
 * canRetryTask parity): retry only from a terminal failure/cancellation. */
export function canRetryResearchTask(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

/** tasks.create (POST /task) ack — only `agentId` is load-bearing here; the
 * rest is display-only. */
export interface TaskCreateAck {
  acknowledged: boolean;
  agentId: string;
  sessionId: string;
  status: string;
}

export function taskCreateAckFrom(value: unknown): TaskCreateAck {
  const raw = asRecord(value);
  return {
    acknowledged: raw["acknowledged"] === true,
    agentId: firstString(raw, ["agentId"]),
    sessionId: firstString(raw, ["sessionId"]),
    status: firstString(raw, ["status"]),
  };
}

/** The research prompt/spec carried by tasks.create — a real daemon agent
 * task, not just a label; its lifecycle is what backs this run's status. */
export function composeResearchTaskPrompt(question: string): string {
  return (
    `Research task: investigate "${question}". Use the tools available to you ` +
    `(web search, page fetch, etc.) to find credible sources, evaluate them, and ` +
    `summarize what you learn.`
  );
}

/** tasks.create body for a new research run (docs/GAPS.md §10 row 3). */
export function researchTaskCreateBody(question: string): AnyRecord {
  const title = question.trim();
  return {
    task: composeResearchTaskPrompt(question),
    title: title.length > 120 ? `${title.slice(0, 117)}...` : title || "Research run",
  };
}

/** Raw record for a freshly created task-backed run — annotation fields only;
 * the daemon task (agentId, and taskId once linked) is the state source. */
export function rawForNewTaskRun(question: string, ack: TaskCreateAck, taskId: string | undefined): AnyRecord {
  return {
    question,
    status: "open",
    findings: [],
    log: [
      makeLogEntry(
        "status",
        taskId
          ? "Run created — backed by daemon task"
          : `Run created — submitted to the daemon (agent ${ack.agentId}); linking task id…`,
      ),
    ],
    agentId: ack.agentId,
    sessionId: ack.sessionId,
    ...(taskId ? { taskId } : {}),
  };
}

export function credibilityFrom(value: unknown): Credibility {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  return (CREDIBILITY_LEVELS as readonly string[]).includes(text) ? (text as Credibility) : "unknown";
}

export function findingFrom(value: unknown): ResearchFinding {
  const raw = asRecord(value);
  return {
    url: firstString(raw, ["url", "link", "href"]),
    title: firstString(raw, ["title", "name"]) || firstString(raw, ["url", "link"]),
    note: firstString(raw, ["note", "notes", "summary"]),
    credibility: credibilityFrom(raw["credibility"]),
    raw,
  };
}

export function runFrom(value: unknown): ResearchRun {
  const raw = asRecord(value);
  const findings = Array.isArray(raw["findings"]) ? raw["findings"].map(findingFrom) : [];
  const log = Array.isArray(raw["log"]) ? raw["log"].map(logEntryFrom) : [];
  const checkpoints = Array.isArray(raw["checkpoints"]) ? raw["checkpoints"].map(checkpointFrom) : [];
  return {
    id: firstString(raw, ["id"]),
    question: firstString(raw, ["question", "title", "name"]) || "(no question)",
    status: firstString(raw, ["status", "state"]) || "open",
    findings,
    reportArtifactId: firstString(raw, ["reportArtifactId"]),
    createdAt: firstTimestamp(raw, ["createdAt"]),
    log,
    checkpoints,
    taskId: firstString(raw, ["taskId"]) || undefined,
    agentId: firstString(raw, ["agentId"]) || undefined,
    raw,
  };
}

/** Serialize the findings array back onto a raw run record, optionally
 * appending a log entry in the same PUT (never two racing mutations). */
export function rawWithFindings(run: ResearchRun, findings: ResearchFinding[], logEntry?: AnyRecord): AnyRecord {
  const existingLog = Array.isArray(run.raw["log"]) ? run.raw["log"] : [];
  return {
    ...run.raw,
    findings: findings.map((f) => ({ ...f.raw, url: f.url, title: f.title, note: f.note, credibility: f.credibility })),
    ...(logEntry ? { log: [...existingLog, logEntry] } : {}),
  };
}

// ─── Findings log + checkpoints (docs/GAPS.md §10 row 3 — resumable runs) ────
// The findings/notes/checkpoint history is always app-local annotation, on
// top of the registry item, regardless of task backing: finding edits and
// checkpoint snapshots are recorded as a timestamped, append-only log on the
// item itself. For a task-backed run the daemon RuntimeTask is the source of
// truth for run STATUS (queued/running/.../cancelled — see runLinkState);
// this log additionally records status transitions the app observes (created,
// linked, cancelled, retried) so the run's own history stays readable even
// though the live value lives on the daemon task. A "checkpoint" snapshots
// the findings-at-the-time into a versions array so a run can be rolled back
// to what it looked like at that point.

export interface RunLogEntry {
  at: number | undefined;
  type: string;
  message: string;
  raw: AnyRecord;
}

export function logEntryFrom(value: unknown): RunLogEntry {
  const raw = asRecord(value);
  return {
    at: firstTimestamp(raw, ["at", "timestamp", "createdAt"]),
    type: firstString(raw, ["type", "kind"]) || "note",
    message: firstString(raw, ["message", "note", "text"]),
    raw,
  };
}

/** A fresh log-entry record (ISO timestamp — matches the registry's own
 * nowIso() convention so ordering survives round-trips through the store). */
export function makeLogEntry(type: string, message: string): AnyRecord {
  return { at: new Date().toISOString(), type, message };
}

export interface RunCheckpoint {
  at: number | undefined;
  label: string;
  findings: ResearchFinding[];
  raw: AnyRecord;
}

export function checkpointFrom(value: unknown): RunCheckpoint {
  const raw = asRecord(value);
  const findings = Array.isArray(raw["findings"]) ? raw["findings"].map(findingFrom) : [];
  return {
    at: firstTimestamp(raw, ["at", "timestamp", "createdAt"]),
    label: firstString(raw, ["label", "name"]) || "checkpoint",
    findings,
    raw,
  };
}

/** Append a log entry (and, optionally, apply other field patches) onto a
 * run's raw record in one shot — a single PUT for both, never a lost update
 * from two separate mutations racing each other. */
export function rawWithLog(run: ResearchRun, patch: AnyRecord, entry: AnyRecord): AnyRecord {
  const existingLog = Array.isArray(run.raw["log"]) ? run.raw["log"] : [];
  return {
    ...run.raw,
    ...patch,
    log: [...existingLog, entry],
  };
}

export function rawWithCheckpoint(run: ResearchRun, label: string): AnyRecord {
  const existingCheckpoints = Array.isArray(run.raw["checkpoints"]) ? run.raw["checkpoints"] : [];
  const existingLog = Array.isArray(run.raw["log"]) ? run.raw["log"] : [];
  const snapshot = {
    at: new Date().toISOString(),
    label,
    findings: run.findings.map((f) => ({ ...f.raw, url: f.url, title: f.title, note: f.note, credibility: f.credibility })),
  };
  return {
    ...run.raw,
    checkpoints: [...existingCheckpoints, snapshot],
    log: [
      ...existingLog,
      makeLogEntry(
        "checkpoint",
        `Checkpointed ${run.findings.length} finding${run.findings.length === 1 ? "" : "s"} as “${label}”`,
      ),
    ],
  };
}

// ─── URL inspection (docs/GAPS.md §10 row 7) ─────────────────────────────────
// POST /app/local/fetch-preview (src/bun/local-tools.ts) — a read-only,
// server-side GET with a private-address guard. Refusals come back as a
// normal HTTP error whose JSON body carries {error, code}; lib/errors.ts's
// errorCode()/formatError() read that shape directly from the HttpError.

export interface UrlPreview {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string;
  textExcerpt: string;
}

export function urlPreviewFrom(value: unknown): UrlPreview {
  const raw = asRecord(value);
  return {
    url: firstString(raw, ["url"]),
    finalUrl: firstString(raw, ["finalUrl", "url"]),
    status: typeof raw["status"] === "number" ? raw["status"] : 0,
    contentType: firstString(raw, ["contentType"]),
    title: firstString(raw, ["title"]),
    textExcerpt: firstString(raw, ["textExcerpt"]),
  };
}

export async function fetchUrlPreview(url: string): Promise<UrlPreview> {
  const res = await appJson<unknown>("/app/local/fetch-preview", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ url }),
  });
  return urlPreviewFrom(res);
}

// ─── Web search parsing ──────────────────────────────────────────────────────

export interface SearchProvider {
  id: string;
  label: string;
  status: string;
}

export function searchProvidersFrom(value: unknown): SearchProvider[] {
  return firstArrayAtPath(value, [["providers"], ["items"], ["data"], ["result", "providers"]])
    .map((entry) => {
      if (typeof entry === "string") return { id: entry, label: entry, status: "" };
      const record = asRecord(entry);
      const id = firstString(record, ["id", "provider", "name", "key"]);
      if (!id) return null;
      return {
        id,
        label: firstString(record, ["label", "displayName", "name"]) || id,
        status: firstString(record, ["status", "state", "availability"]),
      };
    })
    .filter((p): p is SearchProvider => p !== null);
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  raw: AnyRecord;
}

export function searchResultsFrom(value: unknown): SearchResult[] {
  return firstArrayAtPath(value, [
    ["results"],
    ["items"],
    ["data"],
    ["result", "results"],
    ["response", "results"],
  ])
    .map((entry) => {
      const raw = asRecord(entry);
      const url = firstString(raw, ["url", "link", "href"]);
      if (!url) return null;
      return {
        title: firstString(raw, ["title", "name", "heading"]) || url,
        url,
        snippet: firstString(raw, ["snippet", "description", "summary", "content", "text"]),
        source: firstString(raw, ["source", "provider", "engine", "site", "domain"]),
        raw,
      };
    })
    .filter((r): r is SearchResult => r !== null);
}

// ─── Report composition (client-side, sourced from triaged findings) ─────────

/** UTF-8 safe base64 (btoa alone corrupts non-Latin-1 text). */
export function base64FromText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function composeReportMarkdown(run: ResearchRun): string {
  const lines: string[] = [];
  lines.push(`# Research report: ${run.question}`);
  lines.push("");
  lines.push(
    `Generated ${new Date().toISOString()} from ${run.findings.length} reviewed source${run.findings.length === 1 ? "" : "s"}.`,
  );
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  run.findings.forEach((finding, index) => {
    lines.push(`### ${index + 1}. ${finding.title}`);
    lines.push("");
    lines.push(`- Source: <${finding.url}>`);
    lines.push(`- Credibility: ${finding.credibility}`);
    lines.push("");
    if (finding.note) {
      lines.push(finding.note);
      lines.push("");
    }
  });
  lines.push("## Sources");
  lines.push("");
  run.findings.forEach((finding, index) => {
    lines.push(`${index + 1}. [${finding.title}](${finding.url}) — credibility: ${finding.credibility}`);
  });
  lines.push("");
  return lines.join("\n");
}

export function reportFilename(run: ResearchRun): string {
  const slug =
    run.question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "research";
  return `research-report-${slug}.md`;
}
