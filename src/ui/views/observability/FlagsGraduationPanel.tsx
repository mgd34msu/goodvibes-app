// Flags graduation — flags.graduation.report (WS-only, read-only reporting;
// no reference implementation exists anywhere for this contract shape, so
// this is built directly from the wire schema). releaseBlockers is the loud,
// danger-toned surface — the release policy (bun run flags:graduation) fails
// while it is non-empty. Evidence is real-only: "no evidence collected" is an
// honest state, never a fabricated readiness signal.

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { compactJson } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  FLAG_STATES,
  flagStateBadgeTone,
  flagStateLabel,
  groupFlagEntries,
  readFlagsGraduationReport,
} from "./obs-wire.ts";

export function FlagsGraduationPanel() {
  const report = useQuery({
    queryKey: queryKeys.flagsGraduation,
    queryFn: () => gv.flags.graduationReport(),
    retry: false,
  });

  const wsDown = report.isError && isWsBridgeUnavailableError(report.error);
  const unavailable = report.isError && (isMethodUnavailableError(report.error) || wsDown);

  return (
    <section className="obs-subsection">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">Flags graduation</span>
        <button
          type="button"
          className="obs-btn"
          aria-label="Refresh flags graduation report"
          onClick={() => void report.refetch()}
        >
          <RefreshCw size={14} aria-hidden="true" className={report.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      {report.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState
          capability="flags.graduation.report"
          description={
            wsDown
              ? "the graduation report requires the realtime bridge, which is currently down."
              : "this daemon does not serve a feature-defaults graduation report."
          }
        />
      )}

      {report.isError && !unavailable && (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} title="Failed to load flags graduation report" />
      )}

      {report.isSuccess &&
        (() => {
          const data = readFlagsGraduationReport(report.data);
          const grouped = groupFlagEntries(data.entries);
          return (
            <>
              <p className="obs-dashboard__note">
                {data.summary.total} capabilities — {data.summary.graduated} graduated,{" "}
                {data.summary.graduateCandidate} ready to graduate, {data.summary.soaking} soaking,{" "}
                {data.summary.dark} dark, {data.summary.blocked} blocked. Generated{" "}
                {new Date(data.generatedAt).toLocaleString()}.
              </p>

              {data.releaseBlockers.length > 0 && (
                <div className="obs-flags__blockers" role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div>
                    <strong>Release blockers</strong>
                    <ul>
                      {data.releaseBlockers.map((blocker, i) => (
                        <li key={i}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {data.entries.length === 0 && (
                <EmptyState title="No flag entries reported" description="The daemon returned an empty graduation report." />
              )}

              {FLAG_STATES.map((state) => {
                const entries = grouped[state];
                if (entries.length === 0) return null;
                return (
                  <div key={state} className="obs-flags__group">
                    <h3>
                      <span className={`badge ${flagStateBadgeTone(state)}`}>{flagStateLabel(state)}</span> (
                      {entries.length})
                    </h3>
                    <ul className="obs-simple-rows">
                      {entries.map((entry) => (
                        <li key={entry.flagId} className="obs-flags__entry">
                          <div className="obs-flags__entry-head">
                            <span className="obs-table__mono">{entry.flagId}</span>
                            <span>{entry.name}</span>
                            <span className="badge neutral">tier {entry.tier}</span>
                            <span className="badge neutral">{entry.currentDefault}</span>
                            {!entry.runtimeToggleable && <span className="badge neutral">build-time only</span>}
                          </div>
                          {entry.blocker && (
                            <p className="obs-simple-row__description">
                              Blocked {entry.blocker.date}: {entry.blocker.reason}
                            </p>
                          )}
                          {entry.evidence.divergence ? (
                            <p className="obs-simple-row__description">
                              Divergence {(entry.evidence.divergence.divergenceRate * 100).toFixed(1)}% over{" "}
                              {entry.evidence.divergence.totalEvaluations} evaluations — gate{" "}
                              {entry.evidence.divergence.gateStatus}.
                            </p>
                          ) : (
                            <p className="obs-simple-row__description">{entry.evidence.note}</p>
                          )}
                          {entry.note && <p className="obs-simple-row__description">{entry.note}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              <details className="obs-raw-panel">
                <summary>Raw flags.graduation.report payload</summary>
                <pre>{compactJson(report.data)}</pre>
              </details>
            </>
          );
        })()}
    </section>
  );
}
