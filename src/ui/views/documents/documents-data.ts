// Documents view data layer (docs/FEATURES.md §11) — app-local registries:
//  · documents collection ({id,title,headVersion,…}) with the versions
//    sub-endpoint (GET → {versions:[{v,createdAt,content}]}, POST {content,
//    label?} appends a version and updates the head item).
//  · notes collection for blind-model-compare judgments (tagged
//    "model-compare"). Records are superset-tolerant: raw records are kept
//    and mutated as copies so unknown fields survive PUT round-trips.

import { appJson } from "../../lib/http.ts";
import {
  asRecord,
  firstArrayAtPath,
  firstNumber,
  firstString,
  type AnyRecord,
} from "../../lib/wire.ts";

// ─── Query keys (LOCAL, unique "documents-registry" prefix) ──────────────────

export const docKeys = {
  all: ["documents-registry"] as const,
  list: ["documents-registry", "list"] as const,
  versions: (id: string) => ["documents-registry", "versions", id] as const,
  compareNotes: ["documents-registry", "compare-notes"] as const,
};

/** Epoch millis from a numeric or ISO-string timestamp field — the app-local
 * registry store writes ISO strings (src/bun/registries/store.ts nowIso), so
 * lib/wire.ts firstNumber alone would drop every createdAt/updatedAt. */
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

const DOCS_BASE = "/app/registries/documents";
const NOTES_BASE = "/app/registries/notes";
const JSON_HEADERS = { "content-type": "application/json" } as const;

// ─── Documents CRUD ──────────────────────────────────────────────────────────

export async function listDocuments(): Promise<AnyRecord[]> {
  const res = await appJson<unknown>(DOCS_BASE);
  return firstArrayAtPath(res, [["items"], ["data"]]).map(asRecord);
}

export async function createDocument(item: AnyRecord): Promise<AnyRecord> {
  const res = await appJson<unknown>(DOCS_BASE, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ item }),
  });
  return asRecord(asRecord(res)["item"]);
}

export async function updateDocument(id: string, item: AnyRecord): Promise<AnyRecord> {
  const res = await appJson<unknown>(`${DOCS_BASE}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ item }),
  });
  return asRecord(asRecord(res)["item"]);
}

export async function deleteDocument(id: string): Promise<void> {
  await appJson<unknown>(`${DOCS_BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listVersions(id: string): Promise<AnyRecord[]> {
  const res = await appJson<unknown>(`${DOCS_BASE}/${encodeURIComponent(id)}/versions`);
  return firstArrayAtPath(res, [["versions"], ["items"]]).map(asRecord);
}

export async function saveVersion(id: string, content: string, label?: string): Promise<void> {
  await appJson<unknown>(`${DOCS_BASE}/${encodeURIComponent(id)}/versions`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ content, ...(label ? { label } : {}) }),
  });
}

// ─── Notes (compare judgments) ───────────────────────────────────────────────

export async function listNotes(): Promise<AnyRecord[]> {
  const res = await appJson<unknown>(NOTES_BASE);
  return firstArrayAtPath(res, [["items"], ["data"]]).map(asRecord);
}

export async function createNote(item: AnyRecord): Promise<AnyRecord> {
  const res = await appJson<unknown>(NOTES_BASE, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ item }),
  });
  return asRecord(asRecord(res)["item"]);
}

// ─── Parsed shapes ───────────────────────────────────────────────────────────

export interface DocComment {
  id: string;
  text: string;
  createdAt: number | undefined;
  resolved: boolean;
  raw: AnyRecord;
}

export interface DocRecord {
  id: string;
  title: string;
  headVersion: number;
  updatedAt: number | undefined;
  comments: DocComment[];
  raw: AnyRecord;
}

export function commentFrom(value: unknown): DocComment {
  const raw = asRecord(value);
  return {
    id: firstString(raw, ["id"]),
    text: firstString(raw, ["text", "body", "comment"]),
    createdAt: firstTimestamp(raw, ["createdAt"]),
    resolved: raw["resolved"] === true,
    raw,
  };
}

export function documentFrom(value: unknown): DocRecord {
  const raw = asRecord(value);
  const comments = Array.isArray(raw["comments"]) ? raw["comments"].map(commentFrom) : [];
  return {
    id: firstString(raw, ["id"]),
    title: firstString(raw, ["title", "name"]) || "(untitled)",
    headVersion: firstNumber(raw, ["headVersion", "head", "version"]) ?? 0,
    updatedAt: firstTimestamp(raw, ["updatedAt", "createdAt"]),
    comments,
    raw,
  };
}

export interface DocVersion {
  v: number;
  createdAt: number | undefined;
  label: string;
  content: string;
  raw: AnyRecord;
}

export function versionFrom(value: unknown): DocVersion {
  const raw = asRecord(value);
  return {
    v: firstNumber(raw, ["v", "version"]) ?? 0,
    createdAt: firstTimestamp(raw, ["createdAt"]),
    label: firstString(raw, ["label", "name"]),
    content: typeof raw["content"] === "string" ? raw["content"] : "",
    raw,
  };
}

/** Serialize comments back onto a raw document record (superset-tolerant). */
export function rawWithComments(doc: DocRecord, comments: DocComment[]): AnyRecord {
  return {
    ...doc.raw,
    comments: comments.map((c) => ({ ...c.raw, id: c.id, text: c.text, resolved: c.resolved, createdAt: c.createdAt })),
  };
}

// ─── Export helper ───────────────────────────────────────────────────────────

/** Download text as a file via a transient object URL (no RPC dialog needed). */
export function downloadText(filename: string, text: string, mimeType = "text/markdown"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportFilename(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "document";
  return `${slug}.md`;
}
