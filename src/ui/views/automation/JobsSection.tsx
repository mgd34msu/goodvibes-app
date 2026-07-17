// Shared jobs/schedules table (docs/FEATURES.md §5). The daemon backs
// automation.jobs.* and automation.schedules.* with the SAME job store —
// only the method ids, path param names, and available verbs differ
// (schedules have no PATCH). This one section renders both tabs so the two
// row sets never drift; the caller parameterizes noun + method ids.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pencil, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { clearDraft } from "../../lib/drafts.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  AUTOMATION_POLL_MS,
  automationKeys,
  formatAbsolute,
  formatRelative,
  jobsFromResponse,
  type JobRecord,
} from "./automation-model.ts";
import { EditJobForm, type JobEditBody } from "./ScheduleForm.tsx";

export interface JobsSectionMethods {
  list: string;
  enable: string;
  disable: string;
  run: string;
  delete: string;
  /** PATCH verb — only jobs have one on the wire. */
  update?: string;
}

export interface JobsSectionProps {
  noun: "job" | "schedule";
  methods: JobsSectionMethods;
  /** {jobId} for jobs.* routes, {scheduleId} for schedules.* routes. */
  paramName: string;
  queryKey: readonly unknown[];
  onCreate: () => void;
  /** Explanatory line under the toolbar (e.g. the shared-store note). */
  note?: string;
}

