#!/usr/bin/env bun
// generate-feature-settings.ts
//
// Snapshots the installed SDK's FEATURE_SETTINGS (platform/runtime/
// feature-flags) plus the CONFIG_SCHEMA entries those feature units reference,
// into a browser-legal generated module the settings UI reads:
//
//   src/ui/views/settings/feature-settings.generated.ts
//
// Like config-schema.generated.ts this was previously a one-off Bun snippet
// described in the generated file's own header. Its output matched the SDK
// installed when it was last run; what was missing is that no check FAILED when
// a later SDK bump added or dropped a feature. It is a real script wired into
// `generate:check` now, and it shares generate-config-schema.ts's guard that the
// spawned daemon runs the same SDK being snapshotted.
//
// FEATURE_SCHEMA_ENTRIES is ordered by first appearance while walking
// FEATURE_SETTINGS (each unit's enablement key, then its settings keys), NOT by
// CONFIG_SCHEMA order, matching what the UI renders top to bottom. A referenced
// key with no CONFIG_SCHEMA entry is skipped rather than emitted half-formed.
//
// Projection drops anything that cannot or need not cross the Bun/webview
// boundary: the schema's runtime `validate` functions, and the feature entry's
// `operable`/`inoperableDetail` fields, which no consumer in this app reads.
//
// Usage:
//   bun scripts/generate-feature-settings.ts          # write/update
//   bun scripts/generate-feature-settings.ts --check  # exit 1 on drift

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertDaemonSdkMatches,
  toRow as toConfigRow,
  sdkVersion,
  type ConfigSettingRow,
} from "./generate-config-schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");

export const OUT_PATH = resolve(ROOT, "src/ui/views/settings/feature-settings.generated.ts");

interface SdkFeatureSetting {
  id: string;
  name: string;
  description: string;
  domain: string;
  enablement: { key: string; kind: string; enabledValues?: readonly string[] };
  settings: readonly string[];
  restartRequired: boolean;
  defaultEnabled: boolean;
}

interface SdkConfigSetting {
  key: string;
  type: string;
  default: unknown;
  description: string;
  enumValues?: readonly string[];
  validationHint?: string;
}

export interface FeatureSettingRow {
  id: string;
  name: string;
  description: string;
  domain: string;
  enablement: { key: string; kind: string; enabledValues?: readonly string[] };
  settings: readonly string[];
  restartRequired: boolean;
  defaultEnabled: boolean;
}

export async function loadSources(): Promise<{
  features: readonly SdkFeatureSetting[];
  schema: readonly SdkConfigSetting[];
}> {
  const flags = await import("@pellux/goodvibes-sdk/platform/runtime/feature-flags");
  const config = await import("@pellux/goodvibes-sdk/platform/config");
  return {
    features: (flags as unknown as { FEATURE_SETTINGS: readonly SdkFeatureSetting[] }).FEATURE_SETTINGS,
    schema: (config as unknown as { CONFIG_SCHEMA: readonly SdkConfigSetting[] }).CONFIG_SCHEMA,
  };
}

export function toFeatureRows(features: readonly SdkFeatureSetting[]): FeatureSettingRow[] {
  return features.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    domain: f.domain,
    enablement: {
      key: f.enablement.key,
      kind: f.enablement.kind,
      ...(f.enablement.enabledValues !== undefined ? { enabledValues: f.enablement.enabledValues } : {}),
    },
    settings: f.settings,
    restartRequired: f.restartRequired,
    defaultEnabled: f.defaultEnabled,
  }));
}

/** CONFIG_SCHEMA entries for every key the features reference, first-appearance ordered. */
export function toSchemaRows(
  features: readonly SdkFeatureSetting[],
  schema: readonly SdkConfigSetting[],
): ConfigSettingRow[] {
  const byKey = new Map(schema.map((e) => [e.key, e]));
  const seen = new Set<string>();
  const rows: ConfigSettingRow[] = [];
  for (const feature of features) {
    for (const key of [feature.enablement.key, ...feature.settings]) {
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = byKey.get(key);
      if (entry !== undefined) rows.push(toConfigRow(entry));
    }
  }
  return rows;
}

