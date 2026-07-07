// Tasks half of the Approvals & Tasks view: tasks.list with verbatim daemon
// statuses, fire-and-forget create (tasks.create — POST /task semantics),
// cancel (only when the task reports itself cancellable) and retry (only for
// failed/cancelled — the daemon's own transition guard), plus a task detail
// peek (tasks.get) with session correlation. Realtime rides the `tasks`
// domain already wired into DOMAIN_INVALIDATIONS — no extra subscription.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ListTodo, PlusCircle, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import {
  jumpToSession,
  parseTaskDetail,
  taskStatusTone,
  useTasksSnapshot,
  type TaskSummary,
} from "../../lib/approvals.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { compactJson, formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";

// ─── Composer focus store (palette "New Task" lands the cursor in the input) ─

let _composerFocusRequested = false;
const _composerListeners = new Set<() => void>();

export function requestTaskComposerFocus(): void {
  _composerFocusRequested = true;
  _composerListeners.forEach((fn) => fn());
}

function consumeTaskComposerFocus(): boolean {
  const requested = _composerFocusRequested;
  _composerFocusRequested = false;
  return requested;
}

// ─── Detail peek content ─────────────────────────────────────────────────────

function TaskDetailContent({ taskId }: { taskId: string }) {
  const query = useQuery({
    queryKey: queryKeys.taskDetail(taskId),
    queryFn: () => gv.tasks.get(taskId),
    select: parseTaskDetail,
  });

  if (query.isPending) return <SkeletonBlock variant="text" lines={5} />;
  if (query.isError) {
    if (isMethodUnavailableError(query.error)) {
      return <UnavailableState capability="tasks.get" description="task detail cannot be loaded." />;
    }
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Failed to load task" />;
  }

  const task = query.data.task;
  return (
    <div className="task-detail">
      {task ? (
        <>
          <dl className="task-detail__grid">
            <dt>Task</dt>
            <dd>{task.title || task.id}</dd>
            <dt>Kind</dt>
            <dd>{task.kind}</dd>
            <dt>Status</dt>
            <dd>
              <span className={`badge ${taskStatusTone(task.status)}`}>{task.status}</span>
            </dd>
            {task.owner && (
              <>
                <dt>Owner</dt>
                <dd>{task.owner}</dd>
              </>
            )}
            {task.queuedAt !== undefined && (
              <>
                <dt>Queued</dt>
                <dd>{formatRelative(task.queuedAt)}</dd>
              </>
            )}
            {task.startedAt !== undefined && (
              <>
                <dt>Started</dt>
                <dd>{formatRelative(task.startedAt)}</dd>
              </>
            )}
            {task.endedAt !== undefined && (
              <>
                <dt>Ended</dt>
                <dd>{formatRelative(task.endedAt)}</dd>
              </>
            )}
            {task.parentTaskId && (
              <>
                <dt>Parent task</dt>
                <dd>{task.parentTaskId}</dd>
              </>
            )}
            {task.error && (
              <>
                <dt>Error</dt>
                <dd className="task-detail__error">{task.error}</dd>
              </>
            )}
          </dl>
          {task.sessionId && (
            <button
              type="button"
              className="task-detail__session-link"
              onClick={() => jumpToSession(task.sessionId ?? "")}
            >
              <ExternalLink size={13} aria-hidden="true" /> Open session {task.sessionId.slice(0, 8)}
            </button>
          )}
        </>
      ) : (
        <p className="task-detail__note" role="note">
          The daemon answered but reported no task fields this client recognizes — raw payload below.
        </p>
      )}
      <details className="task-detail__raw">
        <summary>Raw payload</summary>
        <pre>{compactJson(query.data.raw)}</pre>
      </details>
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

export function TasksSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const peek = usePeek();
  const [taskDraft, setTaskDraft] = useState("");
  const composerRef = useRef<HTMLInputElement>(null);

  // Palette "New Task" → focus the composer (consume on mount + on event).
  useEffect(() => {
    const focusIfRequested = () => {
      if (consumeTaskComposerFocus()) composerRef.current?.focus();
    };
    focusIfRequested();
    _composerListeners.add(focusIfRequested);
    return () => {
      _composerListeners.delete(focusIfRequested);
    };
  }, []);

  const tasks = useTasksSnapshot();
  const rows = useMemo(() => tasks.data?.tasks ?? [], [tasks.data]);

  const create = useMutation({
    mutationFn: (task: string) => gv.tasks.create({ task }),
    onSuccess: async () => {
      setTaskDraft("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      toast({ title: "Task submitted", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Failed to submit task", description: formatError(error), tone: "danger" });
    },
  });

  const cancel = useMutation({
    mutationFn: (taskId: string) => gv.tasks.cancel(taskId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      toast({ title: "Task cancelled", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Cancel failed", description: formatError(error), tone: "danger" });
    },
  });

  const retry = useMutation({
    mutationFn: (taskId: string) => gv.tasks.retry(taskId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      toast({ title: "Task retried", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Retry failed", description: formatError(error), tone: "danger" });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const draft = taskDraft.trim();
    if (!draft || create.isPending) return;
    create.mutate(draft);
  }

  const counts = tasks.data;
  const countsSummary =
    counts &&
    [
      counts.queued !== undefined ? `${counts.queued} queued` : "",
      counts.running !== undefined ? `${counts.running} running` : "",
      counts.blocked !== undefined ? `${counts.blocked} blocked` : "",
    ]
      .filter(Boolean)
      .join(" · ");

  const unavailable = tasks.isError && isMethodUnavailableError(tasks.error);

  return (
    <section className="tasks-section" aria-label="Tasks">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <ListTodo size={14} aria-hidden="true" /> Tasks
          {countsSummary ? ` · ${countsSummary}` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh tasks"
          onClick={() => void tasks.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={tasks.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      <form className="tasks-create" onSubmit={handleSubmit}>
        <input
          ref={composerRef}
          type="text"
          className="tasks-create__input"
          placeholder="Describe a task to submit"
          aria-label="Task description"
          value={taskDraft}
          onChange={(e) => setTaskDraft(e.target.value)}
          disabled={create.isPending}
        />
        <button type="submit" className="tasks-create__button" disabled={!taskDraft.trim() || create.isPending}>
          <PlusCircle size={14} aria-hidden="true" /> {create.isPending ? "Submitting…" : "Submit"}
        </button>
      </form>

      {tasks.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState capability="tasks.list" description="runtime tasks cannot be listed or managed." />
      )}

      {tasks.isError && !unavailable && (
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} title="Failed to load tasks" />
      )}

      {tasks.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<ListTodo size={28} aria-hidden="true" />}
          title="No tasks"
          description="Submitted and running runtime tasks will appear here."
        />
      )}

      {tasks.isSuccess && rows.length > 0 && (
        <ul className="tasks-rows">
          {rows.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={() => peek.open({ title: task.title || `Task ${task.id}`, content: <TaskDetailContent taskId={task.id} /> })}
              onCancel={() => cancel.mutate(task.id)}
              onRetry={() => retry.mutate(task.id)}
              cancelling={cancel.isPending && cancel.variables === task.id}
              retrying={retry.isPending && retry.variables === task.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({
  task,
  onOpen,
  onCancel,
  onRetry,
  cancelling,
  retrying,
}: {
  task: TaskSummary;
  onOpen: () => void;
  onCancel: () => void;
  onRetry: () => void;
  cancelling: boolean;
  retrying: boolean;
}) {
  const canRetry = task.status === "failed" || task.status === "cancelled";
  return (
    <li className="task-row">
      <button type="button" className="task-row__main" onClick={onOpen} title="Open task detail">
        <span className="task-row__title">{task.title || task.id}</span>
        <span className="task-row__badges">
          <span className="badge neutral">{task.kind}</span>
          <span className={`badge ${taskStatusTone(task.status)}`}>{task.status}</span>
        </span>
        <span className="task-row__meta">
          {task.owner && <small>owner {task.owner}</small>}
          {task.error && <small className="task-row__error">· {task.error}</small>}
        </span>
      </button>
      <span className="task-row__actions">
        {task.cancellable && (
          <button type="button" className="task-row__action" disabled={cancelling} onClick={onCancel}>
            <XCircle size={13} aria-hidden="true" /> {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
        {canRetry && (
          <button type="button" className="task-row__action" disabled={retrying} onClick={onRetry}>
            <RotateCcw size={13} aria-hidden="true" /> {retrying ? "Retrying…" : "Retry"}
          </button>
        )}
      </span>
    </li>
  );
}
