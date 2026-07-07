// Defensive readers + local query keys for the MCP view (docs/FEATURES.md §16).
// Shapes grounded in the pinned operator contract (operator-contract.json):
//   mcp.servers.list → { servers:[{name,connected}], security:[…], sandboxBindings:[…] }
//   mcp.tools.list   → { tools:[{qualifiedName,serverName,toolName,description}] }
//   mcp.config.get   → { locations:[{scope,kind,path,writable}], servers:[…] }
//   mcp.config.reload / servers.upsert / servers.remove → { reload:{added,changed,
//     removed,unchanged,servers:[{name,action,connected}]}, … }
// Local keys extend lib/queries.ts's ["mcp"] prefix so the `mcp` realtime
// domain invalidation (DOMAIN_INVALIDATIONS) fans out to every query here.

import { queryKeys } from "../../lib/queries.ts";
import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

export const mcpKeys = {
  root: queryKeys.mcp,
  servers: [...queryKeys.mcp, "servers"] as const,
  tools: [...queryKeys.mcp, "tools"] as const,
  config: [...queryKeys.mcp, "config"] as const,
} as const;

// ─── servers.list ────────────────────────────────────────────────────────────

export interface McpServerStatus {
  name: string;
  connected: boolean;
}

export function readServerStatuses(data: unknown): McpServerStatus[] {
  return asArray(asRecord(data)["servers"]).map((raw) => ({
    name: firstString(raw, ["name"]),
    connected: asRecord(raw)["connected"] === true,
  }));
}

export function readSecurityPosture(data: unknown): Record<string, unknown>[] {
  return asArray(asRecord(data)["security"]).map((raw) => asRecord(raw));
}

export function readSandboxBindings(data: unknown): Record<string, unknown>[] {
  return asArray(asRecord(data)["sandboxBindings"]).map((raw) => asRecord(raw));
}

// ─── tools.list ──────────────────────────────────────────────────────────────

export interface McpTool {
  qualifiedName: string;
  serverName: string;
  toolName: string;
  description: string;
}

export function readTools(data: unknown): McpTool[] {
  return asArray(asRecord(data)["tools"]).map((raw) => ({
    qualifiedName: firstString(raw, ["qualifiedName"]),
    serverName: firstString(raw, ["serverName"]),
    toolName: firstString(raw, ["toolName"]),
    description: firstString(raw, ["description"]),
  }));
}

// ─── config.get ──────────────────────────────────────────────────────────────

export interface McpConfigLocation {
  scope: string;
  kind: string;
  path: string;
  writable: boolean;
}

export interface McpConfiguredServer {
  name: string;
  command: string;
  args: string[];
  envKeys: string[];
  role: string | null;
  trustMode: string | null;
  allowedPaths: string[];
  allowedHosts: string[];
  source: McpConfigLocation | null;
}

function readLocation(raw: unknown): McpConfigLocation {
  const record = asRecord(raw);
  return {
    scope: firstString(record, ["scope"]),
    kind: firstString(record, ["kind"]),
    path: firstString(record, ["path"]),
    writable: record["writable"] === true,
  };
}

function readStringArray(value: unknown): string[] {
  return asArray(value).filter((v): v is string => typeof v === "string");
}

export function readConfigLocations(data: unknown): McpConfigLocation[] {
  return asArray(asRecord(data)["locations"]).map(readLocation);
}

export function readConfiguredServers(data: unknown): McpConfiguredServer[] {
  return asArray(asRecord(data)["servers"]).map((raw) => {
    const record = asRecord(raw);
    const role = record["role"];
    const trustMode = record["trustMode"];
    return {
      name: firstString(record, ["name"]),
      command: firstString(record, ["command"]),
      args: readStringArray(record["args"]),
      envKeys: readStringArray(record["envKeys"]),
      role: typeof role === "string" ? role : null,
      trustMode: typeof trustMode === "string" ? trustMode : null,
      allowedPaths: readStringArray(record["allowedPaths"]),
      allowedHosts: readStringArray(record["allowedHosts"]),
      source: record["source"] ? readLocation(record["source"]) : null,
    };
  });
}

// ─── reload summaries ────────────────────────────────────────────────────────

export interface ReloadSummary {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}

export function readReloadSummary(data: unknown): ReloadSummary | null {
  const reload = asRecord(asRecord(data)["reload"]);
  if (Object.keys(reload).length === 0) return null;
  return {
    added: firstNumber(reload, ["added"]) ?? 0,
    changed: firstNumber(reload, ["changed"]) ?? 0,
    removed: firstNumber(reload, ["removed"]) ?? 0,
    unchanged: firstNumber(reload, ["unchanged"]) ?? 0,
  };
}

export function formatReloadSummary(summary: ReloadSummary | null): string {
  if (!summary) return "Reload requested.";
  return `${summary.added} added · ${summary.changed} changed · ${summary.removed} removed · ${summary.unchanged} unchanged`;
}

// ─── upsert draft validation (JSON-shape editor) ─────────────────────────────

export interface ServerDraft {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  role?: string | null;
  trustMode?: string | null;
  allowedPaths?: string[];
  allowedHosts?: string[];
}

/**
 * Validate a parsed JSON object against the mcp.servers.upsert `server` input
 * shape (contract-grounded). Returns the typed draft or a list of problems.
 */
export function validateServerDraft(value: unknown): { draft: ServerDraft; errors: [] } | { draft: null; errors: string[] } {
  const errors: string[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { draft: null, errors: ["Top level must be a JSON object."] };
  }
  const record = value as Record<string, unknown>;

  const name = record["name"];
  if (typeof name !== "string" || !name.trim()) errors.push('"name" is required and must be a non-empty string.');
  const command = record["command"];
  if (typeof command !== "string" || !command.trim()) errors.push('"command" is required and must be a non-empty string.');

  for (const key of ["args", "allowedPaths", "allowedHosts", "envKeys"] as const) {
    const item = record[key];
    if (item !== undefined && (!Array.isArray(item) || item.some((v) => typeof v !== "string"))) {
      errors.push(`"${key}" must be an array of strings.`);
    }
  }
  const env = record["env"];
  if (env !== undefined && (env === null || typeof env !== "object" || Array.isArray(env))) {
    errors.push('"env" must be an object of string values.');
  }
  for (const key of ["role", "trustMode"] as const) {
    const item = record[key];
    if (item !== undefined && item !== null && typeof item !== "string") {
      errors.push(`"${key}" must be a string or null.`);
    }
  }

  const known = new Set(["name", "command", "args", "env", "envKeys", "role", "trustMode", "allowedPaths", "allowedHosts"]);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) errors.push(`Unknown field "${key}" (the contract rejects extra server fields).`);
  }

  if (errors.length > 0) return { draft: null, errors };
  return { draft: record as unknown as ServerDraft, errors: [] };
}

/** Editor template for a new server registration. */
export const SERVER_DRAFT_TEMPLATE = `{
  "name": "my-server",
  "command": "bunx",
  "args": ["my-mcp-server", "--stdio"],
  "env": {},
  "role": null,
  "trustMode": null,
  "allowedPaths": [],
  "allowedHosts": []
}`;
