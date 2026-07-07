// Project planning tab: `projectPlanning.*` (docs/FEATURES.md §6 rows 23-24,
// docs/GAPS.md gap #2). Shapes read straight off the SDK's own d.ts
// (node_modules/@pellux/goodvibes-sdk/dist/platform/knowledge/
// project-planning/types.d.ts) rather than guessed field names.
//
// Capability-honesty at the panel level: `status` is probed once; when it
// 404s the whole tab renders a single UnavailableState instead of 17 broken
// sections. Each section below still uses its own QueryStates/mutation error
// handling for the case where the integration exists but one specific method
// doesn't (wire-or-delete: every method is invoked for real).
//
// `state.upsert` and `language.upsert` accept a rich partial-object shape
// (ProjectPlanningState / ProjectPlanningLanguageArtifact — goal, scope,
// assumptions, constraints, risks, tasks, dependencies, verification gates,
// agent assignments, terms, ambiguities…) too large to hand-author a
// dedicated field per key. Rather than lock the UI to a guessed subset, both
// editors are a JSON textarea prefilled with the current record — every
// field the daemon accepts is reachable, not just the ones this view picked.
// Work-plan tasks, by contrast, have small well-typed CRUD bodies, so those
// get real structured forms (the "kanban-ish checklist UI" docs/UX.md calls
// for).
//
// All access:"admin" routes go through the single shared
// PendingConfirmSurface (confirm:true + explicitUserRequest); `evaluate` and
// the `*.get`/`*.list` reads are access:"authenticated" and run directly.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, CheckSquare, Compass, Languages, ListTodo, Trash2 } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import type { ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  DataBlock,
  FactGrid,
  JsonParamsField,
  parseJsonParams,
  PendingConfirmSurface,
  QueryStates,
  type PendingAction,
} from "./KnowledgeBits.tsx";
import { kKeys, graphId, graphTitle, scalarEntries } from "./lib.ts";

const PP = "projectPlanning";

const WORK_PLAN_STATUSES = ["pending", "in_progress", "blocked", "done", "failed", "cancelled"] as const;
type WorkPlanTaskStatus = (typeof WORK_PLAN_STATUSES)[number];

// ─── Availability probe ─────────────────────────────────────────────────────

function usePlanningProbe() {
  return useQuery({
    queryKey: kKeys.planningProbe,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      try {
        return await invoke(`${PP}.status`);
      } catch (error) {
        if (isMethodUnavailableError(error)) return null;
        throw error;
      }
    },
  });
}

// ─── Status ──────────────────────────────────────────────────────────────────

function StatusSection({ status }: { status: unknown }) {
  const record = asRecord(status);
  const counts = asRecord(record["counts"]);
  const capabilities = firstArray(record, ["capabilities"]).filter((c): c is string => typeof c === "string");
  return (
    <section className="knowledge-status" aria-label="Project planning status">
      <div className="knowledge-status__tiles">
        {scalarEntries(counts).map(([key, value]) => (
          <div key={key} className="knowledge-status__tile">
            <span className="knowledge-status__value">{value}</span>
            <span className="knowledge-status__label">{key}</span>
          </div>
        ))}
      </div>
      {capabilities.length > 0 && <p className="knowledge-hint">Capabilities: {capabilities.join(", ")}</p>}
    </section>
  );
}

// ─── State (goal / scope / assumptions / tasks / gates…) ────────────────────

