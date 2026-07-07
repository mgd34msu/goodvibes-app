// Pure logic for the onboarding/Doctor checks (docs/UX.md §5): parse the
// three live checks' wire payloads defensively (shapes drift across daemon
// versions) and hold the provider → credential env-key inventory. No React,
// no fetch — the components own the queries.

import type { AppHealth, DaemonMode } from "../../../shared/app-contract.ts";
import { asRecord, firstArrayAtPath, firstString, readPath } from "../../lib/wire.ts";

export type CheckState = "checking" | "pass" | "fail" | "unavailable";

export interface CheckResult {
  state: CheckState;
  /** One-line human summary shown on the check row. */
  summary: string;
  /** Fix guidance / extra context when failing. */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Check 1 — daemon (from /app/health: found/spawned/adopted + mode display)
// ---------------------------------------------------------------------------

export function daemonModeLabel(mode: DaemonMode): string {
  switch (mode) {
    case "external":
      return "Adopted running daemon";
    case "spawned":
      return "Spawned by this app";
    case "unreachable":
      return "Unreachable";
    case "incompatible":
      return "Version incompatible";
  }
}

export function daemonCheck(health: AppHealth | undefined, appUnreachable: boolean): CheckResult {
  if (appUnreachable) {
    return {
      state: "fail",
      summary: "App server unreachable",
      detail: "The app's own local server is not answering. Relaunch the app.",
    };
  }
  if (!health) return { state: "checking", summary: "Probing daemon…" };
  const { daemon } = health;
  if (daemon.mode === "external" || daemon.mode === "spawned") {
    const version = daemon.version ? ` · v${daemon.version}` : "";
    return { state: "pass", summary: `${daemonModeLabel(daemon.mode)}${version}`, detail: daemon.baseUrl };
  }
  return {
    state: "fail",
    summary: daemonModeLabel(daemon.mode),
    detail:
      daemon.detail ??
      `No GoodVibes daemon is answering at ${daemon.baseUrl}. The app retries automatically; if it keeps failing, run \`goodvibes-daemon\` manually and retry.`,
  };
}

// ---------------------------------------------------------------------------
// Check 2 — auth (control.auth.current through the token-injecting proxy)
// ---------------------------------------------------------------------------

/** Best-effort principal off the auth.current payload, "" when absent. */
export function principalFrom(response: unknown): string {
  const record = asRecord(response);
  const nested = asRecord(record["auth"] ?? record["principal"] ?? record["client"]);
  return (
    firstString(record, ["principal", "subject", "clientId", "username", "name", "surface"]) ||
    firstString(nested, ["principal", "subject", "clientId", "username", "name", "id", "surface"])
  );
}

/** Explicit unauthenticated marker on a 200 auth.current payload. */
export function authExplicitlyRejected(response: unknown): boolean {
  const record = asRecord(response);
  if (record["authenticated"] === false) return true;
  const mode = firstString(record, ["mode", "state", "status"]).toLowerCase();
  return mode === "anonymous" || mode === "unauthenticated" || mode === "none";
}

// ---------------------------------------------------------------------------
// Check 3 — provider + model (providers.list + config.get provider.model)
// ---------------------------------------------------------------------------

export interface ProviderOption {
  id: string;
  label: string;
  /** Raw provider record — model options are parsed off it. */
  value: unknown;
}

export function providerOptionsFrom(response: unknown): ProviderOption[] {
  return firstArrayAtPath(response, [
    ["providers"],
    ["items"],
    ["data"],
    ["result", "providers"],
    ["result", "items"],
  ])
    .map((provider) => {
      const id = firstString(provider, ["id", "providerId", "name"]);
      return id ? { id, label: firstString(provider, ["label", "displayName", "name"]) || id, value: provider } : null;
    })
    .filter((option): option is ProviderOption => option !== null);
}

export interface ModelOption {
  /** provider-qualified registry key (what config.set provider.model takes). */
  registryKey: string;
  label: string;
}

function qualifiedKey(providerId: string, modelId: string, registryKey: string): string {
  if (registryKey.includes(":")) return registryKey;
  if (modelId.includes(":")) return modelId;
  return providerId && modelId ? `${providerId}:${modelId}` : "";
}

/** Models listed on a providers.list provider record (webui provider-models port). */
export function modelOptionsFrom(provider: ProviderOption): ModelOption[] {
  const models: ModelOption[] = [];
  for (const path of [
    ["models"],
    ["availableModels"],
    ["modelCatalog"],
    ["catalog", "models"],
    ["runtime", "models", "models"],
  ]) {
    for (const model of firstArrayAtPath(readPath(provider.value, path), [[]])) {
      let registryKey = "";
      let label = "";
      if (typeof model === "string") {
        registryKey = qualifiedKey(provider.id, model.trim(), "");
        label = model.trim();
      } else {
        const explicit = firstString(model, ["registryKey", "key"]);
        const rawModelId =
          firstString(model, ["modelId", "id", "model", "modelName", "name"]) ||
          explicit.split(":").slice(1).join(":");
        registryKey = qualifiedKey(provider.id, rawModelId, explicit);
        label = firstString(model, ["label", "displayName"]) || rawModelId;
      }
      if (registryKey && !models.some((m) => m.registryKey === registryKey)) {
        models.push({ registryKey, label: label || registryKey });
      }
    }
    if (models.length > 0) break;
  }
  return models;
}

/** The configured provider.model value off a config.get payload, "" if unset. */
export function configuredModelFrom(config: unknown): string {
  const record = asRecord(config);
  const candidates: unknown[] = [
    readPath(record, ["provider", "model"]),
    record["provider.model"],
    readPath(record, ["config", "provider", "model"]),
    readPath(record, ["values", "provider", "model"]),
    readPath(record, ["settings", "provider", "model"]),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

/**
 * Provider → credential env-var name, mirrored from the SDK's
 * platform/config/api-keys.ts inventory (the daemon resolves keys env-first,
 * then its secrets store). Providers absent here take credentials through the
 * TUI (`goodvibes config`) or environment — the fix panel says so honestly.
 */
export const PROVIDER_ENV_KEYS: Readonly<Record<string, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  inceptionlabs: "INCEPTION_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  aihubmix: "AIHUBMIX_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  "ollama-cloud": "OLLAMA_CLOUD_API_KEY",
  huggingface: "HF_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  llm7: "LLM7_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  "github-copilot": "COPILOT_GITHUB_TOKEN",
  "microsoft-foundry": "AZURE_OPENAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  qianfan: "QIANFAN_API_KEY",
  qwen: "QWEN_API_KEY",
  sglang: "SGLANG_API_KEY",
  stepfun: "STEPFUN_API_KEY",
  together: "TOGETHER_API_KEY",
  venice: "VENICE_API_KEY",
  volcengine: "VOLCANO_ENGINE_API_KEY",
  xai: "XAI_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  zai: "ZAI_API_KEY",
  "cloudflare-ai-gateway": "CLOUDFLARE_AI_GATEWAY_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
};

export function envKeyForProvider(providerId: string): string | undefined {
  return PROVIDER_ENV_KEYS[providerId];
}

// ---------------------------------------------------------------------------
// First-run persistence
// ---------------------------------------------------------------------------

export const ONBOARDED_STORAGE_KEY = "goodvibes.app.onboarded";

export function isOnboarded(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDED_STORAGE_KEY) === "true";
  } catch {
    return true; // storage unavailable — never nag on every launch
  }
}

export function setOnboarded(): void {
  try {
    window.localStorage.setItem(ONBOARDED_STORAGE_KEY, "true");
  } catch {
    // best-effort
  }
}
