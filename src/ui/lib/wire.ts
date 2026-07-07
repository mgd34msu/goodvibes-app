// Defensive readers for wire payloads whose exact shape varies across daemon
// versions. Ported from goodvibes-webui src/lib/object.ts.

export type AnyRecord = Record<string, unknown>;

export function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    current = asRecord(current)[key];
  }
  return current;
}

export function firstString(value: unknown, keys: string[]): string {
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) return item;
    if (typeof item === "number") return String(item);
  }
  return "";
}

export function firstNumber(value: unknown, keys: string[]): number | undefined {
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "number" && Number.isFinite(item)) return item;
  }
  return undefined;
}

export function firstArray(value: unknown, keys: string[]): unknown[] {
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (Array.isArray(item)) return item;
  }
  return [];
}

export function firstArrayAtPath(value: unknown, paths: string[][]): unknown[] {
  if (Array.isArray(value)) return value;
  for (const path of paths) {
    const item = readPath(value, path);
    if (Array.isArray(item)) return item;
  }
  return [];
}

export function bestId(value: unknown): string {
  return firstString(value, [
    "id",
    "sessionId",
    "taskId",
    "approvalId",
    "providerId",
    "sourceId",
    "nodeId",
    "username",
    "modelId",
    "registryKey",
  ]);
}

export function bestTitle(value: unknown, fallback = "Untitled"): string {
  return (
    firstString(value, [
      "title",
      "name",
      "label",
      "displayName",
      "summary",
      "providerId",
      "modelId",
      "id",
      "registryKey",
    ]) || fallback
  );
}

export function bestStatus(value: unknown): string {
  return firstString(value, ["status", "state", "phase", "health", "authFreshness", "kind"]) || "unknown";
}

export function countFrom(value: unknown, keys: string[]): number {
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (Array.isArray(item)) return item.length;
    if (typeof item === "number") return item;
  }
  return 0;
}

export function formatRelative(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toLocaleString();
  if (typeof value === "string" && value.trim()) return value;
  return "unknown";
}

export function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
