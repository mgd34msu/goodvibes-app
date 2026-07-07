// Jobs tab: job definitions (knowledge.jobs.list / job.get / job.run),
// recent job runs (knowledge.job-runs.list), schedules CRUD
// (knowledge.schedules.* PLUS the single-item knowledge.schedule.get detail
// peek — docs/GAPS.md §6 row 15), and index maintenance (knowledge.lint /
// knowledge.reindex). Admin actions that kick off daemon-side work or
// destroy state (run job, reindex, delete schedule) go through the shared
// ConfirmSurface and forward confirm:true + explicitUserRequest.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CalendarClock, Hammer, Play, Trash2 } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState } from "../../components/feedback.tsx";
import { DataBlock, QueryStates } from "./KnowledgeBits.tsx";
import { KNOWLEDGE_PREFIX, kKeys, formatEpoch, knowledgeId, knowledgeList, knowledgeTitle } from "./lib.ts";

// ─── Jobs ────────────────────────────────────────────────────────────────────

function JobsSection({ active }: { active: boolean }) {
  const queryClient = useQueryClient();
  const peek = usePeek();
  const { toast } = useToast();
  const [runTarget, setRunTarget] = useState<{ id: string; title: string } | null>(null);

  const jobs = useQuery({
    queryKey: kKeys.jobs,
    queryFn: () => invoke("knowledge.jobs.list"),
    // No wire event for job definitions — poll slowly while visible.
    refetchInterval: active ? 60_000 : false,
  });

  const run = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      invoke("knowledge.job.run", { params: { jobId: id }, body: { ...meta } }),
    onSuccess: async () => {
      setRunTarget(null);
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      toast({ title: "Job run started", tone: "success" });
    },
    onError: (error: unknown) => {
      setRunTarget(null);
      toast({ title: "Job run failed", description: formatError(error), tone: "danger" });
    },
  });

  const items = knowledgeList(jobs.data, "jobs");

  const openJob = (id: string, title: string) =>
    peek.open({ title, content: <JobDetailPeek jobId={id} /> });

  return (
    <section className="knowledge-panel" aria-label="Knowledge jobs">
      <header className="knowledge-panel__head">
        <h3>Jobs</h3>
        <Hammer size={16} aria-hidden="true" />
      </header>
      <QueryStates
        query={jobs}
        capability="knowledge.jobs.list"
        unavailableDescription="indexing jobs cannot be listed or run."
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={<Hammer size={24} aria-hidden="true" />}
            title="No jobs defined"
            description="This daemon exposes no knowledge maintenance jobs."
          />
        }
      >
        <ul className="knowledge-jobs">
          {items.map((job, index) => {
            const id = knowledgeId(job) || firstString(job, ["jobId"]);
            const title = knowledgeTitle(job, id || `Job ${index + 1}`);
            const description = firstString(job, ["description", "summary"]);
            return (
              <li key={id || index} className="knowledge-jobs__row">
                <button
                  type="button"
                  className="knowledge-jobs__info"
                  disabled={!id}
                  onClick={() => id && openJob(id, title)}
                >
                  <strong>{title}</strong>
                  {description && <span>{description}</span>}
                </button>
                <button
                  type="button"
                  className="knowledge-button"
                  disabled={!id || run.isPending}
                  onClick={() => id && setRunTarget({ id, title })}
                >
                  <Play size={13} aria-hidden="true" /> Run
                </button>
              </li>
            );
          })}
        </ul>
      </QueryStates>

      <ConfirmSurface
        open={runTarget !== null}
        action="Run knowledge job"
        target={runTarget?.title ?? ""}
        blastRadius="Starts a daemon-side indexing run over the knowledge store; results land in job runs below."
        confirmLabel="Run job"
        onConfirm={(meta) => runTarget && run.mutate({ id: runTarget.id, meta })}
        onCancel={() => setRunTarget(null)}
      />
    </section>
  );
}

function JobDetailPeek({ jobId }: { jobId: string }) {
  const job = useQuery({
    queryKey: [...kKeys.jobs, jobId],
    queryFn: () => invoke("knowledge.job.get", { params: { jobId } }),
  });
  return (
    <div className="knowledge-peek-body">
      <QueryStates
        query={job}
        capability="knowledge.job.get"
        unavailableDescription="job details cannot be loaded."
        isEmpty={false}
        empty={null}
      >
        <DataBlock title="Job" value={job.data} open />
      </QueryStates>
    </div>
  );
}

function ScheduleDetailPeek({ scheduleId }: { scheduleId: string }) {
  const schedule = useQuery({
    queryKey: kKeys.scheduleDetail(scheduleId),
    queryFn: () => invoke("knowledge.schedule.get", { params: { id: scheduleId } }),
  });
  return (
    <div className="knowledge-peek-body">
      <QueryStates
        query={schedule}
        capability="knowledge.schedule.get"
        unavailableDescription="schedule details cannot be loaded."
        isEmpty={false}
        empty={null}
      >
        <DataBlock title="Schedule" value={schedule.data} open />
      </QueryStates>
    </div>
  );
}

