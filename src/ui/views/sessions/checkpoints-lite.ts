// Minimal, tolerant readers for checkpoints.list / checkpoints.diff — just
// enough for the workspace-scoped FALLBACK inside SessionChanges (used only
// when sessions.changes.get is unavailable on the connected daemon). Kept
// local and deliberately small rather than importing views/code's
// checkpoints-model.ts: that file belongs to a different agent's working set
// this wave, so this view stays self-contained.

import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";

export interface CheckpointLite {
  id: string;
  label: string;
  kind: string;
  createdAt: number;
}

export function parseCheckpointListLite(value: unknown): CheckpointLite[] {
  return firstArray(value, ["checkpoints", "items"])
    .map((entry) => {
      const record = asRecord(entry);
      return {
        id: firstString(record, ["id", "checkpointId"]),
        label: firstString(record, ["label", "title", "name"]),
        kind: firstString(record, ["kind", "type"]),
        createdAt: firstNumber(record, ["createdAt", "created", "timestamp"]) ?? 0,
      };
    })
    .filter((c) => c.id !== "");
}

export function sortCheckpointsNewestFirst(checkpoints: readonly CheckpointLite[]): CheckpointLite[] {
  return [...checkpoints].sort((a, b) => b.createdAt - a.createdAt);
}

export interface CheckpointDiffLite {
  from: string;
  to: string;
  unifiedDiff: string;
}

export function parseCheckpointDiffLite(value: unknown): CheckpointDiffLite {
  const record = asRecord(asRecord(value)["diff"] ?? value);
  return {
    from: firstString(record, ["from", "a"]),
    to: firstString(record, ["to", "b"]),
    unifiedDiff: firstString(record, ["unifiedDiff", "diff", "patch"]),
  };
}
