// model-catalog.ts — multi-target model routing over the real wire shapes,
// ported from goodvibes-webui src/lib/model-catalog.ts and adapted to THIS
// SDK pin (docs/FEATURES.md §14 / src/ui/lib/generated/operator-routes.ts):
//
//   - This pin has NO models.* routes (no models.list / models.current /
//     models.select — verified against the generated route table). The model
//     inventory comes from providers.list/providers.get records, which
//     genuinely carry per-model `tier` and `pricing` when the provider
//     registry's pricing catalog has the data.
//   - The "current model" (main chat) is therefore the shared config key
//     `provider.model` (a provider-qualified registry key, "provider:model"),
//     read via config.get and written via config.set — exactly what
//     views/onboarding/OnboardingChecks.tsx already writes. The webui's
//     models.select validation path does not exist here; the write is honest
//     but unvalidated by the daemon beyond config-schema checks.
//   - Multi-target routing is separate shared config keys (SDK
//     schema-domain-core.ts):
//       main       -> provider.model
//       helper     -> helper.globalProvider + helper.globalModel (+ helper.enabled)
//       tool       -> tools.llmProvider + tools.llmModel (+ tools.llmEnabled)
//       tts        -> tts.llmProvider + tts.llmModel
//       embeddings -> provider.embeddingProvider (provider id only — no model
//                     concept on this wire)
//   - Capability flags and quality tiers are NOT projected onto any HTTP
//     response this client can reach; hasAnyCapabilityData /
//     hasAnyQualityTierData let callers render an honest disabled control
//     instead of a silent no-op filter.

import { asRecord, firstArrayAtPath, firstString, readPath } from "../../lib/wire.ts";

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export type ModelTarget = "main" | "helper" | "tool" | "tts" | "embeddings";

export const MODEL_TARGETS: readonly ModelTarget[] = ["main", "helper", "tool", "tts", "embeddings"];

/** Exact labels from the TUI's model-workspace.ts targetLabelFor() — naming parity. */
export const TARGET_LABELS: Record<ModelTarget, string> = {
  main: "Main Chat",
  helper: "Helper Model",
  tool: "Tool LLM",
  tts: "TTS LLM",
  embeddings: "Embeddings",
};

/** True for the one target with no per-model concept — only a provider id. */
export function targetHasNoModelConcept(target: ModelTarget): boolean {
  return target === "embeddings";
}

// ---------------------------------------------------------------------------
// Config reading — tolerant of the shapes config.get actually returns
// ({ config: { "dotted.key": v } } flat map, nested objects, or bare).
// Same tolerance set views/onboarding/checks.ts configuredModelFrom uses.
// ---------------------------------------------------------------------------

