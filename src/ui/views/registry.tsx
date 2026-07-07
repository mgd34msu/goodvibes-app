// View registry — the single map from ViewId to sidebar placement, icon,
// title, keep-alive policy, and component. Later waves replace a view's
// `Component` with `lazy(() => import("./<domain>/<View>.tsx"))` (the shell
// already renders through Suspense); every unbuilt view renders an honest
// ComingSoon naming its wave. The onboarding flow (views/onboarding/) is a
// separate agent's scope and mounts over the shell via DaemonGate, not here.

import { lazy, type ComponentType } from "react";
import {
  Archive,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  CheckCircle2,
  Eye,
  FileText,
  FlaskConical,
  FolderGit2,
  GitBranch,
  GitCompare,
  Home,
  ListTodo,
  MessageSquare,
  Network,
  Plug,
  Radio,
  Repeat,
  Settings,
  Sparkles,
  SquareTerminal,
  Users,
  Waypoints,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ViewId } from "../lib/router.ts";
import { ComingSoon } from "./ComingSoon.tsx";

export type ViewGroupId = "work" | "automate" | "know" | "assistant" | "code" | "system";

export interface ViewGroupDef {
  id: ViewGroupId;
  label: string;
  views: ViewId[];
}

/** Sidebar information architecture — docs/UX.md §2, order is binding. */
export const VIEW_GROUPS: readonly ViewGroupDef[] = [
  { id: "work", label: "Work", views: ["chat", "sessions", "fleet", "approvals"] },
  { id: "automate", label: "Automate", views: ["automation", "watchers", "channels"] },
  { id: "know", label: "Know", views: ["knowledge", "memory", "artifacts", "research", "documents"] },
  { id: "assistant", label: "Assistant", views: ["home", "routines", "personas", "skills", "personal-ops"] },
  { id: "code", label: "Code", views: ["git", "diff", "worktrees", "checkpoints", "terminal"] },
  { id: "system", label: "System", views: ["observability", "providers", "mcp", "peers", "settings"] },
];

export interface ViewDef {
  id: ViewId;
  title: string;
  group: ViewGroupId;
  icon: LucideIcon;
  /** Keep mounted (display:none) on view switch — holds drafts/scrollback. */
  keepAlive: boolean;
  Component: ComponentType;
}

function stub(title: string, wave: string, description?: string): ComponentType {
  return function ComingSoonView() {
    return <ComingSoon title={title} wave={wave} description={description} />;
  };
}

