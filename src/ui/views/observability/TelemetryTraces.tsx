// Traces browser — telemetry.traces.list.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { compactJson } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import { obsKeys } from "./keys.ts";
import { formatTimestamp, readTraceRows } from "./obs-wire.ts";

export function TelemetryTraces() {
  const [sessionFilter, setSessionFilter] = useState("");
  const { open } = usePeek();

  const query = useMemo(
    () => (sessionFilter.trim() ? { sessionId: sessionFilter.trim() } : undefined),
    [sessionFilter],
  );

  const traces = useQuery({
    queryKey: obsKeys.telemetryTraces({ sessionId: sessionFilter.trim() || undefined }),
    queryFn: () => gv.invoke("telemetry.traces.list", { query }),
    retry: false,
  });

  const rows = useMemo(() => readTraceRows(traces.data), [traces.data]);
  const unavailable = traces.isError && isMethodUnavailableError(traces.error);

  return (
    <div className="obs-traces">
      <div className="obs-filter-grid" role="group" aria-label="Trace filters">
        <label className="obs-filter-field">
          <span>Session ID</span>
          <input
            type="text"
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
            placeholder="Filter by session…"
          />
        </label>
        <button type="button" className="obs-btn" aria-label="Refresh traces" onClick={() => void traces.refetch()}>
          <RefreshCw size={14} aria-hidden="true" className={traces.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      {traces.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState capability="telemetry.traces.list" description="the trace browser cannot be populated." />
      )}

      {traces.isError && !unavailable && (
        <ErrorState error={traces.error} onRetry={() => void traces.refetch()} title="Failed to load traces" />
      )}

      {traces.isSuccess && rows.length === 0 && (
        <EmptyState title="No traces recorded" description="Distributed traces will appear here once the daemon emits them." />
      )}

      {traces.isSuccess && rows.length > 0 && (
        <div className="obs-table-wrap">
          <table className="obs-table">
            <thead>
              <tr>
                <th>Trace</th>
                <th>Status</th>
                <th>Spans</th>
                <th>Duration</th>
                <th>Session</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="obs-table__row"
                  tabIndex={0}
                  onClick={() => open({ title: row.name, content: <pre className="obs-peek-json">{compactJson(row.raw)}</pre> })}
                >
                  <td>
                    <span className="obs-table__mono">{row.id}</span>
                    <span className="obs-table__sub">{row.name}</span>
                  </td>
                  <td>
                    <span className={`badge ${row.status === "error" || row.status === "failed" ? "bad" : "ok"}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>{row.spanCount}</td>
                  <td>{row.durationMs !== undefined ? `${row.durationMs.toLocaleString()} ms` : "—"}</td>
                  <td className="obs-table__mono">{row.sessionId || "—"}</td>
                  <td>{formatTimestamp(row.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
