#!/usr/bin/env bun
// generate-config-schema.ts
//
// Snapshots the installed SDK's CONFIG_SCHEMA (platform/config) into a
// browser-legal generated module the settings UI reads:
//
//   src/ui/views/settings/config-schema.generated.ts
//
// This file used to be produced by a one-off Bun snippet pasted from its own
// header. The snapshot it produced was correct for the SDK installed at the
// time (392 keys against sdk 1.11.2); the problem was that nothing FAILED when
// a later SDK bump changed the schema, so the next bump would have gone
// unnoticed. It is a real script wired into `generate:check` now, so drift
// fails `bun run verify` instead of surfacing as settings rows that error on
// save.
//
// What this snapshot has to agree with is the DAEMON that the app actually
// spawns (node_modules/.bin/goodvibes-daemon, from @pellux/goodvibes-daemon via
// @pellux/goodvibes-tui), because the daemon is what validates a config.set. It
// reads the SDK resolved from this package because today the app and that
// daemon resolve the SAME @pellux/goodvibes-sdk tree (both 2.0.17, hoisted, no
// nested copy). If a future tui/daemon bump reintroduces a nested SDK, this
// script must be pointed at the daemon's copy instead: a snapshot generated
// from a newer SDK than the daemon runs describes settings that do not exist.
//
// Projection: key, type, default, description, enumValues?, validationHint?.
// The schema's runtime `validate` functions cannot cross the Bun/webview
// boundary (docs/ARCHITECTURE.md §5) and are dropped, as is `unit`, which no
// consumer reads. The daemon re-validates every config.set anyway, so the
// client-side hints are advisory only.
//
// Output is deterministic (SDK declaration order, 2-space JSON) so
// regeneration is diff-stable.
//
// Usage:
//   bun scripts/generate-config-schema.ts          # write/update
//   bun scripts/generate-config-schema.ts --check  # exit 1 on drift

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");

export const OUT_PATH = resolve(ROOT, "src/ui/views/settings/config-schema.generated.ts");

/** The slice of the SDK's schema entry this snapshot carries over. */
export interface ConfigSettingRow {
  key: string;
  type: string;
  default: unknown;
  description: string;
  enumValues?: readonly string[];
  validationHint?: string;
}

interface SdkConfigSetting {
  key: string;
  type: string;
  default: unknown;
  description: string;
  enumValues?: readonly string[];
  validationHint?: string;
}

export async function loadConfigSchema(): Promise<readonly SdkConfigSetting[]> {
  const mod = await import("@pellux/goodvibes-sdk/platform/config");
  return (mod as unknown as { CONFIG_SCHEMA: readonly SdkConfigSetting[] }).CONFIG_SCHEMA;
}

export async function sdkVersion(): Promise<string> {
  const pkg = JSON.parse(
    readFileSync(resolve(ROOT, "node_modules/@pellux/goodvibes-sdk/package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

/**
 * Refuse to generate when the daemon the app spawns runs a DIFFERENT SDK than
 * the one being snapshotted.
 *
 * This is the failure the comment above describes, made into an error. It
 * already happened once: the app moved to sdk 2.0.17 while the pinned tui still
 * carried a nested sdk 1.11.2, so a 599-key snapshot was generated for a daemon
 * that only had 392 of them. A version string in a header is not a guard, so
 * this looks for a nested SDK under either package that ships the daemon and
 * compares it to the hoisted one.
 */
export function assertDaemonSdkMatches(appVersion: string): void {
  const nestedCandidates = [
    "node_modules/@pellux/goodvibes-tui/node_modules/@pellux/goodvibes-sdk/package.json",
    "node_modules/@pellux/goodvibes-daemon/node_modules/@pellux/goodvibes-sdk/package.json",
  ];
  for (const rel of nestedCandidates) {
    let raw: string;
    try {
      raw = readFileSync(resolve(ROOT, rel), "utf8");
    } catch {
      continue; // no nested copy: that package shares the hoisted SDK, which is what we want
    }
    const nested = (JSON.parse(raw) as { version: string }).version;
    if (nested !== appVersion) {
      throw new Error(
        `The daemon's SDK (${nested}, via ${rel}) differs from the SDK being snapshotted (${appVersion}). `
          + "A snapshot generated from the app's SDK would describe settings the running daemon does not have "
          + "(they fail on save) and omit ones it does. Align the @pellux/goodvibes-tui pin with the SDK, or "
          + "point these generators at the daemon's own SDK tree.",
      );
    }
  }
}

/** Project one SDK entry, preserving field order so output stays diff-stable. */
export function toRow(entry: SdkConfigSetting): ConfigSettingRow {
  return {
    key: entry.key,
    type: entry.type,
    default: entry.default,
    description: entry.description,
    ...(entry.enumValues !== undefined ? { enumValues: entry.enumValues } : {}),
    ...(entry.validationHint !== undefined ? { validationHint: entry.validationHint } : {}),
  };
}

export function toRows(schema: readonly SdkConfigSetting[]): ConfigSettingRow[] {
  return schema.map(toRow);
}

export function renderModule(rows: readonly ConfigSettingRow[], version: string): string {
  const lines: string[] = [];
  lines.push("// GENERATED FILE: DO NOT EDIT BY HAND.");
  lines.push("// Produced by scripts/generate-config-schema.ts from the installed");
  lines.push(`// @pellux/goodvibes-sdk@${version} (platform/config, a Bun-only subpath the`);
  lines.push(`// webview must not import, docs/ARCHITECTURE.md §5), ${rows.length} keys.`);
  lines.push("// Pure data: key, type, default, description, enum values, validation hint.");
  lines.push("// The runtime `validate` functions cannot cross the boundary and are");
  lines.push("// intentionally dropped; the daemon re-validates every config.set anyway, so");
  lines.push("// client-side hints are advisory only.");
  lines.push("// Regenerate: `bun run generate:config-schema`.");
  lines.push("");
  lines.push("export interface ConfigSettingMeta {");
  lines.push("  readonly key: string;");
  lines.push('  readonly type: "boolean" | "number" | "string" | "enum" | "object";');
  lines.push("  readonly default: unknown;");
  lines.push("  readonly description: string;");
  lines.push("  readonly enumValues?: readonly string[];");
  lines.push("  readonly validationHint?: string;");
  lines.push("}");
  lines.push("");
  lines.push("export const CONFIG_SCHEMA_SNAPSHOT: readonly ConfigSettingMeta[] =");
  lines.push(`${JSON.stringify(rows, null, 2)};`);
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
    console.error(`[generate:config-schema] drift: ${path}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  console.log(`[generate:config-schema] wrote: ${path}`);
  return true;
}

if (import.meta.main) {
  const version = await sdkVersion();
  assertDaemonSdkMatches(version);
  const schema = await loadConfigSchema();
  const rows = toRows(schema);
  const drifted = writeIfChanged(OUT_PATH, renderModule(rows, version), CHECK_ONLY);
  if (CHECK_ONLY && drifted) {
    console.error("[generate:config-schema] drift detected: run `bun run generate:config-schema`");
    process.exit(1);
  }
  if (!drifted) {
    console.log("[generate:config-schema] up-to-date");
  }
}
