// FleetView — the live control room over fleet.snapshot [ws]
// (docs/FEATURES.md §3): the flat, parentId-linked process node list
// (daemon-capped at 2000) rendered as a master/detail tree.
//
// fleet.* emits no dedicated wire event (pinned upstream) — freshness is a 5s
// poll while the view is visible (docs/UX.md §6) + manual refresh, and the
// `agents`/`workflows` realtime domains invalidate queryKeys.fleet as a fast
// signal. fleet.snapshot is ws-only: it rides the /app/ws bridge and degrades
// honestly when the bridge is down (distinct from daemon-unreachable and from
// capability-missing).
//
// Per-node actions are capability-gated on fleet.ts's wireBackedActions —
// steer / detach / start-stop-run-watcher are gated there; any node with a
// live sessionRef.sessionId ALSO gets the full session-level Agent Control
// surface (FleetAgentControl.tsx — steer/follow-up, interrupt via
// sessions.inputs.cancel, stop via sessions.close/detach, resume via
// sessions.reopen; this is what closed out docs/GAPS.md §3 row 7, formerly
// "EXCLUDED: interrupt/kill/pause/resume"). True freeze-and-thaw pause still
// has no wire verb anywhere — see unbackedCapabilityNote and the panel's own
// on-screen note. Inline approval cards ride approvalsForNode.
// The Workstream sub-filter scopes the same snapshot to
// workstream/phase/work-item kinds (no dedicated contract exists).
// Ported from goodvibes-webui src/views/fleet/FleetView.tsx + WorkstreamView.tsx.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, ChevronLeft, GitBranch, OctagonX, Play, RefreshCw, Workflow } from "lucide-react";
import { gv, invoke } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { compactJson, formatRelative } from "../../lib/wire.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { getCurrentUrlState, replaceState } from "../../lib/router.ts";
import { useToast } from "../../lib/toast.ts";
import { contractStateForBadgeTone, type BadgeTone } from "../../lib/presentation-bridge.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  WORKSTREAM_KINDS,
  activeCount,
  agentWorkingDirectory,
  buildFleetRows,
  costLabel,
  formatDurationMs,
  isAwaitingApprovalState,
  isKnownProcessKind,
  isKnownProcessState,
  isStalledState,
  isTerminalState,
  kindLabel,
  normalizeFleetSnapshot,
  stateLabel,
  unbackedCapabilityNote,
  wireBackedActions,
  worktreeLabel,
  wrfcChainProgress,
  wrfcConstraintTally,
  type FleetNode,
} from "./fleet.ts";
import { FleetAgentControl, type FleetAgentControlHandle } from "./FleetAgentControl.tsx";
import { FleetApprovalInline } from "./FleetApprovalInline.tsx";
import { FleetTaskInline } from "./FleetTaskInline.tsx";

/** No wire event exists for fleet.* — poll while visible (docs/UX.md §6). */
const FLEET_POLL_INTERVAL_MS = 5_000;

type FleetScope = "all" | "workstreams";

function KindBadge({ kind }: { kind: string }) {
  const known = isKnownProcessKind(kind);
  return (
    <span
      className={`badge ${known ? "neutral" : "warning"}`}
      title={known ? undefined : "Kind not known to this client — shown verbatim"}
    >
      {kindLabel(kind)}
    </span>
  );
}

/** Fleet-local state→severity ruling (stalled/awaiting-approval have no SDK
 * contract analogue), routed through the shared presentation bridge so the
 * glyph matches TUI/agent/webui. */
function stateTone(state: string): BadgeTone {
  if (!isKnownProcessState(state)) return "warning";
  if (isStalledState(state) || isAwaitingApprovalState(state)) return "warning";
  if (state === "failed" || state === "killed") return "bad";
  if (isTerminalState(state)) return "neutral";
  return "ok";
}

function StateBadge({ state }: { state: string }) {
  const tone = stateTone(state);
  return (
    <span className={`badge ${tone}`} data-contract-state={contractStateForBadgeTone(tone)}>
      {stateLabel(state)}
    </span>
  );
}

