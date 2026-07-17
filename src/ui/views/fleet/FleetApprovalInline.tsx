// "Approve from the tree": renders the real, correlated pending approvals for
// a selected fleet node inline in its detail pane, using the SAME
// ApprovalCard component and deny-with-note modal as the Approvals view —
// full per-hunk diff rendering, claim/cancel, and decision trail. This used
// to be a second, crippled approve/deny implementation with no hunk
// rendering and no claimed-approval guard (an approval another surface had
// claimed could still be approved from here); reusing the shared card closes
// both gaps at once (FRICTION checklist items 3 & 5).
//
// Correlation is fleet.ts's approvalsForNode — the exact sessionId /
// metadata.agentId matching the daemon itself uses to derive a node's
// 'awaiting-approval' state. Shares queryKeys.approvals with the Approvals
// view, so a decision here reflects there instantly (the `permissions`
// realtime domain already invalidates that key).

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { parseApproval, readApprovalEditHunks, type ApprovalRecord } from "../../lib/approvals.ts";
import { formatError, isSessionClosedError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { clearDraft } from "../../lib/drafts.ts";
import { ApprovalCard } from "../approvals/ApprovalCard.tsx";
import { DenyModal } from "../approvals/ApprovalsTasksView.tsx";
import { approvalsForNode, approvalsFromListResponse, type FleetNode } from "./fleet.ts";

function friendlyError(error: unknown): string {
  if (isSessionClosedError(error)) return "That session is closed — the approval can no longer be actioned.";
  return formatError(error);
}

export function FleetApprovalInline({ node }: { node: FleetNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selections, setSelections] = useState<Record<string, ReadonlySet<number>>>({});
  const [denyTarget, setDenyTarget] = useState<ApprovalRecord | null>(null);

  const approvals = useQuery({
    queryKey: queryKeys.approvals,
    queryFn: () => gv.approvals.list(),
  });

  // approvalsForNode correlates on the flattened FleetApproval shape, but
  // every action here needs the FULL record (hunks, audit trail, claimedBy)
  // — parse each match's own `raw` payload rather than re-fetching.
  const matches = useMemo(() => {
    const flat = approvalsForNode(node, approvalsFromListResponse(approvals.data));
    return flat
      .map((entry) => parseApproval(entry.raw))
      .filter((record): record is ApprovalRecord => record !== null);
  }, [node, approvals.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.approvals });

  function toggleHunk(approvalId: string, index: number): void {
    setSelections((current) => {
      const existing = new Set(current[approvalId] ?? []);
      if (existing.has(index)) existing.delete(index);
      else existing.add(index);
      return { ...current, [approvalId]: existing };
    });
  }

  const approve = useMutation({
    mutationFn: ({ id, selectedHunks }: { id: string; selectedHunks?: readonly number[]; totalHunks?: number }) =>
      gv.approvals.approve(id, selectedHunks && selectedHunks.length > 0 ? { selectedHunks } : undefined),
    onSuccess: async (_result, variables) => {
      setSelections((current) => {
        const { [variables.id]: _removed, ...rest } = current;
        return rest;
      });
      await invalidate();
      const selectedCount = variables.selectedHunks?.length ?? 0;
      const isPartial =
        selectedCount > 0 && variables.totalHunks !== undefined && selectedCount < variables.totalHunks;
      toast({
        title: isPartial ? `Approved ${selectedCount} of ${variables.totalHunks} hunks` : "Approved",
        tone: "success",
      });
    },
    onError: (error: unknown) => toast({ title: "Approve failed", description: friendlyError(error), tone: "danger" }),
  });

  const deny = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => gv.approvals.deny(id, { note }),
    onSuccess: async (_result, variables) => {
      setDenyTarget(null);
      clearDraft(`approvals.deny-note.${variables.id}`);
      await invalidate();
      toast({ title: "Denied", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Deny failed", description: friendlyError(error), tone: "danger" }),
  });

  const claim = useMutation({
    mutationFn: (id: string) => gv.approvals.claim(id),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Claimed", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Claim failed", description: friendlyError(error), tone: "danger" }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => gv.approvals.cancel(id),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Cancelled", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Cancel failed", description: friendlyError(error), tone: "danger" }),
  });

  if (approvals.isPending || matches.length === 0) return null;

  return (
    <div className="fleet-detail__approvals">
      <strong>{matches.length === 1 ? "Pending approval" : `Pending approvals (${matches.length})`}</strong>
      <ul className="fleet-approvals">
        {matches.map((record) => (
          <ApprovalCard
            key={record.id}
            record={record}
            selected={selections[record.id] ?? new Set<number>()}
            onToggleHunk={(index) => toggleHunk(record.id, index)}
            onApprove={(selectedHunks) =>
              approve.mutate({
                id: record.id,
                selectedHunks,
                totalHunks: readApprovalEditHunks(record)?.length,
              })
            }
            onDeny={() => setDenyTarget(record)}
            onClaim={() => claim.mutate(record.id)}
            onCancel={() => cancel.mutate(record.id)}
            approving={approve.isPending && approve.variables?.id === record.id}
            denying={deny.isPending && deny.variables?.id === record.id}
            claiming={claim.isPending && claim.variables === record.id}
            cancelling={cancel.isPending && cancel.variables === record.id}
          />
        ))}
      </ul>

      <DenyModal
        key={denyTarget?.id ?? "none"}
        record={denyTarget}
        denying={deny.isPending}
        onClose={() => setDenyTarget(null)}
        onDeny={(id, note) => deny.mutate({ id, note })}
      />
    </div>
  );
}
