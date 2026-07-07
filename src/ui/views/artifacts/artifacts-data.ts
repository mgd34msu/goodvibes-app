// Artifacts view data layer (docs/FEATURES.md §12) — daemon-backed:
// artifacts.list / artifacts.get / artifacts.content.get / artifacts.create,
// plus confirm-gated knowledge.ingest.artifact. Records are parsed
// defensively (shapes vary across daemon versions).

import {
  asRecord,
  firstArrayAtPath,
  firstNumber,
  firstString,
  type AnyRecord,
} from "../../lib/wire.ts";

// ─── Query keys — aligned to lib/queries.ts queryKeys.artifacts ("artifacts")
// prefix so any future domain invalidation fans out here too. artifacts.* has
// no wire event today, so the list also polls (30s).

export const artifactKeys = {
  all: ["artifacts"] as const,
  list: (limit: number) => ["artifacts", "list", limit] as const,
  detail: (id: string) => ["artifacts", "detail", id] as const,
  capability: (methodId: string) => ["artifacts", "capability", methodId] as const,
};

/** Epoch millis from a numeric or ISO-string timestamp field — daemon
 * artifact records may carry either shape; lib/wire.ts firstNumber alone
 * would drop ISO-string createdAt values. */
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

// ─── Kind classification (type facets: md/json/csv/pdf/image/audio/video) ────

export type ArtifactKind =
  | "markdown"
  | "text"
  | "json"
  | "csv"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "other";

export const KIND_FACETS: readonly ArtifactKind[] = [
  "markdown",
  "text",
  "json",
  "csv",
  "image",
  "audio",
  "video",
  "pdf",
  "other",
];

export function kindOf(mimeType: string, filename: string): ArtifactKind {
  const mime = mimeType.toLowerCase();
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mime.includes("markdown") || ext === "md" || ext === "markdown") return "markdown";
  if (mime.includes("json") || ext === "json") return "json";
  if (mime.includes("csv") || ext === "csv") return "csv";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.includes("pdf") || ext === "pdf") return "pdf";
  if (mime.startsWith("text/") || ["txt", "log", "yaml", "yml", "toml", "ts", "tsx", "js", "py", "sh"].includes(ext)) {
    return "text";
  }
  return "other";
}

/** Kinds whose bytes decode as displayable text. */
export function isTextKind(kind: ArtifactKind): boolean {
  return kind === "markdown" || kind === "text" || kind === "json" || kind === "csv";
}

// ─── Record parsing ──────────────────────────────────────────────────────────

export interface ArtifactRecord {
  id: string;
  filename: string;
  mimeType: string;
  kind: ArtifactKind;
  sizeBytes: number | undefined;
  createdAt: number | undefined;
  metadata: AnyRecord;
  raw: AnyRecord;
}

export function artifactFrom(value: unknown): ArtifactRecord {
  const raw = asRecord(value);
  const filename = firstString(raw, ["filename", "name", "title", "label"]);
  const mimeType = firstString(raw, ["mimeType", "contentType", "type"]);
  const id = firstString(raw, ["id", "artifactId"]);
  return {
    id,
    filename: filename || id || "(unnamed)",
    mimeType,
    kind: kindOf(mimeType, filename),
    sizeBytes: firstNumber(raw, ["sizeBytes", "size", "bytes", "length"]),
    createdAt: firstTimestamp(raw, ["createdAt", "created", "timestamp"]),
    metadata: asRecord(raw["metadata"]),
    raw,
  };
}

export function artifactsFromListResponse(value: unknown): ArtifactRecord[] {
  return firstArrayAtPath(value, [
    ["artifacts"],
    ["items"],
    ["data"],
    ["result", "artifacts"],
    ["result", "items"],
  ])
    .map(artifactFrom)
    .filter((a) => a.id);
}

/** Total count off a paginated list response, undefined when unreported. */
export function listTotalFrom(value: unknown): number | undefined {
  return firstNumber(asRecord(value), ["total", "count", "totalCount"]);
}

export function createdArtifactId(created: unknown): string {
  const record = asRecord(created);
  return (
    firstString(asRecord(record["artifact"]), ["id", "artifactId"]) || firstString(record, ["artifactId", "id"])
  );
}

// ─── Formatting + file helpers ───────────────────────────────────────────────

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? (value.split(",").pop() ?? "") : value);
    };
    reader.readAsDataURL(file);
  });
}