export function renderModule(
  featureRows: readonly FeatureSettingRow[],
  schemaRows: readonly ConfigSettingRow[],
  version: string,
): string {
  const lines: string[] = [];
  lines.push("// GENERATED FILE: DO NOT EDIT BY HAND.");
  lines.push("// Produced by scripts/generate-feature-settings.ts from the installed");
  lines.push(`// @pellux/goodvibes-sdk@${version}: FEATURE_SETTINGS (platform/runtime/`);
  lines.push(`// feature-flags, ${featureRows.length} units) plus the CONFIG_SCHEMA entries every unit's`);
  lines.push(`// enablement key and settings keys reference (${schemaRows.length} keys).`);
  lines.push("// The dissolved-feature model (SDK 1.7.1+): every platform capability is a");
  lines.push("// first-class domain settings key, there is no separate enablement namespace.");
  lines.push("// Pure data, no runtime functions cross the Bun/webview boundary. The daemon");
  lines.push("// re-validates every config.set anyway; client-side hints are advisory only.");
  lines.push("// Regenerate: `bun run generate:feature-settings`.");
  lines.push("");
  lines.push('import type { ConfigSettingMeta } from "./config-schema.generated.ts";');
  lines.push("");
  lines.push('export type FeatureEnablementKind = "boolean" | "enum" | "constant";');
  lines.push("");
  lines.push("export interface FeatureSettingMeta {");
  lines.push("  readonly id: string;");
  lines.push("  readonly name: string;");
  lines.push("  readonly description: string;");
  lines.push("  readonly domain: string;");
  lines.push("  readonly enablement: {");
  lines.push("    readonly key: string;");
  lines.push("    readonly kind: FeatureEnablementKind;");
  lines.push("    readonly enabledValues?: readonly string[];");
  lines.push("  };");
  lines.push("  readonly settings: readonly string[];");
  lines.push("  readonly restartRequired: boolean;");
  lines.push("  readonly defaultEnabled: boolean;");
  lines.push("}");
  lines.push("");
  lines.push("/** Every platform capability the settings surface renders as a feature unit,");
  lines.push(" *  ordered by the SDK registry declaration order (groups derive their order");
  lines.push(" *  from first-appearance here, per feature.domain). */");
  lines.push(
    `export const FEATURE_SETTINGS_SNAPSHOT: readonly FeatureSettingMeta[] = ${JSON.stringify(featureRows, null, 2)};`,
  );
  lines.push("");
  lines.push("/** CONFIG_SCHEMA entries for every key referenced by FEATURE_SETTINGS_SNAPSHOT");
  lines.push(" *  (enablement keys + owned settings keys), ordered by first appearance while");
  lines.push(" *  walking the features above rather than by CONFIG_SCHEMA order. */");
  lines.push(
    `export const FEATURE_SCHEMA_ENTRIES: readonly ConfigSettingMeta[] = ${JSON.stringify(schemaRows, null, 2)};`,
  );
  lines.push("");
  return lines.join("\n");
}

export function writeIfChanged(path: string, content: string, checkOnly: boolean): boolean {
  let current: string | null = null;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = null;
  }
  if (current === content) return false;
  if (checkOnly) {
    console.error(`[generate:feature-settings] drift: ${path}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  console.log(`[generate:feature-settings] wrote: ${path}`);
  return true;
}

if (import.meta.main) {
  const version = await sdkVersion();
  assertDaemonSdkMatches(version);
  const { features, schema } = await loadSources();
  const content = renderModule(toFeatureRows(features), toSchemaRows(features, schema), version);
  const drifted = writeIfChanged(OUT_PATH, content, CHECK_ONLY);
  if (CHECK_ONLY && drifted) {
    console.error("[generate:feature-settings] drift detected: run `bun run generate:feature-settings`");
    process.exit(1);
  }
  if (!drifted) {
    console.log("[generate:feature-settings] up-to-date");
  }
}
