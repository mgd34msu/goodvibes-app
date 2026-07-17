// Review queue (memory.review-queue → memory.records.update-review).
// Each row keeps its own DRAFT reviewState/confidence/staleReason — nothing
// is committed until the operator explicitly saves. Approve/stale/contradicted
// quick actions preset the draft; stale/contradicted require a reason before
// save enables (flagging a record excludes it from prompt recall outright, so
// the "why" must be recorded). Ported and extended from goodvibes-webui
// views/memory/ReviewQueuePanel.tsx.

import { useState, type FormEvent } from "react";
import { ClipboardList } from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import {
  MEMORY_REVIEW_STATES,
  formatConfidence,
  isFlaggedReviewState,
  reviewStateTone,
  type MemoryRecord,
  type MemoryReviewState,
} from "./memory-wire.ts";

export interface MemoryReviewDraft {
  state: MemoryReviewState;
  confidence: number;
  staleReason?: string;
}

// ─── Shared review form (also embedded in the record peek) ───────────────────

interface MemoryReviewFormProps {
  record: MemoryRecord;
  saving: boolean;
  onSave: (input: MemoryReviewDraft) => void;
}

export function MemoryReviewForm({ record, saving, onSave }: MemoryReviewFormProps) {
  const knownState = (MEMORY_REVIEW_STATES as readonly string[]).includes(record.reviewState)
    ? (record.reviewState as MemoryReviewState)
    : "fresh";
  const [state, setState] = useState<MemoryReviewState>(knownState);
  const [confidence, setConfidence] = useState(record.confidence);
  const [staleReason, setStaleReason] = useState(record.staleReason ?? "");
  const flagged = isFlaggedReviewState(state);
  const reasonMissing = flagged && !staleReason.trim();

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving || reasonMissing) return;
    onSave({
      state,
      confidence: Math.max(0, Math.min(100, confidence)),
      ...(flagged && staleReason.trim() ? { staleReason: staleReason.trim() } : {}),
    });
  }

  return (
    <form className="memory-review-form" onSubmit={submit}>
      <div className="memory-review-form__quick" role="group" aria-label={`Quick review for ${record.summary}`}>
        <button
          type="button"
          className={`memory-chip-button${state === "reviewed" ? " memory-chip-button--active" : ""}`}
          onClick={() => setState("reviewed")}
        >
          Approve
        </button>
        <button
          type="button"
          className={`memory-chip-button${state === "stale" ? " memory-chip-button--active" : ""}`}
          onClick={() => setState("stale")}
        >
          Mark stale
        </button>
        <button
          type="button"
          className={`memory-chip-button${state === "contradicted" ? " memory-chip-button--active" : ""}`}
          onClick={() => setState("contradicted")}
        >
          Contradicted
        </button>
      </div>
      <div className="memory-review-form__fields">
        <label>
          Review state
          <select
            value={state}
            aria-label={`Review state for ${record.summary}`}
            onChange={(event) => setState(event.target.value as MemoryReviewState)}
          >
            {MEMORY_REVIEW_STATES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          Confidence
          <input
            type="number"
            min={0}
            max={100}
            value={confidence}
            aria-label={`Confidence for ${record.summary}`}
            onChange={(event) => setConfidence(Number(event.target.value))}
          />
        </label>
      </div>
      {flagged && (
        <label className="memory-review-form__reason">
          Reason (required for flagged states)
          <input
            value={staleReason}
            placeholder="Why is this stale/contradicted?"
            aria-label={`Reason for flagging ${record.summary}`}
            onChange={(event) => setStaleReason(event.target.value)}
          />
        </label>
      )}
      <button className="memory-button" type="submit" disabled={saving || reasonMissing} aria-busy={saving}>
        {saving ? "Saving…" : "Save review"}
      </button>
    </form>
  );
}

// ─── Queue panel ──────────────────────────────────────────────────────────────

interface ReviewQueuePanelProps {
  records: readonly MemoryRecord[];
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  savingId: string | null;
  onSave: (id: string, input: MemoryReviewDraft) => void;
  onOpen: (record: MemoryRecord) => void;
  /** Ids to visually highlight — the consolidation "Review" jump lands here
   * via scroll + highlight, never a filter. */
  highlightedIds?: ReadonlySet<string>;
}

export function ReviewQueuePanel({
  records,
  isPending,
  error,
  onRetry,
  savingId,
  onSave,
  onOpen,
  highlightedIds,
}: ReviewQueuePanelProps) {
  if (isPending) {
    return (
      <div className="memory-skeleton-group">
        <SkeletonBlock width="100%" height={40} />
        <SkeletonBlock width="100%" height={40} />
      </div>
    );
  }

  if (error) {
    if (isMethodUnavailableError(error)) {
      return (
        <UnavailableState
          capability="memory.review-queue"
          description="records prioritised for review cannot be listed here."
        />
      );
    }
    return <ErrorState error={error} onRetry={onRetry} title="Review queue unavailable" />;
  }

  if (!records.length) {
    return (
      <EmptyState
        icon={<ClipboardList size={24} aria-hidden="true" />}
        title="Nothing waiting for review"
        description="Records the store prioritises for review appear here."
      />
    );
  }

  return (
    <ul className="memory-review-queue">
      {records.map((record) => {
        const highlighted = highlightedIds?.has(record.id) ?? false;
        return (
          <li
            key={record.id}
            id={`memory-review-row-${record.id}`}
            className={highlighted ? "memory-review-row memory-review-row--highlighted" : "memory-review-row"}
          >
            <button type="button" className="memory-review-row__summary" onClick={() => onOpen(record)}>
              <strong>{record.summary}</strong>
              <span className="memory-review-row__meta">
                <span className="badge neutral">{record.cls}</span>
                <span className="badge neutral">{record.scope}</span>
                <span className={`badge ${reviewStateTone(record.reviewState)}`}>current: {record.reviewState}</span>
                <span className="badge neutral">{formatConfidence(record.confidence)}</span>
              </span>
            </button>
            <MemoryReviewForm
              record={record}
              saving={savingId === record.id}
              onSave={(input) => onSave(record.id, input)}
            />
          </li>
        );
      })}
    </ul>
  );
}
