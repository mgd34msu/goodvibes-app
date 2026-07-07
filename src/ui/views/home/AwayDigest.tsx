// "While you were away" (docs/FEATURES.md §8): on load, query
// automation.runs.list + tasks.list + deliveries.list, filter client-side to
// activity since the app-local lastSeen timestamp, render a grouped digest,
// THEN bump lastSeen — the bump waits until at least one source loaded so a
// dead daemon never eats the window. "Nothing happened while you were away"
// is a valid, rendered state, not a blank.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCheck, History, ListTodo, Repeat, Send } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useTasksSnapshot, type TaskSummary } from "../../lib/approvals.ts";
import { formatError } from "../../lib/errors.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState, SkeletonBlock } from "../../components/feedback.tsx";
import { capabilityRefusal, formatEpoch } from "../personal-ops/personal-ops-data.ts";
import { readLastSeen, writeLastSeen } from "./last-seen.ts";

const MAX_ROWS_PER_GROUP = 5;

interface AutomationRunRow {
  id: string;
  label: string;
  status: string;
  when: number | undefined;
}

function parseRuns(value: unknown): AutomationRunRow[] {
  return firstArray(asRecord(value), ["runs", "items"]).map((raw) => {
    const record = asRecord(raw);
    const execution = asRecord(record["execution"]);
    return {
      id: firstString(record, ["id"]),
      label:
        firstString(execution, ["prompt", "template"]).slice(0, 80) ||
        firstString(record, ["jobId"]) ||
        "(run)",
      status: firstString(record, ["status"]) || "unknown",
      when:
        firstNumber(record, ["endedAt"]) ??
        firstNumber(record, ["startedAt"]) ??
        firstNumber(record, ["updatedAt", "queuedAt", "createdAt"]),
    };
  });
}

interface DeliveryRow {
  id: string;
  label: string;
  status: string;
  when: number | undefined;
}

function parseDeliveries(value: unknown): DeliveryRow[] {
  return firstArray(asRecord(value), ["attempts", "deliveries", "items"]).map((raw) => {
    const record = asRecord(raw);
    const target = asRecord(record["target"]);
    return {
      id: firstString(record, ["id"]),
      label:
        firstString(target, ["label", "address", "surfaceKind", "kind"]) ||
        firstString(record, ["jobId", "runId"]) ||
        "(delivery)",
      status: firstString(record, ["status"]) || "unknown",
      when: firstNumber(record, ["endedAt"]) ?? firstNumber(record, ["startedAt"]),
    };
  });
}

function taskWhen(task: TaskSummary): number | undefined {
  return task.endedAt ?? task.startedAt ?? task.queuedAt;
}

