// Local provider→model catalog normalization for the blind model compare
// (docs/FEATURES.md §11). Deliberately reimplemented here from the same
// providers.list shapes the chat surface reads — view dirs do not import
// each other's modules. Model inventory comes off each provider record; the
// provider-qualified registry key is what config.set { key: "provider.model" }
// takes for the winner-route update.

import { asRecord, firstArrayAtPath, firstString, readPath } from "../../lib/wire.ts";

export interface CompareModelOption {
  /** Unique option id: provider-qualified registry key. */
  registryKey: string;
  label: string;
  providerId: string;
  modelId: string;
}

function qualifiedKey(providerId: string, modelId: string, explicit: string): string {
  if (explicit.includes(":")) return explicit;
  if (modelId.includes(":")) return modelId;
  return providerId && modelId ? `${providerId}:${modelId}` : "";
}

export function compareModelOptionsFrom(providersResponse: unknown): CompareModelOption[] {
  const providers = firstArrayAtPath(providersResponse, [
    ["providers"],
    ["items"],
    ["data"],
    ["result", "providers"],
    ["result", "items"],
  ]);
  const options: CompareModelOption[] = [];
  for (const provider of providers) {
    const providerId = firstString(provider, ["id", "providerId", "name"]);
    if (!providerId) continue;
    const providerLabel = firstString(provider, ["label", "displayName", "name"]) || providerId;
    for (const path of [
      ["models"],
      ["availableModels"],
      ["modelCatalog"],
      ["catalog", "models"],
      ["runtime", "models", "models"],
    ]) {
      for (const model of firstArrayAtPath(readPath(provider, path), [[]])) {
        let registryKey = "";
        let modelId = "";
        let label = "";
        if (typeof model === "string") {
          modelId = model.trim();
          registryKey = qualifiedKey(providerId, modelId, "");
          label = modelId;
        } else {
          const explicit = firstString(model, ["registryKey", "key"]);
          modelId =
            firstString(model, ["modelId", "id", "model", "modelName", "name"]) ||
            explicit.split(":").slice(1).join(":");
          registryKey = qualifiedKey(providerId, modelId, explicit);
          label = firstString(model, ["label", "displayName"]) || modelId;
        }
        if (registryKey && !options.some((o) => o.registryKey === registryKey)) {
          options.push({ registryKey, label: `${providerLabel} · ${label || registryKey}`, providerId, modelId });
        }
      }
    }
    // Fall back to the provider's default model when no catalog is listed.
    const fallback =
      firstString(readPath(provider, ["runtime", "models", "defaultModel"]), ["modelId", "id", "model", "name"]) ||
      (typeof readPath(provider, ["runtime", "models", "defaultModel"]) === "string"
        ? String(readPath(provider, ["runtime", "models", "defaultModel"]))
        : "") ||
      firstString(asRecord(provider)["defaultModel"], ["modelId", "id", "model", "name"]) ||
      (typeof asRecord(provider)["defaultModel"] === "string" ? String(asRecord(provider)["defaultModel"]) : "");
    if (fallback) {
      const registryKey = qualifiedKey(providerId, fallback, "");
      if (registryKey && !options.some((o) => o.registryKey === registryKey)) {
        options.push({ registryKey, label: `${providerLabel} · ${fallback}`, providerId, modelId: fallback });
      }
    }
  }
  return options;
}