/** "c:N/M" — subtask completion progress on a compound WRFC chain; renders
 * nothing when the chain has no subtasks to count (fleet.ts wrfcChainProgress). */
function ChainProgressBadge({ node }: { node: FleetNode }) {
  const progress = wrfcChainProgress(node);
  if (!progress) return null;
  return (
    <span className="badge neutral" title={`${progress.completed} of ${progress.total} subtasks complete`}>
      c:{progress.completed}/{progress.total}
    </span>
  );
}

/** SAT/UNS/UNV constraint-verdict tally from the wire's own reviewer findings
 * (fleet.ts wrfcConstraintTally) — absent entirely until a review has reported. */
function ConstraintVerdictBadges({ node }: { node: FleetNode }) {
  const tally = wrfcConstraintTally(node);
  if (!tally) return null;
  return (
    <>
      <span className="badge ok" title="Constraints the reviewer found satisfied">
        {tally.sat} SAT
      </span>
      <span className="badge bad" title="Constraints the reviewer found unsatisfied">
        {tally.uns} UNS
      </span>
      {tally.unv > 0 && (
        <span className="badge warning" title="Constraints the fan-out collapse made impossible to satisfy">
          {tally.unv} UNV
        </span>
      )}
    </>
  );
}

/** Deep-linkable selection: ?view=fleet&filter[node]=<id>. */
function writeNodeToUrl(nodeId: string): void {
  const current = getCurrentUrlState();
  if ((current.filters["node"] ?? "") === nodeId) return;
  const filters = { ...current.filters };
  if (nodeId) filters["node"] = nodeId;
  else delete filters["node"];
  replaceState({ ...current, filters });
}

