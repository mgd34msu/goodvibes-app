// "Approve from the tree": renders the real, correlated pending approvals for
// a selected fleet node inline in its detail pane, with approve/deny actions.
// Correlation is fleet.ts's approvalsForNode — the exact sessionId /
// metadata.agentId matching the daemon itself uses to derive a node's
// 'awaiting-approval' state. Shares queryKeys.approvals with the Approvals
// view, so a decision here reflects there instantly (the `permissions`
// realtime domain already invalidates that key). Deny requires a note
// (docs/UX.md §4).

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isSessionClosedError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { approvalsForNode, approvalsFromListResponse, type FleetApproval, type FleetNode } from "./fleet.ts";

function friendlyError(error: unknown): string {
  if (isSessionClosedError(error)) return "That session is closed — the approval can no longer be actioned.";
  return formatError(error);
}

function ApprovalCard({ approval }: { approval: FleetApproval }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.approvals });

  const approve = useMutation({
    mutationFn: () => gv.approvals.approve(approval.id),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Approved", tone: "success" });
    },
    onError: (error: unknown) =>
      toast({ title: "Approve failed", description: friendlyError(error), tone: "danger" }),
  });

  const deny = useMutation({
    mutationFn: (denyNote: string) => gv.approvals.deny(approval.id, { note: denyNote }),
    onSuccess: async () => {
      await invalidate();
      setDenying(false);
      setNote("");
      toast({ title: "Denied", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Deny failed", description: friendlyError(error), tone: "danger" }),
  });

  return (
    <li className="fleet-approval">
      <div className="fleet-approval__head">
        <strong className="fleet-approval__tool">{approval.tool || "tool call"}</strong>
        <span className="fleet-approval__badges">
          {approval.category && <span className="badge neutral">{approval.category}</span>}
          {approval.riskLevel && <StatusBadge value={`risk ${approval.riskLevel}`} />}
          <StatusBadge value={approval.status} />
        </span>
      </div>
      {approval.summary && <p className="fleet-approval__summary">{approval.summary}</p>}
      <div className="fleet-approval__actions">
        <button
          type="button"
          className="fleet-action fleet-action--primary"
          disabled={approve.isPending || deny.isPending}
          onClick={() => approve.mutate()}
        >
          {approve.isPending ? "Approving…" : "Approve"}
        </button>
        {!denying && (
          <button
            type="button"
            className="fleet-action fleet-action--danger"
            disabled={approve.isPending}
            onClick={() => setDenying(true)}
          >
            Deny…
          </button>
        )}
      </div>
      {denying && (
        <form
          className="fleet-approval__deny"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = note.trim();
            if (trimmed && !deny.isPending) deny.mutate(trimmed);
          }}
        >
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this denied? (required — the agent sees this note)"
            rows={2}
            aria-label="Denial note"
          />
          <div className="fleet-approval__deny-actions">
            <button type="button" className="fleet-action" onClick={() => setDenying(false)}>
              Cancel
            </button>
            <button type="submit" className="fleet-action fleet-action--danger" disabled={!note.trim() || deny.isPending}>
              {deny.isPending ? "Denying…" : "Deny with note"}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function FleetApprovalInline({ node }: { node: FleetNode }) {
  const approvals = useQuery({
    queryKey: queryKeys.approvals,
    queryFn: () => gv.approvals.list(),
  });

  const matches = useMemo(
    () => approvalsForNode(node, approvalsFromListResponse(approvals.data)),
    [node, approvals.data],
  );

  if (approvals.isPending || matches.length === 0) return null;

  return (
    <div className="fleet-detail__approvals">
      <strong>{matches.length === 1 ? "Pending approval" : `Pending approvals (${matches.length})`}</strong>
      <ul className="fleet-approvals">
        {matches.map((approval) => (
          <ApprovalCard key={approval.id} approval={approval} />
        ))}
      </ul>
    </div>
  );
}
