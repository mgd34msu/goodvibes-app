// Knowledge view — wiki + graph + ingestion + planning (docs/FEATURES.md §6,
// all 25 rows). Sub-navigation is a tab rail (progressive disclosure: pages
// are observability, modals/confirms are configuration); the active tab is
// URL-addressable via ?filter[ktab]=… so palette jumps and deep links
// compose. Panels mount on first activation and then stay mounted-but-hidden
// so drafts (ask query, ingest forms, GraphQL editor) survive tab switches;
// their polls gate on the `active` flag.
//
// Realtime: the `knowledge` SSE domain already invalidates the status/
// sources/issues keys (lib/realtime.ts). Everything else has NO wire event —
// each panel polls narrowly while visible and every mutation invalidates the
// ["knowledge"] prefix.
//
// Store scope (agent-scoped knowledge row): the Overview tab carries an
// Operator/Agent store switcher; the agent store rides the
// /api/goodvibes-agent/knowledge/* routes, probed at runtime — absent routes
// render UnavailableState, never a blank.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Braces,
  FileText,
  Hammer,
  Home,
  Link as LinkIcon,
  ListTodo,
  Map as MapIcon,
  MessageCircleQuestion,
  PackageSearch,
  Sparkles,
} from "lucide-react";
import { appFetch } from "../../lib/http.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useUrlState } from "../../lib/router.ts";
import { ErrorBoundary, ErrorState, UnavailableState } from "../../components/feedback.tsx";
import { KNOWLEDGE_PREFIX, kKeys } from "./lib.ts";
import { AGENT_KNOWLEDGE_BASE, agentKnowledgePath, type KnowledgeScope } from "./scope.ts";
import { AskPanel } from "./AskPanel.tsx";
import { BrowsePanel } from "./BrowsePanel.tsx";
import { MapPanel } from "./MapPanel.tsx";
import { IngestPanel } from "./IngestPanel.tsx";
import { JobsPanel } from "./JobsPanel.tsx";
import { RefinePanel } from "./RefinePanel.tsx";
import { ProjectionsPanel } from "./ProjectionsPanel.tsx";
import { PacketPanel } from "./PacketPanel.tsx";
import { GraphqlPanel } from "./GraphqlPanel.tsx";
import { ReportsPanel } from "./ReportsPanel.tsx";
import { HomeGraphPanel } from "./HomeGraphPanel.tsx";
import { PlanningPanel } from "./PlanningPanel.tsx";

const TAB_IDS = [
  "overview",
  "browse",
  "map",
  "ingest",
  "jobs",
  "refine",
  "projections",
  "packet",
  "graphql",
  "reports",
  "homegraph",
  "planning",
] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_DEFS: ReadonlyArray<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "overview", label: "Overview", icon: <MessageCircleQuestion size={14} aria-hidden="true" /> },
  { id: "browse", label: "Browse", icon: <BookOpen size={14} aria-hidden="true" /> },
  { id: "map", label: "Map", icon: <MapIcon size={14} aria-hidden="true" /> },
  { id: "ingest", label: "Ingest", icon: <LinkIcon size={14} aria-hidden="true" /> },
  { id: "jobs", label: "Jobs", icon: <Hammer size={14} aria-hidden="true" /> },
  { id: "refine", label: "Refine", icon: <Sparkles size={14} aria-hidden="true" /> },
  { id: "projections", label: "Projections", icon: <FileText size={14} aria-hidden="true" /> },
  { id: "packet", label: "Packet", icon: <PackageSearch size={14} aria-hidden="true" /> },
  { id: "graphql", label: "GraphQL", icon: <Braces size={14} aria-hidden="true" /> },
  { id: "reports", label: "Reports", icon: <BarChart3 size={14} aria-hidden="true" /> },
  { id: "homegraph", label: "Home graph", icon: <Home size={14} aria-hidden="true" /> },
  { id: "planning", label: "Planning", icon: <ListTodo size={14} aria-hidden="true" /> },
];

