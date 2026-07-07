// Shared client for the /app/registries HTTP contract (Bun-side app-local
// file stores under ~/.goodvibes/app/ — src/bun/registries, built by a
// parallel agent; we code strictly to the contract, never import their
// files). Used by the three Assistant views: Routines, Personas, Skills —
// all three view dirs are owned by the same wave agent, so the shared code
// lives here in views/routines/ and the other two import it.
//
// Endpoints (docs/ARCHITECTURE.md §5):
//   GET    /app/registries/<collection>        → { items: Item[] }
//   POST   /app/registries/<collection>        → body { item } → { item }
//   GET    /app/registries/<collection>/<id>   → { item }
//   PUT    /app/registries/<collection>/<id>   → body { item } → { item }
//   DELETE /app/registries/<collection>/<id>   → { ok: true }
//   GET/PUT /app/registries/vibe               → { content, path, exists } / { content }
//   POST   /app/registries/import/preview      → { collections, samples }
//   POST   /app/registries/import/apply        → { imported }
//
// All item shapes are superset-tolerant: unknown extra fields are preserved
// verbatim on round-trip (we spread the raw record back into edits).

import { appJson } from "../../lib/http.ts";
import { asRecord, firstString } from "../../lib/wire.ts";
import { errorStatus } from "../../lib/errors.ts";

// ─── Query keys ──────────────────────────────────────────────────────────────
// LOCAL keys with a unique prefix (never added to lib/queries.ts — hard rule).
// Everything hangs off ["app-registries"] so one prefix invalidation after an
// import-apply refreshes every registry list across all three views.

export const REGISTRIES_KEY_PREFIX = ["app-registries"] as const;

export const regKeys = {
  all: REGISTRIES_KEY_PREFIX,
  collection: (name: RegistryCollection) => [...REGISTRIES_KEY_PREFIX, name] as const,
  vibe: [...REGISTRIES_KEY_PREFIX, "vibe"] as const,
  importPreview: (source: string) => [...REGISTRIES_KEY_PREFIX, "import-preview", source] as const,
} as const;

/** No wire event exists for the app-local registry files — views poll on this
 * interval (cheap local file reads) so out-of-band edits (agent CLI, manual
 * file edits) surface without a manual refresh. */
export const REGISTRY_POLL_MS = 30_000;

export type RegistryCollection =
  | "routines"
  | "personas"
  | "skills"
  | "notes"
  | "profiles"
  | "documents"
  | "research-runs";

/** Collections the import bridge can copy from ~/.goodvibes/agent/*. */
export const IMPORTABLE_COLLECTIONS: readonly RegistryCollection[] = [
  "routines",
  "personas",
  "skills",
  "notes",
];

// ─── Item shapes (agent-map §1b record shapes, superset-tolerant) ────────────

export interface RoutineItem {
  id: string;
  name: string;
  steps: string[];
  triggers: string[];
  tags: string[];
  requirements: string[];
  enabled: boolean;
  source: string;
  reviewState: string;
  startCount: number;
  /** Raw record — spread back on PUT so unknown fields survive round-trips. */
  raw: Record<string, unknown>;
}

export interface PersonaItem {
  id: string;
  name: string;
  description: string;
  prompt: string;
  active: boolean;
  source: string;
  raw: Record<string, unknown>;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  requirements: string[];
  source: string;
  raw: Record<string, unknown>;
}

/** Scratchpad note (docs/FEATURES.md §8 row 11) — app-local only, no daemon
 * verb backs the "notes" collection itself. Promotion is a separate,
 * confirm-gated write to memory.records.add / knowledge.ingest.artifact;
 * `promotedTo` records the id it landed at so a promoted note can say so. */
