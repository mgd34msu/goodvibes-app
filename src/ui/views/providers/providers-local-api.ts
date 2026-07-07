// Typed client for the app-local /app/local/providers + /app/local/llm-scan
// routes (src/bun/local-tools.ts). No wire method backs any of this
// (docs/GAPS.md §14 rows 8/9 — MISSING) — every value here is app-local disk
// I/O (custom TUI provider JSON files under ~/.goodvibes/tui/providers/) or an
// opt-in localhost probe, so freshness is mutation-driven invalidation only
// (no wire event, no poll — nothing here changes unless this app or the TUI
// touches those files, and the scan never runs unless the user clicks it).

import { appJson } from "../../lib/http.ts";
import { errorStatus } from "../../lib/errors.ts";

export const providersLocalKeys = {
  customList: ["providers-local", "custom", "list"] as const,
};

/** 404/501 shape this app-local module returns before it exists in a build. */
export function isProvidersLocalRouteUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 501;
}

export interface CustomProviderFile {
  file: string;
  json: unknown;
  error?: string;
}

export interface CustomProvidersList {
  dir: string;
  providers: CustomProviderFile[];
}

export const customProvidersApi = {
  list: () => appJson<CustomProvidersList>("/app/local/providers"),
  put: (file: string, json: Record<string, unknown>) =>
    appJson<{ ok: true; file: string }>(`/app/local/providers/${encodeURIComponent(file)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json }),
    }),
  remove: (file: string) =>
    appJson<{ ok: true; file: string }>(`/app/local/providers/${encodeURIComponent(file)}`, { method: "DELETE" }),
} as const;

// ─── opt-in localhost LLM server scan ──────────────────────────────────────

export type LlmServerKind = "ollama" | "lmstudio" | "llamacpp" | "vllm";

export interface LlmScanServer {
  port: number;
  kind: LlmServerKind;
  alive: boolean;
  models: string[];
}

export const llmScanApi = {
  /** POST only — never runs unless the caller explicitly invokes it. */
  scan: () => appJson<{ servers: LlmScanServer[] }>("/app/local/llm-scan", { method: "POST" }),
} as const;

/** Best-effort custom-provider JSON prefill from a discovered local LLM server. */
export function providerJsonFromLlmServer(server: LlmScanServer): Record<string, unknown> {
  const baseUrl = `http://127.0.0.1:${server.port}`;
  return {
    id: server.kind,
    label: `${server.kind} (localhost:${server.port})`,
    baseUrl: server.kind === "ollama" ? baseUrl : `${baseUrl}/v1`,
    models: server.models,
  };
}
