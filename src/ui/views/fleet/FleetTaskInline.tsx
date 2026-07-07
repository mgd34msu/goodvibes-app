// "Cancel/retry from the tree": correlates a selected fleet 'agent' node to
// its RuntimeTask record (fleet.ts's taskForNode — the same owner:agentId
// link the daemon's own AgentTaskAdapter establishes) and renders
// tasks.cancel / tasks.retry against it. Shares queryKeys.tasks with the
// Approvals & Tasks view's Tasks section, so an action here reflects there
// instantly (the `tasks` realtime domain already invalidates that key).
// Both actions are confirm-gated in this view (cancel styled as the
// destructive one — work in progress is discarded; retry just requeues).

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, XCircle } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { parseTasksSnapshot, taskStatusTone } from "../../lib/approvals.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { canRetryTask, taskForNode, type FleetNode } from "./fleet.ts";

export function FleetTaskInline({ node }: { node: FleetNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);

  const tasks = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => gv.tasks.list(),
    select: parseTasksSnapshot,
    enabled: node.kind === "agent",
  });

  const task = useMemo(() => taskForNode(node, tasks.data?.tasks ?? []), [node, tasks.data]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    await queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
  };

  const cancel = useMutation({
    mutationFn: (taskId: string) => gv.tasks.cancel(taskId),
    onSuccess: async () => {
      setConfirmCancel(false);
      await invalidate();
      toast({ title: "Task cancelled", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Cancel failed", description: formatError(error), tone: "danger" }),
  });

  const retry = useMutation({
    mutationFn: (taskId: string) => gv.tasks.retry(taskId),
    onSuccess: async () => {
      setConfirmRetry(false);
      await invalidate();
      toast({ title: "Task retried", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Retry failed", description: formatError(error), tone: "danger" }),
  });

  if (node.kind !== "agent" || !task) return null;

  const canRetry = canRetryTask(task);
  if (!task.cancellable && !canRetry) return null;

  return (
    <div className="fleet-detail__task-panel">
      <strong>Runtime task</strong>
      <p className="fleet-detail__task-panel-status">
        <span className={`badge ${taskStatusTone(task.status)}`}>{task.status}</span>
        {task.title ? ` ${task.title}` : ""}
      </p>
      <div className="fleet-detail__actions">
        {task.cancellable && (
          <button
            type="button"
            className="fleet-action fleet-action--danger"
            disabled={cancel.isPending}
            onClick={() => setConfirmCancel(true)}
          >
            <XCircle size={13} aria-hidden="true" /> {cancel.isPending ? "Cancelling…" : "Cancel task"}
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            className="fleet-action"
            disabled={retry.isPending}
            onClick={() => setConfirmRetry(true)}
          >
            <RotateCcw size={13} aria-hidden="true" /> {retry.isPending ? "Retrying…" : "Retry task"}
          </button>
        )}
      </div>

      <ConfirmSurface
        open={confirmCancel}
        action="Cancel task"
        target={task.title || task.id}
        blastRadius="The underlying task stops immediately and any work in progress is discarded. This does not detach or delete the agent's session — only the task record backing it."
        danger
        confirmLabel="Cancel task"
        onConfirm={() => cancel.mutate(task.id)}
        onCancel={() => setConfirmCancel(false)}
      />
      <ConfirmSurface
        open={confirmRetry}
        action="Retry task"
        target={task.title || task.id}
        blastRadius="The daemon requeues the task to run again under its configured retry policy."
        confirmLabel="Retry task"
        onConfirm={() => retry.mutate(task.id)}
        onCancel={() => setConfirmRetry(false)}
      />
    </div>
  );
}
