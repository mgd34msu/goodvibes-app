// Refine tab: gap-refinement runs (knowledge.refinement.run — admin, kicks
// off daemon-side search + ingest, so it is confirm-gated), the refinement
// task list with per-task cancel PLUS a single-task detail peek that polls
// every 4s while the fetched task is still active
// (knowledge.refinement.task.get — docs/GAPS.md §6 row 17), and the
// consolidation candidates review surface (knowledge.candidates.list /
// candidate.decide) — accept / reject / supersede are explicit per-row
// decisions, never auto-applied. `CandidatesSection` is exported for reuse
// by the Memory view's combined "Learning review" curator (§8 row 12).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ListChecks, Sparkles, XCircle } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { firstNumber, firstString } from "../../lib/wire.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState } from "../../components/feedback.tsx";
import { DataBlock, FactGrid, QueryStates } from "./KnowledgeBits.tsx";
import { KNOWLEDGE_PREFIX, kKeys, knowledgeId, knowledgeList, knowledgeTitle, scalarEntries } from "./lib.ts";

type Decision = "accept" | "reject" | "supersede";

// ─── Refinement ──────────────────────────────────────────────────────────────

function RefinementSection({ active }: { active: boolean }) {
  const queryClient = useQueryClient();
  const peek = usePeek();
  const { toast } = useToast();
  const [limit, setLimit] = useState("10");
  const [force, setForce] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const tasks = useQuery({
    queryKey: kKeys.refinementTasks,
    queryFn: () => invoke("knowledge.refinement.tasks.list", { query: { limit: 100 } }),
    // Refinement tasks progress in the background with no wire event — 15s poll.
    refetchInterval: active ? 15_000 : false,
  });

  const run = useMutation({
    mutationFn: (meta: ConfirmMetadata) => {
      const cap = Number(limit);
      return invoke("knowledge.refinement.run", {
        body: {
          ...(Number.isFinite(cap) && cap > 0 ? { limit: cap } : {}),
          ...(force ? { force: true } : {}),
          ...meta,
        },
      });
    },
    onSuccess: async () => {
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      toast({ title: "Refinement run finished", tone: "success" });
    },
    onError: (error: unknown) => {
      setConfirmOpen(false);
      toast({ title: "Refinement run failed", description: formatError(error), tone: "danger" });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => invoke("knowledge.refinement.task.cancel", { params: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: kKeys.refinementTasks });
      toast({ title: "Refinement task cancelled", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Cancel failed", description: formatError(error), tone: "danger" });
    },
  });

  const items = knowledgeList(tasks.data, "tasks");

  return (
    <section className="knowledge-panel" aria-label="Refinement">
      <header className="knowledge-panel__head">
        <h3>Refinement</h3>
        <Sparkles size={16} aria-hidden="true" />
      </header>

      <div className="knowledge-refine__controls">
        <label>
          Gap limit
          <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" aria-label="Gap limit" />
        </label>
        <label className="knowledge-form__check">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          Force (re-process suppressed gaps)
        </label>
        <button
          type="button"
          className="knowledge-button knowledge-button--primary"
          disabled={run.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {run.isPending ? "Running…" : "Run refinement"}
        </button>
      </div>

      {run.isSuccess && (
        <FactGrid facts={scalarEntries(run.data)} />
      )}
      {run.isSuccess && <DataBlock title="Raw refinement result" value={run.data} />}

      <QueryStates
        query={tasks}
        capability="knowledge.refinement.tasks.list"
        unavailableDescription="refinement task history is not served."
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={<Sparkles size={24} aria-hidden="true" />}
            title="No refinement tasks"
            description="Run refinement to scan knowledge gaps and repair them."
          />
        }
      >
        <ul className="knowledge-refine__tasks">
          {items.map((task, index) => {
            const id = knowledgeId(task);
            const title = knowledgeTitle(task, id || `Task ${index + 1}`);
            const state = firstString(task, ["state", "status"]) || "unknown";
            const cancellable = ["pending", "queued", "running", "in-progress"].includes(state.toLowerCase());
            return (
              <li key={id || index} className="knowledge-refine__task">
                <span className="knowledge-refine__task-head">
                  <strong>{title}</strong>
                  <StatusBadge value={state} />
                </span>
                {id && (
                  <button
                    type="button"
                    className="knowledge-button"
                    onClick={() => peek.open({ title, content: <RefinementTaskDetailPeek taskId={id} /> })}
                  >
                    Details
                  </button>
                )}
                {cancellable && id && (
                  <button
                    type="button"
                    className="knowledge-button"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(id)}
                  >
                    Cancel
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </QueryStates>

      <ConfirmSurface
        open={confirmOpen}
        action="Run knowledge refinement"
        target={`up to ${limit || "all"} knowledge gaps`}
        blastRadius="The daemon searches for and may INGEST new sources to repair gaps — this writes to the knowledge store."
        confirmLabel="Run refinement"
        onConfirm={(meta) => run.mutate(meta)}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}

const REFINEMENT_TASK_ACTIVE_STATES = ["pending", "queued", "running", "in-progress"];

function RefinementTaskDetailPeek({ taskId }: { taskId: string }) {
  const task = useQuery({
    queryKey: kKeys.refinementTaskDetail(taskId),
    queryFn: () => invoke("knowledge.refinement.task.get", { params: { id: taskId } }),
    // Refreshable while the task is in flight — poll every 4s as long as the
    // fetched state is still active, stop once it settles (docs/GAPS.md §6
    // row 17: "refreshable while a task runs").
    refetchInterval: (query) => {
      const state = firstString(query.state.data, ["state", "status"]).toLowerCase();
      return REFINEMENT_TASK_ACTIVE_STATES.includes(state) ? 4_000 : false;
    },
  });
  return (
    <div className="knowledge-peek-body">
      <QueryStates
        query={task}
        capability="knowledge.refinement.task.get"
        unavailableDescription="refinement task details cannot be loaded."
        isEmpty={false}
        empty={null}
      >
        <DataBlock title="Refinement task" value={task.data} open />
      </QueryStates>
    </div>
  );
}

// ─── Candidates ──────────────────────────────────────────────────────────────

// Exported so the Memory view can embed this same query/mutation logic in
// its combined "Learning review" curator surface (docs/GAPS.md §8 row 12)
// without duplicating the candidates.list/candidate.decide wiring.
export function CandidatesSection({ active }: { active: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pendingKey, setPendingKey] = useState("");

  const candidates = useQuery({
    queryKey: kKeys.candidates,
    queryFn: () => invoke("knowledge.candidates.list", { query: { limit: 50 } }),
    // Candidates are produced by background consolidation — 30s poll while visible.
    refetchInterval: active ? 30_000 : false,
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: Decision }) =>
      invoke("knowledge.candidate.decide", { params: { id }, body: { decision } }),
    onSuccess: async (_result, variables) => {
      setPendingKey("");
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      const past: Record<Decision, string> = { accept: "accepted", reject: "rejected", supersede: "superseded" };
      toast({ title: `Candidate ${past[variables.decision]}`, tone: "success" });
    },
    onError: (error: unknown) => {
      setPendingKey("");
      toast({ title: "Decision failed", description: formatError(error), tone: "danger" });
    },
  });

  const items = knowledgeList(candidates.data, "candidates");

  return (
    <section className="knowledge-panel" aria-label="Consolidation candidates">
      <header className="knowledge-panel__head">
        <h3>Candidates</h3>
        <ListChecks size={16} aria-hidden="true" />
      </header>
      <QueryStates
        query={candidates}
        capability="knowledge.candidates.list"
        unavailableDescription="consolidation candidates cannot be reviewed."
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={<ListChecks size={24} aria-hidden="true" />}
            title="No consolidation candidates"
            description="Candidates appear when the knowledge base scores something worth promoting, reviewing, or refreshing."
          />
        }
      >
        <ul className="knowledge-candidates">
          {items.map((candidate, index) => {
            const id = knowledgeId(candidate) || String(index);
            const title = knowledgeTitle(candidate, "Untitled candidate");
            const status = firstString(candidate, ["status"]) || "unknown";
            const candidateType = firstString(candidate, ["candidateType", "kind"]);
            const score = firstNumber(candidate, ["score"]);
            const summary = firstString(candidate, ["summary", "reason"]);
            const busy = decide.isPending && pendingKey === id;
            const decided = status !== "pending" && status !== "unknown";
            return (
              <li key={id} className="knowledge-candidates__row">
                <span className="knowledge-candidates__head">
                  <strong>{title}</strong>
                  <StatusBadge value={status} />
                </span>
                {summary && <p className="knowledge-candidates__summary">{summary}</p>}
                <p className="knowledge-candidates__meta">
                  {candidateType || "candidate"}
                  {score !== undefined && <> · score {score.toFixed(2)}</>}
                </p>
                {!decided && (
                  <span className="knowledge-candidates__actions">
                    <button
                      type="button"
                      className="knowledge-button"
                      disabled={busy}
                      onClick={() => {
                        setPendingKey(id);
                        decide.mutate({ id, decision: "accept" });
                      }}
                    >
                      <CheckCircle2 size={13} aria-hidden="true" /> Accept
                    </button>
                    <button
                      type="button"
                      className="knowledge-button"
                      disabled={busy}
                      onClick={() => {
                        setPendingKey(id);
                        decide.mutate({ id, decision: "reject" });
                      }}
                    >
                      <XCircle size={13} aria-hidden="true" /> Reject
                    </button>
                    <button
                      type="button"
                      className="knowledge-button"
                      disabled={busy}
                      onClick={() => {
                        setPendingKey(id);
                        decide.mutate({ id, decision: "supersede" });
                      }}
                    >
                      Supersede
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </QueryStates>
    </section>
  );
}

export function RefinePanel({ active }: { active: boolean }) {
  return (
    <div className="knowledge-two-col">
      <RefinementSection active={active} />
      <CandidatesSection active={active} />
    </div>
  );
}