function StateSection({ requestConfirm }: { requestConfirm: (action: PendingAction) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("{}");

  const state = useQuery({ queryKey: kKeys.planningState, queryFn: () => invoke(`${PP}.state.get`) });

  const upsert = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${PP}.state.upsert`, { body: { state: parseJsonParams(draft), ...meta } }),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: kKeys.planningState });
      toast({ title: "Planning state saved", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Save failed", description: formatError(error), tone: "danger" }),
  });

  const record = asRecord(state.data)["state"];
  const stateRecord = asRecord(record);
  const readiness = firstString(stateRecord, ["readiness"]) || "unknown";
  const goal = firstString(stateRecord, ["goal"]);
  const scope = firstString(stateRecord, ["scope"]);
  const lists: ReadonlyArray<readonly [string, string]> = [
    ["Known context", firstArray(stateRecord, ["knownContext"]).join("; ")],
    ["Assumptions", firstArray(stateRecord, ["assumptions"]).join("; ")],
    ["Constraints", firstArray(stateRecord, ["constraints"]).join("; ")],
    ["Risks", firstArray(stateRecord, ["risks"]).join("; ")],
  ];
  const tasks = firstArray(stateRecord, ["tasks"]);
  const gates = firstArray(stateRecord, ["verificationGates"]);
  const openQuestions = firstArray(stateRecord, ["openQuestions"]);

  function startEdit() {
    const editable = { ...stateRecord };
    delete (editable as Record<string, unknown>)["id"];
    delete (editable as Record<string, unknown>)["projectId"];
    delete (editable as Record<string, unknown>)["knowledgeSpaceId"];
    delete (editable as Record<string, unknown>)["createdAt"];
    delete (editable as Record<string, unknown>)["updatedAt"];
    setDraft(JSON.stringify(editable, null, 2));
    setEditing(true);
  }

  return (
    <section className="knowledge-panel" aria-label="Planning state">
      <header className="knowledge-panel__head">
        <h3>State</h3>
        <Compass size={16} aria-hidden="true" />
      </header>
      <QueryStates
        query={state}
        capability={`${PP}.state.get`}
        unavailableDescription="the planning state cannot be loaded."
        isEmpty={!record}
        empty={
          <EmptyState
            icon={<Compass size={24} aria-hidden="true" />}
            title="No planning state yet"
            description="Nothing has recorded a goal for this project. Use Edit state below to start one."
            action={{ label: "Start planning state", onClick: startEdit }}
          />
        }
      >
        {!editing ? (
          <>
            <div className="knowledge-status__meta">
              <StatusBadge value={readiness} />
              {goal && <strong>{goal}</strong>}
            </div>
            {scope && <p>{scope}</p>}
            <FactGrid facts={lists.filter(([, value]) => value)} />
            {openQuestions.length > 0 && (
              <DataBlock title={`Open questions (${openQuestions.length})`} value={openQuestions} />
            )}
            {tasks.length > 0 && <DataBlock title={`Planning tasks (${tasks.length})`} value={tasks} />}
            {gates.length > 0 && <DataBlock title={`Verification gates (${gates.length})`} value={gates} />}
            <button type="button" className="knowledge-button" onClick={startEdit}>
              Edit state
            </button>
          </>
        ) : (
          <div className="knowledge-form">
            <JsonParamsField value={draft} onChange={setDraft} label="State (JSON — replaces the fields you include)" />
            <div className="knowledge-form__split">
              <button
                type="button"
                className="knowledge-button knowledge-button--primary"
                disabled={upsert.isPending}
                onClick={() =>
                  requestConfirm({
                    action: "Save planning state",
                    target: goal || "(new planning state)",
                    blastRadius: "Replaces the planning state fields included in this JSON for the current project.",
                    run: (meta) => upsert.mutate(meta),
                  })
                }
              >
                {upsert.isPending ? "Saving…" : "Save"}
              </button>
              <button type="button" className="knowledge-button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </QueryStates>
    </section>
  );
}

// ─── Language (terms / ambiguities) ─────────────────────────────────────────

function LanguageSection({ requestConfirm }: { requestConfirm: (action: PendingAction) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("{}");

  const language = useQuery({ queryKey: kKeys.planningLanguage, queryFn: () => invoke(`${PP}.language.get`) });

  const upsert = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${PP}.language.upsert`, { body: { language: parseJsonParams(draft), ...meta } }),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: kKeys.planningLanguage });
      toast({ title: "Project language saved", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Save failed", description: formatError(error), tone: "danger" }),
  });

  const record = asRecord(language.data)["language"];
  const languageRecord = asRecord(record);
  const terms = firstArray(languageRecord, ["terms"]);
  const ambiguities = firstArray(languageRecord, ["ambiguities"]);

  function startEdit() {
    const editable = { terms, ambiguities, examples: firstArray(languageRecord, ["examples"]) };
    setDraft(JSON.stringify(editable, null, 2));
    setEditing(true);
  }

  return (
    <section className="knowledge-panel" aria-label="Project language">
      <header className="knowledge-panel__head">
        <h3>Language</h3>
        <Languages size={16} aria-hidden="true" />
      </header>
      <QueryStates
        query={language}
        capability={`${PP}.language.get`}
        unavailableDescription="the disambiguated project vocabulary cannot be loaded."
        isEmpty={!record}
        empty={
          <EmptyState
            title="No terms defined"
            description="Define project-specific terms and resolved ambiguities so every agent means the same thing."
            action={{ label: "Add terms", onClick: startEdit }}
          />
        }
      >
        {!editing ? (
          <>
            {terms.length > 0 && (
              <ul className="knowledge-records">
                {terms.map((term, index) => {
                  const t = asRecord(term);
                  return (
                    <li key={firstString(t, ["term"]) || index} className="knowledge-records__row">
                      <strong>{firstString(t, ["term"])}</strong>
                      <span className="knowledge-records__summary">{firstString(t, ["definition"])}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {ambiguities.length > 0 && <DataBlock title={`Resolved ambiguities (${ambiguities.length})`} value={ambiguities} />}
            <button type="button" className="knowledge-button" onClick={startEdit}>
              Edit language
            </button>
          </>
        ) : (
          <div className="knowledge-form">
            <JsonParamsField value={draft} onChange={setDraft} label="Terms / ambiguities / examples (JSON)" />
            <div className="knowledge-form__split">
              <button
                type="button"
                className="knowledge-button knowledge-button--primary"
                disabled={upsert.isPending}
                onClick={() =>
                  requestConfirm({
                    action: "Save project language",
                    target: `${terms.length} term(s)`,
                    blastRadius: "Replaces the project's disambiguated vocabulary with this list.",
                    run: (meta) => upsert.mutate(meta),
                  })
                }
              >
                {upsert.isPending ? "Saving…" : "Save"}
              </button>
              <button type="button" className="knowledge-button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </QueryStates>
    </section>
  );
}

// ─── Decisions ───────────────────────────────────────────────────────────────

function DecisionsSection({ requestConfirm }: { requestConfirm: (action: PendingAction) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [decisionText, setDecisionText] = useState("");
  const [context, setContext] = useState("");

  const decisions = useQuery({ queryKey: kKeys.planningDecisions, queryFn: () => invoke(`${PP}.decisions.list`) });

  const record = useMutation({
    mutationFn: (meta: ConfirmMetadata) =>
      invoke(`${PP}.decisions.record`, {
        body: {
          decision: {
            title: title.trim(),
            decision: decisionText.trim(),
            ...(context.trim() ? { context: context.trim() } : {}),
          },
          ...meta,
        },
      }),
    onSuccess: async () => {
      setTitle("");
      setDecisionText("");
      setContext("");
      await queryClient.invalidateQueries({ queryKey: kKeys.planningDecisions });
      toast({ title: "Decision recorded", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Record failed", description: formatError(error), tone: "danger" }),
  });

  const items = firstArray(decisions.data, ["decisions"]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!title.trim() || !decisionText.trim() || record.isPending) return;
    requestConfirm({
      action: "Record planning decision",
      target: title.trim(),
      blastRadius: "Adds a permanent decision record to this project's planning timeline.",
      run: (meta) => record.mutate(meta),
    });
  }

  return (
    <section className="knowledge-panel" aria-label="Planning decisions">
      <header className="knowledge-panel__head">
        <h3>Decisions</h3>
        <BookMarked size={16} aria-hidden="true" />
      </header>
      <form className="knowledge-form" onSubmit={submit}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Decision title" />
        </label>
        <label>
          Decision
          <textarea value={decisionText} onChange={(e) => setDecisionText(e.target.value)} rows={2} placeholder="What was decided" />
        </label>
        <label>
          Context (optional)
          <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} />
        </label>
        <button
          type="submit"
          className="knowledge-button knowledge-button--primary"
          disabled={!title.trim() || !decisionText.trim() || record.isPending}
        >
          {record.isPending ? "Recording…" : "Record decision"}
        </button>
      </form>
      <QueryStates
        query={decisions}
        capability={`${PP}.decisions.list`}
        unavailableDescription="the decision timeline is not served."
        isEmpty={items.length === 0}
        empty={<EmptyState title="No decisions recorded" description="Record a decision above to start the timeline." />}
      >
        <ul className="knowledge-records">
          {[...items].reverse().map((decision, index) => {
            const status = firstString(decision, ["status"]) || "proposed";
            const decisionTitle = graphTitle(decision, `Decision ${index + 1}`);
            const body = firstString(decision, ["decision"]);
            return (
              <li key={graphId(decision) || index} className="knowledge-records__row">
                <span className="knowledge-records__head">
                  <strong>{decisionTitle}</strong>
                  <StatusBadge value={status} />
                </span>
                {body && <span className="knowledge-records__summary">{body}</span>}
              </li>
            );
          })}
        </ul>
      </QueryStates>
    </section>
  );
}

// ─── Evaluate readiness ──────────────────────────────────────────────────────

function EvaluateSection() {
  const evaluate = useMutation({ mutationFn: () => invoke(`${PP}.evaluate`, { body: {} }) });
  const gaps = firstArray(evaluate.data, ["gaps"]);
  const readiness = firstString(evaluate.data, ["readiness"]);
  const nextQuestion = asRecord(evaluate.data)["nextQuestion"];

  return (
    <section className="knowledge-panel" aria-label="Evaluate planning readiness">
      <header className="knowledge-panel__head">
        <h3>Evaluate readiness</h3>
        <CheckSquare size={16} aria-hidden="true" />
      </header>
      <button type="button" className="knowledge-button knowledge-button--primary" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>
        {evaluate.isPending ? "Evaluating…" : "Evaluate"}
      </button>
      {evaluate.isError &&
        (isMethodUnavailableError(evaluate.error) ? (
          <UnavailableState capability={`${PP}.evaluate`} description="readiness evaluation is not served." />
        ) : (
          <ErrorState error={evaluate.error} onRetry={() => evaluate.mutate()} title="Evaluate failed" />
        ))}
      {evaluate.isSuccess && (
        <>
          <div className="knowledge-status__meta">
            <StatusBadge value={readiness || "unknown"} />
          </div>
          {gaps.length === 0 ? (
            <EmptyState title="No gaps" description="Nothing is blocking execution readiness right now." />
          ) : (
            <ul className="knowledge-records">
              {gaps.map((gap, index) => {
                const severity = firstString(gap, ["severity"]) || "advisory";
                const message = firstString(gap, ["message"]) || `Gap ${index + 1}`;
                const kind = firstString(gap, ["kind"]);
                return (
                  <li key={graphId(gap) || index} className="knowledge-records__row">
                    <span className="knowledge-records__head">
                      <strong>{message}</strong>
                      <StatusBadge value={severity} />
                    </span>
                    {kind && <span className="knowledge-records__meta">{kind}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {nextQuestion && <DataBlock title="Next question" value={nextQuestion} open />}
        </>
      )}
    </section>
  );
}

// ─── Work plan ───────────────────────────────────────────────────────────────

function WorkPlanTaskPeek({
  taskId,
  requestConfirm,
  onSaved,
}: {
  taskId: string;
  requestConfirm: (action: PendingAction) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const task = useQuery({
    queryKey: kKeys.planningWorkPlanTask(taskId),
    queryFn: () => invoke(`${PP}.workPlan.task.get`, { params: { taskId } }),
  });
  const taskRecord = asRecord(asRecord(task.data)["task"] ?? task.data);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [dirty, setDirty] = useState(false);

  const effectiveTitle = dirty ? title : firstString(taskRecord, ["title"]);
  const effectiveNotes = dirty ? notes : firstString(taskRecord, ["notes"]);
  const effectiveOwner = dirty ? owner : firstString(taskRecord, ["owner"]);
  const effectivePriority = dirty ? priority : String(firstNumber(taskRecord, ["priority"]) ?? "");

  const update = useMutation({
    mutationFn: (meta: ConfirmMetadata) =>
      invoke(`${PP}.workPlan.task.update`, {
        params: { taskId },
        body: {
          patch: {
            title: effectiveTitle.trim() || undefined,
            notes: effectiveNotes.trim() || undefined,
            owner: effectiveOwner.trim() || undefined,
            priority: effectivePriority.trim() ? Number(effectivePriority) : undefined,
          },
          ...meta,
        },
      }),
    onSuccess: () => {
      onSaved();
      toast({ title: "Task updated", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Update failed", description: formatError(error), tone: "danger" }),
  });

  return (
    <div className="knowledge-peek-body">
      <QueryStates
        query={task}
        capability={`${PP}.workPlan.task.get`}
        unavailableDescription="task detail is not served."
        isEmpty={false}
        empty={null}
      >
        <div className="knowledge-form">
          <label>
            Title
            <input
              value={effectiveTitle}
              onChange={(e) => {
                setDirty(true);
                setTitle(e.target.value);
              }}
            />
          </label>
          <label>
            Notes
            <textarea
              rows={3}
              value={effectiveNotes}
              onChange={(e) => {
                setDirty(true);
                setNotes(e.target.value);
              }}
            />
          </label>
          <div className="knowledge-form__split">
            <label>
              Owner
              <input
                value={effectiveOwner}
                onChange={(e) => {
                  setDirty(true);
                  setOwner(e.target.value);
                }}
              />
            </label>
            <label>
              Priority
              <input
                inputMode="numeric"
                value={effectivePriority}
                onChange={(e) => {
                  setDirty(true);
                  setPriority(e.target.value);
                }}
              />
            </label>
          </div>
          <button
            type="button"
            className="knowledge-button knowledge-button--primary"
            disabled={update.isPending}
            onClick={() =>
              requestConfirm({
                action: "Update work-plan task",
                target: effectiveTitle || taskId,
                blastRadius: "Overwrites this task's title/notes/owner/priority.",
                run: (meta) => update.mutate(meta),
              })
            }
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
        <DataBlock title="Raw task" value={taskRecord} />
      </QueryStates>
    </div>
  );
}

function WorkPlanSection({ requestConfirm }: { requestConfirm: (action: PendingAction) => void }) {
  const peek = usePeek();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<"" | WorkPlanTaskStatus>("");
  const [newTitle, setNewTitle] = useState("");
  const [newOwner, setNewOwner] = useState("");

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: kKeys.planningWorkPlanSnapshot }),
      queryClient.invalidateQueries({ queryKey: kKeys.planningWorkPlanTasks(statusFilter) }),
    ]);

  const snapshot = useQuery({ queryKey: kKeys.planningWorkPlanSnapshot, queryFn: () => invoke(`${PP}.workPlan.snapshot`) });
  const tasksQuery = useQuery({
    queryKey: kKeys.planningWorkPlanTasks(statusFilter),
    queryFn: () => invoke(`${PP}.workPlan.tasks.list`, { query: statusFilter ? { status: statusFilter, limit: 200 } : { limit: 200 } }),
  });

  const create = useMutation({
    mutationFn: (meta: ConfirmMetadata) =>
      invoke(`${PP}.workPlan.task.create`, {
        body: { task: { title: newTitle.trim(), ...(newOwner.trim() ? { owner: newOwner.trim() } : {}) }, ...meta },
      }),
    onSuccess: async () => {
      setNewTitle("");
      setNewOwner("");
      await invalidateAll();
      toast({ title: "Task created", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Create failed", description: formatError(error), tone: "danger" }),
  });

  const setStatus = useMutation({
    mutationFn: ({ taskId, status, meta }: { taskId: string; status: WorkPlanTaskStatus; meta: ConfirmMetadata }) =>
      invoke(`${PP}.workPlan.task.status`, { params: { taskId }, body: { status, ...meta } }),
    onSuccess: async () => {
      await invalidateAll();
      toast({ title: "Task status updated", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Status update failed", description: formatError(error), tone: "danger" }),
  });

  const remove = useMutation({
    mutationFn: ({ taskId, meta }: { taskId: string; meta: ConfirmMetadata }) =>
      invoke(`${PP}.workPlan.task.delete`, { params: { taskId }, body: { ...meta } }),
    onSuccess: async () => {
      await invalidateAll();
      toast({ title: "Task deleted", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Delete failed", description: formatError(error), tone: "danger" }),
  });

  const reorder = useMutation({
    mutationFn: ({ orderedTaskIds, meta }: { orderedTaskIds: string[]; meta: ConfirmMetadata }) =>
      invoke(`${PP}.workPlan.tasks.reorder`, { body: { orderedTaskIds, ...meta } }),
    onSuccess: async () => {
      await invalidateAll();
    },
    onError: (error: unknown) => toast({ title: "Reorder failed", description: formatError(error), tone: "danger" }),
  });

  const clearCompleted = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${PP}.workPlan.clearCompleted`, { body: { ...meta } }),
    onSuccess: async () => {
      await invalidateAll();
      toast({ title: "Completed tasks cleared", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Clear failed", description: formatError(error), tone: "danger" }),
  });

  const counts = asRecord(asRecord(snapshot.data)["counts"]);
  const items = firstArray(tasksQuery.data, ["tasks"]);

  function moveTask(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const orderedTaskIds = items.map((task) => graphId(task));
    const tmp = orderedTaskIds[index];
    orderedTaskIds[index] = orderedTaskIds[target] as string;
    orderedTaskIds[target] = tmp as string;
    requestConfirm({
      action: "Reorder work-plan tasks",
      target: "task order",
      blastRadius: "Changes the display/execution order of work-plan tasks.",
      run: (meta) => reorder.mutate({ orderedTaskIds, meta }),
    });
  }

  return (
    <section className="knowledge-panel" aria-label="Work plan">
      <header className="knowledge-panel__head">
        <h3>Work plan</h3>
        <ListTodo size={16} aria-hidden="true" />
      </header>

      {snapshot.isSuccess && (
        <div className="knowledge-status__tiles">
          {scalarEntries(counts).map(([key, value]) => (
            <div key={key} className="knowledge-status__tile">
              <span className="knowledge-status__value">{value}</span>
              <span className="knowledge-status__label">{key}</span>
            </div>
          ))}
        </div>
      )}

      <form
        className="knowledge-form knowledge-form--row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newTitle.trim() || create.isPending) return;
          requestConfirm({
            action: "Create work-plan task",
            target: newTitle.trim(),
            blastRadius: "Adds a new task to the project's work plan.",
            run: (meta) => create.mutate(meta),
          });
        }}
      >
        <label>
          New task
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Task title" />
        </label>
        <label>
          Owner (optional)
          <input value={newOwner} onChange={(e) => setNewOwner(e.target.value)} />
        </label>
        <button type="submit" className="knowledge-button knowledge-button--primary" disabled={!newTitle.trim() || create.isPending}>
          {create.isPending ? "Creating…" : "Add task"}
        </button>
      </form>

      <div className="knowledge-segmented" role="group" aria-label="Filter by status">
        <button
          type="button"
          className={statusFilter === "" ? "knowledge-segmented__item knowledge-segmented__item--active" : "knowledge-segmented__item"}
          onClick={() => setStatusFilter("")}
        >
          All
        </button>
        {WORK_PLAN_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={statusFilter === status ? "knowledge-segmented__item knowledge-segmented__item--active" : "knowledge-segmented__item"}
            onClick={() => setStatusFilter(status)}
          >
            {status}
          </button>
        ))}
      </div>

      <QueryStates
        query={tasksQuery}
        capability={`${PP}.workPlan.tasks.list`}
        unavailableDescription="work-plan tasks cannot be listed."
        isEmpty={items.length === 0}
        empty={<EmptyState icon={<ListTodo size={24} aria-hidden="true" />} title="No tasks" description="Add a task above to start the work plan." />}
      >
        <ul className="knowledge-refine__tasks">
          {items.map((task, index) => {
            const taskId = graphId(task);
            const title = graphTitle(task, `Task ${index + 1}`);
            const status = firstString(task, ["status"]) || "pending";
            const owner = firstString(task, ["owner"]);
            const priority = firstNumber(task, ["priority"]);
            return (
              <li key={taskId || index} className="knowledge-refine__task">
                <button
                  type="button"
                  className="knowledge-link"
                  disabled={!taskId}
                  onClick={() =>
                    taskId &&
                    peek.open({
                      title,
                      content: <WorkPlanTaskPeek taskId={taskId} requestConfirm={requestConfirm} onSaved={() => void invalidateAll()} />,
                    })
                  }
                >
                  <strong>{title}</strong>
                </button>
                <StatusBadge value={status} />
                {owner && <span className="knowledge-records__meta">{owner}</span>}
                {priority !== undefined && <span className="knowledge-records__meta">priority {priority}</span>}
                <span className="knowledge-schedules__actions">
                  <button type="button" className="knowledge-button" disabled={index === 0} onClick={() => moveTask(index, -1)} aria-label={`Move ${title} up`}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="knowledge-button"
                    disabled={index === items.length - 1}
                    onClick={() => moveTask(index, 1)}
                    aria-label={`Move ${title} down`}
                  >
                    ↓
                  </button>
                  {taskId && (
                    <select
                      aria-label={`Set status for ${title}`}
                      value={status}
                      disabled={setStatus.isPending}
                      onChange={(e) => {
                        const next = e.target.value as WorkPlanTaskStatus;
                        requestConfirm({
                          action: "Update task status",
                          target: title,
                          blastRadius: `Moves this task to "${next}".`,
                          run: (meta) => setStatus.mutate({ taskId, status: next, meta }),
                        });
                      }}
                    >
                      {WORK_PLAN_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  )}
                  {taskId && (
                    <button
                      type="button"
                      className="knowledge-button knowledge-button--danger"
                      aria-label={`Delete ${title}`}
                      disabled={remove.isPending}
                      onClick={() =>
                        requestConfirm({
                          action: "Delete work-plan task",
                          target: title,
                          blastRadius: "Permanently removes this task from the work plan.",
                          danger: true,
                          run: (meta) => remove.mutate({ taskId, meta }),
                        })
                      }
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </QueryStates>

      <button
        type="button"
        className="knowledge-button knowledge-button--danger"
        disabled={clearCompleted.isPending}
        onClick={() =>
          requestConfirm({
            action: "Clear completed tasks",
            target: "done and cancelled work-plan tasks",
            blastRadius: "Permanently removes every task in a completed/cancelled state from the work plan.",
            danger: true,
            run: (meta) => clearCompleted.mutate(meta),
          })
        }
      >
        {clearCompleted.isPending ? "Clearing…" : "Clear completed"}
      </button>
    </section>
  );
}

// ─── Panel root ──────────────────────────────────────────────────────────────

export function PlanningPanel() {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const probe = usePlanningProbe();

  if (probe.isPending) return <SkeletonBlock variant="text" lines={6} />;
  if (probe.isError) {
    return <ErrorState error={probe.error} onRetry={() => void probe.refetch()} title="Project planning availability unknown" />;
  }
  if (probe.data === null) {
    return (
      <UnavailableState
        capability={`${PP}.status`}
        description="this daemon has no project-planning surface configured — state, language, decisions, evaluate, and the work plan all depend on it."
      />
    );
  }

  return (
    <div className="knowledge-homegraph">
      <StatusSection status={probe.data} />
      <div className="knowledge-two-col">
        <StateSection requestConfirm={setPending} />
        <LanguageSection requestConfirm={setPending} />
      </div>
      <div className="knowledge-two-col">
        <DecisionsSection requestConfirm={setPending} />
        <EvaluateSection />
      </div>
      <WorkPlanSection requestConfirm={setPending} />
      <PendingConfirmSurface pending={pending} onCancel={() => setPending(null)} />
    </div>
  );
}
