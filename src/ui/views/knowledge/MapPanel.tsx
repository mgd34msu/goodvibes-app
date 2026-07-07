// Map tab: knowledge.map rendered as an interactive node-link SVG (the
// GUI-native win over the TUI): the daemon returns laid-out nodes (x/y/radius)
// and edges, drawn natively with hover titles, a kind legend, and click →
// item peek. When a daemon returns only the pre-rendered `svg` string (older
// builds), it renders via an <img data:> URL — never dangerouslySetInnerHTML
// on daemon-sourced markup. Empty-state honesty ports the webui W8 ladder:
// "jobs ran / 0 nodes" is a named state, never a blank.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Map as MapIcon, RefreshCw } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { DataBlock } from "./KnowledgeBits.tsx";
import { KnowledgeItemPeekBody } from "./ItemPeek.tsx";
import { kKeys } from "./lib.ts";

const KIND_CLASS_COUNT = 6;

interface MapNode {
  id: string;
  title: string;
  kind: string;
  x: number;
  y: number;
  radius: number;
}

interface MapEdge {
  fromId: string;
  toId: string;
  relation: string;
}

function readNodes(data: unknown): MapNode[] {
  return firstArray(data, ["nodes"]).flatMap((raw) => {
    const record = asRecord(raw);
    const id = firstString(record, ["id"]);
    const x = firstNumber(record, ["x"]);
    const y = firstNumber(record, ["y"]);
    if (!id || x === undefined || y === undefined) return [];
    return [
      {
        id,
        title: firstString(record, ["title", "summary", "id"]) || id,
        kind: firstString(record, ["recordKind", "kind"]) || "node",
        x,
        y,
        radius: firstNumber(record, ["radius"]) ?? 6,
      },
    ];
  });
}

function readEdges(data: unknown): MapEdge[] {
  return firstArray(data, ["edges"]).flatMap((raw) => {
    const record = asRecord(raw);
    const fromId = firstString(record, ["fromId", "source"]);
    const toId = firstString(record, ["toId", "target"]);
    if (!fromId || !toId) return [];
    return [{ fromId, toId, relation: firstString(record, ["relation"]) }];
  });
}

/** A well-formed-enough SVG document for an <img> data URL (webui port). */
function isRenderableSvg(svg: string): boolean {
  const trimmed = svg.trim();
  return trimmed.length > 0 && /^<svg[\s>]/i.test(trimmed) && /<\/svg>\s*$/i.test(trimmed);
}

