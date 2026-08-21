#!/usr/bin/env bun
// generate-device-capabilities.ts
//
// Snapshots the installed device capability catalog
// (@pellux/goodvibes-sdk/platform/devices DEVICE_CAPABILITY_CATALOG) into a
// browser-legal generated module the Devices settings surface builds its
// request form from:
//
//   src/ui/views/settings/device-capabilities.generated.ts
//
// WHY THIS IS GENERATED RATHER THAN READ OFF THE WIRE. devices.nodes.list
// returns a capability array, but it carries only id/family/title/purpose/
// effect/sensitivity/producesArtifact/allowAlwaysOffered, and NOT `inputFields`,
// which is the one part a request form cannot invent. The catalog module that
// does carry them is a `platform` subpath, and scripts/check-boundaries.ts
// forbids src/ui from importing those at all (the webview process must never
// pull in Bun-only code). So the fields are pinned here, at build time, from
// the same installed SDK the daemon speaks, instead of being retyped by hand
// into the UI where they could drift silently.
//
// A capability id the wire reports that this snapshot does not know is not an
// error: the form falls back to sending no typed input for it, the daemon
// validates the arguments it actually got, and its refusal names the field.
//
// Output is deterministic (catalog order, which is the order the surfaces
// render) so regeneration is diff-stable. `--check` exits 1 on drift without
// writing, wired into `bun run verify` so an SDK bump that changed a
// capability's inputs fails fast instead of shipping a form that asks for the
// wrong thing.
//
// Usage:
//   bun scripts/generate-device-capabilities.ts          # write/update
//   bun scripts/generate-device-capabilities.ts --check  # exit 1 on drift

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");

export const OUT_PATH = resolve(ROOT, "src/ui/views/settings/device-capabilities.generated.ts");

export interface CatalogInputField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface CatalogEntry {
  id: string;
  family: string;
  title: string;
  purpose: string;
  effect: string;
  artifactKind: string;
  producesArtifact: boolean;
  sensitivity: string;
  secureContextRequired: boolean;
  inputFields: CatalogInputField[];
}

export interface CatalogSnapshot {
  contractVersion: number;
  nodeKinds: string[];
  entries: CatalogEntry[];
}

interface SdkCatalogModule {
  DEVICE_CAPABILITY_CONTRACT_VERSION: number;
  KNOWN_DEVICE_NODE_KINDS: readonly string[];
  DEVICE_CAPABILITY_CATALOG: readonly {
    id: string;
    family: string;
    title: string;
    purpose: string;
    effect: string;
    artifactKind: string;
    producesArtifact: boolean;
    sensitivity: string;
    secureContextRequired: boolean;
    inputFields: readonly CatalogInputField[];
  }[];
}

export async function loadCatalog(): Promise<CatalogSnapshot> {
  const mod = (await import("@pellux/goodvibes-sdk/platform/devices")) as unknown as SdkCatalogModule;
  return {
    contractVersion: mod.DEVICE_CAPABILITY_CONTRACT_VERSION,
    nodeKinds: [...mod.KNOWN_DEVICE_NODE_KINDS],
    entries: mod.DEVICE_CAPABILITY_CATALOG.map((descriptor) => ({
      id: descriptor.id,
      family: descriptor.family,
      title: descriptor.title,
      purpose: descriptor.purpose,
      effect: descriptor.effect,
      artifactKind: descriptor.artifactKind,
      producesArtifact: descriptor.producesArtifact,
      sensitivity: descriptor.sensitivity,
      secureContextRequired: descriptor.secureContextRequired,
      inputFields: descriptor.inputFields.map((field) => ({
        name: field.name,
        type: field.type,
        required: field.required,
        description: field.description,
      })),
    })),
  };
}

