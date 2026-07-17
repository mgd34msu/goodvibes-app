// Central query-key registry (webui doctrine: TanStack Query is the ONLY
// server-state store; prefix keys so one invalidation fans out to list +
// every open detail query) plus the boot snapshot loader.

import type { QueryClient } from "@tanstack/react-query";
import { gv } from "./gv.ts";
import type { AppHealth } from "../../shared/app-contract.ts";
import { appJson } from "./http.ts";

export const queryKeys = {
  appHealth: ["app", "health"] as const,
  status: ["control", "status"] as const,
  control: ["control", "snapshot"] as const,
  contract: ["control", "contract"] as const,
  authCurrent: ["control", "auth", "current"] as const,
  // Full config read (admin) — onboarding/doctor reads provider.model off it.
  configAll: ["config"] as const,
  accounts: ["accounts"] as const,
  providers: ["providers"] as const,
  tasks: ["tasks"] as const,
  // Task detail is PREFIXED with 'tasks' so the tasks-domain invalidation
  // refetches the list AND every open detail peek in one shot.
  taskDetail: (taskId: string) => ["tasks", taskId] as const,
  approvals: ["approvals"] as const,
  sessions: ["sessions"] as const,
  // Detail/messages keys are PREFIXED with 'sessions' so invalidating
  // queryKeys.sessions (non-exact) refetches the union list AND every open
  // detail/messages query — the single invalidation the raw session-update
  // stream fires.
  sessionDetail: (sessionId: string) => ["sessions", sessionId] as const,
  sessionMessages: (sessionId: string) => ["sessions", sessionId, "messages"] as const,
  sessionInputs: (sessionId: string) => ["sessions", sessionId, "inputs"] as const,
  // Also 'sessions'-prefixed on purpose: a session-update frame refreshes
  // open sessions.search results too (they are session records).
  sessionSearch: (query: string, includeClosed: boolean) =>
    ["sessions", "search", query, includeClosed] as const,
  chatSessions: ["chat", "sessions"] as const,
  chatMessages: (sessionId: string) => ["chat", "sessions", sessionId, "messages"] as const,
  // fleet.*/checkpoints.* have no wire events (pinned upstream) — views poll
  // and refetch on mutation; these keys are NOT in DOMAIN_INVALIDATIONS.
  fleet: ["fleet"] as const,
  fleetArchived: ["fleet", "archived"] as const,
  checkpoints: ["checkpoints"] as const,
  workstream: ["workstream"] as const,
  knowledgeStatus: ["knowledge", "status"] as const,
  knowledgeSources: ["knowledge", "sources"] as const,
  knowledgeNodes: ["knowledge", "nodes"] as const,
  knowledgeIssues: ["knowledge", "issues"] as const,
  // memory.* has no wire event either — poll/refetch-on-mutation.
  memoryList: ["memory", "list"] as const,
  memoryReviewQueue: ["memory", "review-queue"] as const,
  artifacts: ["artifacts"] as const,
  automation: ["automation"] as const,
  watchers: ["watchers"] as const,
  channels: ["channels"] as const,
  mcp: ["mcp"] as const,
  telemetry: ["telemetry"] as const,
  healthSnapshot: ["health", "snapshot"] as const,
  voice: ["voice"] as const,
  deliveries: ["deliveries"] as const,
  workflows: ["workflows"] as const,
  agents: ["agents"] as const,
  // Contract 1.11 domains. Most have NO wire event (poll-while-relevant +
  // mutation-invalidate); exceptions noted per key.
  fleetAttempts: ["fleet", "attempts"] as const,
  fleetConflicts: ["fleet", "conflicts"] as const,
  fleetGraph: (workstreamId: string) => ["fleet", "graph", workstreamId] as const,
  ciWatches: ["ci", "watches"] as const,
  skills: ["skills"] as const,
  principals: ["principals"] as const,
  channelProfiles: ["channels", "profiles"] as const,
  checkinConfig: ["checkin", "config"] as const,
  checkinReceipts: ["checkin", "receipts"] as const,
  pairingTokens: ["pairing", "tokens"] as const,
  pairingPosture: ["pairing", "posture"] as const,
  permissionRules: ["permissions", "rules"] as const,
  powerStatus: ["power", "status"] as const, // invalidate on OPS_POWER_STATE_CHANGED
  opsMemory: ["ops", "memory"] as const, // invalidate on OPS_MEMORY_PRESSURE
  runtimeMetrics: ["runtime", "metrics"] as const,
  costAttribution: (window: string, dimension: string) => ["cost", "attribution", window, dimension] as const,
  quotaSnapshot: (provider: string) => ["quota", "snapshot", provider] as const,
  flagsGraduation: ["flags", "graduation"] as const,
  tailscale: ["tailscale"] as const,
  workspaceRegistrations: ["workspaces", "registrations"] as const,
  voiceLocal: ["voice", "local"] as const,
  acpAgents: ["acp", "agents"] as const,
  memoryProjections: ["memory", "projections"] as const,
  memoryConsolidation: ["memory", "consolidation"] as const,
  sessionChanges: (sessionId: string) => ["sessions", sessionId, "changes"] as const,
  sessionContextUsage: (sessionId: string) => ["sessions", sessionId, "context-usage"] as const,
  sessionPermissionMode: (sessionId: string) => ["sessions", sessionId, "permission-mode"] as const,
  sessionQueuedMessages: (sessionId: string) => ["sessions", sessionId, "queued-messages"] as const,
} as const;

export async function fetchAppHealth(): Promise<AppHealth> {
  return appJson<AppHealth>("/app/health");
}

export interface BootEntry {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Boot snapshot: one Promise.allSettled sweep priming the query cache so the
 * shell hydrates without a request waterfall. Failures are recorded per-key,
 * never thrown — the shell paints regardless.
 */
export async function loadBootSnapshot(queryClient: QueryClient): Promise<Record<string, BootEntry>> {
  const loads: Array<{ key: readonly unknown[]; name: string; run: () => Promise<unknown> }> = [
    { key: queryKeys.status, name: "status", run: () => gv.control.status() },
    { key: queryKeys.control, name: "control", run: () => gv.control.snapshot() },
    { key: queryKeys.providers, name: "providers", run: () => gv.providers.list() },
    { key: queryKeys.tasks, name: "tasks", run: () => gv.tasks.list() },
    { key: queryKeys.approvals, name: "approvals", run: () => gv.approvals.list() },
    { key: queryKeys.sessions, name: "sessions", run: () => gv.sessions.list() },
    { key: queryKeys.chatSessions, name: "chatSessions", run: () => gv.chat.sessions.list() },
  ];

  const settled = await Promise.allSettled(loads.map((l) => l.run()));
  const report: Record<string, BootEntry> = {};
  settled.forEach((entry, index) => {
    const load = loads[index];
    if (!load) return;
    if (entry.status === "fulfilled") {
      queryClient.setQueryData(load.key, entry.value);
      report[load.name] = { ok: true, value: entry.value };
    } else {
      report[load.name] = {
        ok: false,
        error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
      };
    }
  });
  return report;
}