function InteractiveMap({
  nodes,
  edges,
  width,
  height,
  onSelect,
}: {
  nodes: MapNode[];
  edges: MapEdge[];
  width: number;
  height: number;
  onSelect: (id: string, title: string) => void;
}) {
  const kinds = useMemo(() => [...new Set(nodes.map((n) => n.kind))].sort(), [nodes]);
  const kindClass = (kind: string) => `knowledge-map__node--k${kinds.indexOf(kind) % KIND_CLASS_COUNT}`;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <div className="knowledge-map__wrap">
      <div className="knowledge-map__legend" aria-label="Node kinds">
        {kinds.map((kind) => (
          <span key={kind} className={`knowledge-map__legend-item ${kindClass(kind)}`}>
            <span className="knowledge-map__legend-dot" aria-hidden="true" />
            {kind}
          </span>
        ))}
      </div>
      <div className="knowledge-map__canvas" role="group" aria-label={`Knowledge map: ${nodes.length} nodes, ${edges.length} edges`}>
        <svg viewBox={`0 0 ${width} ${height}`} className="knowledge-map__svg" role="img" aria-hidden="false">
          {edges.map((edge, index) => {
            const from = byId.get(edge.fromId);
            const to = byId.get(edge.toId);
            if (!from || !to) return null;
            return (
              <line
                key={index}
                className="knowledge-map__edge"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              >
                {edge.relation && <title>{edge.relation}</title>}
              </line>
            );
          })}
          {nodes.map((node) => (
            <g
              key={node.id}
              className={`knowledge-map__node ${kindClass(node.kind)}`}
              tabIndex={0}
              role="button"
              aria-label={`${node.kind}: ${node.title}`}
              onClick={() => onSelect(node.id, node.title)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(node.id, node.title);
                }
              }}
            >
              <circle cx={node.x} cy={node.y} r={Math.max(3, node.radius)} />
              <text x={node.x} y={node.y - Math.max(3, node.radius) - 3} textAnchor="middle">
                {node.title.length > 24 ? `${node.title.slice(0, 22)}…` : node.title}
              </text>
              <title>{`${node.kind}: ${node.title}`}</title>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

export function MapPanel({ active, onViewJobs }: { active: boolean; onViewJobs: () => void }) {
  const peek = usePeek();
  const [filter, setFilter] = useState("");
  const [applied, setApplied] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const status = useQuery({ queryKey: kKeys.status, queryFn: () => invoke("knowledge.status") });
  const map = useQuery({
    queryKey: kKeys.map(applied),
    queryFn: () =>
      invoke("knowledge.map", {
        query: {
          limit: 150,
          includeSources: true,
          includeIssues: true,
          includeGenerated: true,
          ...(applied ? { query: applied } : {}),
        },
      }),
    // No dedicated map wire event — refresh on a slow poll while visible so
    // background ingestion shows up without a manual refresh.
    refetchInterval: active ? 60_000 : false,
  });

  if (map.isPending || status.isPending) {
    return <SkeletonBlock height={280} />;
  }
  if (map.isError) {
    if (isMethodUnavailableError(map.error)) {
      return <UnavailableState capability="knowledge.map" description="the knowledge graph map cannot be rendered." />;
    }
    return <ErrorState error={map.error} onRetry={() => void map.refetch()} title="Map failed to load" />;
  }

  const data = map.data;
  const nodeCount = firstNumber(asRecord(data), ["nodeCount"]) ?? 0;
  const edgeCount = firstNumber(asRecord(data), ["edgeCount"]) ?? 0;
  const totalNodeCount = firstNumber(asRecord(data), ["totalNodeCount"]) ?? nodeCount;
  const totalEdgeCount = firstNumber(asRecord(data), ["totalEdgeCount"]) ?? edgeCount;
  const overallNodeCount = status.isSuccess ? firstNumber(asRecord(status.data), ["nodeCount"]) : undefined;
  const jobRunCount = status.isSuccess ? firstNumber(asRecord(status.data), ["jobRunCount"]) ?? 0 : 0;

  const nodes = readNodes(data);
  const edges = readEdges(data);
  const svg = firstString(asRecord(data), ["svg"]);
  const width = firstNumber(asRecord(data), ["width"]) ?? 900;
  const height = firstNumber(asRecord(data), ["height"]) ?? 600;

  const baseIsEmpty = overallNodeCount === undefined ? totalNodeCount === 0 : overallNodeCount === 0;

  const controls = (
    <form
      className="knowledge-map__controls"
      onSubmit={(e) => {
        e.preventDefault();
        setApplied(filter.trim());
      }}
    >
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter map (query)"
        aria-label="Filter knowledge map"
      />
      <button type="submit" className="knowledge-button">
        Filter
      </button>
      <button
        type="button"
        className="knowledge-button"
        aria-label="Refresh knowledge map"
        onClick={() => void map.refetch()}
      >
        <RefreshCw size={14} aria-hidden="true" className={map.isFetching ? "knowledge-spin" : undefined} />
      </button>
      <span className="knowledge-map__counts">
        {nodeCount} node{nodeCount === 1 ? "" : "s"} · {edgeCount} edge{edgeCount === 1 ? "" : "s"}
        {(totalNodeCount > nodeCount || totalEdgeCount > edgeCount) && (
          <> — of {totalNodeCount}/{totalEdgeCount} total</>
        )}
      </span>
    </form>
  );

  let body: React.ReactNode;
  if (baseIsEmpty) {
    body =
      jobRunCount > 0 ? (
        <EmptyState
          icon={<AlertTriangle size={24} aria-hidden="true" />}
          title={`${jobRunCount} indexing job${jobRunCount === 1 ? "" : "s"} ran, 0 nodes`}
          description="Indexing may still be in progress, filtered everything out, or be failing to produce nodes."
          action={{ label: "View jobs", onClick: onViewJobs }}
        />
      ) : (
        <EmptyState
          icon={<MapIcon size={24} aria-hidden="true" />}
          title="No knowledge indexed yet"
          description="Ingest a source to start building the map."
        />
      );
  } else if (nodeCount === 0 && applied) {
    body = (
      <EmptyState
        icon={<MapIcon size={24} aria-hidden="true" />}
        title="No nodes match this filter"
        description="Try a different query, or clear the filter to see the full map."
        action={{
          label: "Clear filter",
          onClick: () => {
            setFilter("");
            setApplied("");
          },
        }}
      />
    );
  } else if (nodeCount === 0) {
    body = (
      <EmptyState
        icon={<AlertTriangle size={24} aria-hidden="true" />}
        title="Map returned 0 nodes"
        description={`The knowledge base reports ${overallNodeCount ?? totalNodeCount} node(s) elsewhere, but this unfiltered read came back empty.`}
        action={{ label: "View jobs", onClick: onViewJobs }}
      />
    );
  } else if (nodes.length > 0) {
    body = (
      <InteractiveMap
        nodes={nodes}
        edges={edges}
        width={width}
        height={height}
        onSelect={(id, title) => peek.open({ title, content: <KnowledgeItemPeekBody itemId={id} /> })}
      />
    );
  } else if (svg && isRenderableSvg(svg)) {
    // Older daemon: no positioned node list, only the pre-rendered picture.
    body = (
      <div className="knowledge-map__canvas">
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          alt={`Knowledge map: ${nodeCount} nodes, ${edgeCount} edges`}
        />
      </div>
    );
  } else {
    body = (
      <EmptyState
        icon={<AlertTriangle size={24} aria-hidden="true" />}
        title="Map unavailable"
        description="The daemon returned no renderable map for these nodes."
      />
    );
  }

  return (
    <div className="knowledge-map">
      {controls}
      <div aria-live="polite">{body}</div>
      <button
        type="button"
        className="knowledge-link knowledge-map__raw-toggle"
        onClick={() => setShowRaw((v) => !v)}
        aria-expanded={showRaw}
      >
        {showRaw ? "Hide raw map data" : "View raw map data"}
      </button>
      {showRaw && <DataBlock title="Raw map data" value={data} open />}
    </div>
  );
}
