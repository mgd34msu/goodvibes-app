// Display helpers + defensive parsers for checkpoints.* (ws-only methods over
// the /app/ws bridge). Ported from goodvibes-webui src/lib/checkpoints.ts,
// with wire-shape parsing added because this client reads `unknown` payloads.

import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";

export interface WorkspaceCheckpoint {
  id: string;
  label: string;
  kind: string;
  retentionClass: string;
  createdAt: number;
  sizeBytes: number | undefined;
  commit: string;
  parentId: string;
}

export function parseCheckpoint(value: unknown): WorkspaceCheckpoint {
  const record = asRecord(value);
  return {
    id: firstString(record, ["id", "checkpointId"]),
    label: firstString(record, ["label", "title", "name"]),
    kind: firstString(record, ["kind", "type"]),
    retentionClass: firstString(record, ["retentionClass", "retention"]),
    createdAt: firstNumber(record, ["createdAt", "created", "timestamp"]) ?? 0,
    sizeBytes: firstNumber(record, ["sizeBytes", "size"]),
    commit: firstString(record, ["commit", "sha", "oid"]),
    parentId: firstString(record, ["parentId", "parent"]),
  };
}

export function parseCheckpointList(value: unknown): WorkspaceCheckpoint[] {
  return firstArray(value, ["checkpoints", "items"])
    .map(parseCheckpoint)
    .filter((c) => c.id !== "");
}

export interface CheckpointDiffPayload {
  from: string;
  to: string;
  files: string[];
  unifiedDiff: string;
  stat: string;
}

export function parseCheckpointDiff(value: unknown): CheckpointDiffPayload {
  const record = asRecord(asRecord(value)["diff"] ?? value);
  return {
    from: firstString(record, ["from", "a"]),
    to: firstString(record, ["to", "b"]),
    files: firstArray(record, ["files", "paths"]).filter((f): f is string => typeof f === "string"),
    unifiedDiff: firstString(record, ["unifiedDiff", "diff", "patch"]),
    stat: firstString(record, ["stat", "summary"]),
  };
}

export function sortCheckpointsNewestFirst(checkpoints: readonly WorkspaceCheckpoint[]): WorkspaceCheckpoint[] {
  return [...checkpoints].sort((a, b) => b.createdAt - a.createdAt);
}

export function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * The exact honest wording for a create() response that reported noop:true
 * (tree identical to the most recent checkpoint — no commit, ref, or manifest
 * entry created). Never phrased as a failure.
 */
export const CHECKPOINT_NOOP_MESSAGE =
  "Nothing to snapshot — the workspace tree is unchanged since the last checkpoint.";
