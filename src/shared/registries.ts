// /app/registries contract types shared between the Bun main process
// (src/bun/registries/) and the webview UI. Runtime-neutral: no Bun globals,
// no DOM globals, no imports (see scripts/check-boundaries.ts).
//
// Item shapes follow goodvibes-agent's registries (docs/research/agent-map.md
// §1b) in simplified app form. Every item is superset-tolerant: unknown extra
// fields round-trip through the store untouched.

export const REGISTRY_COLLECTIONS = [
  "routines",
  "personas",
  "skills",
  "notes",
  "profiles",
  "documents",
  "research-runs",
] as const;

export type RegistryCollection = (typeof REGISTRY_COLLECTIONS)[number];

export function isRegistryCollection(value: string): value is RegistryCollection {
  return (REGISTRY_COLLECTIONS as readonly string[]).includes(value);
}

/** Every stored item. id/createdAt/updatedAt are assigned server-side. */
export interface RegistryItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface RoutineItem extends RegistryItem {
  name: string;
  steps: string[];
  triggers?: string[];
  tags?: string[];
  requirements?: unknown[];
  enabled: boolean;
  source?: string;
  reviewState?: string;
  startCount: number;
}

export interface PersonaItem extends RegistryItem {
  name: string;
  description: string;
  prompt: string;
  active: boolean;
  source?: string;
}

export interface SkillItem extends RegistryItem {
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  requirements?: unknown[];
  source?: string;
}

export interface NoteItem extends RegistryItem {
  text: string;
  tags?: string[];
  promoted?: boolean;
}

export interface ProfileItem extends RegistryItem {
  name: string;
  description?: string;
}

export interface DocumentVersion {
  v: number;
  createdAt: string;
  content: string;
  label?: string;
}

export interface DocumentItem extends RegistryItem {
  title: string;
  headVersion: number;
  versions?: DocumentVersion[];
}

export interface ResearchFinding {
  url: string;
  title: string;
  note: string;
  credibility?: string;
  [key: string]: unknown;
}

export interface ResearchRunItem extends RegistryItem {
  question: string;
  status: string;
  findings: ResearchFinding[];
  reportArtifactId?: string;
}

// --- Response envelopes ------------------------------------------------------

export interface RegistryListResponse {
  items: RegistryItem[];
}

export interface RegistryItemResponse {
  item: RegistryItem;
}

export interface RegistryDeleteResponse {
  ok: true;
}

export interface DocumentVersionsResponse {
  versions: DocumentVersion[];
}

/** GET /app/registries/vibe — the REAL file ~/.goodvibes/app/VIBE.md. */
export interface VibeResponse {
  content: string;
  path: string;
  exists: boolean;
}

export type RegistryImportSource = "agent";

export interface ImportPreviewResponse {
  collections: Record<string, number>;
  samples: Record<string, RegistryItem[]>;
}

export interface ImportApplyResponse {
  imported: Record<string, number>;
}

/** Error envelope for every non-2xx registries response. */
export interface RegistryErrorResponse {
  error: string;
  code: string;
}