// ─── Job runs ────────────────────────────────────────────────────────────────

function JobRunsSection({ active }: { active: boolean }) {
  const runs = useQuery({
    queryKey: kKeys.jobRuns,
    queryFn: () => invoke("knowledge.job-runs.list", { query: { limit: 50 } }),
    // Runs change while jobs execute in the background — 15s poll while visible.
    refetchInterval: active ? 15_000 : false,
  });
  const jobs = useQuery({ queryKey: kKeys.jobs, queryFn: () => invoke("knowledge.jobs.list") });

  const runItems = knowledgeList(runs.data, "runs");
  const jobItems = knowledgeList(jobs.data, "jobs");
  const titleById = new Map(jobItems.map((job) => [knowledgeId(job), knowledgeTitle(job, "")]));
  const sorted = [...runItems].sort(
    (a, b) => (firstNumber(b, ["requestedAt", "startedAt"]) ?? 0) - (firstNumber(a, ["requestedAt", "startedAt"]) ?? 0),
  );

  return (
    <section className="knowledge-panel" aria-label="Job runs">
      <header className="knowledge-panel__head">
        <h3>Recent runs</h3>
        <Activity size={16} aria-hidden="true" />
      </header>
      <QueryStates
        query={runs}
        capability="knowledge.job-runs.list"
        unavailableDescription="job run history is not served."
        isEmpty={runItems.length === 0}
        empty={
          <EmptyState
            icon={<Activity size={24} aria-hidden="true" />}
            title="No job runs yet"
            description="Indexing jobs have not run yet."
          />
        }
      >
        <ul className="knowledge-runs">
          {sorted.map((run, index) => {
            const id = knowledgeId(run) || String(index);
            const jobId = firstString(run, ["jobId"]);
            const title = titleById.get(jobId)?.trim() || jobId || "Unknown job";
            const status = firstString(run, ["status", "state"]) || "unknown";
            const when = formatEpoch(firstNumber(run, ["requestedAt", "startedAt"]));
            const error = firstString(run, ["error"]);
            return (
              <li key={id} className="knowledge-runs__row">
                <span className="knowledge-runs__head">
                  <strong>{title}</strong>
                  <StatusBadge value={status} />
                </span>
                {when && <span className="knowledge-runs__meta">{when}</span>}
                {error && <p className="knowledge-runs__error">{error}</p>}
              </li>
            );
          })}
        </ul>
      </QueryStates>
    </section>
  );
}

// ─── Schedules ───────────────────────────────────────────────────────────────

