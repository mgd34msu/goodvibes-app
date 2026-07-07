// Telemetry events browser — telemetry.events.list with the eight filters
// FEATURES.md §17 calls out: domain/type/severity/trace/session/turn/agent/
// task. Filters are local component state (not URL-synced) — dense filter
// forms follow the McpView.toolSearch precedent rather than every keystroke
// becoming a history entry.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { compactJson } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import { obsKeys } from "./keys.ts";
import { formatTimestamp, readEventRows, severityBadgeTone, type EventRow } from "./obs-wire.ts";

interface Filters {
  domain: string;
  type: string;
  severity: string;
  trace: string;
  session: string;
  turn: string;
  agent: string;
  task: string;
}

const EMPTY_FILTERS: Filters = { domain: "", type: "", severity: "", trace: "", session: "", turn: "", agent: "", task: "" };

const FILTER_FIELDS: Array<{ key: keyof Filters; label: string; query: string }> = [
  { key: "domain", label: "Domain", query: "domain" },
  { key: "type", label: "Type", query: "type" },
  { key: "severity", label: "Severity", query: "severity" },
  { key: "trace", label: "Trace ID", query: "traceId" },
  { key: "session", label: "Session ID", query: "sessionId" },
  { key: "turn", label: "Turn ID", query: "turnId" },
  { key: "agent", label: "Agent ID", query: "agentId" },
  { key: "task", label: "Task ID", query: "taskId" },
];

function filtersToQuery(filters: Filters): Record<string, string | undefined> {
  const query: Record<string, string | undefined> = {};
  for (const field of FILTER_FIELDS) {
    const value = filters[field.key].trim();
    if (value) query[field.query] = value;
  }
  return query;
}

export function TelemetryEvents() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const { open } = usePeek();

  const query = useMemo(() => filtersToQuery(filters), [filters]);

  const events = useQuery({
    queryKey: obsKeys.telemetryEvents(query),
    queryFn: () => gv.invoke("telemetry.events.list", { query }),
    retry: false,
  });

  const rows = useMemo(() => readEventRows(events.data), [events.data]);
  const unavailable = events.isError && isMethodUnavailableError(events.error);
  const hasActiveFilter = Object.values(filters).some((v) => v.trim());

  function showRow(row: EventRow): void {
    open({
      title: `Event ${row.id}`,
      content: <pre className="obs-peek-json">{compactJson(row.raw)}</pre>,
    });
  }

  return (
    <div className="obs-events">
      <div className="obs-filter-grid" role="group" aria-label="Event filters">
        {FILTER_FIELDS.map((field) => (
          <label key={field.key} className="obs-filter-field">
            <span>{field.label}</span>
            <input
              type="text"
              value={filters[field.key]}
              onChange={(e) => setFilters((prev) => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={`Filter by ${field.label.toLowerCase()}…`}
            />
          </label>
        ))}
        <button
          type="button"
          className="obs-btn"
          onClick={() => setFilters(EMPTY_FILTERS)}
          disabled={!hasActiveFilter}
        >
          Clear filters
        </button>
        <button
          type="button"
          className="obs-btn"
          aria-label="Refresh events"
          onClick={() => void events.refetch()}
        >
          <RefreshCw size={14} aria-hidden="true" className={events.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      {events.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState capability="telemetry.events.list" description="the event browser cannot be populated." />
      )}

      {events.isError && !unavailable && (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} title="Failed to load telemetry events" />
      )}

      {events.isSuccess && rows.length === 0 && (
        <EmptyState
          title={hasActiveFilter ? "No events match these filters" : "No telemetry events"}
          description={hasActiveFilter ? "Try clearing a filter." : "Events will appear here as the daemon emits them."}
        />
      )}

      {events.isSuccess && rows.length > 0 && (
        <div className="obs-table-wrap">
          <table className="obs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Domain</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Session</th>
                <th>Trace</th>
                <th>Agent</th>
                <th>Task</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="obs-table__row" onClick={() => showRow(row)} tabIndex={0}>
                  <td>{formatTimestamp(row.timestamp)}</td>
                  <td>{row.domain}</td>
                  <td>{row.type}</td>
                  <td>
                    <span className={`badge ${severityBadgeTone(row.severity)}`}>{row.severity}</span>
                  </td>
                  <td className="obs-table__mono">{row.sessionId || "—"}</td>
                  <td className="obs-table__mono">{row.traceId || "—"}</td>
                  <td className="obs-table__mono">{row.agentId || "—"}</td>
                  <td className="obs-table__mono">{row.taskId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
