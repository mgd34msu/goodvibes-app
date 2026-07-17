// Memory governor — ops.memory.get. Crib: goodvibes-webui
// src/components/settings/MemoryDiagnostics.tsx — same tier badge / budget
// bar / per-cache table / paused-jobs list / tripwire line, ported onto this
// app's query client + feedback kit.
//
// OPS_MEMORY_PRESSURE rides the same "ops" wire domain as
// OPS_POWER_STATE_CHANGED, but lib/realtime.ts's DOMAIN_INVALIDATIONS has no
// "ops" entry yet — this polls sparsely as a fallback (integration-gate
// note) rather than inventing a subscription this view doesn't own.

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { isMethodNotInvokableError, isMethodUnavailableError } from "../../lib/errors.ts";
import { compactJson } from "../../lib/wire.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { formatBytesOrDash, formatMb, memoryTierBadgeClass, memoryTierLabel, readMemorySnapshot, tripwireLine } from "./obs-wire.ts";

export function MemoryPanel() {
  const memory = useQuery({
    queryKey: queryKeys.opsMemory,
    queryFn: () => gv.ops.memory(),
    refetchInterval: 30_000,
    retry: false,
  });

  // A daemon that never heard of ops.memory.get (404) and a build that
  // cataloged it with no MemoryGovernor wired (501) both render the same
  // honest "not served" state.
  const unavailable =
    memory.isError && (isMethodUnavailableError(memory.error) || isMethodNotInvokableError(memory.error));

  return (
    <section className="obs-subsection">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">Memory governor</span>
        <button
          type="button"
          className="obs-btn"
          aria-label="Refresh memory governor state"
          onClick={() => void memory.refetch()}
        >
          <RefreshCw size={14} aria-hidden="true" className={memory.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      {memory.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState
          capability="ops.memory.get"
          description="this daemon build has no memory-governance observability endpoint."
        />
      )}

      {memory.isError && !unavailable && (
        <ErrorState error={memory.error} onRetry={() => void memory.refetch()} title="Failed to load memory governor state" />
      )}

      {memory.isSuccess &&
        (() => {
          const snap = readMemorySnapshot(memory.data);
          const tone = memoryTierBadgeClass(snap.tier);
          return (
            <>
              <div className="obs-memory__tier-row">
                <span className={`badge ${tone}`}>{memoryTierLabel(snap.tier)}</span>
                {snap.refusingExpensiveWork && (
                  <span className="obs-power__note" role="note">
                    Refusing expensive work while under pressure.
                  </span>
                )}
              </div>

              <div className="obs-memory__bar-row">
                <div className="obs-memory__bar-label">
                  <span>
                    {formatMb(snap.rssMb)} of {formatMb(snap.budgetMb)} budget
                  </span>
                  <span>{Math.round(snap.usedPct)}%</span>
                </div>
                <div
                  className="obs-memory__bar-track"
                  role="progressbar"
                  aria-label="Memory used vs budget"
                  aria-valuenow={Math.round(snap.clampedUsedPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`obs-memory__bar-fill obs-memory__bar-fill--${snap.tier}`}
                    style={{ width: `${snap.clampedUsedPct}%` }}
                  />
                </div>
                <p className="obs-power__note">
                  Heap {formatMb(snap.heapUsedMb)}
                  {snap.heapTotalMb !== undefined ? ` of ${formatMb(snap.heapTotalMb)}` : ""}
                </p>
              </div>

              <div className="obs-table-wrap">
                <table className="obs-table">
                  <caption className="obs-power__note">Per-cache footprint</caption>
                  <thead>
                    <tr>
                      <th>Cache</th>
                      <th>Entries</th>
                      <th>Bytes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.caches.length === 0 && (
                      <tr>
                        <td colSpan={3}>No caches reported.</td>
                      </tr>
                    )}
                    {snap.caches.map((cache) => (
                      <tr key={cache.id}>
                        <td>{cache.name}</td>
                        <td>{cache.entries ?? "—"}</td>
                        <td>{formatBytesOrDash(cache.estimatedBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {snap.pausedJobs.length > 0 ? (
                <div>
                  <strong>Paused jobs</strong>
                  <ul className="obs-simple-rows">
                    {snap.pausedJobs.map((job) => (
                      <li key={job} className="obs-simple-row">
                        {job}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="obs-power__note">No deferrable jobs currently paused.</p>
              )}

              <p
                className={
                  snap.tripwire.armed ? "obs-memory__tripwire obs-memory__tripwire--armed" : "obs-memory__tripwire"
                }
                role="status"
              >
                {tripwireLine(snap.tripwire)}
              </p>

              <details className="obs-raw-panel">
                <summary>Raw ops.memory.get payload</summary>
                <pre>{compactJson(memory.data)}</pre>
              </details>
            </>
          );
        })()}
    </section>
  );
}