function SchedulesSection({ active }: { active: boolean }) {
  const queryClient = useQueryClient();
  const peek = usePeek();
  const { toast } = useToast();
  const [jobId, setJobId] = useState("");
  const [scheduleText, setScheduleText] = useState("");
  const [label, setLabel] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const schedules = useQuery({
    queryKey: kKeys.schedules,
    queryFn: () => invoke("knowledge.schedules.list", { query: { limit: 100 } }),
    refetchInterval: active ? 60_000 : false, // no wire event for schedules
  });
  const jobs = useQuery({ queryKey: kKeys.jobs, queryFn: () => invoke("knowledge.jobs.list") });
  const jobItems = knowledgeList(jobs.data, "jobs");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });

  const save = useMutation({
    mutationFn: () =>
      invoke("knowledge.schedule.save", {
        body: {
          jobId: jobId.trim(),
          schedule: scheduleText.trim(),
          ...(label.trim() ? { label: label.trim() } : {}),
          enabled: true,
        },
      }),
    onSuccess: async () => {
      setScheduleText("");
      setLabel("");
      await invalidate();
      toast({ title: "Schedule saved", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Schedule save failed", description: formatError(error), tone: "danger" });
    },
  });

  const enable = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      invoke("knowledge.schedule.enable", { params: { id }, body: { enabled } }),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (error: unknown) => {
      toast({ title: "Schedule toggle failed", description: formatError(error), tone: "danger" });
    },
  });

  const remove = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      invoke("knowledge.schedule.delete", { params: { id }, body: { ...meta } }),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidate();
      toast({ title: "Schedule deleted", tone: "info" });
    },
    onError: (error: unknown) => {
      setDeleteTarget(null);
      toast({ title: "Schedule delete failed", description: formatError(error), tone: "danger" });
    },
  });

  const items = knowledgeList(schedules.data, "schedules");

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!jobId.trim() || !scheduleText.trim() || save.isPending) return;
    save.mutate();
  }

  return (
    <section className="knowledge-panel" aria-label="Schedules">
      <header className="knowledge-panel__head">
        <h3>Schedules</h3>
        <CalendarClock size={16} aria-hidden="true" />
      </header>

      <form className="knowledge-form knowledge-form--row" onSubmit={submit}>
        <label>
          Job
          {jobItems.length > 0 ? (
            <select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Job to schedule">
              <option value="">Select job…</option>
              {jobItems.map((job, index) => {
                const id = knowledgeId(job) || firstString(job, ["jobId"]);
                return (
                  <option key={id || index} value={id}>
                    {knowledgeTitle(job, id)}
                  </option>
                );
              })}
            </select>
          ) : (
            <input value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="job id" />
          )}
        </label>
        <label>
          Schedule (cron or interval)
          <input
            value={scheduleText}
            onChange={(e) => setScheduleText(e.target.value)}
            placeholder="0 3 * * * or 6h"
          />
        </label>
        <label>
          Label (optional)
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button
          type="submit"
          className="knowledge-button knowledge-button--primary"
          disabled={save.isPending || !jobId.trim() || !scheduleText.trim()}
        >
          {save.isPending ? "Saving…" : "Save schedule"}
        </button>
      </form>

      <QueryStates
        query={schedules}
        capability="knowledge.schedules.list"
        unavailableDescription="knowledge job schedules are not served."
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={<CalendarClock size={24} aria-hidden="true" />}
            title="No schedules"
            description="Save a schedule above to run a job automatically."
          />
        }
      >
        <ul className="knowledge-schedules">
          {items.map((schedule, index) => {
            const id = knowledgeId(schedule);
            const title =
              firstString(schedule, ["label"]) ||
              firstString(schedule, ["jobId"]) ||
              `Schedule ${index + 1}`;
            const cron = firstString(schedule, ["schedule", "cron", "interval"]);
            const enabled = asRecord(schedule)["enabled"] === true;
            return (
              <li key={id || index} className="knowledge-schedules__row">
                <span className="knowledge-schedules__name">
                  <strong>{title}</strong>
                  {cron && <code>{cron}</code>}
                  <StatusBadge value={enabled ? "enabled" : "disabled"} />
                </span>
                <span className="knowledge-schedules__actions">
                  <button
                    type="button"
                    className="knowledge-button"
                    disabled={!id}
                    onClick={() => id && peek.open({ title, content: <ScheduleDetailPeek scheduleId={id} /> })}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    className="knowledge-button"
                    disabled={!id || enable.isPending}
                    onClick={() => id && enable.mutate({ id, enabled: !enabled })}
                  >
                    {enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="knowledge-button knowledge-button--danger"
                    aria-label={`Delete schedule ${title}`}
                    disabled={!id || remove.isPending}
                    onClick={() => id && setDeleteTarget({ id, title })}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </QueryStates>

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete schedule"
        target={deleteTarget?.title ?? ""}
        blastRadius="The job stops running automatically; the job definition and past runs are untouched."
        danger
        onConfirm={(meta) => deleteTarget && remove.mutate({ id: deleteTarget.id, meta })}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

// ─── Maintenance: lint + reindex ─────────────────────────────────────────────

function MaintenanceSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reindexOpen, setReindexOpen] = useState(false);

  const lint = useMutation({
    mutationFn: () => invoke("knowledge.lint", { body: {} }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      const count = firstArray(result, ["issues"]).length;
      toast({ title: `Lint finished — ${count} issue${count === 1 ? "" : "s"}`, tone: count > 0 ? "warning" : "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Lint failed", description: formatError(error), tone: "danger" });
    },
  });

  const reindex = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke("knowledge.reindex", { body: { ...meta } }),
    onSuccess: async () => {
      setReindexOpen(false);
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      toast({ title: "Reindex started", tone: "success" });
    },
    onError: (error: unknown) => {
      setReindexOpen(false);
      toast({ title: "Reindex failed", description: formatError(error), tone: "danger" });
    },
  });

  return (
    <section className="knowledge-panel" aria-label="Index maintenance">
      <header className="knowledge-panel__head">
        <h3>Maintenance</h3>
      </header>
      <div className="knowledge-maintenance">
        <button type="button" className="knowledge-button" disabled={lint.isPending} onClick={() => lint.mutate()}>
          {lint.isPending ? "Linting…" : "Run lint"}
        </button>
        <button
          type="button"
          className="knowledge-button knowledge-button--danger"
          disabled={reindex.isPending}
          onClick={() => setReindexOpen(true)}
        >
          {reindex.isPending ? "Reindexing…" : "Reindex store"}
        </button>
      </div>
      {lint.isSuccess && <DataBlock title="Lint issues" value={firstArray(lint.data, ["issues"])} open />}
      {reindex.isSuccess && <DataBlock title="Reindex result" value={reindex.data} />}

      <ConfirmSurface
        open={reindexOpen}
        action="Reindex knowledge store"
        target="the entire knowledge index"
        blastRadius="Rebuilds every derived index over all sources and nodes; queries may return stale or partial results while it runs."
        danger
        requireTypedText="reindex"
        onConfirm={(meta) => reindex.mutate(meta)}
        onCancel={() => setReindexOpen(false)}
      />
    </section>
  );
}

export function JobsPanel({ active }: { active: boolean }) {
  return (
    <div className="knowledge-jobs-panel">
      <div className="knowledge-two-col">
        <JobsSection active={active} />
        <JobRunsSection active={active} />
      </div>
      <SchedulesSection active={active} />
      <MaintenanceSection />
    </div>
  );
}
