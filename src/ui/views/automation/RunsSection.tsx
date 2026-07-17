// Automation run history (docs/FEATURES.md §5 "Runs: list/get/cancel/retry").
// Statuses are rendered VERBATIM (queued|running|completed|failed|cancelled —
// an open daemon vocabulary); the status filter chips are derived from the
// statuses actually present, never a hardcoded enum. Duration comes from the
// daemon's durationMs when present, else endedAt - startedAt.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { asRecord, compactJson } from "../../lib/wire.ts";
import {
  AUTOMATION_POLL_MS,
  automationKeys,
  formatAbsolute,
  formatDuration,
  formatRelative,
  normalizeRun,
  runsFromResponse,
  type RunRecord,
} from "./automation-model.ts";

/** Affordance heuristics only — the daemon remains the judge; a rejected
 * cancel/retry surfaces its verbatim error in a toast. */
const CANCELLABLE = new Set(["queued", "running"]);
const RETRIABLE = new Set(["failed", "cancelled", "completed"]);

function useRunActions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: automationKeys.all });

  const cancel = useMutation({
    mutationFn: (runId: string) =>
      gv.invoke("automation.runs.cancel", { params: { runId }, body: { reason: "operator-cancelled" } }),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Run cancelled", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Cancel failed", description: formatError(error), tone: "danger" });
    },
  });

  const retry = useMutation({
    mutationFn: (runId: string) => gv.invoke("automation.runs.retry", { params: { runId } }),
    onSuccess: async (result) => {
      await invalidate();
      const run = normalizeRun(asRecord(result)["run"]);
      toast({
        title: "Retry queued",
        description: run.id ? `New run ${run.id.slice(0, 8)} (${run.status}).` : undefined,
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Retry failed", description: formatError(error), tone: "danger" });
    },
  });

  return { cancel, retry };
}

export function RunsSection({ jobNames }: { jobNames: ReadonlyMap<string, string> }) {
  const peek = usePeek();
  const [statusFilter, setStatusFilter] = useState("");

  const list = useQuery({
    queryKey: automationKeys.runs,
    // No automation domain on the invalidation stream — poll while visible.
    queryFn: () => gv.invoke("automation.runs.list"),
    refetchInterval: AUTOMATION_POLL_MS,
  });
  const rows = useMemo(() => runsFromResponse(list.data), [list.data]);
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows]);
  const filtered = useMemo(
    () => (statusFilter ? rows.filter((r) => r.status === statusFilter) : rows),
    [rows, statusFilter],
  );

  const { cancel, retry } = useRunActions();
  const unavailable = list.isError && isMethodUnavailableError(list.error);

  const openDetail = (run: RunRecord) => {
    peek.open({
      title: `Run ${run.id.slice(0, 12)}`,
      content: <RunDetailPanel runId={run.id} jobNames={jobNames} />,
    });
  };

  return (
    <section className="automation-section" aria-label="Automation runs">
      <div className="automation-toolbar">
        <span className="automation-toolbar__summary">
          <History size={14} aria-hidden="true" /> Runs
          {list.isSuccess ? ` · ${rows.length} recorded` : ""}
        </span>
        <button
          type="button"
          className="automation-toolbar__refresh"
          aria-label="Refresh runs"
          onClick={() => void list.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {statuses.length > 1 && (
        <div className="run-filters" role="group" aria-label="Filter runs by status">
          <button
            type="button"
            className={statusFilter === "" ? "run-filter run-filter--active" : "run-filter"}
            onClick={() => setStatusFilter("")}
          >
            all <span className="run-filter__count">{rows.length}</span>
          </button>
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              className={statusFilter === status ? "run-filter run-filter--active" : "run-filter"}
              onClick={() => setStatusFilter(status === statusFilter ? "" : status)}
            >
              {status}
              <span className="run-filter__count">{rows.filter((r) => r.status === status).length}</span>
            </button>
          ))}
        </div>
      )}

      {list.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState
          capability="automation.runs.list"
          description="run history with outcomes cannot be shown."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load runs" />
      )}

      {list.isSuccess && filtered.length === 0 && (
        <EmptyState
          icon={<History size={28} aria-hidden="true" />}
          title={statusFilter ? `No ${statusFilter} runs` : "No runs yet"}
          description={
            statusFilter
              ? "No recorded run currently has this status."
              : "Runs appear here when a job or schedule fires, or when you press Run now."
          }
        />
      )}

      {list.isSuccess && filtered.length > 0 && (
        <ul className="run-rows">
          {filtered.map((run) => (
            <li key={run.id} className="run-row">
              <button type="button" className="run-row__open" onClick={() => openDetail(run)}>
                <span className="run-row__id">{run.id.slice(0, 8)}</span>
                <StatusBadge value={run.status} />
                <span className="run-row__job" title={jobNames.get(run.jobId) ?? run.jobId}>
                  {jobNames.get(run.jobId) ?? run.jobId.slice(0, 12) ?? "—"}
                </span>
                {run.trigger && <span className="run-row__trigger">{run.trigger}</span>}
                <span className="run-row__times">
                  {run.queuedAt !== undefined && (
                    <span title={formatAbsolute(run.queuedAt)}>queued {formatRelative(run.queuedAt)}</span>
                  )}
                  {run.durationMs !== undefined ? (
                    <span className="run-row__duration">{formatDuration(run.durationMs)}</span>
                  ) : run.startedAt !== undefined && run.endedAt === undefined ? (
                    <span className="run-row__duration" title={formatAbsolute(run.startedAt)}>
                      started {formatRelative(run.startedAt)}
                    </span>
                  ) : null}
                </span>
                {run.error && (
                  <span className="run-row__error" title={run.error}>
                    {run.error}
                  </span>
                )}
              </button>
              <span className="run-row__actions">
                {CANCELLABLE.has(run.status) && (
                  <button
                    type="button"
                    className="automation-btn"
                    disabled={cancel.isPending && cancel.variables === run.id}
                    onClick={() => cancel.mutate(run.id)}
                  >
                    {cancel.isPending && cancel.variables === run.id ? "Cancelling…" : "Cancel"}
                  </button>
                )}
                {RETRIABLE.has(run.status) && (
                  <button
                    type="button"
                    className="automation-btn"
                    disabled={retry.isPending && retry.variables === run.id}
                    onClick={() => retry.mutate(run.id)}
                  >
                    {retry.isPending && retry.variables === run.id ? "Retrying…" : "Retry"}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Detail peek — GET /api/automation/runs/{id} → { run, deliveries } ───────

function RunDetailPanel({ runId, jobNames }: { runId: string; jobNames: ReadonlyMap<string, string> }) {
  const detail = useQuery({
    queryKey: automationKeys.runDetail(runId),
    queryFn: () => gv.invoke("automation.runs.get", { params: { runId } }),
    refetchInterval: AUTOMATION_POLL_MS,
  });
  const { cancel, retry } = useRunActions();

  if (detail.isPending) return <SkeletonBlock variant="text" lines={6} />;
  if (detail.isError) {
    if (isMethodUnavailableError(detail.error)) {
      return <UnavailableState capability="automation.runs.get" description="run detail cannot be fetched." />;
    }
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="Failed to load run" />;
  }

  const payload = asRecord(detail.data);
  const run = normalizeRun(payload["run"] ?? detail.data);
  const deliveries = Array.isArray(payload["deliveries"]) ? (payload["deliveries"] as unknown[]) : [];

  return (
    <div className="run-detail">
      <dl className="run-detail__facts">
        <dt>Status</dt>
        <dd>
          <StatusBadge value={run.status} />
        </dd>
        <dt>Job</dt>
        <dd>{jobNames.get(run.jobId) ?? run.jobId ?? "—"}</dd>
        {run.trigger && (
          <>
            <dt>Trigger</dt>
            <dd>{run.trigger}</dd>
          </>
        )}
        {run.attempt !== undefined && (
          <>
            <dt>Attempt</dt>
            <dd>{run.attempt}</dd>
          </>
        )}
        {run.queuedAt !== undefined && (
          <>
            <dt>Queued</dt>
            <dd>
              {formatRelative(run.queuedAt)} · {formatAbsolute(run.queuedAt)}
            </dd>
          </>
        )}
        {run.startedAt !== undefined && (
          <>
            <dt>Started</dt>
            <dd>
              {formatRelative(run.startedAt)} · {formatAbsolute(run.startedAt)}
            </dd>
          </>
        )}
        {run.endedAt !== undefined && (
          <>
            <dt>Ended</dt>
            <dd>
              {formatRelative(run.endedAt)} · {formatAbsolute(run.endedAt)}
            </dd>
          </>
        )}
        {run.durationMs !== undefined && (
          <>
            <dt>Duration</dt>
            <dd>{formatDuration(run.durationMs)}</dd>
          </>
        )}
        {run.agentId && (
          <>
            <dt>Agent</dt>
            <dd>{run.agentId}</dd>
          </>
        )}
        {run.sessionId && (
          <>
            <dt>Session</dt>
            <dd>{run.sessionId}</dd>
          </>
        )}
        {run.error && (
          <>
            <dt>Error</dt>
            <dd className="run-detail__error">{run.error}</dd>
          </>
        )}
        {run.cancelledReason && (
          <>
            <dt>Cancelled</dt>
            <dd>{run.cancelledReason}</dd>
          </>
        )}
        <dt>Deliveries</dt>
        <dd>{deliveries.length === 0 ? "none recorded" : `${deliveries.length}`}</dd>
      </dl>

      <div className="run-detail__actions">
        {CANCELLABLE.has(run.status) && (
          <button
            type="button"
            className="automation-btn"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(run.id)}
          >
            {cancel.isPending ? "Cancelling…" : "Cancel run"}
          </button>
        )}
        {RETRIABLE.has(run.status) && (
          <button
            type="button"
            className="automation-btn"
            disabled={retry.isPending}
            onClick={() => retry.mutate(run.id)}
          >
            {retry.isPending ? "Retrying…" : "Retry run"}
          </button>
        )}
      </div>

      <details className="run-detail__raw">
        <summary>Raw payload</summary>
        <pre>{compactJson(detail.data)}</pre>
      </details>
    </div>
  );
}
