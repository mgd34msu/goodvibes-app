// Node-host contract viewer — remote.node_host.contract (docs/FEATURES.md
// §21 row 5). Read-only: the daemon's own description of the peer wire
// protocol (transport, recommended heartbeat/work-pull intervals, scopes,
// endpoints). A collapsible summary is the default view; the full raw JSON
// is one <details> away for anyone who wants the exact schema.

import { useQuery } from "@tanstack/react-query";
import { FileJson, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { compactJson, normalizeContract, peersKeys, REMOTE_POLL_MS } from "./peers-model.ts";

export function NodeHostContractSection() {
  const query = useQuery({
    queryKey: peersKeys.contract,
    queryFn: () => gv.invoke("remote.node_host.contract"),
    refetchInterval: REMOTE_POLL_MS,
  });

  const unavailable = query.isError && isMethodUnavailableError(query.error);

  return (
    <section className="peers-section" aria-label="Node-host contract">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <FileJson size={14} aria-hidden="true" /> Node-host contract
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh contract"
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={query.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {query.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState
          capability="remote.node_host.contract"
          description="the peer wire-protocol contract (endpoints, scopes, recommended intervals) cannot be inspected."
        />
      )}

      {query.isError && !unavailable && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Failed to load contract" />
      )}

      {query.isSuccess &&
        (() => {
          const contract = normalizeContract(query.data);
          return (
            <div className="node-host-contract">
              <dl className="peer-detail__facts">
                <dt>Transport</dt>
                <dd>{contract.transport || "—"}</dd>
                <dt>Base path</dt>
                <dd>
                  <code>{contract.basePath || "—"}</code>
                </dd>
                {contract.schemaVersion !== undefined && (
                  <>
                    <dt>Schema version</dt>
                    <dd>{contract.schemaVersion}</dd>
                  </>
                )}
                {contract.recommendedHeartbeatMs !== undefined && (
                  <>
                    <dt>Recommended heartbeat</dt>
                    <dd>{Math.round(contract.recommendedHeartbeatMs / 1000)}s</dd>
                  </>
                )}
                {contract.recommendedWorkPullMs !== undefined && (
                  <>
                    <dt>Recommended work-pull</dt>
                    <dd>{Math.round(contract.recommendedWorkPullMs / 1000)}s</dd>
                  </>
                )}
              </dl>

              <div className="node-host-contract__tags">
                <span className="peer-detail__tags-label">Peer kinds</span>
                {contract.peerKinds.map((k) => (
                  <span key={k} className="badge neutral">
                    {k}
                  </span>
                ))}
              </div>
              <div className="node-host-contract__tags">
                <span className="peer-detail__tags-label">Work types</span>
                {contract.workTypes.map((t) => (
                  <span key={t} className="badge info">
                    {t}
                  </span>
                ))}
              </div>
              <div className="node-host-contract__tags">
                <span className="peer-detail__tags-label">Scopes</span>
                {contract.scopes.length === 0 ? (
                  <span className="peer-detail__note">none declared</span>
                ) : (
                  contract.scopes.map((s) => (
                    <span key={s} className="badge neutral">
                      {s}
                    </span>
                  ))
                )}
              </div>

              {contract.endpoints.length > 0 && (
                <div className="node-host-contract__endpoints">
                  <span className="peer-detail__tags-label">Endpoints ({contract.endpoints.length})</span>
                  <div className="node-host-contract__table-wrap">
                    <table className="node-host-contract__table">
                      <thead>
                        <tr>
                          <th>Method</th>
                          <th>Path</th>
                          <th>Auth</th>
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contract.endpoints.map((endpoint) => (
                          <tr key={endpoint.id}>
                            <td>{endpoint.method}</td>
                            <td>
                              <code>{endpoint.path}</code>
                            </td>
                            <td>{endpoint.auth}</td>
                            <td>{endpoint.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <details className="peer-detail__raw">
                <summary>Raw contract JSON</summary>
                <pre>{compactJson(contract.raw)}</pre>
              </details>
            </div>
          );
        })()}
    </section>
  );
}
