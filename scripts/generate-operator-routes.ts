#!/usr/bin/env bun
// generate-operator-routes.ts
//
// Snapshots the installed operator contract (@pellux/goodvibes-sdk
// contracts/operator-contract.json — all 327 methods with their HTTP routes
// and flags) into a browser-legal generated module the UI data layer routes
// calls through:
//
//   src/ui/lib/generated/operator-routes.ts
//
// Each entry keeps the raw {param} placeholders in `path` (e.g.
// "/api/approvals/{approvalId}/approve"); `ws: true` marks WS-only methods
// (no HTTP transport — httpMethod/path are null and the call must go over
// the /app/ws bridge).
//
// Output is deterministic (sorted by method id) so regeneration is
// diff-stable. `--check` exits 1 on drift without writing — wired into
// `bun run verify` so a contract bump that was not regenerated fails fast.
//
// Usage:
//   bun scripts/generate-operator-routes.ts          # write/update
//   bun scripts/generate-operator-routes.ts --check  # exit 1 on drift

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");

export const OUT_PATH = resolve(ROOT, "src/ui/lib/generated/operator-routes.ts");

// Minimal slice of the contract artifact shape we consume (verified against
// the installed sdk 1.3.1 artifact: operator.methods[] entries carry id,
// access, transport[], optional http{method,path} and optional dangerous).
interface ContractMethod {
  id: string;
  access: string;
  transport: readonly string[];
  http?: { method: string; path: string } | null;
  dangerous?: boolean | null;
}

interface OperatorContractJson {
  version: number;
  product: { id: string; surface: string; version: string };
  operator: { methods: ContractMethod[] };
}

export interface OperatorRouteRow {
  id: string;
  httpMethod: string | null;
  path: string | null;
  ws: boolean;
  dangerous: boolean;
  access: string;
}

export async function loadContract(): Promise<OperatorContractJson> {
  const mod = await import("@pellux/goodvibes-sdk/contracts/operator-contract.json");
  return mod.default as unknown as OperatorContractJson;
}

export function toRows(contract: OperatorContractJson): OperatorRouteRow[] {
  return contract.operator.methods
    .map((m): OperatorRouteRow => {
      const http = m.http ?? null;
      return {
        id: m.id,
        httpMethod: http?.method ?? null,
        path: http?.path ?? null,
        // WS-only: reachable exclusively over the websocket call transport.
        ws: http === null && m.transport.includes("ws"),
        dangerous: m.dangerous === true,
        access: m.access,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function renderModule(contract: OperatorContractJson, rows: OperatorRouteRow[]): string {
  const lines: string[] = [];
  lines.push("// GENERATED FILE — DO NOT EDIT BY HAND.");
  lines.push("// Produced by scripts/generate-operator-routes.ts from the installed");
  lines.push("// @pellux/goodvibes-sdk contracts/operator-contract.json artifact");
  lines.push(
    `// (contract v${contract.version}, ${contract.product.id} ${contract.product.surface} ${contract.product.version}, ${rows.length} methods).`,
  );
  lines.push("// `path` keeps {param} placeholders; `ws: true` = WS-only method (no HTTP");
  lines.push("// route — call it over the /app/ws bridge). Regenerate: `bun run generate:routes`.");
  lines.push("");
  lines.push("export interface OperatorRoute {");
  lines.push("  id: string;");
  lines.push("  httpMethod: string | null;");
  lines.push("  path: string | null;");
  lines.push("  ws: boolean;");
  lines.push("  dangerous: boolean;");
  lines.push("  access: string;");
  lines.push("}");
  lines.push("");
  lines.push("export const OPERATOR_ROUTES: Readonly<Record<string, OperatorRoute>> = {");
  for (const row of rows) {
    const parts = [
      `id: ${JSON.stringify(row.id)}`,
      `httpMethod: ${row.httpMethod === null ? "null" : JSON.stringify(row.httpMethod)}`,
      `path: ${row.path === null ? "null" : JSON.stringify(row.path)}`,
      `ws: ${row.ws}`,
      `dangerous: ${row.dangerous}`,
      `access: ${JSON.stringify(row.access)}`,
    ];
    lines.push(`  ${JSON.stringify(row.id)}: { ${parts.join(", ")} },`);
  }
  lines.push("};");
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
    console.error(`[generate:routes] drift: ${path}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  console.log(`[generate:routes] wrote: ${path}`);
  return true;
}

if (import.meta.main) {
  const contract = await loadContract();
  const rows = toRows(contract);
  const drifted = writeIfChanged(OUT_PATH, renderModule(contract, rows), CHECK_ONLY);
  if (CHECK_ONLY && drifted) {
    console.error("[generate:routes] drift detected — run `bun run generate:routes`");
    process.exit(1);
  }
  if (!drifted) {
    console.log("[generate:routes] up-to-date");
  }
}
