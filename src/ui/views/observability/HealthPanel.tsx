// Health snapshot — health.snapshot rendered as actionable cause/impact/
// next-action cards (docs/FEATURES.md §17), not a bare status blob.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { compactJson } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { obsKeys } from "./keys.ts";
import { readHealthCards, severityBadgeTone } from "./obs-wire.ts";

export function HealthPanel() {
  const health = useQuery({
    queryKey: obsKeys.health,
    queryFn: () => gv.health.snapshot(),
    refetchInterval: 20_000,
    retry: false,
  });

  const cards = useMemo(() => readHealthCards(health.data), [health.data]);
  const unavailable = health.isError && isMethodUnavailableError(health.error);

  return (
    <div className="obs-health">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">Health snapshot</span>
        <button type="button" className="obs-btn" aria-label="Refresh health" onClick={() => void health.refetch()}>
          <RefreshCw size={14} aria-hidden="true" className={health.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      {health.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && <UnavailableState capability="health.snapshot" description="no health snapshot is served." />}

      {health.isError && !unavailable && (
        <ErrorState error={health.error} onRetry={() => void health.refetch()} title="Failed to load health snapshot" />
      )}

      {health.isSuccess && cards.length === 0 && (
        <EmptyState title="No health checks reported" description="The daemon returned an empty health snapshot." />
      )}

      {health.isSuccess && cards.length > 0 && (
        <ul className="obs-health-cards">
          {cards.map((card) => (
            <li key={card.id} className="obs-health-card">
              <div className="obs-health-card__head">
                <span className={`badge ${severityBadgeTone(card.severity)}`}>{card.severity}</span>
                <span className="obs-health-card__title">{card.title}</span>
              </div>
              <dl className="obs-health-card__facts">
                <dt>Cause</dt>
                <dd>{card.cause || "not reported"}</dd>
                <dt>Impact</dt>
                <dd>{card.impact || "not reported"}</dd>
                <dt>Next action</dt>
                <dd>{card.nextAction || "none suggested"}</dd>
              </dl>
              <details className="obs-raw-panel">
                <summary>Raw check payload</summary>
                <pre>{compactJson(card.raw)}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
