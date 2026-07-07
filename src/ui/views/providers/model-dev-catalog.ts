// model-dev-catalog.ts — the real model catalog (docs/FEATURES.md §14 row 5 /
// docs/GAPS.md top-10 gap #8): a plain `fetch` of https://models.dev/api.json
// (a public, static, CORS-open JSON document — no daemon/wire involvement),
// cached in localStorage with a 24h TTL, browsable by provider/modality/price
// tier. This is DELIBERATELY separate from model-catalog.ts (the config-write
// routing model over providers.list/config.get) — this file only ever reads
// and never writes daemon config; the two catalogs are cross-referenced by
// registryKey in ModelCatalogPanel.tsx, never merged into one type, since
// their fields (and their honesty caveats) differ.
//
// Shape read here (models.dev's own root object, tolerant of drift — never
// cast): `{ [providerId]: { name, models: { [modelId]: { id, name, cost:
// {input,output,cache_read,cache_write}, limit: {context,output}, modalities:
// {input:[],output:[]}, reasoning, tool_call, open_weights, knowledge } } } }`.

import { asArray, asRecord, firstString } from "../../lib/wire.ts";

const CATALOG_URL = "https://models.dev/api.json";
const CACHE_KEY = "goodvibes.app.providers.models-dev-catalog.v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fetch + localStorage cache
// ---------------------------------------------------------------------------

interface CachedCatalog {
  readonly fetchedAt: number;
  readonly raw: unknown;
}

function readCache(): CachedCatalog | null {
  try {
    const stored = window.localStorage.getItem(CACHE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    const record = asRecord(parsed);
    const fetchedAt = record["fetchedAt"];
    if (typeof fetchedAt !== "number" || !("raw" in record)) return null;
    return { fetchedAt, raw: record["raw"] };
  } catch {
    return null;
  }
}

function writeCache(entry: CachedCatalog): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Quota/privacy failures degrade to network-only fetches, never a crash.
  }
}

export function isCacheFresh(fetchedAt: number, now: number = Date.now()): boolean {
  return now - fetchedAt < CACHE_TTL_MS;
}

export type CatalogFetchSource = "cache" | "network" | "stale-cache";

export interface CatalogFetchResult {
  readonly raw: unknown;
  readonly fetchedAt: number;
  readonly source: CatalogFetchSource;
}

/**
 * Fetch models.dev's catalog, honoring the 24h cache unless `force` (manual
 * refresh) is set. A network failure falls back to whatever is cached — even
 * stale — so a transient offline blip never blanks the panel; only a missing
 * cache PLUS a failed fetch throws, and the caller (ModelCatalogPanel) is the
 * one that degrades further, to the daemon's own providers.list.
 */
