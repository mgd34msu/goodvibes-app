// Typed client for the app-local /app/secrets/* routes (src/bun/secrets.ts)
// plus the LOCAL query-key registry for the Secrets / Services / App & Launch
// settings sections. No wire method backs any of this (docs/FEATURES.md §19
// "gap" rows) — every value here is app-local, so freshness is a short
// targeted poll plus mutation-driven invalidation, same doctrine as
// settings-queries.ts's SETTINGS_POLL_MS.

import { appJson } from "../../lib/http.ts";
import { errorStatus } from "../../lib/errors.ts";

export const secretsKeys = {
  list: ["settings-secrets", "list"] as const,
  inspect: ["settings-secrets", "inspect"] as const,
  services: ["settings-secrets", "services"] as const,
  serviceInspect: (name: string) => ["settings-secrets", "services", name] as const,
  doctor: ["settings-secrets", "doctor"] as const,
  appSettings: ["settings-secrets", "app-settings"] as const,
  importPreview: (source: "tui" | "agent") => ["settings-secrets", "import-preview", source] as const,
} as const;

/** 404/501 shape this app-local module returns before it exists in a build. */
export function isSecretsRouteUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 501;
}

// ─── secrets ──────────────────────────────────────────────────────────────

export interface SecretRow {
  key: string;
  source: "env" | "project-secure" | "project-plaintext" | "user-secure" | "user-plaintext";
  scope: "project" | "user" | "env";
  secure: boolean;
  overriddenByEnv: boolean;
  refSource: string | null;
}

export interface SecretsStorageReview {
  policy: "plaintext_allowed" | "preferred_secure" | "require_secure";
  secureAvailable: boolean;
  storedKeys: number;
  envBackedKeys: number;
  secureKeys: number;
  plaintextKeys: number;
  warnings: readonly string[];
  locations: ReadonlyArray<{ source: string; path: string; exists: boolean; readable: boolean }>;
}

/** Mirrors the SDK's SecretRef union shapes closely enough to build a "link"
 *  payload from a form — validated server-side against the real type. */
export type SecretLinkInput =
  | { source: "env"; id: string }
  | { source: "goodvibes"; id: string }
  | { source: "file"; path: string; selector?: string }
  | { source: "exec"; command: string; args?: string[] }
  | { source: "1password" | "onepassword"; ref?: string; vault?: string; item?: string; field?: string }
  | { source: "bitwarden" | "vaultwarden"; item: string; field?: string; server?: string }
  | { source: "bitwarden-secrets-manager" | "bws"; id: string; field?: string };

export const LINK_PROVIDERS: ReadonlyArray<{ value: SecretLinkInput["source"]; label: string }> = [
  { value: "env", label: "Environment variable" },
  { value: "file", label: "File" },
  { value: "exec", label: "Command (exec)" },
  { value: "1password", label: "1Password" },
  { value: "bitwarden", label: "Bitwarden" },
  { value: "vaultwarden", label: "Vaultwarden" },
  { value: "bitwarden-secrets-manager", label: "Bitwarden Secrets Manager" },
];

export const secretsApi = {
  list: () => appJson<{ secrets: SecretRow[] }>("/app/secrets"),
  inspect: () => appJson<{ inspect: SecretsStorageReview }>("/app/secrets/inspect"),
  set: (name: string, valueOrLink: { value: string } | { link: SecretLinkInput }, scope?: "project" | "user") =>
    appJson<{ ok: boolean; name: string; kind: "value" | "link" }>("/app/secrets/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scope, ...valueOrLink }),
    }),
  test: (name: string) =>
    appJson<{ ok: boolean; name: string; reason?: string }>(`/app/secrets/test/${encodeURIComponent(name)}`, {
      method: "POST",
    }),
  remove: (name: string) => appJson<{ ok: boolean; name: string }>(`/app/secrets/${encodeURIComponent(name)}`, { method: "DELETE" }),
} as const;

// ─── services ─────────────────────────────────────────────────────────────

export interface ServiceRow {
  name: string;
  baseUrl: string | null;
  authType: "bearer" | "basic" | "api-key" | "oauth";
  providerId: string | null;
  hasPrimaryCredential: boolean;
  hasPasswordCredential: boolean;
  hasAuthTokenCredential: boolean;
  hasWebhookUrl: boolean;
  hasSigningSecret: boolean;
  hasPublicKey: boolean;
  hasAppToken: boolean;
}

export interface ServiceTestResult {
  ok: boolean;
  status: number | null;
  testedUrl: string | null;
  error?: string;
}

export interface DoctorReport {
  secrets: SecretsStorageReview;
  services: ReadonlyArray<{ name: string; configured: boolean }>;
  note: string;
}

export const servicesApi = {
  list: () => appJson<{ services: ServiceRow[]; servicesFilePath: string }>("/app/secrets/services"),
  inspect: (name: string) => appJson<{ service: ServiceRow }>(`/app/secrets/services/${encodeURIComponent(name)}`),
  test: (name: string) =>
    appJson<{ test: ServiceTestResult }>(`/app/secrets/services/${encodeURIComponent(name)}/test`, { method: "POST" }),
  doctor: () => appJson<DoctorReport>("/app/secrets/doctor"),
} as const;

// ─── app-own settings + launch-at-login posture ────────────────────────────

export interface AppOwnSettings {
  stopDaemonOnQuit: boolean;
}

export interface AutostartStatus {
  supported: boolean;
  enabled: boolean;
  reason: string;
  launcherPath: string | null;
}

export const appOwnSettingsApi = {
  get: () => appJson<{ app: AppOwnSettings; autostart: AutostartStatus }>("/app/secrets/app-settings"),
  put: (patch: Partial<AppOwnSettings>) =>
    appJson<{ app: AppOwnSettings; autostart: AutostartStatus }>("/app/secrets/app-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app: patch }),
    }),
  setAutostart: (enabled: boolean) =>
    appJson<{ ok: boolean; autostart: AutostartStatus }>("/app/secrets/app-settings/autostart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
} as const;

// ─── read-only settings import preview (tui/agent) ─────────────────────────

export interface ImportSuggestion {
  key: string;
  label: string;
  value: string;
  applicable: boolean;
}

export interface ImportPreview {
  source: "tui" | "agent";
  found: boolean;
  path: string;
  redacted: unknown;
  suggestions: ImportSuggestion[];
}

export const importPreviewApi = {
  preview: (source: "tui" | "agent") => appJson<ImportPreview>(`/app/secrets/import-preview?source=${source}`),
} as const;
