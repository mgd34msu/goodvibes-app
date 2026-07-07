// Review packets: wizard + presets + freshness check (docs/GAPS.md §11 rows
// 4-6). Packets and presets persist through the SAME /app/registries "notes"
// collection documents-data.ts already uses for blind-compare judgments
// (tag: "model-compare") — this file just adds two more tags:
//   "review-packet"        — a composed packet: title, context, and a frozen
//                             snapshot of each included document version.
//   "review-packet-preset" — a reusable wizard config: which documents +
//                             a context template, no frozen content.
// No new Bun-side route: the generic /app/registries CRUD (superset-tolerant
// RegistryItem, src/shared/registries.ts) already round-trips arbitrary
// fields, so this is pure UI + the existing notes CRUD in documents-data.ts.

import { asRecord, firstString, type AnyRecord } from "../../lib/wire.ts";
import { createNote, deleteNote, firstTimestamp, listNotes, updateNote, type DocRecord } from "./documents-data.ts";

export const PACKET_TAG = "review-packet";
export const PRESET_TAG = "review-packet-preset";

// ─── Shapes ───────────────────────────────────────────────────────────────────

export interface PacketItemRef {
  docId: string;
  docTitle: string;
  version: number;
  label: string;
  content: string;
}

export interface ReviewPacket {
  id: string;
  title: string;
  context: string;
  items: PacketItemRef[];
  createdAt: number | undefined;
  raw: AnyRecord;
}

export interface PacketPreset {
  id: string;
  name: string;
  docIds: string[];
  context: string;
  createdAt: number | undefined;
  raw: AnyRecord;
}

function itemRefFrom(value: unknown): PacketItemRef {
  const raw = asRecord(value);
  return {
    docId: firstString(raw, ["docId"]),
    docTitle: firstString(raw, ["docTitle"]) || "(untitled)",
    version: typeof raw["version"] === "number" ? raw["version"] : 0,
    label: firstString(raw, ["label"]),
    content: typeof raw["content"] === "string" ? raw["content"] : "",
  };
}

export function packetFrom(value: unknown): ReviewPacket {
  const raw = asRecord(value);
  const items = Array.isArray(raw["items"]) ? raw["items"].map(itemRefFrom) : [];
  return {
    id: firstString(raw, ["id"]),
    title: firstString(raw, ["title"]) || "(untitled packet)",
    context: firstString(raw, ["context"]),
    items,
    createdAt: firstTimestamp(raw, ["createdAt"]),
    raw,
  };
}

export function presetFrom(value: unknown): PacketPreset {
  const raw = asRecord(value);
  const docIds = Array.isArray(raw["docIds"])
    ? raw["docIds"].filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    id: firstString(raw, ["id"]),
    name: firstString(raw, ["name"]) || "(untitled preset)",
    docIds,
    context: firstString(raw, ["context"]),
    createdAt: firstTimestamp(raw, ["createdAt"]),
    raw,
  };
}

/** A plain note — anything in the collection that isn't a packet/preset
 * (includes chat's /note-saved items, tag "chat-note", and anything else). */
export interface PlainNote {
  id: string;
  tag: string;
  text: string;
  createdAt: number | undefined;
  raw: AnyRecord;
}

export function plainNoteFrom(value: unknown): PlainNote {
  const raw = asRecord(value);
  return {
    id: firstString(raw, ["id"]),
    tag: firstString(raw, ["tag"]) || "note",
    text: firstString(raw, ["text", "summary", "note"]),
    createdAt: firstTimestamp(raw, ["createdAt"]),
    raw,
  };
}

// ─── Reads (one shared fetch of the notes collection) ────────────────────────

export async function listAllNotes(): Promise<AnyRecord[]> {
  return listNotes();
}

export function packetsFrom(notes: AnyRecord[]): ReviewPacket[] {
  return notes.filter((n) => n["tag"] === PACKET_TAG).map(packetFrom).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function presetsFrom(notes: AnyRecord[]): PacketPreset[] {
  return notes.filter((n) => n["tag"] === PRESET_TAG).map(presetFrom).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function plainNotesFrom(notes: AnyRecord[]): PlainNote[] {
  return notes
    .filter((n) => n["tag"] !== PACKET_TAG && n["tag"] !== PRESET_TAG && n["tag"] !== "model-compare")
    .map(plainNoteFrom)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function createPacket(input: { title: string; context: string; items: PacketItemRef[] }): Promise<ReviewPacket> {
  const item = await createNote({
    tag: PACKET_TAG,
    title: input.title,
    context: input.context,
    items: input.items,
    createdAt: Date.now(),
  });
  return packetFrom(item);
}

export async function deletePacket(id: string): Promise<void> {
  await deleteNote(id);
}

export async function createPreset(input: { name: string; docIds: string[]; context: string }): Promise<PacketPreset> {
  const item = await createNote({
    tag: PRESET_TAG,
    name: input.name,
    docIds: input.docIds,
    context: input.context,
    createdAt: Date.now(),
  });
  return presetFrom(item);
}

export async function deletePreset(id: string): Promise<void> {
  await deleteNote(id);
}

export async function renamePreset(id: string, item: AnyRecord): Promise<PacketPreset> {
  const updated = await updateNote(id, item);
  return presetFrom(updated);
}

// ─── Freshness check (row 4) ──────────────────────────────────────────────────

export interface FreshnessRow {
  docId: string;
  docTitle: string;
  capturedVersion: number;
  /** null: the document no longer exists in the live registry. */
  currentHeadVersion: number | null;
  stale: boolean;
}

/** Compares each packet item's captured version against the live document's
 * current headVersion — reuses the Drafts tab's already-fetched doc list, no
 * extra round trip. */
export function checkFreshness(packet: ReviewPacket, liveDocs: readonly DocRecord[]): FreshnessRow[] {
  const byId = new Map(liveDocs.map((doc) => [doc.id, doc]));
  return packet.items.map((item) => {
    const live = byId.get(item.docId);
    const currentHeadVersion = live ? live.headVersion : null;
    return {
      docId: item.docId,
      docTitle: item.docTitle,
      capturedVersion: item.version,
      currentHeadVersion,
      stale: currentHeadVersion !== null && currentHeadVersion !== item.version,
    };
  });
}
