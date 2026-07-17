// Daemon-canonical skills store (skills.list/get/create/update/delete) — the
// FIRST UI anywhere for this store (no webui/tui crib exists; built directly
// from node_modules/@pellux/goodvibes-sdk's operator-contract.json). This is
// a SEPARATE store from the app-local registry-based skills the rest of
// SkillsView.tsx manages (routines/registries.ts, /app/registries/skills) —
// two independent skill catalogs that happen to share the name "skill".
//
// Progressive disclosure is the wire design, not an app choice: skills.list
// returns only name/description/metadata (no body — cheap index rows), and
// skills.get is the only way to fetch one skill's full markdown body.

import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

export interface DaemonSkillMetadata {
  [key: string]: unknown;
}

/** Index-row shape from skills.list — deliberately BODY-LESS. */
export interface DaemonSkillIndexEntry {
  name: string;
  description: string;
  metadata: DaemonSkillMetadata;
  updatedAt?: number;
}

/** Full shape from skills.get / skills.create / skills.update — includes body. */
export interface DaemonSkill extends DaemonSkillIndexEntry {
  body: string;
}

export const daemonSkillKeys = {
  // Prefix everything under ["skills"] (lib/queries.ts's reserved-but-unused
  // queryKeys.skills tuple) so one invalidation fans out to the index AND
  // every open detail fetch.
  all: ["skills"] as const,
  list: ["skills"] as const,
  detail: (name: string) => ["skills", name] as const,
};

function parseMetadata(value: unknown): DaemonSkillMetadata {
  const record = asRecord(value);
  return { ...record };
}

export function parseDaemonSkillIndexEntry(value: unknown): DaemonSkillIndexEntry | null {
  const record = asRecord(value);
  const name = firstString(record, ["name"]);
  if (!name) return null;
  const updatedAt = firstNumber(record, ["updatedAt"]);
  return {
    name,
    description: firstString(record, ["description"]),
    metadata: parseMetadata(record["metadata"]),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

export function parseDaemonSkillIndex(value: unknown): DaemonSkillIndexEntry[] {
  const record = asRecord(value);
  return asArray(record["skills"] ?? value).flatMap((item) => {
    const parsed = parseDaemonSkillIndexEntry(item);
    return parsed ? [parsed] : [];
  });
}

export function parseDaemonSkill(value: unknown): DaemonSkill | null {
  const outer = asRecord(value);
  const record = asRecord(outer["skill"] ?? value);
  const name = firstString(record, ["name"]);
  if (!name) return null;
  const updatedAt = firstNumber(record, ["updatedAt"]);
  return {
    name,
    description: firstString(record, ["description"]),
    metadata: parseMetadata(record["metadata"]),
    body: firstString(record, ["body"]),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

/** Metadata rendered as short "key: value" chips — best-effort stringify,
 * never crashes on an object/array value. */
export function metadataEntries(metadata: DaemonSkillMetadata): Array<[string, string]> {
  return Object.entries(metadata).map(([key, value]) => {
    if (value === null) return [key, "null"];
    if (typeof value === "string") return [key, value];
    if (typeof value === "number" || typeof value === "boolean") return [key, String(value)];
    try {
      return [key, JSON.stringify(value)];
    } catch {
      return [key, "(unserializable)"];
    }
  });
}

/** Pretty-print metadata for the editor's JSON textarea; "{}" for empty/absent. */
export function metadataToText(metadata: DaemonSkillMetadata | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) return "{}";
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return "{}";
  }
}

export type MetadataParseResult = { ok: true; value: DaemonSkillMetadata } | { ok: false; error: string };

/** Parse the editor's metadata textarea back to an object — blank text means
 * "no metadata" (undefined on the wire body), not an error. */
export function parseMetadataText(text: string): MetadataParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Metadata must be a JSON object, e.g. {\"key\": \"value\"}." };
    }
    return { ok: true, value: parsed as DaemonSkillMetadata };
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
}

export function formatSkillTimestamp(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Date(value).toLocaleString();
}
