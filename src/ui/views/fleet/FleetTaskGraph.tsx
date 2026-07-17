// FleetTaskGraph — the fix-phase task graph for one workstream
// (fleet.graph.get, operator contract 1.11), rendered in the workstream
// detail pane.
//
// Deliberately a VERTICAL LIST, not a node-link diagram — every state tell
// (ready/running/blocked/at-cap/stalled) is expressible as text + a badge,
// and a diagram earns its complexity only once this list stops being
// legible, which it is not.
//
// fleet.graph.get has no wire event — this is fetch-once (no poll) + a
// manual refresh button, matching the rest of this app's fleet.*-domain
// views (docs/UX.md §6: poll only while relevant, else fetch-once +
// invalidate-on-mutation — a task graph has no mutation this app drives, so
// "invalidate" here is just the refresh button).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { contractStateForBadgeTone } from "../../lib/presentation-bridge.ts";
import {
  dependencyTitlesForNode,
  graphNodeStateLabel,
  graphNodeStateTone,
  isKnownGraphNodeState,
  normalizeFleetGraph,
  poolSummaryLabel,
  type FleetGraphNode,
} from "./fleet-graph.ts";

function GraphNodeRow({ node, dependsOn }: { node: FleetGraphNode; dependsOn: readonly string[] }) {
  const tone = graphNodeStateTone(node.state);
  return (
    <li className="fleet-graph-node">
      <div className="fleet-graph-node__head">
        <span className="fleet-graph-node__title">{node.title}</span>
        <span
          className={`badge ${tone}`}
          data-contract-state={contractStateForBadgeTone(tone)}
          title={isKnownGraphNodeState(node.state) ? undefined : "State not known to this client — shown verbatim"}
        >
          {graphNodeStateLabel(node.state)}
        </span>
        {node.stalled && <span className="badge warning">Stalled</span>}
      </div>
      {node.blockedReason && <p className="fleet-graph-node__blocked">{node.blockedReason}</p>}
      {dependsOn.length > 0 && (
        <p className="fleet-graph-node__deps">Depends on {dependsOn.join(", ")}</p>
      )}
      {node.files.length > 0 && <p className="fleet-graph-node__files">{node.files.join(", ")}</p>}
      {node.orphaned && (
        <p className="fleet-graph-node__orphaned" role="note">
          Orphaned — the daemon can no longer place this node in the graph's structure.
        </p>
      )}
    </li>
  );
}

export function FleetTaskGraph({ workstreamId }: { workstreamId: string }) {
  const graph = useQuery({
    queryKey: queryKeys.fleetGraph(workstreamId),
    queryFn: async () => normalizeFleetGraph(await gv.fleet.graph.get(workstreamId)),
    enabled: Boolean(workstreamId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const nodesById = useMemo(
    () => new Map((graph.data?.nodes ?? []).map((n) => [n.id, n] as const)),
    [graph.data],
  );

  return (
    <section className="fleet-task-graph" aria-label="Task graph">
      <div className="fleet-task-graph__head">
        <h3>
          <GitBranch size={14} aria-hidden="true" /> Task graph
        </h3>
        <button
          type="button"
          className="fleet-icon-button"
          title="Refresh task graph"
          aria-label="Refresh task graph"
          disabled={graph.isFetching}
          onClick={() => void graph.refetch()}
        >
          <RefreshCw size={13} className={graph.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {graph.isPending && <SkeletonBlock variant="text" lines={3} />}

      {graph.isError && isMethodUnavailableError(graph.error) && (
        <UnavailableState capability="fleet.graph.get" description="this daemon cannot report a workstream's task graph" />
      )}
      {graph.isError && !isMethodUnavailableError(graph.error) && (
        <ErrorState error={graph.error} title="Task graph unavailable" onRetry={() => void graph.refetch()} />
      )}

      {graph.isSuccess && (
        <>
          {graph.data.pool && (
            <p className="fleet-task-graph__pool">
              {poolSummaryLabel(graph.data.pool)}
              {graph.data.pool.refusal ? ` — ${graph.data.pool.refusal}` : ""}
            </p>
          )}
          {graph.data.nodes.length === 0 ? (
            <p className="fleet-task-graph__empty">No task-graph nodes yet.</p>
          ) : (
            <ul className="fleet-graph-nodes">
              {graph.data.nodes.map((node) => (
                <GraphNodeRow
                  key={node.id}
                  node={node}
                  dependsOn={dependencyTitlesForNode(node.id, graph.data.edges, nodesById)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
