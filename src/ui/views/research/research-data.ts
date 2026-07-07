// Research view data layer (docs/FEATURES.md §10) — two backends:
//  1. Daemon web search: web_search.providers.list + web_search.query via gv.invoke.
//  2. App-local research-runs registry: /app/registries/research-runs (the Bun
//     side implements the collection contract; this module codes to it).
// Records are superset-tolerant: parse defensively, mutate copies of the raw
// record so unknown fields survive the PUT round-trip.

import { appJson } from "../../lib/http.ts";
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
  /** Raw item record — the PUT payload is built from this. */
  raw: AnyRecord;
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
// A run is "resumable" when its status transitions and finding edits are
// recorded as a timestamped, append-only log on the item itself (no wire
// task backs this — the app-local registry item IS the source of truth),
// and a "checkpoint" snapshots the findings-at-the-time into a versions
// array so a run can be rolled back to what it looked like at that point.

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

/** Status transitions offered in the run-detail status selector — an open
 * vocabulary (the raw field accepts any string; these are just the offered
 * choices so a transition always has a readable log message). */
export const RUN_STATUSES = ["open", "in-progress", "blocked", "done", "reported"] as const;

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