export function renderModule(snapshot: CatalogSnapshot): string {
  const lines: string[] = [];
  lines.push("// GENERATED FILE: DO NOT EDIT BY HAND.");
  lines.push("// Produced by scripts/generate-device-capabilities.ts from the installed");
  lines.push("// @pellux/goodvibes-sdk platform/devices capability catalog");
  lines.push(
    `// (device capability contract v${snapshot.contractVersion}, ${snapshot.entries.length} capabilities).`,
  );
  lines.push("//");
  lines.push("// The wire (devices.nodes.list) carries every field here EXCEPT inputFields,");
  lines.push("// which is why this snapshot exists: a request form cannot invent the typed");
  lines.push("// arguments a capability takes. Regenerate: `bun run generate:device-capabilities`.");
  lines.push("");
  lines.push("export interface DeviceCapabilityInputField {");
  lines.push("  name: string;");
  lines.push("  type: string;");
  lines.push("  required: boolean;");
  lines.push("  description: string;");
  lines.push("}");
  lines.push("");
  lines.push("export interface DeviceCapabilityCatalogEntry {");
  lines.push("  id: string;");
  lines.push("  family: string;");
  lines.push("  title: string;");
  lines.push("  purpose: string;");
  lines.push("  effect: string;");
  lines.push("  artifactKind: string;");
  lines.push("  producesArtifact: boolean;");
  lines.push("  sensitivity: string;");
  lines.push("  secureContextRequired: boolean;");
  lines.push("  inputFields: readonly DeviceCapabilityInputField[];");
  lines.push("}");
  lines.push("");
  lines.push(`export const DEVICE_CAPABILITY_CONTRACT_VERSION = ${snapshot.contractVersion};`);
  lines.push("");
  lines.push("/** Advisory only: a node kind not listed here still pairs and works. */");
  lines.push(
    `export const KNOWN_DEVICE_NODE_KINDS: readonly string[] = ${JSON.stringify(snapshot.nodeKinds)};`,
  );
  lines.push("");
  lines.push(
    "export const DEVICE_CAPABILITY_CATALOG: readonly DeviceCapabilityCatalogEntry[] = [",
  );
  for (const entry of snapshot.entries) {
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(entry.id)},`);
    lines.push(`    family: ${JSON.stringify(entry.family)},`);
    lines.push(`    title: ${JSON.stringify(entry.title)},`);
    lines.push(`    purpose: ${JSON.stringify(entry.purpose)},`);
    lines.push(`    effect: ${JSON.stringify(entry.effect)},`);
    lines.push(`    artifactKind: ${JSON.stringify(entry.artifactKind)},`);
    lines.push(`    producesArtifact: ${entry.producesArtifact},`);
    lines.push(`    sensitivity: ${JSON.stringify(entry.sensitivity)},`);
    lines.push(`    secureContextRequired: ${entry.secureContextRequired},`);
    if (entry.inputFields.length === 0) {
      lines.push("    inputFields: [],");
    } else {
      lines.push("    inputFields: [");
      for (const field of entry.inputFields) {
        const parts = [
          `name: ${JSON.stringify(field.name)}`,
          `type: ${JSON.stringify(field.type)}`,
          `required: ${field.required}`,
          `description: ${JSON.stringify(field.description)}`,
        ];
        lines.push(`      { ${parts.join(", ")} },`);
      }
      lines.push("    ],");
    }
    lines.push("  },");
  }
  lines.push("];");
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
    console.error(`[generate:device-capabilities] drift: ${path}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  console.log(`[generate:device-capabilities] wrote: ${path}`);
  return true;
}

if (import.meta.main) {
  const snapshot = await loadCatalog();
  const drifted = writeIfChanged(OUT_PATH, renderModule(snapshot), CHECK_ONLY);
  if (CHECK_ONLY && drifted) {
    console.error(
      "[generate:device-capabilities] drift detected: run `bun run generate:device-capabilities`",
    );
    process.exit(1);
  }
  if (!drifted) {
    console.log("[generate:device-capabilities] up-to-date");
  }
}
