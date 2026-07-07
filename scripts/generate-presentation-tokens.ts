#!/usr/bin/env bun
// generate-presentation-tokens.ts
//
// Ported from ../goodvibes-webui/scripts/generate-presentation-tokens.ts
// (same author, same semantics). Bridges the SDK presentation contract
// (the platform presentation subpath of @pellux/goodvibes-sdk — status-glyph
// registry, tone-token table, spinner frames, thinking-phrase pool the TUI
// and agent already render through) onto two generated, checked-in artifacts:
//
//   - src/ui/lib/generated/presentation-tokens.ts     — typed TS mirror of the
//     contract's data tables, consumed by the UI's presentation bridge.
//   - src/ui/styles/generated/presentation-tokens.css — CSS custom properties:
//     glyphs as quoted `content` strings (--contract-glyph-*) and the state
//     tone-color table per theme mode (--contract-state-*).
//
// Only DATA tables are snapshotted (GLYPHS, STATE_GLYPHS, TONE_TOKENS,
// SPINNER_FRAMES, THINKING_PHRASES). `waitingPhrase` is a pure function with
// no meaningful generated form; Bun-side code imports it from the SDK
// directly (src/ui never imports SDK platform subpaths — this generated
// snapshot is exactly how the contract data crosses that boundary).
//
// `--check` exits 1 the moment either artifact drifts from a fresh
// regeneration — wired into `bun run verify`.
//
// Usage:
//   bun scripts/generate-presentation-tokens.ts          # write/update
//   bun scripts/generate-presentation-tokens.ts --check  # exit 1 on drift

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GLYPHS,
  STATE_GLYPHS,
  TONE_TOKENS,
  resolveTones,
  SPINNER_FRAMES,
  THINKING_PHRASES,
} from "@pellux/goodvibes-sdk/platform/presentation";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");

export const CSS_OUT_PATH = resolve(ROOT, "src/ui/styles/generated/presentation-tokens.css");
export const TS_OUT_PATH = resolve(ROOT, "src/ui/lib/generated/presentation-tokens.ts");

export interface PresentationContractSnapshot {
  readonly glyphs: typeof GLYPHS;
  readonly stateGlyphs: typeof STATE_GLYPHS;
  readonly toneDark: typeof TONE_TOKENS;
  readonly toneLight: ReturnType<typeof resolveTones>;
  readonly spinnerFrames: typeof SPINNER_FRAMES;
  readonly thinkingPhrases: typeof THINKING_PHRASES;
}

/** Read the real contract from the installed @pellux/goodvibes-sdk. */
export function loadContractSnapshot(): PresentationContractSnapshot {
  return {
    glyphs: GLYPHS,
    stateGlyphs: STATE_GLYPHS,
    toneDark: TONE_TOKENS,
    toneLight: resolveTones("light"),
    spinnerFrames: SPINNER_FRAMES,
    thinkingPhrases: THINKING_PHRASES,
  };
}

