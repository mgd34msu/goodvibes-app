// Read-only import bridge from goodvibes-agent's file stores under
// ~/.goodvibes/agent/ (docs/research/agent-map.md §1b, §3). Source stores are
// NEVER mutated — corrupt or missing agent files are skipped with a warning,
// never renamed or rewritten. Imported items keep their agent ids (re-imports
// are idempotent) and are marked source:"agent-import".
//
// Agent store shapes (goodvibes-agent src/agent/*-registry.ts):
//   routines/routines.json    {version, routines:[{id,name,description,steps:string,
//                              triggers,tags,requirements,enabled,source,reviewState,
//                              startCount,createdAt,updatedAt,...}]}
//   personas/personas.json    {version, activePersonaId, personas:[{id,name,description,
//                              body,tags,triggers,...}]}
//   skills/skills.json        {version, skills:[{id,name,description,procedure,enabled,
//                              requirements,...}], bundles?}
//   notes/notes.json          {version, notes:[{id,title,body,tags,reviewState,...}]}
//   documents/documents.json  {version, documents:[{id,title,body,versions:[{id,title,
//                              body,summary,createdAt}],...}]}
//   research/runs.json        {version, runs:[{id,title,question,status,sourceIds,
//                              reportArtifactId,...}]}
//   research/sources.json     {version, sources:[{id,question,title,url,summary,note,
//                              credibility,...}]}
//   profile-homes/<id>/profile.json  per-profile metadata

import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import type {
  DocumentVersion,
  ImportApplyResponse,
  ImportPreviewResponse,
  RegistryCollection,
  RegistryItem,
  ResearchFinding,
} from "../../shared/registries.ts";
import { REGISTRY_COLLECTIONS } from "../../shared/registries.ts";
import type { RegistryStore } from "./store.ts";

const IMPORT_SOURCE = "agent-import";
const PREVIEW_SAMPLES = 3;

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function recordArray(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Read + parse a source JSON file. Missing or corrupt → undefined (warn only). */
async function readSourceJson(path: string): Promise<Raw | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined; // store absent — normal
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch (err) {
    console.warn(`[registries] import: skipping unreadable agent store ${path}: ${String(err)}`);
    return undefined;
  }
}

function baseFields(record: Raw): Pick<RegistryItem, "id" | "createdAt" | "updatedAt"> {
  return {
    id: str(record.id) || crypto.randomUUID(),
    createdAt: str(record.createdAt) || new Date().toISOString(),
    updatedAt: str(record.updatedAt) || new Date().toISOString(),
  };
}

// --- per-collection mappers (exported for unit tests) ------------------------