export function readConfigKey(response: unknown, dotted: string): unknown {
  const path = dotted.split(".");
  for (const root of [readPath(response, ["config"]), response, readPath(response, ["values"])]) {
    const record = asRecord(root);
    if (dotted in record) return record[dotted];
    const nested = readPath(root, path);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function readConfigString(response: unknown, dotted: string): string {
  const value = readConfigKey(response, dotted);
  return typeof value === "string" ? value.trim() : "";
}

// ---------------------------------------------------------------------------
// Catalog model shape
// ---------------------------------------------------------------------------

export interface ModelPricing {
  readonly inputPerMillionTokens: number;
  readonly outputPerMillionTokens: number;
  readonly currency: string;
}

export interface CatalogModel {
  readonly id: string;
  readonly registryKey: string;
  readonly provider: string;
  readonly label: string;
  readonly contextWindow?: number;
  readonly tier?: string;
  readonly pricing?: ModelPricing;
}

function readPricing(raw: unknown): ModelPricing | undefined {
  const record = asRecord(raw);
  const input = record["inputPerMillionTokens"];
  const output = record["outputPerMillionTokens"];
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return {
    inputPerMillionTokens: input,
    outputPerMillionTokens: output,
    currency: firstString(record, ["currency"]) || "USD",
  };
}

function normalizeCatalogModel(providerId: string, raw: unknown): CatalogModel | null {
  if (typeof raw === "string") {
    const id = raw.trim();
    if (!id || !providerId) return null;
    return { id, registryKey: `${providerId}:${id}`, provider: providerId, label: id };
  }
  const record = asRecord(raw);
  const id =
    firstString(record, ["id", "modelId"]) || firstString(record, ["registryKey"]).split(":").slice(1).join(":");
  const registryKey = firstString(record, ["registryKey"]) || (id && providerId ? `${providerId}:${id}` : "");
  if (!registryKey || !id) return null;
  const contextWindowRaw = record["contextWindow"];
  return {
    id,
    registryKey,
    provider: providerId,
    label: firstString(record, ["displayName", "label", "name"]) || id,
    contextWindow: typeof contextWindowRaw === "number" ? contextWindowRaw : undefined,
    tier: firstString(record, ["tier"]) || undefined,
    pricing: readPricing(record["pricing"]),
  };
}

const PROVIDER_MODEL_PATHS: readonly (readonly string[])[] = [
  ["models"],
  ["availableModels"],
  ["modelCatalog"],
  ["catalog", "models"],
  ["runtime", "models", "models"],
];

/** Models off ONE provider record (providers.list entry or providers.get body). */
export function modelsFromProviderRecord(providerRaw: unknown): CatalogModel[] {
  const providerId = firstString(providerRaw, ["providerId", "id", "name"]);
  if (!providerId) return [];
  const models: CatalogModel[] = [];
  for (const path of PROVIDER_MODEL_PATHS) {
    const list = readPath(providerRaw, [...path]);
    if (!Array.isArray(list)) continue;
    for (const modelRaw of list) {
      const model = normalizeCatalogModel(providerId, modelRaw);
      if (model && !models.some((existing) => existing.registryKey === model.registryKey)) {
        models.push(model);
      }
    }
    if (models.length > 0) break;
  }
  return models;
}

/**
 * Read models from a providers.list() response — the source that genuinely
 * carries tier/pricing on this pin. Tolerant of the list envelope
 * ({ providers: [...] } / {items} / bare array) and a single provider record.
 */
export function modelsFromProvidersResponse(value: unknown): CatalogModel[] {
  const providers = firstArrayAtPath(value, [["providers"], ["items"], ["data"]]);
  const providerRecords = providers.length > 0 ? providers : [value];
  const models: CatalogModel[] = [];
  for (const providerRaw of providerRecords) {
    for (const model of modelsFromProviderRecord(providerRaw)) {
      if (!models.some((existing) => existing.registryKey === model.registryKey)) models.push(model);
    }
  }
  return models;
}

/** Distinct provider ids from a providers.list() response, in listed order. */
export function providerIdsFromProvidersResponse(value: unknown): string[] {
  const providers = firstArrayAtPath(value, [["providers"], ["items"], ["data"]]);
  const ids: string[] = [];
  for (const providerRaw of providers) {
    const id = firstString(providerRaw, ["providerId", "id", "name"]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Provider ids whose `configured` (top-level or runtime.auth.configured) is true. */
export function configuredProviderIdsFromProvidersResponse(value: unknown): Set<string> {
  const providers = firstArrayAtPath(value, [["providers"], ["items"], ["data"]]);
  const ids = new Set<string>();
  for (const providerRaw of providers) {
    const id = firstString(providerRaw, ["providerId", "id", "name"]);
    if (!id) continue;
    const configured =
      asRecord(providerRaw)["configured"] === true ||
      readPath(providerRaw, ["runtime", "auth", "configured"]) === true;
    if (configured) ids.add(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Family detection — mirrors the TUI's model-picker-types.ts FAMILY_PATTERNS
// exactly, for cross-surface grouping parity. Purely a label/id heuristic.
// ---------------------------------------------------------------------------

export type ModelFamily =
  | "Claude"
  | "GPT"
  | "Gemini"
  | "Llama"
  | "Qwen"
  | "GLM"
  | "MiniMax"
  | "DeepSeek"
  | "Mistral"
  | "Command"
  | "Grok"
  | "Kimi"
  | "Other";

const FAMILY_PATTERNS: readonly { pattern: RegExp; family: ModelFamily }[] = [
  { pattern: /claude/i, family: "Claude" },
  { pattern: /gpt|\bo1\b|\bo3\b|\bo4\b/i, family: "GPT" },
  { pattern: /gemini/i, family: "Gemini" },
  { pattern: /llama/i, family: "Llama" },
  { pattern: /qwen/i, family: "Qwen" },
  { pattern: /glm|chatglm/i, family: "GLM" },
  { pattern: /minimax|abab/i, family: "MiniMax" },
  { pattern: /deepseek/i, family: "DeepSeek" },
  { pattern: /mistral|mixtral/i, family: "Mistral" },
  { pattern: /command|cohere/i, family: "Command" },
  { pattern: /grok/i, family: "Grok" },
  { pattern: /kimi|moonshot/i, family: "Kimi" },
];

export function detectFamily(model: CatalogModel): ModelFamily {
  const haystack = `${model.id} ${model.label}`;
  for (const { pattern, family } of FAMILY_PATTERNS) {
    if (pattern.test(haystack)) return family;
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Filters — TUI vocabulary. Price/tier are backed by real per-model tier data
// where the wire serves it; capability/quality-tier have no wire data on this
// pin and callers must honest-disable those controls.
// ---------------------------------------------------------------------------

export type CategoryFilter = "all" | "free" | "paid" | "subscription";
export type GroupByMode = "provider" | "family" | "pricingTier" | "qualityTier";

/** TUI's tierToCategoryFilter: 'free'/'subscription' pass through, anything else configured is 'paid'. */
export function tierToCategoryFilter(tier: string | undefined): CategoryFilter | undefined {
  if (!tier) return undefined;
  if (tier === "free") return "free";
  if (tier === "subscription") return "subscription";
  return "paid";
}

/** True once the current dataset carries real tier data on at least one model. */
export function hasAnyTierData(models: readonly CatalogModel[]): boolean {
  return models.some((model) => Boolean(model.tier));
}

/** Always false today — capability flags are not projected onto any reachable
 * response on this pin. Kept as a function so a future daemon that starts
 * serving them is picked up here without call-site changes. */
export function hasAnyCapabilityData(_models: readonly CatalogModel[]): boolean {
  return false;
}

/** Always false today — see hasAnyCapabilityData. */
export function hasAnyQualityTierData(_models: readonly CatalogModel[]): boolean {
  return false;
}

export interface ModelFilterOptions {
  readonly query?: string;
  readonly provider?: string;
  readonly categoryFilter?: CategoryFilter;
  readonly availableOnly?: boolean;
  readonly configuredProviderIds?: ReadonlySet<string>;
}

export function filterModels(models: readonly CatalogModel[], options: ModelFilterOptions): CatalogModel[] {
  const query = (options.query ?? "").trim().toLowerCase();
  const categoryFilter = options.categoryFilter ?? "all";
  return models.filter((model) => {
    if (options.provider && model.provider !== options.provider) return false;
    if (query && !`${model.label} ${model.registryKey}`.toLowerCase().includes(query)) return false;
    if (categoryFilter !== "all" && tierToCategoryFilter(model.tier) !== categoryFilter) return false;
    if (options.availableOnly && options.configuredProviderIds && !options.configuredProviderIds.has(model.provider)) {
      return false;
    }
    return true;
  });
}

export interface ModelGroup {
  readonly key: string;
  readonly label: string;
  readonly models: readonly CatalogModel[];
}

/** Honest for 'provider'/'family'/'pricingTier'; 'qualityTier' has no wire data
 * so callers disable that mode — passed through as one "Ungrouped" bucket if forced. */
export function groupModels(models: readonly CatalogModel[], groupBy: GroupByMode): ModelGroup[] {
  const buckets = new Map<string, CatalogModel[]>();
  const order: string[] = [];
  const keyFor = (model: CatalogModel): string => {
    if (groupBy === "provider") return model.provider;
    if (groupBy === "family") return detectFamily(model);
    if (groupBy === "pricingTier") return model.tier ?? "unreported";
    return "Ungrouped";
  };
  for (const model of models) {
    const key = keyFor(model);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)?.push(model);
  }
  return order.map((key) => ({
    key,
    label: key === "unreported" ? "Pricing tier unreported" : key,
    models: buckets.get(key) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Target routing — read the current selection for a target, and build the
// config.set entries a "Use" action should write.
// ---------------------------------------------------------------------------

export interface TargetRouting {
  readonly target: ModelTarget;
  readonly label: string;
  readonly enabled: boolean;
  /** True when this target has genuinely never been routed. */
  readonly unset: boolean;
  readonly provider: string;
  readonly model: string;
  /** Honest note for targets with no model concept, or an empty-means-inherit key. */
  readonly configuredNote?: string;
}

/** Split a provider-qualified registry key ("provider:model") into its parts. */
export function splitRegistryKey(registryKey: string): { provider: string; model: string } {
  const idx = registryKey.indexOf(":");
  if (idx <= 0) return { provider: "", model: registryKey };
  return { provider: registryKey.slice(0, idx), model: registryKey.slice(idx + 1) };
}

/** Read the current routing for a target off a config.get() response. */
export function readTargetRouting(target: ModelTarget, config: unknown): TargetRouting {
  const label = TARGET_LABELS[target];
  if (target === "main") {
    // provider.model is the qualified registry key onboarding writes; fall
    // back to provider.name when the key is unqualified.
    const raw = readConfigString(config, "provider.model");
    const { provider: keyProvider, model } = splitRegistryKey(raw);
    const provider = keyProvider || readConfigString(config, "provider.name");
    return { target, label, enabled: true, unset: !raw, provider, model };
  }
  if (target === "helper") {
    const provider = readConfigString(config, "helper.globalProvider");
    const model = readConfigString(config, "helper.globalModel");
    const enabled = readConfigKey(config, "helper.enabled") === true;
    return { target, label, enabled, unset: !provider || !model, provider, model };
  }
  if (target === "tool") {
    const provider = readConfigString(config, "tools.llmProvider");
    const model = readConfigString(config, "tools.llmModel");
    const enabled = readConfigKey(config, "tools.llmEnabled") === true;
    return {
      target,
      label,
      enabled,
      unset: !provider || !model,
      provider,
      model,
      configuredNote: !model && enabled ? "Empty model uses the fastest available for the provider." : undefined,
    };
  }
  if (target === "tts") {
    const provider = readConfigString(config, "tts.llmProvider");
    const model = readConfigString(config, "tts.llmModel");
    return {
      target,
      label,
      enabled: true,
      unset: !provider || !model,
      provider,
      model,
      configuredNote:
        !provider || !model ? "Empty uses the active chat provider/model for spoken-output turns." : undefined,
    };
  }
  // embeddings — no model concept.
  const provider = readConfigString(config, "provider.embeddingProvider") || "hashed-local";
  return {
    target,
    label,
    enabled: true,
    unset: false,
    provider,
    model: "",
    configuredNote: "Embedding provider only — this target has no model selection.",
  };
}

/**
 * The config.set entries a "Use <model> for <target>" action writes. On this
 * pin EVERY target routes through config.set (there is no models.select) —
 * main writes the provider-qualified `provider.model` registry key.
 */
export function buildTargetWriteEntries(
  target: ModelTarget,
  providerId: string,
  modelId: string,
): readonly (readonly [string, unknown])[] {
  if (target === "main") {
    const registryKey = modelId.includes(":") ? modelId : `${providerId}:${modelId}`;
    return [["provider.model", registryKey]];
  }
  if (target === "helper") {
    return [
      ["helper.globalProvider", providerId],
      ["helper.globalModel", modelId],
      ["helper.enabled", true],
    ];
  }
  if (target === "tool") {
    return [
      ["tools.llmProvider", providerId],
      ["tools.llmModel", modelId],
      ["tools.llmEnabled", true],
    ];
  }
  if (target === "tts") {
    return [
      ["tts.llmProvider", providerId],
      ["tts.llmModel", modelId],
    ];
  }
  // embeddings — provider id only, no model.
  return [["provider.embeddingProvider", providerId]];
}

/** The single config.set entry that flips a target's enable flag, or null for
 * targets with no enable flag ('main', 'tts', 'embeddings' are always-on). */
export function buildTargetEnableEntry(target: ModelTarget, enabled: boolean): readonly [string, unknown] | null {
  if (target === "helper") return ["helper.enabled", enabled];
  if (target === "tool") return ["tools.llmEnabled", enabled];
  return null;
}
