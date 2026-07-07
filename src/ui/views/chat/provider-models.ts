// Provider-first / model-second option normalization over providers.list,
// trimmed from goodvibes-webui src/lib/provider-models.ts. This SDK pin has
// no models.* routes, so the model inventory comes from each provider record
// (models / availableModels / runtime.models.*) and the SELECTION is
// daemon-owned per chat session (companion.chat.sessions.update
// { provider, model }) — not a global models.select.

import { asRecord, bestId, bestTitle, firstArrayAtPath, firstString, readPath } from "../../lib/wire.ts";

export interface ProviderOption {
  id: string;
  label: string;
  value: unknown;
}

export interface ModelOption {
  id: string;
  label: string;
  providerId: string;
  modelId: string;
}

export function providerOptionsFromResponse(value: unknown): ProviderOption[] {
  return firstArrayAtPath(value, [
    ["providers"],
    ["items"],
    ["data"],
    ["result", "providers"],
    ["result", "items"],
  ])
    .map((provider) => {
      const id = bestId(provider);
      return id ? { id, label: bestTitle(provider, id), value: provider } : null;
    })
    .filter((provider): provider is ProviderOption => provider !== null);
}

function normalizeModel(providerId: string, model: unknown): ModelOption | null {
  if (typeof model === "string") {
    const modelId = model.trim();
    return modelId ? { id: `${providerId}:${modelId}`, label: modelId, providerId, modelId } : null;
  }
  const modelId =
    firstString(model, ["modelId", "id", "model", "modelName", "value", "name"]) ||
    firstString(model, ["registryKey", "key"]).split(":").slice(1).join(":");
  if (!modelId) return null;
  return { id: `${providerId}:${modelId}`, label: bestTitle(model, modelId), providerId, modelId };
}

export function modelOptionsFromProvider(provider: unknown): ModelOption[] {
  const providerId = bestId(provider);
  const models: ModelOption[] = [];
  const push = (model: ModelOption | null) => {
    if (model && !models.some((item) => item.id === model.id)) models.push(model);
  };
  for (const path of [
    ["models"],
    ["availableModels"],
    ["modelCatalog"],
    ["catalog", "models"],
    ["runtime", "models", "models"],
    ["runtime", "models", "aliases"],
  ]) {
    for (const model of firstArrayAtPath(provider, [path])) push(normalizeModel(providerId, model));
  }
  push(normalizeModel(providerId, readPath(provider, ["runtime", "models", "defaultModel"])));
  push(normalizeModel(providerId, asRecord(provider)["defaultModel"]));
  return models;
}
