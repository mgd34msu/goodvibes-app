// Projections — the LIVE markdown projection of standing (project/team-scope)
// memory records (memory.projections.list/get). This is the same standing
// memory the file projection writes as markdown, computed from the store on
// every call — never read from disk, never cached — so opening one always
// shows the current record, not a stale snapshot.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Layers } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import {
  formatConfidence,
  memoryKeys,
  parseMemoryProjectionDetail,
  parseMemoryProjections,
  projectionStatusTone,
  type MemoryProjectionMeta,
} from "./memory-wire.ts";

function ProjectionDetail({ id }: { id: string }) {
  const detail = useQuery({
    queryKey: memoryKeys.projection(id),
    queryFn: async () => parseMemoryProjectionDetail(await gv.memory.projections.get(id)),
    retry: false,
  });

  if (detail.isPending) return <SkeletonBlock variant="text" lines={6} />;
  if (detail.isError) {
    if (isMethodUnavailableError(detail.error)) {
      return (
        <UnavailableState
          capability="memory.projections.get"
          description="this projection cannot be opened here."
        />
      );
    }
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="Failed to load projection" />;
  }
  if (!detail.data) {
    return <p className="memory-record-detail__none">No standing record with this id exists (session-scope records have no projection).</p>;
  }

  return (
    <div className="projection-detail">
      <p className="projection-detail__live-note" role="note">
        Live — recomputed from the store on every open, never a cached file.
      </p>
      <div className="reg-form__preview projection-detail__markdown">
        <MarkdownMessage content={detail.data.markdown} />
      </div>
    </div>
  );
}

export function ProjectionsPanel() {
  const peek = usePeek();

  const list = useQuery({
    queryKey: memoryKeys.projections,
    queryFn: async () => parseMemoryProjections(await gv.memory.projections.list()),
    // No wire event for memory.* — poll while mounted.
    refetchInterval: 30_000,
    retry: false,
  });

  const [openId, setOpenId] = useState<string | null>(null);

  function openProjection(entry: MemoryProjectionMeta): void {
    setOpenId(entry.id);
    peek.open({ title: entry.summary || entry.filename, content: <ProjectionDetail id={entry.id} /> });
  }

  const unavailable = list.isError && isMethodUnavailableError(list.error);

  return (
    <section className="memory-panel memory-panel--projections" aria-label="Memory projections">
      <div className="memory-panel__title">
        <h2>Projections</h2>
        <Layers size={16} aria-hidden="true" />
        {list.isSuccess && <span className="badge neutral">{list.data.length}</span>}
      </div>
      <p className="memory-learning-review__note">
        Standing-memory (project/team-scope) markdown, one file per record. Opening a projection fetches it live from
        the store — session-scope records have no projection here.
      </p>

      {list.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState
          capability="memory.projections.list"
          description="standing-memory projections cannot be listed here."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load projections" />
      )}

      {list.isSuccess && list.data.length === 0 && (
        <EmptyState
          icon={<FileText size={24} aria-hidden="true" />}
          title="No standing-memory projections yet"
          description="A projection appears once a memory record is promoted to project or team scope."
        />
      )}

      {list.isSuccess && list.data.length > 0 && (
        <ul className="projections-list">
          {list.data.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={openId === entry.id ? "projection-row projection-row--active" : "projection-row"}
                onClick={() => openProjection(entry)}
              >
                <span className="projection-row__summary">{entry.summary}</span>
                <span className="projection-row__meta">
                  <span className="badge neutral">{entry.scope}</span>
                  <span className="badge neutral">{entry.cls}</span>
                  <span className={`badge ${projectionStatusTone(entry.status)}`}>{entry.status}</span>
                  <span className="badge neutral">{formatConfidence(entry.confidence)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