export interface NoteItem {
  id: string;
  text: string;
  tags: string[];
  promoted: boolean;
  promotedTo?: { kind: "memory" | "knowledge"; id: string };
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

/** Named app-level preset bundle (docs/FEATURES.md §8 row 7). SCOPE NOTE: this
 * is an app-level preset, not an isolated GOODVIBES_APP_HOME root — activating
 * one only (a) sets a persona active and (b) overwrites VIBE.md content, both
 * via the same registries API a user could drive by hand from Personas. The
 * skills list is informational (shown, not enforced) unless the user opens
 * each skill from Skills and enables it themselves. */
export interface ProfileItem {
  id: string;
  name: string;
  description: string;
  template: string;
  active: boolean;
  personaName: string;
  personaDescription: string;
  personaPrompt: string;
  skills: string[];
  vibeContent: string;
  raw: Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function parseRoutine(value: unknown): RoutineItem {
  const raw = asRecord(value);
  return {
    id: firstString(raw, ["id"]),
    name: firstString(raw, ["name"]) || "Untitled routine",
    steps: stringArray(raw["steps"]),
    triggers: stringArray(raw["triggers"]),
    tags: stringArray(raw["tags"]),
    requirements: stringArray(raw["requirements"]),
    enabled: raw["enabled"] !== false,
    source: firstString(raw, ["source"]),
    reviewState: firstString(raw, ["reviewState"]),
    startCount: typeof raw["startCount"] === "number" ? raw["startCount"] : 0,
    raw,
  };
}

export function parsePersona(value: unknown): PersonaItem {
  const raw = asRecord(value);
  return {
    id: firstString(raw, ["id"]),
    name: firstString(raw, ["name"]) || "Untitled persona",
    description: firstString(raw, ["description"]),
    prompt: typeof raw["prompt"] === "string" ? raw["prompt"] : "",
    active: raw["active"] === true,
    source: firstString(raw, ["source"]),
    raw,
  };
}

export function parseSkill(value: unknown): SkillItem {
  const raw = asRecord(value);
  return {
    id: firstString(raw, ["id"]),
    name: firstString(raw, ["name"]) || "Untitled skill",
    description: firstString(raw, ["description"]),
    body: typeof raw["body"] === "string" ? raw["body"] : "",
    enabled: raw["enabled"] !== false,
    requirements: stringArray(raw["requirements"]),
    source: firstString(raw, ["source"]),
    raw,
  };
}

function isPromotedTo(value: unknown): { kind: "memory" | "knowledge"; id: string } | undefined {
  const record = asRecord(value);
  const kind = record["kind"];
  const id = firstString(record, ["id"]);
  if ((kind === "memory" || kind === "knowledge") && id) return { kind, id };
  return undefined;
}

export function parseNote(value: unknown): NoteItem {
  const raw = asRecord(value);
  return {
    id: firstString(raw, ["id"]),
    text: typeof raw["text"] === "string" ? raw["text"] : "",
    tags: stringArray(raw["tags"]),
    promoted: raw["promoted"] === true,
    promotedTo: isPromotedTo(raw["promotedTo"]),
    createdAt: firstString(raw, ["createdAt"]),
    updatedAt: firstString(raw, ["updatedAt"]),
    raw,
  };
}

export function parseProfile(value: unknown): ProfileItem {
  const raw = asRecord(value);
  const persona = asRecord(raw["persona"]);
  return {
    id: firstString(raw, ["id"]),
    name: firstString(raw, ["name"]) || "Untitled profile",
    description: firstString(raw, ["description"]),
    template: firstString(raw, ["template"]) || "custom",
    active: raw["active"] === true,
    personaName: firstString(persona, ["name"]) || firstString(raw, ["name"]) || "Untitled profile",
    personaDescription: firstString(persona, ["description"]),
    personaPrompt: typeof persona["prompt"] === "string" ? persona["prompt"] : "",
    skills: stringArray(raw["skills"]),
    vibeContent: typeof raw["vibeContent"] === "string" ? raw["vibeContent"] : "",
    raw,
  };
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

export async function listRegistryItems(collection: RegistryCollection): Promise<unknown[]> {
  const response = await appJson<{ items?: unknown[] }>(`/app/registries/${collection}`);
  return Array.isArray(response?.items) ? response.items : [];
}

export async function createRegistryItem(
  collection: RegistryCollection,
  item: Record<string, unknown>,
): Promise<unknown> {
  const response = await appJson<{ item?: unknown }>(`/app/registries/${collection}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item }),
  });
  return response?.item;
}

export async function updateRegistryItem(
  collection: RegistryCollection,
  id: string,
  item: Record<string, unknown>,
): Promise<unknown> {
  const response = await appJson<{ item?: unknown }>(
    `/app/registries/${collection}/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item }),
    },
  );
  return response?.item;
}

