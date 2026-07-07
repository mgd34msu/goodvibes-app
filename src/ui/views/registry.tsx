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
  { id: "system", label: "System", views: ["observability", "providers", "mcp", "settings"] },
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
    Component: stub("Automation", "Wave B", "Jobs, schedules, and run history."),
  },
  watchers: {
    title: "Watchers",
    icon: Eye,
    keepAlive: false,
    Component: stub("Watchers", "Wave B", "Webhook/email/event-triggered watchers."),
  },
  channels: {
    title: "Channels",
    icon: Radio,
    keepAlive: false,
    Component: stub("Channels", "Wave B", "Omnichannel status, inbox, and delivery receipts."),
  },
  // Know — Waves B/C
  knowledge: {
    title: "Knowledge",
    icon: BookOpen,
    keepAlive: false,
    Component: stub("Knowledge", "Wave B", "Ask, search, graph map, and ingestion."),
  },
  memory: {
    title: "Memory",
    icon: Brain,
    keepAlive: false,
    Component: stub("Memory", "Wave B", "Canonical memory records, semantic search, review queue."),
  },
  artifacts: {
    title: "Artifacts",
    icon: Archive,
    keepAlive: false,
    Component: stub("Artifacts", "Wave C", "Browse, preview, and upload artifacts."),
  },
  research: {
    title: "Research",
    icon: FlaskConical,
    keepAlive: false,
    Component: stub("Research", "Wave C", "Web search, research runs, and sourced reports."),
  },
  documents: {
    title: "Documents",
    icon: FileText,
    keepAlive: false,
    Component: stub("Documents", "Wave C", "Versioned drafts, review packets, and model comparison."),
  },
  // Assistant — Wave C
  home: {
    title: "Home",
    icon: Home,
    keepAlive: false,
    Component: stub("Home", "Wave C", "Briefing, away-digest, and coming-up rail."),
  },
  routines: {
    title: "Routines",
    icon: Repeat,
    keepAlive: false,
    Component: stub("Routines", "Wave C", "Reusable step routines, promotable to daemon schedules."),
  },
  personas: {
    title: "Personas",
    icon: Users,
    keepAlive: false,
    Component: stub("Personas", "Wave C", "Persona registry with VIBE.md import."),
  },
  skills: {
    title: "Skills",
    icon: Sparkles,
    keepAlive: false,
    Component: stub("Skills", "Wave C", "Skill registry with readiness checks and bundles."),
  },
  "personal-ops": {
    title: "Personal Ops",
    icon: Bot,
    keepAlive: false,
    Component: stub("Personal Ops", "Wave C", "Daily briefing, inbox, calendar, and reminders."),
  },
  // Code — Wave B
  git: {
    title: "Git",
    icon: FolderGit2,
    keepAlive: false,
    Component: stub("Git", "Wave B", "Status, log, staging, and commits for the workspace."),
  },
  diff: {
    title: "Diff",
    icon: GitCompare,
    keepAlive: false,
    Component: stub("Diff", "Wave B", "Working/staged/ref diffs, syntax highlighted."),
  },
  worktrees: {
    title: "Worktrees",
    icon: GitBranch,
    keepAlive: false,
    Component: stub("Worktrees", "Wave B", "Worktree snapshot with agent awareness."),
  },
  checkpoints: {
    title: "Checkpoints",
    icon: Waypoints,
    keepAlive: false,
    Component: stub("Checkpoints", "Wave B", "Workspace checkpoints: list, diff, restore."),
  },
  terminal: {
    title: "Terminal",
    icon: SquareTerminal,
    keepAlive: true,
    Component: stub("Terminal", "Wave B", "Embedded PTY tabs with preserved scrollback."),
  },
  // System — Waves B/D
  observability: {
    title: "Observability",
    icon: Zap,
    keepAlive: false,
    Component: stub("Observability", "Wave D", "Telemetry, cost analytics, health, and traces."),
  },
  providers: {
    title: "Providers & Models",
    icon: Plug,
    keepAlive: false,
    Component: stub("Providers & Models", "Wave B", "Provider status, credentials, and model workspace."),
  },
  mcp: {
    title: "MCP",
    icon: Wrench,
    keepAlive: false,
    Component: stub("MCP", "Wave B", "MCP servers, tool inventory, and trust review."),
  },
  settings: {
    title: "Settings",
    icon: Settings,
    keepAlive: false,
    Component: stub("Settings", "Wave D", "Schema-driven settings, keybindings, theme, and doctor."),
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