export async function fetchModelsDevCatalog(force: boolean): Promise<CatalogFetchResult> {
  const cached = readCache();
  if (!force && cached && isCacheFresh(cached.fetchedAt)) {
    return { raw: cached.raw, fetchedAt: cached.fetchedAt, source: "cache" };
  }
  try {
    const response = await fetch(CATALOG_URL, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`models.dev responded ${response.status}`);
    const raw: unknown = await response.json();
    const fetchedAt = Date.now();
    writeCache({ fetchedAt, raw });
    return { raw, fetchedAt, source: "network" };
  } catch (error) {
    if (cached) return { raw: cached.raw, fetchedAt: cached.fetchedAt, source: "stale-cache" };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export interface RemoteModel {
  readonly id: string;
  readonly registryKey: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly name: string;
  readonly contextWindow?: number;
  readonly maxOutput?: number;
  readonly inputPricePerMillion?: number;
  readonly outputPricePerMillion?: number;
  readonly modalitiesIn: readonly string[];
  readonly modalitiesOut: readonly string[];
  readonly reasoning: boolean;
  readonly toolCall: boolean;
  readonly openWeights: boolean;
  readonly knowledgeCutoff: string;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

/** Every model across every provider in a models.dev api.json body. Tolerant
 * of a root that isn't the expected shape at all (empty result, not a throw). */
export function remoteModelsFromCatalog(raw: unknown): RemoteModel[] {
  const root = asRecord(raw);
  const models: RemoteModel[] = [];
  for (const [providerId, providerRaw] of Object.entries(root)) {
    const providerRecord = asRecord(providerRaw);
    const providerName = firstString(providerRecord, ["name"]) || providerId;
    const modelsRecord = asRecord(providerRecord["models"]);
    for (const [modelId, modelRaw] of Object.entries(modelsRecord)) {
      const modelRecord = asRecord(modelRaw);
      const id = firstString(modelRecord, ["id"]) || modelId;
      if (!id) continue;
      const cost = asRecord(modelRecord["cost"]);
      const limit = asRecord(modelRecord["limit"]);
      const modalities = asRecord(modelRecord["modalities"]);
      models.push({
        id,
        registryKey: `${providerId}:${id}`,
        providerId,
        providerName,
        name: firstString(modelRecord, ["name"]) || id,
        contextWindow: readNumber(limit, "context"),
        maxOutput: readNumber(limit, "output"),
        inputPricePerMillion: readNumber(cost, "input"),
        outputPricePerMillion: readNumber(cost, "output"),
        modalitiesIn: readStringArray(modalities["input"]),
        modalitiesOut: readStringArray(modalities["output"]),
        reasoning: modelRecord["reasoning"] === true,
        toolCall: modelRecord["tool_call"] === true,
        openWeights: modelRecord["open_weights"] === true,
        knowledgeCutoff: firstString(modelRecord, ["knowledge"]),
      });
    }
  }
  return models;
}

// ---------------------------------------------------------------------------
// Price tiers — models.dev has no named tier field; this is a display-only
// bucket derived from the actual $/M-token cost it does report. Absent when
// neither input nor output price is reported (never fabricated as "free").
// ---------------------------------------------------------------------------

export type RemotePriceTier = "free" | "budget" | "standard" | "premium";

export const REMOTE_PRICE_TIER_LABELS: Record<RemotePriceTier, string> = {
  free: "Free",
  budget: "Budget (< $2/M)",
  standard: "Standard ($2–10/M)",
  premium: "Premium (> $10/M)",
};

export function remotePriceTier(model: RemoteModel): RemotePriceTier | undefined {
  const { inputPricePerMillion: input, outputPricePerMillion: output } = model;
  if (input === undefined && output === undefined) return undefined;
  const values = [input, output].filter((v): v is number => typeof v === "number");
  const blended = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (blended <= 0) return "free";
  if (blended < 2) return "budget";
  if (blended < 10) return "standard";
  return "premium";
}

// ---------------------------------------------------------------------------
// Browse: search / provider / modality / price-tier filters
// ---------------------------------------------------------------------------

export interface RemoteModelFilterOptions {
  readonly query?: string;
  readonly providerId?: string;
  readonly modality?: string;
  readonly priceTier?: RemotePriceTier | "all";
}

export function filterRemoteModels(
  models: readonly RemoteModel[],
  options: RemoteModelFilterOptions,
): RemoteModel[] {
  const query = (options.query ?? "").trim().toLowerCase();
  return models.filter((model) => {
    if (options.providerId && model.providerId !== options.providerId) return false;
    if (
      options.modality &&
      !model.modalitiesIn.includes(options.modality) &&
      !model.modalitiesOut.includes(options.modality)
    ) {
      return false;
    }
    if (options.priceTier && options.priceTier !== "all" && remotePriceTier(model) !== options.priceTier) {
      return false;
    }
    if (query && !`${model.name} ${model.id} ${model.providerName}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

export interface RemoteProviderOption {
  readonly id: string;
  readonly name: string;
}

export function remoteProviderOptions(models: readonly RemoteModel[]): RemoteProviderOption[] {
  const seen = new Map<string, string>();
  for (const model of models) {
    if (!seen.has(model.providerId)) seen.set(model.providerId, model.providerName);
  }
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function remoteModalityOptions(models: readonly RemoteModel[]): string[] {
  const set = new Set<string>();
  for (const model of models) {
    for (const modality of model.modalitiesIn) set.add(modality);
    for (const modality of model.modalitiesOut) set.add(modality);
  }
  return [...set].sort();
}