export function AwayDigest() {
  // Frozen at mount: the digest keeps rendering the window it opened with,
  // even after lastSeen is bumped underneath it.
  const [windowStart, setWindowStart] = useState<number | null>(() => readLastSeen());
  const [mountedAt] = useState(() => Date.now());
  const bumpedRef = useRef(false);

  const firstVisit = windowStart === null;

  const runsQuery = useQuery({
    queryKey: [...queryKeys.automation, "runs", "away"],
    queryFn: () => gv.invoke("automation.runs.list"),
    retry: false,
    enabled: !firstVisit,
  });
  const tasksQuery = useTasksSnapshot({ enabled: !firstVisit });
  const deliveriesQuery = useQuery({
    // Nested under the shared 'deliveries' prefix — the deliveries SSE domain
    // invalidation fans out here.
    queryKey: [...queryKeys.deliveries, "away"],
    queryFn: () => gv.invoke("deliveries.list"),
    retry: false,
    enabled: !firstVisit,
  });

  // First ever visit: nothing to diff against — record now and say so.
  useEffect(() => {
    if (firstVisit && !bumpedRef.current) {
      bumpedRef.current = true;
      writeLastSeen(mountedAt);
    }
  }, [firstVisit, mountedAt]);

  // Bump lastSeen once the digest actually rendered from at least one live
  // source. If every source failed, keep the window so the next load retries.
  const anySettledOk = runsQuery.isSuccess || tasksQuery.isSuccess || deliveriesQuery.isSuccess;
  const allSettled =
    !runsQuery.isPending && !tasksQuery.isPending && !deliveriesQuery.isPending;
  useEffect(() => {
    if (!firstVisit && allSettled && anySettledOk && !bumpedRef.current) {
      bumpedRef.current = true;
      writeLastSeen(mountedAt);
    }
  }, [firstVisit, allSettled, anySettledOk, mountedAt]);

  // Palette command: reset the window to "now" explicitly.
  useEffect(() => {
    registerCommand({
      id: "home.markCaughtUp",
      title: "Mark Caught Up",
      group: "assistant",
      keywords: ["away", "digest", "caught", "up", "seen", "clear"],
      run: () => {
        writeLastSeen(Date.now());
        setWindowStart(Date.now());
      },
    });
    return () => unregisterCommand("home.markCaughtUp");
  }, []);

  const since = windowStart ?? mountedAt;

  const runs = useMemo(
    () =>
      runsQuery.isSuccess
        ? parseRuns(runsQuery.data)
            .filter((row) => row.when !== undefined && row.when >= since)
            .sort((a, b) => (b.when ?? 0) - (a.when ?? 0))
        : [],
    [runsQuery.isSuccess, runsQuery.data, since],
  );
  const tasks = useMemo(
    () =>
      tasksQuery.isSuccess
        ? tasksQuery.data.tasks
            .filter((task) => {
              const when = taskWhen(task);
              return when !== undefined && when >= since;
            })
            .sort((a, b) => (taskWhen(b) ?? 0) - (taskWhen(a) ?? 0))
        : [],
    [tasksQuery.isSuccess, tasksQuery.data, since],
  );
  const deliveries = useMemo(
    () =>
      deliveriesQuery.isSuccess
        ? parseDeliveries(deliveriesQuery.data)
            .filter((row) => row.when !== undefined && row.when >= since)
            .sort((a, b) => (b.when ?? 0) - (a.when ?? 0))
        : [],
    [deliveriesQuery.isSuccess, deliveriesQuery.data, since],
  );

  // Per-source honesty notes (unavailable vs genuine failure).
  const sourceNotes: string[] = [];
  for (const [query, capability] of [
    [runsQuery, "automation.runs.list"],
    [deliveriesQuery, "deliveries.list"],
  ] as const) {
    if (query.isError) {
      const refusal = capabilityRefusal(query.error, capability, "");
      sourceNotes.push(
        refusal ? `${capability} is not served by this daemon` : `${capability} failed: ${formatError(query.error)}`,
      );
    }
  }
  if (tasksQuery.isError) sourceNotes.push(`tasks.list failed: ${formatError(tasksQuery.error)}`);

  const loading = !firstVisit && (runsQuery.isPending || tasksQuery.isPending || deliveriesQuery.isPending);
  const empty = allSettled && anySettledOk && runs.length === 0 && tasks.length === 0 && deliveries.length === 0;

  return (
    <section className="home-card home-away" aria-label="While you were away">
      <div className="home-card__header">
        <span className="home-card__title">
          <History size={14} aria-hidden="true" /> While you were away
        </span>
        {windowStart !== null && <span className="home-card__hint">since {formatEpoch(windowStart)}</span>}
        <button
          type="button"
          className="home-away__caught-up"
          onClick={() => {
            writeLastSeen(Date.now());
            setWindowStart(Date.now());
          }}
        >
          <CheckCheck size={13} aria-hidden="true" /> Mark caught up
        </button>
      </div>

      {firstVisit && (
        <EmptyState
          title="First visit"
          description="From now on this card lists automation runs, tasks, and deliveries that finished while the app was closed."
        />
      )}

      {loading && <SkeletonBlock variant="text" lines={3} />}

      {!firstVisit && allSettled && !anySettledOk && (
        <EmptyState
          title="Away digest unavailable"
          description={`None of the digest sources answered. ${sourceNotes.join(" · ")}`}
        />
      )}

      {empty && (
        <EmptyState
          title="Nothing happened while you were away"
          description="No automation runs, task changes, or deliveries in the window. That's the whole truth, not a loading failure."
        />
      )}

      {!firstVisit && anySettledOk && (runs.length > 0 || tasks.length > 0 || deliveries.length > 0) && (
        <div className="home-away__groups">
          {runs.length > 0 && (
            <DigestGroup
              icon={<Repeat size={13} aria-hidden="true" />}
              title={`Automation runs (${runs.length})`}
              rows={runs.map((row) => ({ key: row.id, label: row.label, status: row.status, when: row.when }))}
            />
          )}
          {tasks.length > 0 && (
            <DigestGroup
              icon={<ListTodo size={13} aria-hidden="true" />}
              title={`Tasks (${tasks.length})`}
              rows={tasks.map((task) => ({
                key: task.id,
                label: task.title || task.kind,
                status: task.status,
                when: taskWhen(task),
              }))}
            />
          )}
          {deliveries.length > 0 && (
            <DigestGroup
              icon={<Send size={13} aria-hidden="true" />}
              title={`Deliveries (${deliveries.length})`}
              rows={deliveries.map((row) => ({ key: row.id, label: row.label, status: row.status, when: row.when }))}
            />
          )}
        </div>
      )}

      {sourceNotes.length > 0 && anySettledOk && (
        <p className="home-card__footnote" role="status">
          Partial digest: {sourceNotes.join(" · ")}
        </p>
      )}
    </section>
  );
}

function DigestGroup({
  icon,
  title,
  rows,
}: {
  icon: ReactNode;
  title: string;
  rows: Array<{ key: string; label: string; status: string; when: number | undefined }>;
}) {
  const visible = rows.slice(0, MAX_ROWS_PER_GROUP);
  const overflow = rows.length - visible.length;
  return (
    <div className="home-away__group">
      <h3 className="home-away__group-title">
        {icon} {title}
      </h3>
      <ul className="home-away__list">
        {visible.map((row, index) => (
          <li key={row.key || index} className="home-away__row">
            <span className="home-away__row-label" title={row.label}>
              {row.label || "(untitled)"}
            </span>
            <StatusBadge value={row.status} />
            <span className="home-away__row-when">{formatEpoch(row.when)}</span>
          </li>
        ))}
      </ul>
      {overflow > 0 && <p className="home-card__footnote">+{overflow} more in this window</p>}
    </div>
  );
}