/** camelCase -> kebab-case for CSS custom-property names. */
function cssIdent(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function cssStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// NOTE: the banner deliberately names the SDK's presentation contract without
// spelling out the platform subpath import specifier — scripts/check-boundaries.ts
// scans every line of src/ui/**/*.ts for that substring, comments included.
const GENERATED_BANNER = [
  "GENERATED FILE — DO NOT EDIT BY HAND.",
  "Produced by scripts/generate-presentation-tokens.ts from the SDK",
  "presentation contract (the platform presentation subpath of",
  "@pellux/goodvibes-sdk — the same tables the TUI, agent and webui render",
  "through, so states look identical across surfaces).",
  "",
  "This is a layer SEPARATE from src/ui/styles/tokens.css: tokens.css owns",
  "this app's own brand palette / layout / motion tokens; this file owns",
  "only the values the SDK contract actually defines — status glyphs and",
  "the state tone-color table.",
  "",
  "Regenerate: `bun run generate:presentation`.",
  "Verify (no write): `bun run generate:check` — wired into `bun run verify`,",
  "so a contract change that was not regenerated fails verification.",
].join("\n * ");

/** Strip trailing whitespace introduced by joining banner lines around blanks. */
function stripTrailingWhitespace(text: string): string {
  return text.replace(/[ \t]+$/gm, "");
}

export function renderCss(snapshot: PresentationContractSnapshot): string {
  const lines: string[] = [];
  lines.push(`/*\n * ${GENERATED_BANNER}\n */`);
  lines.push("");
  lines.push(":root {");
  lines.push("  /* Status glyphs — GLYPHS.status, quoted for `content:` use. All keys are");
  lines.push("   * emitted for parity with the TS mirror (one snapshot, not a hand-picked");
  lines.push("   * subset) so a component reaching for a more specific glyph than the");
  lines.push("   * 4-bucket STATE_GLYPHS alias never has to regenerate first. */");
  for (const [key, value] of Object.entries(snapshot.glyphs.status)) {
    lines.push(`  --contract-glyph-${cssIdent(key)}: ${cssStringLiteral(value)};`);
  }
  lines.push("");
  lines.push("  /* State tone colors — TONE_TOKENS.state (dark / default). Tint the glyph");
  lines.push("   * itself, never a component's overall background/text color: the app's own");
  lines.push("   * palette (tokens.css) is not repainted onto the contract's colors —");
  lines.push("   * glyphs, not colors, are the cross-surface parity mechanism. */");
  for (const [key, value] of Object.entries(snapshot.toneDark.state)) {
    lines.push(`  --contract-state-${cssIdent(key)}: ${value};`);
  }
  lines.push("}");
  lines.push("");
  lines.push("/* State tone colors — light-mode override (resolveTones('light')). */");
  lines.push(':root[data-theme="light"] {');
  for (const [key, value] of Object.entries(snapshot.toneLight.state)) {
    lines.push(`  --contract-state-${cssIdent(key)}: ${value};`);
  }
  lines.push("}");
  lines.push("");
  return stripTrailingWhitespace(lines.join("\n"));
}

export function renderTs(snapshot: PresentationContractSnapshot): string {
  const json = (value: unknown): string => JSON.stringify(value, null, 2);
  const text = [
    `/**\n * ${GENERATED_BANNER}\n *\n * Import from the UI's presentation bridge for the semantic mapping onto\n * app components; import from here directly only if you need the raw\n * contract shape.\n */`,
    "",
    `export const CONTRACT_GLYPHS = ${json(snapshot.glyphs)} as const;`,
    "",
    `export const CONTRACT_STATE_GLYPHS = ${json(snapshot.stateGlyphs)} as const;`,
    "",
    `export const CONTRACT_TONE_DARK = ${json(snapshot.toneDark)} as const;`,
    "",
    `export const CONTRACT_TONE_LIGHT = ${json(snapshot.toneLight)} as const;`,
    "",
    `export const CONTRACT_SPINNER_FRAMES = ${json(snapshot.spinnerFrames)} as const;`,
    "",
    `export const CONTRACT_THINKING_PHRASES = ${json(snapshot.thinkingPhrases)} as const;`,
    "",
    "/** The four contract severity buckets STATE_GLYPHS aliases onto. */",
    "export type ContractStatusState = keyof typeof CONTRACT_STATE_GLYPHS;",
    "",
  ].join("\n");
  return stripTrailingWhitespace(text);
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
    console.error(`[generate:presentation] drift: ${path}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  console.log(`[generate:presentation] wrote: ${path}`);
  return true;
}

if (import.meta.main) {
  const snapshot = loadContractSnapshot();
  let drifted = false;
  drifted = writeIfChanged(CSS_OUT_PATH, renderCss(snapshot), CHECK_ONLY) || drifted;
  drifted = writeIfChanged(TS_OUT_PATH, renderTs(snapshot), CHECK_ONLY) || drifted;

  if (CHECK_ONLY && drifted) {
    console.error("[generate:presentation] drift detected — run `bun run generate:presentation`");
    process.exit(1);
  }
  if (!drifted) {
    console.log("[generate:presentation] up-to-date");
  }
}