export function JobsSection({ noun, methods, paramName, queryKey, onCreate, note }: JobsSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editTarget, setEditTarget] = useState<JobRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobRecord | null>(null);

  const list = useQuery({
    queryKey,
    // No automation domain on the invalidation stream — poll while visible.
    queryFn: () => gv.invoke(methods.list),
    refetchInterval: AUTOMATION_POLL_MS,
  });
  const rows = useMemo(() => jobsFromResponse(list.data), [list.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: automationKeys.all });

  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      gv.invoke(enabled ? methods.enable : methods.disable, { params: { [paramName]: id } }),
    onSuccess: async (_r, variables) => {
      await invalidate();
      toast({ title: variables.enabled ? `Enabled ${noun}` : `Disabled ${noun}`, tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: `Failed to toggle ${noun}`, description: formatError(error), tone: "danger" });
    },
  });

  const runNow = useMutation({
    mutationFn: (id: string) => gv.invoke(methods.run, { params: { [paramName]: id } }),
    onSuccess: async (result) => {
      await invalidate();
      const runId =
        result && typeof result === "object" && "runId" in result ? String((result as { runId: unknown }).runId) : "";
      toast({
        title: `Run queued`,
        description: runId ? `Run ${runId.slice(0, 8)} — watch it under the Runs tab.` : undefined,
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      toast({ title: `Failed to run ${noun}`, description: formatError(error), tone: "danger" });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: JobEditBody }) => {
      if (!methods.update) throw new Error(`No update method for ${noun}s`);
      return gv.invoke(methods.update, { params: { [paramName]: id }, body });
    },
    onSuccess: async (_result, variables) => {
      setEditTarget(null);
      clearDraft(`automation.job-edit.${variables.id}.prompt`);
      await invalidate();
      toast({ title: `Updated ${noun}`, tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: `Failed to update ${noun}`, description: formatError(error), tone: "danger" });
    },
  });

  const remove = useMutation({
    // The route is dangerous-flagged: forward the ConfirmSurface metadata
    // (confirm:true + explicitUserRequest) on the wire.
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      gv.invoke(methods.delete, { params: { [paramName]: id }, body: meta }),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidate();
      toast({ title: `Deleted ${noun}`, tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: `Failed to delete ${noun}`, description: formatError(error), tone: "danger" });
    },
  });

  const unavailable = list.isError && isMethodUnavailableError(list.error);
  const plural = `${noun}s`;

  return (
    <section className="automation-section" aria-label={plural}>
      <div className="automation-toolbar">
        <span className="automation-toolbar__summary">
          <CalendarClock size={14} aria-hidden="true" /> {plural}
          {list.isSuccess ? ` · ${rows.length} total · ${rows.filter((r) => r.enabled).length} enabled` : ""}
        </span>
        <span className="automation-toolbar__actions">
          <button type="button" className="automation-btn automation-btn--primary" onClick={onCreate}>
            <Plus size={14} aria-hidden="true" /> New {noun}
          </button>
          <button
            type="button"
            className="automation-toolbar__refresh"
            aria-label={`Refresh ${plural}`}
            onClick={() => void list.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
        </span>
      </div>

      {note && (
        <p className="automation-note" role="note">
          {note}
        </p>
      )}

      {list.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState
          capability={methods.list}
          description={`${plural} cannot be listed or managed from this app.`}
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title={`Failed to load ${plural}`} />
      )}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<CalendarClock size={28} aria-hidden="true" />}
          title={`No ${plural} yet`}
          description={`Create a ${noun} to run a prompt on a cron expression, a fixed interval, or once at a set time.`}
          action={{ label: `New ${noun}`, onClick: onCreate }}
        />
      )}

      {list.isSuccess && rows.length > 0 && (
        <ul className="job-rows">
          {rows.map((job) => (
            <li key={job.id || job.name} className="job-row">
              <div className="job-row__main">
                <span className="job-row__name" title={job.description || job.name}>
                  {job.name}
                </span>
                <StatusBadge value={job.status} />
                <span className={`badge neutral job-row__kind`}>{job.scheduleKind}</span>
                <code className="job-row__schedule">{job.scheduleSummary}</code>
                {job.timezone && <span className="job-row__tz">{job.timezone}</span>}
              </div>
              <div className="job-row__meta">
                {job.nextRunAt !== undefined ? (
                  <span className="job-row__when" title={formatAbsolute(job.nextRunAt)}>
                    next {formatRelative(job.nextRunAt)} · {formatAbsolute(job.nextRunAt)}
                  </span>
                ) : (
                  <span className="job-row__when job-row__when--none">no next run scheduled</span>
                )}
                {job.lastRunAt !== undefined && (
                  <span className="job-row__when" title={formatAbsolute(job.lastRunAt)}>
                    last {formatRelative(job.lastRunAt)}
                  </span>
                )}
                {job.runCount !== undefined && (
                  <span className="job-row__counts">
                    {job.runCount} runs
                    {job.failureCount ? ` · ${job.failureCount} failed` : ""}
                  </span>
                )}
                {job.pausedReason && <span className="job-row__paused">paused: {job.pausedReason}</span>}
              </div>
              <div className="job-row__actions">
                <button
                  type="button"
                  className="automation-btn"
                  disabled={runNow.isPending && runNow.variables === job.id}
                  onClick={() => runNow.mutate(job.id)}
                >
                  <Play size={13} aria-hidden="true" />
                  {runNow.isPending && runNow.variables === job.id ? "Running…" : "Run now"}
                </button>
                <button
                  type="button"
                  className="automation-btn"
                  disabled={setEnabled.isPending && setEnabled.variables?.id === job.id}
                  onClick={() => setEnabled.mutate({ id: job.id, enabled: !job.enabled })}
                >
                  {job.enabled ? "Disable" : "Enable"}
                </button>
                {methods.update && (
                  <button
                    type="button"
                    className="automation-btn"
                    aria-label={`Edit ${job.name}`}
                    onClick={() => setEditTarget(job)}
                  >
                    <Pencil size={13} aria-hidden="true" /> Edit
                  </button>
                )}
                <button
                  type="button"
                  className="automation-btn automation-btn--danger"
                  aria-label={`Delete ${job.name}`}
                  onClick={() => setDeleteTarget(job)}
                >
                  <Trash2 size={13} aria-hidden="true" /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {methods.update && (
        <Modal open={editTarget !== null} onClose={() => setEditTarget(null)} title={`Edit ${noun}`}>
          {editTarget && (
            <EditJobForm
              key={editTarget.id}
              entityId={editTarget.id}
              initialName={editTarget.name}
              initialPrompt={editTarget.description}
              submitting={update.isPending}
              onSubmit={(body) => update.mutate({ id: editTarget.id, body })}
              onCancel={() => setEditTarget(null)}
            />
          )}
        </Modal>
      )}

      <ConfirmSurface
        open={deleteTarget !== null}
        action={`Delete ${noun}`}
        target={deleteTarget ? `${deleteTarget.name} (${deleteTarget.id})` : ""}
        blastRadius={`The ${noun} and its trigger are removed permanently. Past runs stay in the run history; nothing new will fire.`}
        danger
        confirmLabel={`Delete ${noun}`}
        onConfirm={(meta) => {
          if (deleteTarget) remove.mutate({ id: deleteTarget.id, meta });
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