export async function deleteRegistryItem(collection: RegistryCollection, id: string): Promise<void> {
  await appJson<{ ok?: boolean }>(`/app/registries/${collection}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ─── VIBE.md (real disk file — never a DB; the desktop autopsy's Memory-view
// deception is the named failure this endpoint exists to avoid) ──────────────

export interface VibeFile {
  content: string;
  path: string;
  exists: boolean;
}

export async function fetchVibe(): Promise<VibeFile> {
  const response = await appJson<Partial<VibeFile>>("/app/registries/vibe");
  return {
    content: typeof response?.content === "string" ? response.content : "",
    path: typeof response?.path === "string" ? response.path : "~/.goodvibes/app/VIBE.md",
    exists: response?.exists === true,
  };
}

export async function saveVibe(content: string): Promise<void> {
  await appJson("/app/registries/vibe", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

// ─── Import bridge (~/.goodvibes/agent/* → app stores; source READ-ONLY) ─────

export interface ImportPreview {
  collections: Record<string, number>;
  samples: Record<string, unknown[]>;
}

export async function previewImport(source: string): Promise<ImportPreview> {
  const response = await appJson<Partial<ImportPreview>>("/app/registries/import/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source }),
  });
  const collections: Record<string, number> = {};
  for (const [name, count] of Object.entries(asRecord(response?.collections))) {
    if (typeof count === "number") collections[name] = count;
  }
  const samples: Record<string, unknown[]> = {};
  for (const [name, list] of Object.entries(asRecord(response?.samples))) {
    if (Array.isArray(list)) samples[name] = list;
  }
  return { collections, samples };
}

export async function applyImport(
  source: string,
  collections: string[],
): Promise<Record<string, number>> {
  const response = await appJson<{ imported?: Record<string, unknown> }>(
    "/app/registries/import/apply",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, collections }),
    },
  );
  const imported: Record<string, number> = {};
  for (const [name, count] of Object.entries(asRecord(response?.imported))) {
    if (typeof count === "number") imported[name] = count;
  }
  return imported;
}

// ─── Availability ────────────────────────────────────────────────────────────

/**
 * The registries service is app-local (Bun side), not a daemon method — a 404
 * or 501 from an /app/registries path means this build does not serve the
 * store at all (the route module is missing), the honest UnavailableState
 * signal. Anything else is a real error and renders ErrorState with retry.
 */
export function isRegistryUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 501;
}

// ─── Chat draft handoff (Routines → Chat composer) ───────────────────────────

/**
 * DOCUMENTED HANDOFF CONTRACT — localStorage key "gv.chat.draft".
 * Value: JSON { text: string, source?: string, ts: number }.
 * Producer (this module) writes the key and navigates to the Chat view;
 * consumer (views/chat) reads AND REMOVES the key, prefilling its composer
 * draft with `text`. Stale handoffs (older than 5 minutes) should be ignored
 * by the consumer.
 */
export const CHAT_DRAFT_HANDOFF_KEY = "gv.chat.draft";

export function writeChatDraftHandoff(text: string, source: string): boolean {
  try {
    window.localStorage.setItem(
      CHAT_DRAFT_HANDOFF_KEY,
      JSON.stringify({ text, source, ts: Date.now() }),
    );
    return true;
  } catch {
    return false; // localStorage unavailable — caller falls back to clipboard-free navigation.
  }
}

/** Render a routine's ordered steps as the chat / schedule task text. */
export function routineStepsText(name: string, steps: readonly string[]): string {
  const lines = steps.map((step, index) => `${index + 1}. ${step}`);
  return [`Follow the routine "${name}" step by step:`, ...lines].join("\n");
}
