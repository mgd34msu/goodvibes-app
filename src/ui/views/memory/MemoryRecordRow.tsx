// One record row: summary + cls/scope/review-state/confidence badges +
// optional semantic-similarity chip + delete. Never renders `detail` here
// (that is the peek's job) — the list stays scannable. Ported from
// goodvibes-webui views/memory/MemoryRecordRow.tsx.

import { Trash2 } from "lucide-react";
import {
  formatConfidence,
  formatSimilarity,
  isBelowRecallFloor,
  reviewStateTone,
  type MemoryRecord,
} from "./memory-wire.ts";

interface MemoryRecordRowProps {
  record: MemoryRecord;
  /** The wire recall floor the search that produced this record ran against —
   * undefined (older daemon) makes no below-floor claim. */
  recallFloor: number | undefined;
  /** Semantic similarity (0..1) from memory.records.search-semantic, when the
   * semantic overlay ran. */
  similarity?: number;
  onOpen: (record: MemoryRecord) => void;
  onDelete: (record: MemoryRecord) => void;
  deleting?: boolean;
}

export function MemoryRecordRow({
  record,
  recallFloor,
  similarity,
  onOpen,
  onDelete,
  deleting = false,
}: MemoryRecordRowProps) {
  const tone = reviewStateTone(record.reviewState);
  const belowFloor = isBelowRecallFloor(record, recallFloor);

  return (
    <div className="memory-record-row">
      <button type="button" className="memory-record-row__main" onClick={() => onOpen(record)}>
        <strong className="memory-record-row__summary">{record.summary}</strong>
        <span className="memory-record-row__meta">
          <span className="badge neutral">{record.cls}</span>
          <span className="badge neutral">{record.scope}</span>
          <span className={`badge ${tone}`}>{record.reviewState}</span>
          <span
            className={`badge ${belowFloor ? "warning" : "neutral"}`}
            title={
              belowFloor
                ? `Below the ${recallFloor}% recall floor — never injected into a prompt`
                : undefined
            }
          >
            {formatConfidence(record.confidence)}
          </span>
          {similarity !== undefined && <span className="badge info">{formatSimilarity(similarity)}</span>}
          {record.tags.map((tag) => (
            <span key={tag} className="memory-tag-chip">
              {tag}
            </span>
          ))}
        </span>
      </button>
      <button
        type="button"
        className="memory-record-row__delete"
        title={deleting ? "Deleting…" : `Delete "${record.summary}" permanently`}
        aria-label={`Delete ${record.summary}`}
        disabled={deleting}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(record);
        }}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
