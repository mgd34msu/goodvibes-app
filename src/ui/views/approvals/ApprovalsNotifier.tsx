// Global approvals bridge, mounted once in AppShell: watches the shared
// approvals query for NEWLY pending approvals and raises an actionable toast
// ("answer from anywhere" — toast → jump, docs/UX.md §4), and registers the
// approvals/tasks palette commands so they exist without the view mounted.
//
// Honest gap: the native desktop-notification RPC path does not exist yet in
// src/bun (FEATURES §24) — until it lands, the in-app toast is the whole
// notification surface. Renders nothing.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../lib/queries.ts";
import { jumpToApprovals, useApprovalsSnapshot } from "../../lib/approvals.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useToast } from "../../lib/toast.ts";
import { requestTaskComposerFocus } from "./TasksSection.tsx";

const APPROVAL_TOAST_DURATION_MS = 12_000;

export function ApprovalsNotifier({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // The 60s interval is the honest fallback while the SSE stream is paused;
  // the `permissions` domain invalidation is the fast path.
  const approvals = useApprovalsSnapshot({ enabled, refetchInterval: 60_000 });

  // Baseline on the first successful load — never toast the backlog.
  const knownPendingRef = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (!approvals.data) return;
    const pending = approvals.data.approvals.filter((record) => record.status === "pending");
    const known = knownPendingRef.current;
    knownPendingRef.current = new Set(pending.map((record) => record.id));
    if (known === null) return;

    const fresh = pending.filter((record) => !known.has(record.id));
    if (fresh.length === 0) return;

    const first = fresh[0];
    if (fresh.length === 1 && first) {
      const summary = first.request.analysis.summary;
      toast({
        title: `Approval requested: ${first.request.tool}`,
        description: summary.length > 140 ? `${summary.slice(0, 140)}…` : summary || undefined,
        tone: "warning",
        durationMs: APPROVAL_TOAST_DURATION_MS,
        action: { label: "Review", onClick: () => jumpToApprovals({ approvalId: first.id }) },
      });
    } else {
      toast({
        title: `${fresh.length} new approvals pending`,
        tone: "warning",
        durationMs: APPROVAL_TOAST_DURATION_MS,
        action: { label: "Review", onClick: () => jumpToApprovals({ firstPending: true }) },
      });
    }
  }, [approvals.data, toast]);

  useEffect(() => {
    registerCommand({
      id: "approvals.review",
      title: "Review Pending Approvals",
      group: "work",
      keywords: ["approve", "deny", "pending", "permission", "review"],
      run: () => jumpToApprovals({ firstPending: true }),
    });
    registerCommand({
      id: "approvals.refresh",
      title: "Refresh Approvals & Tasks",
      group: "work",
      keywords: ["approvals", "tasks", "refresh", "reload"],
      run: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      },
    });
    registerCommand({
      id: "tasks.new",
      title: "New Task",
      group: "work",
      keywords: ["task", "create", "submit", "run"],
      run: () => {
        jumpToApprovals();
        requestTaskComposerFocus();
      },
    });
    return () => {
      unregisterCommand("approvals.review");
      unregisterCommand("approvals.refresh");
      unregisterCommand("tasks.new");
    };
  }, [queryClient]);

  return null;
}
