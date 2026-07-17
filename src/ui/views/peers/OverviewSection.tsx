// Overview — remote.snapshot (docs/FEATURES.md §21 row 1). Renders the
// runtime health snapshot honestly: daemon transport, the ACP bridge, the
// sandbox/runner registry, the local supervisor, and the distributed
// counts (peers/pair requests/work) plus a recent-audit trail — there is no
// dedicated `remote.audit.*` list method, so this is the only place the
// audit trail is visible at all.

import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw, ScrollText } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { formatRelative, normalizeSnapshot, peersKeys, REMOTE_POLL_MS } from "./peers-model.ts";

function actionLabel(action: string): string {
  return action.replace(/-/g, " ");
}

export function OverviewSection() {
  const snapshot = useQuery({
    queryKey: peersKeys.snapshot,
    queryFn: () => gv.invoke("remote.snapshot"),
    refetchInterval: REMOTE_POLL_MS,
  });

  const unavailable = snapshot.isError && isMethodUnavailableError(snapshot.error);

  return (
    <section className="peers-section" aria-label="Remote runtime overview">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Activity size={14} aria-hidden="true" /> Overview
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh overview"
          onClick={() => void snapshot.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={snapshot.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {snapshot.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState
          capability="remote.snapshot"
          description="the remote runtime overview (daemon/ACP/registry/supervisor health, peer and work counts) cannot be loaded."
        />
      )}

      {snapshot.isError && !unavailable && (
        <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} title="Failed to load overview" />
      )}

      {snapshot.isSuccess &&
        (() => {
          const s = normalizeSnapshot(snapshot.data);
          const pendingRequests = s.pairRequests.filter((r) => r.status === "pending").length;
          const reachablePeers = s.peers.filter(
            (p) => p.status === "connected" || p.status === "idle" || p.status === "paired",
          ).length;
          const queuedWork = s.work.filter((w) => w.status === "queued" || w.status === "claimed").length;
          const recentAudit = [...s.audit].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 8);

          return (
            <>
              <div className="peers-overview-grid">
                <div className="peers-card">
                  <span className="peers-card__label">Daemon transport</span>
                  <StatusBadge value={s.daemon.transportState} />
                  <dl className="peers-card__facts">
                    <dt>Running</dt>
                    <dd>{s.daemon.isRunning === undefined ? "—" : s.daemon.isRunning ? "yes" : "no"}</dd>
                    <dt>Reconnect attempts</dt>
                    <dd>{s.daemon.reconnectAttempts ?? "—"}</dd>
                    <dt>Running jobs</dt>
                    <dd>{s.daemon.runningJobCount ?? "—"}</dd>
                    {s.daemon.lastError && (
                      <>
                        <dt>Last error</dt>
                        <dd className="peers-card__error">{s.daemon.lastError}</dd>
                      </>
                    )}
                  </dl>
                </div>

                <div className="peers-card">
                  <span className="peers-card__label">ACP bridge</span>
                  <StatusBadge value={s.acp.transportState} />
                  <dl className="peers-card__facts">
                    <dt>Active connections</dt>
                    <dd>{s.acp.activeConnectionIds.length}</dd>
                    <dt>Spawned</dt>
                    <dd>{s.acp.totalSpawned ?? "—"}</dd>
                    <dt>Failed</dt>
                    <dd>{s.acp.totalFailed ?? "—"}</dd>
                    {s.acp.lastError && (
                      <>
                        <dt>Last error</dt>
                        <dd className="peers-card__error">{s.acp.lastError}</dd>
                      </>
                    )}
                  </dl>
                </div>

                <div className="peers-card">
                  <span className="peers-card__label">Sandbox / runner registry</span>
                  <dl className="peers-card__facts">
                    <dt>Pools</dt>
                    <dd>{s.registry.pools ?? "—"}</dd>
                    <dt>Contracts</dt>
                    <dd>{s.registry.contracts ?? "—"}</dd>
                    <dt>Artifacts</dt>
                    <dd>{s.registry.artifacts ?? "—"}</dd>
                  </dl>
                </div>

                <div className="peers-card">
                  <span className="peers-card__label">Local supervisor</span>
                  <dl className="peers-card__facts">
                    <dt>Sessions</dt>
                    <dd>{s.supervisor.sessions ?? "—"}</dd>
                    <dt>Degraded</dt>
                    <dd>{s.supervisor.degraded ?? "—"}</dd>
                    <dt>Captured</dt>
                    <dd>{s.supervisor.capturedAt !== undefined ? formatRelative(s.supervisor.capturedAt) : "—"}</dd>
                  </dl>
                </div>

                <div className="peers-card peers-card--counts">
                  <span className="peers-card__label">Distributed runtime</span>
                  <dl className="peers-card__facts">
                    <dt>Peers</dt>
                    <dd>
                      {s.peers.length} total · {reachablePeers} reachable
                    </dd>
                    <dt>Pair requests</dt>
                    <dd>
                      {s.pairRequests.length} total · {pendingRequests} pending
                    </dd>
                    <dt>Work items</dt>
                    <dd>
                      {s.work.length} total · {queuedWork} queued/claimed
                    </dd>
                  </dl>
                </div>
              </div>

              <div className="peers-audit">
                <div className="peers-audit__head">
                  <ScrollText size={13} aria-hidden="true" /> Recent audit trail
                </div>
                {recentAudit.length === 0 ? (
                  <p className="peers-audit__empty" role="note">
                    No remote activity recorded yet — pairing, token, connection, and work events will appear here.
                  </p>
                ) : (
                  <ul className="peers-audit__list">
                    {recentAudit.map((entry) => (
                      <li key={entry.id} className="peers-audit__row">
                        <span className="peers-audit__action">{actionLabel(entry.action)}</span>
                        <span className="peers-audit__actor">{entry.actor || "system"}</span>
                        <span className="peers-audit__note" title={entry.note || undefined}>
                          {entry.note}
                        </span>
                        <span className="peers-audit__time">{formatRelative(entry.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          );
        })()}
    </section>
  );
}