/** Agent routine steps are a single string; the app models steps as string[]. */
export function splitRoutineSteps(steps: unknown): string[] {
  if (Array.isArray(steps)) return strArray(steps);
  if (typeof steps !== "string") return [];
  return steps
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function mapAgentRoutine(record: Raw): RegistryItem {
  return {
    ...baseFields(record),
    name: str(record.name),
    description: str(record.description),
    steps: splitRoutineSteps(record.steps),
    triggers: strArray(record.triggers),
    tags: strArray(record.tags),
    requirements: Array.isArray(record.requirements) ? record.requirements : [],
    enabled: record.enabled !== false,
    reviewState: str(record.reviewState, "fresh"),
    startCount: typeof record.startCount === "number" ? record.startCount : 0,
    source: IMPORT_SOURCE,
  };
}

export function mapAgentPersona(record: Raw, activePersonaId: string | null): RegistryItem {
  const id = str(record.id) || crypto.randomUUID();
  return {
    ...baseFields(record),
    id,
    name: str(record.name),
    description: str(record.description),
    prompt: str(record.body), // agent field is `body`; app contract names it `prompt`
    active: activePersonaId !== null && id === activePersonaId,
    tags: strArray(record.tags),
    triggers: strArray(record.triggers),
    source: IMPORT_SOURCE,
  };
}

export function mapAgentSkill(record: Raw): RegistryItem {
  return {
    ...baseFields(record),
    name: str(record.name),
    description: str(record.description),
    body: str(record.procedure), // agent field is `procedure`; app contract names it `body`
    enabled: record.enabled !== false,
    requirements: Array.isArray(record.requirements) ? record.requirements : [],
    tags: strArray(record.tags),
    triggers: strArray(record.triggers),
    reviewState: str(record.reviewState, "fresh"),
    source: IMPORT_SOURCE,
  };
}

export function mapAgentNote(record: Raw): RegistryItem {
  const title = str(record.title);
  const body = str(record.body);
  const text = title !== "" && body !== "" ? `${title}\n\n${body}` : title || body;
  return {
    ...baseFields(record),
    text,
    tags: strArray(record.tags),
    // Agent notes have no `promoted` flag; reviewed notes are the promoted ones.
    promoted: str(record.reviewState) === "reviewed",
    source: IMPORT_SOURCE,
  };
}

export function mapAgentDocument(record: Raw): RegistryItem {
  const versions: DocumentVersion[] = [];
  for (const entry of recordArray(record.versions)) {
    versions.push({
      v: versions.length + 1,
      createdAt: str(entry.createdAt),
      content: str(entry.body),
      label: str(entry.title) || str(entry.summary) || `v${versions.length + 1}`,
    });
  }
  // The agent keeps the current text on the record itself; snapshot it as head.
  const body = str(record.body);
  const last = versions[versions.length - 1];
  if (body !== "" && (last === undefined || last.content !== body)) {
    versions.push({ v: versions.length + 1, createdAt: str(record.updatedAt), content: body, label: "head" });
  }
  const bounded = versions.slice(-100);
  return {
    ...baseFields(record),
    title: str(record.title),
    headVersion: bounded.length > 0 ? bounded[bounded.length - 1]!.v : 0,
    versions: bounded,
    content: body,
    tags: strArray(record.tags),
    status: str(record.status, "draft"),
    source: IMPORT_SOURCE,
  };
}

export function mapAgentResearchRun(record: Raw, sources: Raw[]): RegistryItem {
  const sourceIds = new Set(strArray(record.sourceIds));
  const question = str(record.question);
  const findings: ResearchFinding[] = [];
  for (const source of sources) {
    const linked = sourceIds.has(str(source.id)) || (question !== "" && str(source.question) === question);
    if (!linked) continue;
    findings.push({
      url: str(source.url),
      title: str(source.title),
      note: str(source.note) || str(source.summary),
      ...(typeof source.credibility === "string" ? { credibility: source.credibility } : {}),
    });
  }
  return {
    ...baseFields(record),
    title: str(record.title),
    question,
    status: str(record.status, "planned"),
    findings,
    ...(typeof record.reportArtifactId === "string" ? { reportArtifactId: record.reportArtifactId } : {}),
    source: IMPORT_SOURCE,
  };
}

export function mapAgentProfile(dirName: string, profileJson: Raw | undefined): RegistryItem {
  const meta = profileJson ?? {};
  return {
    id: str(meta.id) || dirName,
    createdAt: str(meta.createdAt) || new Date().toISOString(),
    updatedAt: str(meta.updatedAt) || new Date().toISOString(),
    name: str(meta.name) || dirName,
    ...(str(meta.description) !== "" ? { description: str(meta.description) } : {}),
    source: IMPORT_SOURCE,
  };
}

// --- loading all collections from an agent home ------------------------------

async function loadAgentCollection(agentRoot: string, collection: RegistryCollection): Promise<RegistryItem[]> {
  switch (collection) {
    case "routines": {
      const file = await readSourceJson(join(agentRoot, "routines", "routines.json"));
      return recordArray(file?.routines).map(mapAgentRoutine);
    }
    case "personas": {
      const file = await readSourceJson(join(agentRoot, "personas", "personas.json"));
      const active = typeof file?.activePersonaId === "string" ? file.activePersonaId : null;
      return recordArray(file?.personas).map((record) => mapAgentPersona(record, active));
    }
    case "skills": {
      const file = await readSourceJson(join(agentRoot, "skills", "skills.json"));
      return recordArray(file?.skills).map(mapAgentSkill);
    }
    case "notes": {
      const file = await readSourceJson(join(agentRoot, "notes", "notes.json"));
      return recordArray(file?.notes).map(mapAgentNote);
    }
    case "documents": {
      const file = await readSourceJson(join(agentRoot, "documents", "documents.json"));
      return recordArray(file?.documents).map(mapAgentDocument);
    }
    case "research-runs": {
      const runsFile = await readSourceJson(join(agentRoot, "research", "runs.json"));
      const sourcesFile = await readSourceJson(join(agentRoot, "research", "sources.json"));
      const sources = recordArray(sourcesFile?.sources);
      return recordArray(runsFile?.runs).map((record) => mapAgentResearchRun(record, sources));
    }
    case "profiles": {
      const root = join(agentRoot, "profile-homes");
      let entries: string[];
      try {
        entries = await readdir(root);
      } catch {
        return [];
      }
      const items: RegistryItem[] = [];
      for (const entry of entries.sort()) {
        try {
          if (!(await stat(join(root, entry))).isDirectory()) continue;
        } catch {
          continue;
        }
        const meta = await readSourceJson(join(root, entry, "profile.json"));
        items.push(mapAgentProfile(entry, meta));
      }
      return items;
    }
  }
}

export async function previewAgentImport(agentRoot: string): Promise<ImportPreviewResponse> {
  const collections: Record<string, number> = {};
  const samples: Record<string, RegistryItem[]> = {};
  for (const collection of REGISTRY_COLLECTIONS) {
    const items = await loadAgentCollection(agentRoot, collection);
    collections[collection] = items.length;
    if (items.length > 0) samples[collection] = items.slice(0, PREVIEW_SAMPLES);
  }
  return { collections, samples };
}

export async function applyAgentImport(
  agentRoot: string,
  store: RegistryStore,
  requested: RegistryCollection[],
): Promise<ImportApplyResponse> {
  const imported: Record<string, number> = {};
  for (const collection of requested) {
    const items = await loadAgentCollection(agentRoot, collection);
    imported[collection] = await store.insertImported(collection, items);
  }
  return { imported };
}
