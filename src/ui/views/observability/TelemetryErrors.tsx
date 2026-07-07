// Error ledger — telemetry.errors.list.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { compactJson } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import { obsKeys } from "./keys.ts";
import { formatTimestamp, readErrorRows, severityBadgeTone } from "./obs-wire.ts";

export function TelemetryErrors() {
  const [domainFilter, setDomainFilter] = useState("");
  const { open } = usePeek();

  const query = useMemo(
    () => (domainFilter.trim() ? { domain: domainFilter.trim() } : undefined),
    [domainFilter],
  );

  const errors = useQuery({
    queryKey: obsKeys.telemetryErrors({ domain: domainFilter.trim() || undefined }),
    queryFn: () => gv.invoke("telemetry.errors.list", { query }),
    retry: false,
  });

  const rows = useMemo(() => readErrorRows(errors.data), [errors.data]);
  const unavailable = errors.isError && isMethodUnavailableError(errors.error);

  return (
    <div className="obs-errors">
      <div className="obs-filter-grid" role="group" aria-label="Error filters">
        <label className="obs-filter-field">
          <span>Domain</span>
          <input
            type="text"
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            placeholder="Filter by domain…"
          />
        </label>
        <button type="button" className="obs-btn" aria-label="Refresh errors" onClick={() => void errors.refetch()}>
          <RefreshCw size={14} aria-hidden="true" className={errors.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      {errors.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState capability="telemetry.errors.list" description="the error ledger cannot be populated." />
      )}

      {errors.isError && !unavailable && (
        <ErrorState error={errors.error} onRetry={() => void errors.refetch()} title="Failed to load error ledger" />
      )}

      {errors.isSuccess && rows.length === 0 && (
        <EmptyState title="No recorded errors" description="Nothing has been logged to the error ledger yet — that's good news." />
      )}

      {errors.isSuccess && rows.length > 0 && (
        <ul className="obs-error-rows">
          {rows.map((row) => (
            <li key={row.id} className="obs-error-row">
              <button
                type="button"
                className="obs-error-row__button"
                onClick={() => open({ title: `Error ${row.id}`, content: <pre className="obs-peek-json">{compactJson(row.raw)}</pre> })}
              >
                <div className="obs-error-row__head">
                  <span className={`badge ${severityBadgeTone(row.severity)}`}>{row.severity}</span>
                  <span className="obs-error-row__domain">{row.domain}</span>
                  {row.code && <code className="obs-error-row__code">{row.code}</code>}
                  <span className="obs-error-row__time">{formatTimestamp(row.timestamp)}</span>
                </div>
                <p className="obs-error-row__message">{row.message}</p>
                {(row.sessionId || row.traceId) && (
                  <p className="obs-error-row__meta">
                    {row.sessionId && <span>session {row.sessionId}</span>}
                    {row.traceId && <span>trace {row.traceId}</span>}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