function isTabId(value: string): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value);
}

/** Agent store capability quad-state (sessions.delete probe pattern):
 * available / unavailable / uncertain (probe itself failed) / checking. */
function useAgentScopeProbe() {
  const probe = useQuery({
    queryKey: kKeys.agentScopeProbe,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await appFetch(agentKnowledgePath("/status"));
      if (res.ok) return true;
      if (res.status === 404 || res.status === 501) return false;
      throw new Error(`Agent knowledge probe failed: HTTP ${res.status}`);
    },
  });
  if (probe.isSuccess) return probe.data ? "available" : "unavailable";
  if (probe.isError) return "uncertain";
  return "checking";
}

export function KnowledgeView() {
  const queryClient = useQueryClient();
  const { filters, setFilters } = useUrlState();
  const urlTab = filters["ktab"] ?? "";
  const [tab, setTabState] = useState<TabId>(() => (isTabId(urlTab) ? urlTab : "overview"));
  const [scope, setScope] = useState<KnowledgeScope>("operator");
  // Panels that have been visited stay mounted (hidden) so drafts survive.
  const [mounted, setMounted] = useState<ReadonlySet<TabId>>(() => new Set<TabId>([isTabId(urlTab) ? urlTab : "overview"]));

  const agentScopeState = useAgentScopeProbe();

  const setTab = (next: TabId) => {
    setTabState(next);
    setMounted((current) => (current.has(next) ? current : new Set(current).add(next)));
    setFilters({ ktab: next === "overview" ? undefined : next }, { replace: true });
  };

  // Follow URL changes (palette jumps / back button) into local tab state.
  useEffect(() => {
    if (isTabId(urlTab) && urlTab !== tab) {
      setTabState(urlTab);
      setMounted((current) => (current.has(urlTab) ? current : new Set(current).add(urlTab)));
    }
    // Intentionally NOT depending on `tab` — this effect only ingests URL edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);

  // Palette commands — view-scoped, unregistered on unmount.
  useEffect(() => {
    registerCommand({
      id: "knowledge.refresh",
      title: "Refresh Knowledge",
      group: "know",
      keywords: ["knowledge", "reload", "wiki", "graph"],
      run: () => void queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX }),
    });
    const jumps: Array<{ id: string; title: string; tab: TabId; keywords: string[] }> = [
      { id: "knowledge.ask", title: "Knowledge: Ask", tab: "overview", keywords: ["ask", "question", "answer"] },
      { id: "knowledge.map", title: "Knowledge: Graph Map", tab: "map", keywords: ["map", "graph", "nodes"] },
      { id: "knowledge.ingest", title: "Knowledge: Ingest", tab: "ingest", keywords: ["ingest", "url", "import", "bookmarks"] },
      { id: "knowledge.graphql", title: "Knowledge: GraphQL Console", tab: "graphql", keywords: ["graphql", "query", "console"] },
      { id: "knowledge.candidates", title: "Knowledge: Review Candidates", tab: "refine", keywords: ["candidates", "review", "consolidation"] },
      { id: "knowledge.homegraph", title: "Knowledge: Home Graph", tab: "homegraph", keywords: ["home", "graph", "homeassistant", "ha", "entity", "device"] },
      { id: "knowledge.planning", title: "Knowledge: Project Planning", tab: "planning", keywords: ["planning", "project", "work plan", "task", "decision"] },
    ];
    for (const jump of jumps) {
      registerCommand({
        id: jump.id,
        title: jump.title,
        group: "know",
        keywords: jump.keywords,
        run: () => setTab(jump.tab),
      });
    }
    return () => {
      unregisterCommand("knowledge.refresh");
      for (const jump of jumps) unregisterCommand(jump.id);
    };
    // setTab identity is stable enough for command registration lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  const effectiveScope: KnowledgeScope = scope === "agent" && agentScopeState === "available" ? "agent" : "operator";

  const panels = useMemo(
    () =>
      [
        {
          id: "overview" as TabId,
          node: (
            <>
              <div className="knowledge-scope" role="group" aria-label="Knowledge store scope">
                <span className="knowledge-scope__label">Store</span>
                <button
                  type="button"
                  className={
                    scope === "operator"
                      ? "knowledge-segmented__item knowledge-segmented__item--active"
                      : "knowledge-segmented__item"
                  }
                  aria-pressed={scope === "operator"}
                  onClick={() => setScope("operator")}
                >
                  Operator
                </button>
                <button
                  type="button"
                  className={
                    scope === "agent"
                      ? "knowledge-segmented__item knowledge-segmented__item--active"
                      : "knowledge-segmented__item"
                  }
                  aria-pressed={scope === "agent"}
                  onClick={() => setScope("agent")}
                  disabled={agentScopeState === "checking"}
                >
                  Agent{agentScopeState === "checking" ? " (probing…)" : ""}
                </button>
                {scope === "agent" && agentScopeState === "available" && (
                  <span className="knowledge-scope__note">
                    Isolated agent store — Browse/Map/Jobs tabs still operate on the operator store.
                  </span>
                )}
              </div>
              {scope === "agent" && agentScopeState === "unavailable" ? (
                <UnavailableState
                  capability={`${AGENT_KNOWLEDGE_BASE}/*`}
                  description="this daemon does not expose the isolated agent-scoped knowledge store."
                />
              ) : scope === "agent" && agentScopeState === "uncertain" ? (
                <ErrorState
                  error={new Error("The agent knowledge probe failed — availability is unknown, not absent.")}
                  onRetry={() => void queryClient.refetchQueries({ queryKey: kKeys.agentScopeProbe })}
                  title="Agent store availability unknown"
                />
              ) : (
                <AskPanel scope={effectiveScope} />
              )}
            </>
          ),
        },
        { id: "browse" as TabId, node: <BrowsePanel active={tab === "browse"} onViewJobs={() => setTab("jobs")} /> },
        { id: "map" as TabId, node: <MapPanel active={tab === "map"} onViewJobs={() => setTab("jobs")} /> },
        { id: "ingest" as TabId, node: <IngestPanel active={tab === "ingest"} /> },
        { id: "jobs" as TabId, node: <JobsPanel active={tab === "jobs"} /> },
        { id: "refine" as TabId, node: <RefinePanel active={tab === "refine"} /> },
        { id: "projections" as TabId, node: <ProjectionsPanel /> },
        { id: "packet" as TabId, node: <PacketPanel /> },
        { id: "graphql" as TabId, node: <GraphqlPanel /> },
        { id: "reports" as TabId, node: <ReportsPanel active={tab === "reports"} /> },
        { id: "homegraph" as TabId, node: <HomeGraphPanel /> },
        { id: "planning" as TabId, node: <PlanningPanel /> },
      ] as const,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, scope, agentScopeState, effectiveScope],
  );

  return (
    <ErrorBoundary
      fallback={(error, reset) => <ErrorState error={error} onRetry={reset} title="Knowledge view failed" />}
    >
      <div className="knowledge-view">
        <nav className="knowledge-tabs" role="tablist" aria-label="Knowledge sections">
          {TAB_DEFS.map((def) => (
            <button
              key={def.id}
              type="button"
              role="tab"
              aria-selected={tab === def.id}
              className={tab === def.id ? "knowledge-tab knowledge-tab--active" : "knowledge-tab"}
              onClick={() => setTab(def.id)}
            >
              {def.icon}
              {def.label}
            </button>
          ))}
        </nav>
        <div className="knowledge-outlet">
          {panels.map(
            (panel) =>
              mounted.has(panel.id) && (
                <div
                  key={panel.id}
                  role="tabpanel"
                  aria-label={panel.id}
                  hidden={tab !== panel.id}
                  className="knowledge-tabpanel"
                >
                  {panel.node}
                </div>
              ),
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
