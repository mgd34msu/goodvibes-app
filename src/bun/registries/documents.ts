// Documents versioning: versions are stored inline on the document item
// (bounded to the last MAX_DOCUMENT_VERSIONS), headVersion always points at
// the newest version's `v`. POST /app/registries/documents/<id>/versions
// appends a version and updates the head item.

import type { DocumentVersion, RegistryItem } from "../../shared/registries.ts";

export const MAX_DOCUMENT_VERSIONS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Defensive read of an item's versions array (superset-tolerant store). */
export function readDocumentVersions(item: RegistryItem): DocumentVersion[] {
  const raw = item.versions;
  if (!Array.isArray(raw)) return [];
  const versions: DocumentVersion[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    versions.push({
      v: typeof entry.v === "number" ? entry.v : versions.length + 1,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
      content: typeof entry.content === "string" ? entry.content : "",
      ...(typeof entry.label === "string" ? { label: entry.label } : {}),
    });
  }
  return versions;
}

function maxVersionNumber(versions: DocumentVersion[]): number {
  let max = 0;
  for (const version of versions) if (version.v > max) max = version.v;
  return max;
}

/**
 * Normalize a document item at create time: seed version 1 from a provided
 * `content` string when no versions came in, and make headVersion consistent.
 */
export function normalizeDocumentOnCreate(input: Record<string, unknown>): Record<string, unknown> {
  const item = { ...input };
  const versions = readDocumentVersions(item as RegistryItem);
  if (versions.length === 0 && typeof item.content === "string" && item.content !== "") {
    versions.push({ v: 1, createdAt: new Date().toISOString(), content: item.content });
  }
  item.versions = versions;
  item.headVersion = maxVersionNumber(versions);
  return item;
}

/** Append a version to a document item; returns the updated item + new version. */
export function appendDocumentVersion(
  item: RegistryItem,
  content: string,
  label?: string,
): { item: RegistryItem; version: DocumentVersion } {
  const versions = readDocumentVersions(item);
  const version: DocumentVersion = {
    v: maxVersionNumber(versions) + 1,
    createdAt: new Date().toISOString(),
    content,
    ...(label !== undefined ? { label } : {}),
  };
  versions.push(version);
  const bounded = versions.slice(-MAX_DOCUMENT_VERSIONS);
  const next: RegistryItem = {
    ...item,
    versions: bounded,
    headVersion: version.v,
    content, // convenience: head content readable without the versions call
    updatedAt: new Date().toISOString(),
  };
  return { item: next, version };
}