const defs: Record<ViewId, Omit<ViewDef, "id" | "group">> = {
  // Work — Wave A
  chat: {
    title: "Chat",
    icon: MessageSquare,
    keepAlive: true,
    Component: lazy(() => import("./chat/ChatView.tsx").then((m) => ({ default: m.ChatView }))),
  },
  sessions: {
    title: "Sessions",
    icon: ListTodo,
    keepAlive: false,
    Component: lazy(() => import("./sessions/SessionsView.tsx").then((m) => ({ default: m.SessionsView }))),
  },
  fleet: {
    title: "Fleet",
    icon: Network,
    keepAlive: false,
    Component: lazy(() => import("./fleet/FleetView.tsx").then((m) => ({ default: m.FleetView }))),
  },
  approvals: {
    title: "Approvals",
    icon: CheckCircle2,
    keepAlive: false,
    Component: lazy(() =>
      import("./approvals/ApprovalsTasksView.tsx").then((m) => ({ default: m.ApprovalsTasksView })),
    ),
  },
  // Automate — Wave B
  automation: {
    title: "Automation",
    icon: CalendarClock,
    keepAlive: false,
    Component: lazy(() => import("./automation/AutomationView.tsx").then((m) => ({ default: m.AutomationView }))),
  },
  watchers: {
    title: "Watchers",
    icon: Eye,
    keepAlive: false,
    Component: lazy(() => import("./watchers/WatchersView.tsx").then((m) => ({ default: m.WatchersView }))),
  },
  channels: {
    title: "Channels",
    icon: Radio,
    keepAlive: false,
    Component: lazy(() => import("./channels/ChannelsView.tsx").then((m) => ({ default: m.ChannelsView }))),
  },
  // Know — Waves B/C
  knowledge: {
    title: "Knowledge",
    icon: BookOpen,
    keepAlive: false,
    Component: lazy(() => import("./knowledge/KnowledgeView.tsx").then((m) => ({ default: m.KnowledgeView }))),
  },
  memory: {
    title: "Memory",
    icon: Brain,
    keepAlive: false,
    Component: lazy(() => import("./memory/MemoryView.tsx").then((m) => ({ default: m.MemoryView }))),
  },
  artifacts: {
    title: "Artifacts",
    icon: Archive,
    keepAlive: false,
    Component: lazy(() => import("./artifacts/ArtifactsView.tsx").then((m) => ({ default: m.ArtifactsView }))),
  },
  research: {
    title: "Research",
    icon: FlaskConical,
    keepAlive: false,
    Component: lazy(() => import("./research/ResearchView.tsx").then((m) => ({ default: m.ResearchView }))),
  },
  documents: {
    title: "Documents",
    icon: FileText,
    keepAlive: false,
    Component: lazy(() => import("./documents/DocumentsView.tsx").then((m) => ({ default: m.DocumentsView }))),
  },
  // Assistant — Wave C
  home: {
    title: "Home",
    icon: Home,
    keepAlive: false,
    Component: lazy(() => import("./home/HomeView.tsx").then((m) => ({ default: m.HomeView }))),
  },
  routines: {
    title: "Routines",
    icon: Repeat,
    keepAlive: false,
    Component: lazy(() => import("./routines/RoutinesView.tsx").then((m) => ({ default: m.RoutinesView }))),
  },
  personas: {
    title: "Personas",
    icon: Users,
    keepAlive: false,
    Component: lazy(() => import("./personas/PersonasView.tsx").then((m) => ({ default: m.PersonasView }))),
  },
  skills: {
    title: "Skills",
    icon: Sparkles,
    keepAlive: false,
    Component: lazy(() => import("./skills/SkillsView.tsx").then((m) => ({ default: m.SkillsView }))),
  },
  "personal-ops": {
    title: "Personal Ops",
    icon: Bot,
    keepAlive: false,
    Component: lazy(() => import("./personal-ops/PersonalOpsView.tsx").then((m) => ({ default: m.PersonalOpsView }))),
  },
  // Code — Wave B
  git: {
    title: "Git",
    icon: FolderGit2,
    keepAlive: false,
    Component: lazy(() => import("./code/GitView.tsx").then((m) => ({ default: m.GitView }))),
  },
  diff: {
    title: "Diff",
    icon: GitCompare,
    keepAlive: false,
    Component: lazy(() => import("./code/DiffView.tsx").then((m) => ({ default: m.DiffView }))),
  },
  worktrees: {
    title: "Worktrees",
    icon: GitBranch,
    keepAlive: false,
    Component: lazy(() => import("./code/WorktreesView.tsx").then((m) => ({ default: m.WorktreesView }))),
  },
  checkpoints: {
    title: "Checkpoints",
    icon: Waypoints,
    keepAlive: false,
    Component: lazy(() => import("./code/CheckpointsView.tsx").then((m) => ({ default: m.CheckpointsView }))),
  },
  terminal: {
    title: "Terminal",
    icon: SquareTerminal,
    keepAlive: true,
    Component: lazy(() => import("./terminal/TerminalView.tsx").then((m) => ({ default: m.TerminalView }))),
  },
  // System — Waves B/D
  observability: {
    title: "Observability",
    icon: Zap,
    keepAlive: false,
    Component: lazy(() => import("./observability/ObservabilityView.tsx").then((m) => ({ default: m.ObservabilityView }))),
  },
  providers: {
    title: "Providers & Models",
    icon: Plug,
    keepAlive: false,
    Component: lazy(() => import("./providers/ProvidersView.tsx").then((m) => ({ default: m.ProvidersView }))),
  },
  mcp: {
    title: "MCP",
    icon: Wrench,
    keepAlive: false,
    Component: lazy(() => import("./mcp/McpView.tsx").then((m) => ({ default: m.McpView }))),
  },
  peers: {
    title: "Remote & Peers",
    icon: Waypoints,
    keepAlive: false,
    Component: lazy(() => import("./peers/PeersView.tsx").then((m) => ({ default: m.PeersView }))),
  },
  settings: {
    title: "Settings",
    icon: Settings,
    keepAlive: false,
    Component: lazy(() => import("./settings/SettingsView.tsx").then((m) => ({ default: m.SettingsView }))),
  },
};

function groupOf(id: ViewId): ViewGroupId {
  const group = VIEW_GROUPS.find((g) => g.views.includes(id));
  return group?.id ?? "work";
}

export const VIEW_REGISTRY: Readonly<Record<ViewId, ViewDef>> = Object.fromEntries(
  (Object.entries(defs) as [ViewId, Omit<ViewDef, "id" | "group">][]).map(([id, def]) => [
    id,
    { id, group: groupOf(id), ...def },
  ]),
) as Record<ViewId, ViewDef>;

export const ALL_VIEWS: readonly ViewDef[] = VIEW_GROUPS.flatMap((group) =>
  group.views.map((id) => VIEW_REGISTRY[id]),
);

export function viewDef(id: ViewId): ViewDef {
  return VIEW_REGISTRY[id];
}

export function groupLabel(id: ViewGroupId): string {
  return VIEW_GROUPS.find((g) => g.id === id)?.label ?? id;
}
