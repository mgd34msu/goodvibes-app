// The smaller read-only System subtabs: surfaces list, continuity snapshot,
// scheduler capacity, and OTLP ingest endpoints (display-only per
// docs/FEATURES.md §17). Each shape is unpinned, so every panel renders a
// best-effort summary list plus the raw payload — nothing is hidden behind a
// guessed field name that doesn't match.

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, bestId, bestStatus, bestTitle, compactJson, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { obsKeys } from "./keys.ts";

function ReadOnlyListPanel({
  title,
  capability,
  queryKey,
  queryFn,
  itemsPath,
  emptyLabel,
}: {
  title: string;
  capability: string;
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
  itemsPath: string[];
  emptyLabel: string;
}) {
  const query = useQuery({ queryKey, queryFn, retry: false, refetchInterval: 20_000 });
  const rows = useMemo(() => firstArray(query.data, itemsPath), [query.data, itemsPath]);
  const unavailable = query.isError && isMethodUnavailableError(query.error);

  return (
    <section className="obs-subsection">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">
          {title}
          {query.isSuccess ? ` · ${rows.length}` : ""}
        </span>
        <button type="button" className="obs-btn" aria-label={`Refresh ${title}`} onClick={() => void query.refetch()}>
          <RefreshCw size={14} aria-hidden="true" className={query.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {query.isPending && <SkeletonBlock variant="text" lines={3} />}
      {unavailable && <UnavailableState capability={capability} />}
      {query.isError && !unavailable && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} title={`Failed to load ${title.toLowerCase()}`} />
      )}
      {query.isSuccess && rows.length === 0 && <EmptyState title={emptyLabel} />}
      {query.isSuccess && rows.length > 0 && (
        <ul className="obs-simple-rows">
          {rows.map((row, i) => {
            const record = asRecord(row);
            return (
              <li key={bestId(record) || i} className="obs-simple-row">
                <span className="badge neutral">{bestStatus(record)}</span>
                <span>{bestTitle(record, `item ${i + 1}`)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {query.isSuccess && rows.length === 0 && query.data !== undefined && (
        <details className="obs-raw-panel">
          <summary>Raw payload</summary>
          <pre>{compactJson(query.data)}</pre>
        </details>
      )}
    </section>
  );
}

export function SurfacesPanel() {
  return (
    <ReadOnlyListPanel
      title="Surfaces"
      capability="surfaces.list"
      queryKey={obsKeys.surfaces}
      queryFn={() => gv.invoke("surfaces.list")}
      itemsPath={["items", "surfaces", "data"]}
      emptyLabel="No surfaces reported"
    />
  );
}

export function ContinuityPanel() {
  const query = useQuery({
    queryKey: obsKeys.continuity,
    queryFn: () => gv.invoke("continuity.snapshot"),
    retry: false,
    refetchInterval: 20_000,
  });
  const unavailable = query.isError && isMethodUnavailableError(query.error);

  return (
    <section className="obs-subsection">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">Continuity snapshot</span>
        <button type="button" className="obs-btn" aria-label="Refresh continuity" onClick={() => void query.refetch()}>
          <RefreshCw size={14} aria-hidden="true" className={query.isFetching ? "spinning" : undefined} />
        </button>
      </div>
      {query.isPending && <SkeletonBlock variant="text" lines={3} />}
      {unavailable && <UnavailableState capability="continuity.snapshot" />}
      {query.isError && !unavailable && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Failed to load continuity snapshot" />
      )}
      {query.isSuccess && (
        <details className="obs-raw-panel" open>
          <summary>Snapshot payload</summary>
          <pre>{compactJson(query.data)}</pre>
        </details>
      )}
    </section>
  );
}

export function SchedulerPanel() {
  const query = useQuery({
    queryKey: obsKeys.scheduler,
    queryFn: () => gv.invoke("scheduler.capacity"),
    retry: false,
    refetchInterval: 15_000,
  });
  const unavailable = query.isError && isMethodUnavailableError(query.error);
  const record = asRecord(query.data);
  const capacity = firstNumber(record, ["capacity", "maxConcurrency", "slots"]);
  const inUse = firstNumber(record, ["inUse", "active", "running"]);

  return (
    <section className="obs-subsection">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">Scheduler capacity</span>
        <button type="button" className="obs-btn" aria-label="Refresh scheduler capacity" onClick={() => void query.refetch()}>
          <RefreshCw size={14} aria-hidden="true" className={query.isFetching ? "spinning" : undefined} />
        </button>
      </div>
      {query.isPending && <SkeletonBlock variant="text" lines={2} />}
      {unavailable && <UnavailableState capability="scheduler.capacity" />}
      {query.isError && !unavailable && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Failed to load scheduler capacity" />
      )}
      {query.isSuccess && (capacity !== undefined || inUse !== undefined) && (
        <div className="obs-stat-row" role="list" aria-label="Scheduler capacity">
          {inUse !== undefined && (
            <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
              <span className="obs-stat-tile__value">{inUse}</span>
              <span className="obs-stat-tile__label">In use</span>
            </div>
          )}
          {capacity !== undefined && (
            <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
              <span className="obs-stat-tile__value">{capacity}</span>
              <span className="obs-stat-tile__label">Capacity</span>
            </div>
          )}
        </div>
      )}
      {query.isSuccess && (
        <details className="obs-raw-panel">
          <summary>Raw payload</summary>
          <pre>{compactJson(query.data)}</pre>
        </details>
      )}
    </section>
  );
}

const OTLP_METHODS = [
  { id: "telemetry.otlp.logs", label: "Logs" },
  { id: "telemetry.otlp.metrics", label: "Metrics" },
  { id: "telemetry.otlp.traces", label: "Traces" },
] as const;

export function OtlpPanel() {
  const queries = useQueries({
    queries: OTLP_METHODS.map((m) => ({
      queryKey: [...obsKeys.telemetryOtlp, m.id] as const,
      queryFn: () => gv.invoke(m.id),
      retry: false,
    })),
  });

  return (
    <section className="obs-subsection">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">OTLP ingest endpoints (display-only)</span>
      </div>
      <ul className="obs-simple-rows">
        {OTLP_METHODS.map((method, i) => {
          const query = queries[i];
          const unavailable = query?.isError && isMethodUnavailableError(query.error);
          return (
            <li key={method.id} className="obs-simple-row">
              <span className="badge neutral">{method.label}</span>
              <span className="obs-table__mono">{firstString(asRecord(query?.data), ["endpoint", "url", "path"]) || method.id}</span>
              {unavailable && <span className="badge bad">not exposed</span>}
              {query?.isError && !unavailable && <span className="badge warning">error</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