export function FleetView() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(() => getCurrentUrlState().filters["node"] ?? "");
  const [scope, setScope] = useState<FleetScope>("all");

  const snapshot = useQuery({
    queryKey: queryKeys.fleet,
    queryFn: async () => normalizeFleetSnapshot(await gv.fleet.snapshot()),
    refetchInterval: FLEET_POLL_INTERVAL_MS,
    retry: 1,
  });

  const allNodes = useMemo(() => snapshot.data?.nodes ?? [], [snapshot.data]);
  const nodes = useMemo(
    () => (scope === "workstreams" ? allNodes.filter((n) => WORKSTREAM_KINDS.has(n.kind)) : allNodes),
    [allNodes, scope],
  );
  const rows = useMemo(() => buildFleetRows(nodes), [nodes]);
  const selected = useMemo(() => allNodes.find((n) => n.id === selectedId) ?? null, [allNodes, selectedId]);
  const running = useMemo(() => activeCount(nodes), [nodes]);
  const stalled = useMemo(() => nodes.filter((n) => isStalledState(n.state)).length, [nodes]);

  const selectNode = (id: string) => {
    setSelectedId(id);
    writeNodeToUrl(id);
  };

  useEffect(() => {
    registerCommand({
      id: "fleet.refresh",
      title: "Refresh Fleet",
      group: "work",
      keywords: ["fleet", "processes", "reload"],
      run: () => void queryClient.invalidateQueries({ queryKey: queryKeys.fleet }),
    });
    registerCommand({
      id: "fleet.toggleWorkstreams",
      title: "Fleet: Toggle Workstream Filter",
      group: "work",
      keywords: ["workstream", "phase", "work item", "orchestration"],
      run: () => setScope((prev) => (prev === "all" ? "workstreams" : "all")),
    });
    return () => {
      unregisterCommand("fleet.refresh");
      unregisterCommand("fleet.toggleWorkstreams");
    };
  }, [queryClient]);

  const bridgeDown = snapshot.isError && isWsBridgeUnavailableError(snapshot.error);
  const methodMissing = snapshot.isError && isMethodUnavailableError(snapshot.error);

  return (
    <div className={selected ? "fleet-view has-selection" : "fleet-view"}>
      <div className="fleet-list-pane">
        <div className="fleet-toolbar">
          <span className="fleet-toolbar__summary">
            <Boxes size={14} aria-hidden="true" /> {nodes.length} node{nodes.length === 1 ? "" : "s"} · {running}{" "}
            active{stalled > 0 ? ` · ${stalled} stalled` : ""}
          </span>
          <div className="fleet-scope" role="group" aria-label="Fleet scope">
            <button
              type="button"
              className={`fleet-scope__option${scope === "all" ? " active" : ""}`}
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              <Boxes size={13} aria-hidden="true" /> All
            </button>
            <button
              type="button"
              className={`fleet-scope__option${scope === "workstreams" ? " active" : ""}`}
              aria-pressed={scope === "workstreams"}
              title="Only workstream / phase / work-item orchestration nodes"
              onClick={() => setScope("workstreams")}
            >
              <Workflow size={13} aria-hidden="true" /> Workstreams
            </button>
          </div>
          <button
            className="fleet-icon-button"
            type="button"
            title="Refresh"
            aria-label="Refresh fleet"
            onClick={() => void snapshot.refetch()}
          >
            <RefreshCw size={15} className={snapshot.isFetching ? "spinning" : undefined} />
          </button>
        </div>

        {snapshot.isPending && <SkeletonBlock variant="text" lines={6} />}

        {bridgeDown && (
          <div className="fleet-bridge-note" role="alert">
            <strong>Fleet needs the live bridge.</strong> fleet.snapshot is a ws-only method and the app's bridge to
            the daemon's websocket is down right now — nothing is wrong with the fleet itself. Reconnecting
            automatically; you can also retry now.
            <button type="button" className="fleet-action" onClick={() => void snapshot.refetch()}>
              Retry
            </button>
          </div>
        )}
        {methodMissing && (
          <UnavailableState
            capability="fleet.snapshot"
            description="this daemon cannot report a live process tree"
          />
        )}
        {snapshot.isError && !bridgeDown && !methodMissing && (
          <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} title="Failed to load the fleet" />
        )}

        {snapshot.isSuccess && snapshot.data.truncated && (
          <div className="fleet-cap-note" role="note">
            Showing {snapshot.data.nodes.length}
            {snapshot.data.totalCount !== null ? ` of ${snapshot.data.totalCount}` : ""} nodes — truncated at the
            daemon's node cap.
          </div>
        )}

        {snapshot.isSuccess && nodes.length === 0 && (
          <EmptyState
            icon={scope === "workstreams" ? <Workflow size={28} /> : <Boxes size={28} />}
            title={scope === "workstreams" ? "No active workstreams" : "No active processes"}
            description={
              scope === "workstreams"
                ? "Multi-phase orchestration runs (workstreams, phases, work items) appear here while they run."
                : "Agents, WRFC chains, workflows, watchers, and background processes appear here while they run."
            }
          />
        )}

        {snapshot.isSuccess && nodes.length > 0 && (
          <ul className="fleet-rows">
            {rows.map(({ node, depth }) => (
              <li key={node.id} style={{ paddingLeft: `${depth * 14}px` }}>
                <button
                  type="button"
                  className={`fleet-row${node.id === selectedId ? " active" : ""}`}
                  onClick={() => selectNode(node.id)}
                >
                  <span className="fleet-row__title">{node.label}</span>
                  <span className="fleet-row__badges">
                    <KindBadge kind={node.kind} />
                    <StateBadge state={node.state} />
                    {node.kind !== "phase" && <span className="badge neutral">{costLabel(node)}</span>}
                    <ChainProgressBadge node={node} />
                    <ConstraintVerdictBadges node={node} />
                  </span>
                  {worktreeLabel(node) && (
                    <span className="fleet-row__worktree" title={agentWorkingDirectory(node)}>
                      <GitBranch size={11} aria-hidden="true" /> {worktreeLabel(node)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="fleet-detail-pane">
        {selected ? (
          <FleetDetail node={selected} onBack={() => selectNode("")} />
        ) : (
          <div className="fleet-detail-empty">Select a process to view its detail.</div>
        )}
      </div>
    </div>
  );
}

function FleetDetail({ node, onBack }: { node: FleetNode; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const backed = useMemo(() => wireBackedActions(node), [node]);
  const unbackedNote = useMemo(() => unbackedCapabilityNote(node), [node]);
  const agentControlRef = useRef<FleetAgentControlHandle>(null);

  // Palette commands for the Agent Control surface (docs/GAPS.md §3 row 7) —
  // re-registered whenever the selection changes to a different session, so
  // `when` always guards against the CURRENTLY selected node. The `run`/
  // `when` closures read agentControlRef on every palette query, so they stay
  // live across the view's 5s poll without re-registering on every refetch.
  useEffect(() => {
    if (!node.sessionId) return undefined;
    registerCommand({
      id: "fleet.control.steer",
      title: "Fleet: Steer Selected Agent",
      group: "work",
      keywords: ["fleet", "steer", "agent", "control", "follow-up"],
      when: () => agentControlRef.current !== null,
      run: () => agentControlRef.current?.focusDispatch(),
    });
    registerCommand({
      id: "fleet.control.stop",
      title: "Fleet: Stop Selected Session",
      group: "work",
      keywords: ["fleet", "stop", "close", "session", "control"],
      when: () => agentControlRef.current?.canStop ?? false,
      run: () => agentControlRef.current?.requestStop(),
    });
    registerCommand({
      id: "fleet.control.resume",
      title: "Fleet: Resume Selected Session",
      group: "work",
      keywords: ["fleet", "resume", "reopen", "session", "control"],
      when: () => agentControlRef.current?.canResume ?? false,
      run: () => agentControlRef.current?.resume(),
    });
    return () => {
      unregisterCommand("fleet.control.steer");
      unregisterCommand("fleet.control.stop");
      unregisterCommand("fleet.control.resume");
    };
  }, [node.id, node.sessionId]);

  const invalidateWatchers = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    await queryClient.invalidateQueries({ queryKey: queryKeys.watchers });
  };

  const stopWatcher = useMutation({
    mutationFn: (watcherId: string) => invoke("watchers.stop", { params: { watcherId } }),
    onSuccess: async () => {
      toast({ title: "Stop requested", tone: "info" });
      await invalidateWatchers();
    },
    onError: (error: unknown) => toast({ title: "Stop failed", description: formatError(error), tone: "danger" }),
  });

  const startWatcher = useMutation({
    mutationFn: (watcherId: string) => invoke("watchers.start", { params: { watcherId } }),
    onSuccess: async () => {
      setConfirmStart(false);
      toast({ title: "Watcher started", tone: "success" });
      await invalidateWatchers();
    },
    onError: (error: unknown) => toast({ title: "Start failed", description: formatError(error), tone: "danger" }),
  });

  const runWatcher = useMutation({
    mutationFn: (watcherId: string) => invoke("watchers.run", { params: { watcherId } }),
    onSuccess: async () => {
      setConfirmRun(false);
      toast({ title: "Watcher run triggered", tone: "success" });
      await invalidateWatchers();
    },
    onError: (error: unknown) => toast({ title: "Run failed", description: formatError(error), tone: "danger" }),
  });

  return (
    <div className="fleet-detail">
      <button type="button" className="fleet-detail__back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        Back to processes
      </button>
      <header className="fleet-detail__header">
        <h2>{node.label}</h2>
        <div className="fleet-detail__badges">
          <KindBadge kind={node.kind} />
          <StateBadge state={node.state} />
          {node.kind !== "phase" && <span className="badge neutral">{costLabel(node)}</span>}
          <ChainProgressBadge node={node} />
          <ConstraintVerdictBadges node={node} />
        </div>
        {node.task && <p className="fleet-detail__task">{node.task}</p>}
        <div className="fleet-detail__meta">
          <small>Elapsed {formatDurationMs(node.elapsedMs)}</small>
          {node.startedAt !== null && <small>· started {formatRelative(node.startedAt)}</small>}
          {node.model && (
            <small>
              · {node.provider ? `${node.provider}/` : ""}
              {node.model}
            </small>
          )}
          {worktreeLabel(node) && (
            <small className="fleet-detail__worktree" title={agentWorkingDirectory(node)}>
              <GitBranch size={11} aria-hidden="true" /> {worktreeLabel(node)}
            </small>
          )}
        </div>
      </header>

      <FleetApprovalInline node={node} />

      {node.sessionId && <FleetAgentControl ref={agentControlRef} node={node} />}

      {(backed.has("start") || backed.has("stop") || backed.has("run")) && (
        <div className="fleet-detail__actions">
          {backed.has("start") && (
            <button
              type="button"
              className="fleet-action"
              disabled={startWatcher.isPending}
              onClick={() => setConfirmStart(true)}
            >
              <Play size={13} aria-hidden="true" /> {startWatcher.isPending ? "Starting…" : "Start"}
            </button>
          )}
          {backed.has("stop") && (
            <button
              type="button"
              className="fleet-action fleet-action--danger"
              disabled={stopWatcher.isPending}
              onClick={() => setConfirmStop(true)}
            >
              <OctagonX size={14} aria-hidden="true" /> {stopWatcher.isPending ? "Stopping…" : "Stop"}
            </button>
          )}
          {backed.has("run") && (
            <button
              type="button"
              className="fleet-action"
              disabled={runWatcher.isPending}
              onClick={() => setConfirmRun(true)}
            >
              <Play size={13} aria-hidden="true" /> {runWatcher.isPending ? "Triggering…" : "Run once"}
            </button>
          )}
        </div>
      )}

      <FleetTaskInline node={node} />

      {unbackedNote && (
        <p className="fleet-detail__unbacked-note" role="note">
          {unbackedNote}
        </p>
      )}

      {node.kind === "phase" && (
        <p className="fleet-detail__phase-note" role="note">
          Phases report no usage/cost of their own — a work item's usage is cumulative across every phase it visits,
          so attributing it to its current phase would double-count.
        </p>
      )}

      {node.currentActivity && (
        <div className="fleet-detail__activity">
          <strong>Current activity</strong>
          <p>
            {node.currentActivity.toolName ? `${node.currentActivity.toolName}: ` : ""}
            {node.currentActivity.text}
          </p>
        </div>
      )}

      {node.usage && (
        <div className="fleet-detail__usage">
          <strong>Usage</strong>
          <div className="fleet-detail__usage-grid">
            <span>{node.usage.inputTokens} in</span>
            <span>{node.usage.outputTokens} out</span>
            <span>{node.usage.cacheReadTokens} cache-read</span>
            <span>{node.usage.cacheWriteTokens} cache-write</span>
            <span>{node.usage.llmCallCount} calls</span>
            <span>{node.usage.turnCount} turns</span>
            <span>{node.usage.toolCallCount} tool calls</span>
          </div>
        </div>
      )}

      {(node.sessionId || node.agentId) && (
        <div className="fleet-detail__session">
          {node.sessionId && <small>Session: {node.sessionId}</small>}
          {node.agentId && <small>· agent {node.agentId}</small>}
        </div>
      )}

      <details className="fleet-detail__raw">
        <summary>Raw node</summary>
        <pre>{compactJson(node.raw)}</pre>
      </details>

      <ConfirmSurface
        open={confirmStop}
        action="Stop watcher"
        target={`${node.label} (${node.id})`}
        blastRadius="The watcher stops observing and running its trigger until started again. In-flight runs are not interrupted; nothing is deleted."
        confirmLabel="Stop watcher"
        onConfirm={() => {
          setConfirmStop(false);
          stopWatcher.mutate(node.id);
        }}
        onCancel={() => setConfirmStop(false)}
      />
      <ConfirmSurface
        open={confirmStart}
        action="Start watcher"
        target={`${node.label} (${node.id})`}
        blastRadius="The watcher resumes observing its source and will run its trigger again on the next matching event or interval."
        confirmLabel="Start watcher"
        onConfirm={() => startWatcher.mutate(node.id)}
        onCancel={() => setConfirmStart(false)}
      />
      <ConfirmSurface
        open={confirmRun}
        action="Run watcher once"
        target={`${node.label} (${node.id})`}
        blastRadius="Manually triggers this watcher's action once, right now, outside of its normal schedule or event source."
        confirmLabel="Run once"
        onConfirm={() => runWatcher.mutate(node.id)}
        onCancel={() => setConfirmRun(false)}
      />
    </div>
  );
}
