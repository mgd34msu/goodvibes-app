// Approvals & Tasks — human-in-the-loop (docs/FEATURES.md §4).
//
// Approvals: pending / claimed / history tabs over approvals.list, with a
// category × risk matrix for the active tab. The hero interaction is per-hunk
// edit approval: a pending edit approval's request.args.edits render as real
// diffs with per-hunk checkboxes; "Approve selected" sends
// approvals.approve({ selectedHunks }) — an INDEX ARRAY ONLY, the daemon
// computes the modified edit so every surface agrees. Deny always requires a
// note (docs/UX.md §4). Claim locks a pending approval; Cancel withdraws it
// without deciding. Realtime rides the `permissions` domain invalidation.
//
// Deep links: ?filter[approval]=<id> (and the module focus store fed by
// jumpToApprovals — the toast → jump flow) selects the right tab, scrolls the
// card into view, and highlights it.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import {
  consumeApprovalFocus,
  readApprovalEditHunks,
  riskTone,
  sortApprovalsNewestFirst,
  subscribeApprovalFocus,
  useApprovalsSnapshot,
  type ApprovalFocusTarget,
  type ApprovalRecord,
} from "../../lib/approvals.ts";
import { formatError, isMethodUnavailableError, isSessionClosedError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { useUrlState } from "../../lib/router.ts";
import { Modal } from "../../components/Modal.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { TasksSection } from "./TasksSection.tsx";

function friendlyError(error: unknown): string {
  if (isSessionClosedError(error)) {
    return "That session is closed — the approval can no longer be actioned.";
  }
  return formatError(error);
}

type ApprovalTab = "pending" | "claimed" | "history";

function tabForStatus(status: string): ApprovalTab {
  if (status === "pending") return "pending";
  if (status === "claimed") return "claimed";
  return "history";
}

export function ApprovalsTasksView() {
  return (
    <div className="approvals-tasks-view">
      <ApprovalsSection />
      <TasksSection />
    </div>
  );
}

// ─── Approvals ───────────────────────────────────────────────────────────────

function ApprovalsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { filters } = useUrlState();
  const [tab, setTab] = useState<ApprovalTab>("pending");
  const [selections, setSelections] = useState<Record<string, ReadonlySet<number>>>({});
  const [denyTarget, setDenyTarget] = useState<ApprovalRecord | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<ApprovalFocusTarget | null>(() => {
    // URL deep link is the mount-time focus request; the module store (fed by
    // jumpToApprovals) overrides it when a jump just happened.
    const fromStore = consumeApprovalFocus();
    if (fromStore) return fromStore;
    const fromUrl = filters["approval"];
    return fromUrl ? { approvalId: fromUrl } : null;
  });
  const listRef = useRef<HTMLUListElement>(null);

  const approvals = useApprovalsSnapshot();
  const rows = useMemo(() => sortApprovalsNewestFirst(approvals.data?.approvals ?? []), [approvals.data]);

  const byTab = useMemo(
    () => ({
      pending: rows.filter((r) => r.status === "pending"),
      claimed: rows.filter((r) => r.status === "claimed"),
      history: rows.filter((r) => r.status !== "pending" && r.status !== "claimed"),
    }),
    [rows],
  );
  const activeRows = byTab[tab];

  // Focus requests arriving while the view is already mounted (toast → jump).
  useEffect(
    () =>
      subscribeApprovalFocus(() => {
        const target = consumeApprovalFocus();
        if (target) setFocusTarget(target);
      }),
    [],
  );

  // Resolve the focus target once rows are loaded: pick the record, switch to
  // its tab, highlight, and scroll it into view after paint.
  useEffect(() => {
    if (!focusTarget || !approvals.isSuccess) return;
    const record =
      "approvalId" in focusTarget
        ? rows.find((r) => r.id === focusTarget.approvalId)
        : rows.find((r) => r.status === "pending");
    setFocusTarget(null);
    if (!record) return;
    setTab(tabForStatus(record.status));
    setFocusedId(record.id);
  }, [focusTarget, approvals.isSuccess, rows]);

  useEffect(() => {
    if (!focusedId) return;
    const element = listRef.current?.querySelector(`[data-approval-id="${CSS.escape(focusedId)}"]`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedId, tab, activeRows.length]);

  function toggleHunk(approvalId: string, index: number): void {
    setSelections((current) => {
      const existing = new Set(current[approvalId] ?? []);
      if (existing.has(index)) existing.delete(index);
      else existing.add(index);
      return { ...current, [approvalId]: existing };
    });
  }

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
    [queryClient],
  );

  const approve = useMutation({
    mutationFn: ({ id, selectedHunks }: { id: string; selectedHunks?: readonly number[]; totalHunks?: number }) =>
      gv.approvals.approve(id, selectedHunks && selectedHunks.length > 0 ? { selectedHunks } : undefined),
    onSuccess: async (_result, variables) => {
      setSelections((current) => {
        const { [variables.id]: _removed, ...rest } = current;
        return rest;
      });
      await invalidate();
      // A subset was sent only when selectedHunks is non-empty AND shorter
      // than the full hunk count — selecting every hunk (or "Approve all")
      // is a full approval, not a partial one.
      const selectedCount = variables.selectedHunks?.length ?? 0;
      const isPartial =
        selectedCount > 0 && variables.totalHunks !== undefined && selectedCount < variables.totalHunks;
      toast({
        title: isPartial ? `Approved ${selectedCount} of ${variables.totalHunks} hunks` : "Approved",
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Approve failed", description: friendlyError(error), tone: "danger" });
    },
  });

  const deny = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => gv.approvals.deny(id, { note }),
    onSuccess: async () => {
      setDenyTarget(null);
      await invalidate();
      toast({ title: "Denied", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Deny failed", description: friendlyError(error), tone: "danger" });
    },
  });

  const claim = useMutation({
    mutationFn: (id: string) => gv.approvals.claim(id),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Claimed", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Claim failed", description: friendlyError(error), tone: "danger" });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => gv.approvals.cancel(id),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Cancelled", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Cancel failed", description: friendlyError(error), tone: "danger" });
    },
  });

  const unavailable = approvals.isError && isMethodUnavailableError(approvals.error);

  const TAB_LABELS: Record<ApprovalTab, string> = {
    pending: "Pending",
    claimed: "Claimed",
    history: "History",
  };

  return (
    <section className="approvals-section" aria-label="Approvals">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <ClipboardCheck size={14} aria-hidden="true" /> Approvals
          {approvals.isSuccess ? ` · ${byTab.pending.length} pending` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh approvals"
          onClick={() => void approvals.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={approvals.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      <div className="approvals-tabs" role="tablist" aria-label="Approval status">
        {(Object.keys(TAB_LABELS) as ApprovalTab[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "approvals-tab approvals-tab--active" : "approvals-tab"}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
            <span className="approvals-tab__count">{byTab[id].length}</span>
          </button>
        ))}
      </div>

      {approvals.isSuccess && activeRows.length > 0 && <ApprovalClassMatrix rows={activeRows} />}

      {approvals.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState
          capability="approvals.list"
          description="human-in-the-loop approvals cannot be listed or decided."
        />
      )}

      {approvals.isError && !unavailable && (
        <ErrorState
          error={approvals.error}
          onRetry={() => void approvals.refetch()}
          title="Failed to load approvals"
        />
      )}

      {approvals.isSuccess && activeRows.length === 0 && (
        <EmptyState
          icon={<ClipboardCheck size={28} aria-hidden="true" />}
          title={tab === "pending" ? "No pending approvals" : `No ${tab} approvals`}
          description={
            tab === "pending"
              ? "Approval requests from agents and tools will appear here while they wait for a decision."
              : tab === "claimed"
                ? "Approvals locked by a surface show up here until they are resolved."
                : "Approved, denied, cancelled, and expired approvals form the audit history here."
          }
        />
      )}

      {approvals.isSuccess && activeRows.length > 0 && (
        <ul className="approvals-rows" ref={listRef}>
          {activeRows.map((record) => (
            <ApprovalCard
              key={record.id}
              record={record}
              selected={selections[record.id] ?? new Set<number>()}
              focused={focusedId === record.id}
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
      )}

      <DenyModal
        record={denyTarget}
        denying={deny.isPending}
        onClose={() => setDenyTarget(null)}
        onDeny={(id, note) => deny.mutate({ id, note })}
      />
    </section>
  );
}

// ─── Deny modal (a note is REQUIRED — docs/UX.md §4) ─────────────────────────

function DenyModal({
  record,
  denying,
  onClose,
  onDeny,
}: {
  record: ApprovalRecord | null;
  denying: boolean;
  onClose: () => void;
  onDeny: (id: string, note: string) => void;
}) {
  const [note, setNote] = useState("");

  // Reset the draft whenever a new approval is targeted.
  const recordId = record?.id ?? null;
  useEffect(() => {
    setNote("");
  }, [recordId]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = note.trim();
    if (!record || !trimmed || denying) return;
    onDeny(record.id, trimmed);
  }

  return (
    <Modal open={record !== null} onClose={onClose} title="Deny approval">
      {record && (
        <form className="deny-form" onSubmit={handleSubmit}>
          <p className="deny-form__context">
            Denying <strong>{record.request.tool}</strong>
            {record.request.analysis.summary ? ` — ${record.request.analysis.summary}` : ""}. The requesting agent
            sees your note as the reason.
          </p>
          <label className="deny-form__label" htmlFor="deny-note">
            Reason (required)
          </label>
          <textarea
            id="deny-note"
            className="deny-form__note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this request is denied"
            disabled={denying}
          />
          <div className="deny-form__actions">
            <button type="button" className="deny-form__cancel" onClick={onClose} disabled={denying}>
              Keep pending
            </button>
            <button type="submit" className="deny-form__submit" disabled={!note.trim() || denying}>
              {denying ? "Denying…" : "Deny with note"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ─── Category × risk matrix ──────────────────────────────────────────────────
// Grounded entirely in fields already on ApprovalRecord (request.category,
// request.analysis.riskLevel) — both open, daemon-defined vocabularies this
// client renders verbatim, so the matrix groups by whatever strings are
// actually present rather than a fixed enum.

function ApprovalClassMatrix({ rows }: { rows: readonly ApprovalRecord[] }) {
  const matrix = useMemo(() => {
    const byCategory = new Map<string, Map<string, number>>();
    for (const record of rows) {
      const category = record.request.category || "uncategorized";
      const risk = record.request.analysis.riskLevel || "unknown";
      const byRisk = byCategory.get(category) ?? new Map<string, number>();
      byRisk.set(risk, (byRisk.get(risk) ?? 0) + 1);
      byCategory.set(category, byRisk);
    }
    return [...byCategory.entries()]
      .map(([category, byRisk]) => ({
        category,
        total: [...byRisk.values()].reduce((sum, n) => sum + n, 0),
        byRisk: [...byRisk.entries()].sort((a, b) => b[1] - a[1]),
      }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  if (matrix.length === 0) return null;

  return (
    <div className="approval-class-matrix" role="table" aria-label="Approvals by category and risk">
      {matrix.map(({ category, total, byRisk }) => (
        <div key={category} className="approval-class-matrix__row" role="row">
          <span className="approval-class-matrix__category" role="cell">
            {category}
          </span>
          <span className="badge neutral" role="cell">
            {total}
          </span>
          <span className="approval-class-matrix__risks" role="cell">
            {byRisk.map(([risk, count]) => (
              <span key={risk} className={`badge ${riskTone(risk)}`}>
                {risk} × {count}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
