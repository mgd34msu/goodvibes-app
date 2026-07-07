// Coding/Dev snapshot tiles (docs/FEATURES.md §15 rows 8/12; docs/GAPS.md
// top-10 gap #3): read-only `intelligence.snapshot` (LSP/tree-sitter/
// diagnostics posture) and `review.snapshot` (API-surface + counts). Neither
// method has a wire event, so each tile polls gently while the Git view is
// mounted, plus a manual refresh button (matches checkpoints/worktrees
// idiom). No mutation surface — these are inspection-only per docs/FEATURES.md
// ("read-only; full control room excluded").

import { useQuery } from "@tanstack/react-query";
import { Activity, ClipboardList, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  normalizeIntelligenceSnapshot,
  normalizeReviewSnapshot,
  statusTone,
} from "./dev-snapshots-model.ts";

const TILE_POLL_MS = 30_000; // neither method emits a wire event — targeted poll while visible

const devSnapshotKeys = {
  intelligence: ["code", "intelligence", "snapshot"] as const,
  review: ["code", "review", "snapshot"] as const,
} as const;

export function DevSnapshotsPanel() {
  return (
    <section className="dev-snapshots" aria-label="Coding intelligence and review snapshots">
      <IntelligenceTile />
      <ReviewTile />
    </section>
  );
}

function IntelligenceTile() {
  const query = useQuery({
    queryKey: devSnapshotKeys.intelligence,
    queryFn: () => gv.invoke("intelligence.snapshot"),
    refetchInterval: TILE_POLL_MS,
    retry: false,
  });

  const unavailable = query.isError && isMethodUnavailableError(query.error);

  return (
    <div className="dev-snapshot-tile" aria-label="Intelligence snapshot">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Activity size={14} aria-hidden="true" /> Intelligence
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh intelligence snapshot"
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={query.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {query.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState
          capability="intelligence.snapshot"
          description="LSP/tree-sitter posture (diagnostics, symbol search, completions, hover) cannot be read from this daemon."
        />
      )}

      {query.isError && !unavailable && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Failed to load intelligence snapshot" />
      )}

      {query.isSuccess &&
        (() => {
          const snap = normalizeIntelligenceSnapshot(query.data);
          const rows: Array<[string, string]> = [
            ["Diagnostics", snap.diagnosticsStatus],
            ["Symbol search", snap.symbolSearchStatus],
            ["Completions", snap.completionsStatus],
            ["Hover", snap.hoverStatus],
          ];
          return (
            <>
              <dl className="dev-snapshot-tile__facts">
                {rows.map(([label, status]) => (
                  <div key={label} className="dev-snapshot-tile__fact-row">
                    <dt>{label}</dt>
                    <dd>
                      <span className={`badge ${statusTone(status)}`}>{status}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="dev-snapshot-tile__counts">
                <span className="dev-snapshot-tile__count">
                  <strong>{snap.errorCount}</strong> error{snap.errorCount === 1 ? "" : "s"}
                </span>
                <span className="dev-snapshot-tile__count">
                  <strong>{snap.warningCount}</strong> warning{snap.warningCount === 1 ? "" : "s"}
                </span>
                <span className="dev-snapshot-tile__count">
                  <strong>{snap.totalRequests}</strong> request{snap.totalRequests === 1 ? "" : "s"}
                </span>
                <span className="dev-snapshot-tile__count">
                  avg <strong>{snap.avgLatencyMs.toFixed(1)}</strong>ms
                </span>
              </div>
            </>
          );
        })()}
    </div>
  );
}

function ReviewTile() {
  const query = useQuery({
    queryKey: devSnapshotKeys.review,
    queryFn: () => gv.invoke("review.snapshot"),
    refetchInterval: TILE_POLL_MS,
    retry: false,
  });

  const unavailable = query.isError && isMethodUnavailableError(query.error);

  return (
    <div className="dev-snapshot-tile" aria-label="Review snapshot">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <ClipboardList size={14} aria-hidden="true" /> Review
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh review snapshot"
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={query.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {query.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState
          capability="review.snapshot"
          description="the API-family/route/session-count review summary cannot be read from this daemon."
        />
      )}

      {query.isError && !unavailable && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Failed to load review snapshot" />
      )}

      {query.isSuccess &&
        (() => {
          const snap = normalizeReviewSnapshot(query.data);
          const counts: Array<[string, number]> = [
            ["Sessions", snap.sessions],
            ["Tasks", snap.tasks],
            ["Pending approvals", snap.pendingApprovals],
            ["Remote contracts", snap.remoteContracts],
            ["Panels", snap.panels],
          ];
          return (
            <>
              <div className="dev-snapshot-tile__counts">
                {counts.map(([label, count]) => (
                  <span key={label} className="dev-snapshot-tile__count">
                    <strong>{count}</strong> {label.toLowerCase()}
                  </span>
                ))}
              </div>
              <div className="dev-snapshot-tile__tags">
                <span className="peer-detail__tags-label">API families ({snap.apiFamilies.length})</span>
                {snap.apiFamilies.length === 0 ? (
                  <span className="dev-snapshot-tile__note">none reported</span>
                ) : (
                  snap.apiFamilies.map((f) => (
                    <span key={f} className="badge neutral">
                      {f}
                    </span>
                  ))
                )}
              </div>
              {snap.routes.length > 0 && (
                <details className="dev-snapshot-tile__routes">
                  <summary>Routes ({snap.routes.length})</summary>
                  <ul>
                    {snap.routes.map((route) => (
                      <li key={route}>
                        <code>{route}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          );
        })()}
    </div>
  );
}
