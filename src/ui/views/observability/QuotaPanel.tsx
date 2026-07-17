// Quota — quota.snapshot.get / quota.fanout.get (WS-only, [ws] in gv.ts).
// hasSignal:false is an honest "no observation yet" — never rendered as a
// fabricated full/empty quota. The fan-out advisor is a pre-flight verdict
// grounded in observed signals — labeled advisory, not a promise; the human
// still decides whether to spawn.

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { asRecord, bestId, bestTitle } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { formatEpoch, readQuotaFanoutResult, readQuotaSnapshot } from "./obs-wire.ts";

export function QuotaPanel() {
  const providers = useQuery({ queryKey: queryKeys.providers, queryFn: () => gv.providers.list(), retry: false });

  const providerOptions = useMemo(() => {
    const list = asRecord(providers.data)["providers"] ?? providers.data;
    return Array.isArray(list)
      ? list.map((p) => ({ id: bestId(p), label: bestTitle(p) })).filter((p) => p.id !== "")
      : [];
  }, [providers.data]);

  const [providerChoice, setProviderChoice] = useState("");
  const activeProvider = providerChoice || providerOptions[0]?.id || "";

  const snapshot = useQuery({
    queryKey: queryKeys.quotaSnapshot(activeProvider),
    queryFn: () => gv.quota.snapshot({ provider: activeProvider }),
    enabled: activeProvider !== "",
    retry: false,
  });

  const [agentCount, setAgentCount] = useState("5");
  const [callsPerAgent, setCallsPerAgent] = useState("");

  const fanout = useMutation({
    mutationFn: () =>
      gv.quota.fanout({
        provider: activeProvider,
        agentCount: Number(agentCount) || 0,
        ...(callsPerAgent ? { callsPerAgent: Number(callsPerAgent) } : {}),
      }),
  });

  const snapshotWsDown = snapshot.isError && isWsBridgeUnavailableError(snapshot.error);
  const snapshotUnavailable = snapshot.isError && (isMethodUnavailableError(snapshot.error) || snapshotWsDown);

  const fanoutWsDown = fanout.isError && isWsBridgeUnavailableError(fanout.error);
  const fanoutUnavailable = fanout.isError && (isMethodUnavailableError(fanout.error) || fanoutWsDown);

  return (
    <section className="obs-subsection">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">
          <Gauge size={14} aria-hidden="true" /> Quota
        </span>
      </div>

      {providers.isPending && <SkeletonBlock variant="text" lines={2} />}

      {providers.isSuccess && providerOptions.length === 0 && (
        <EmptyState title="No providers configured" description="Quota observation needs at least one configured provider." />
      )}

      {providerOptions.length > 0 && (
        <>
          <label className="obs-filter-field">
            <span>Provider</span>
            <select value={activeProvider} onChange={(e) => setProviderChoice(e.target.value)}>
              {providerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {snapshot.isPending && <SkeletonBlock variant="text" lines={2} />}

          {snapshotUnavailable && (
            <UnavailableState
              capability="quota.snapshot.get"
              description={
                snapshotWsDown
                  ? "quota observation requires the realtime bridge, which is currently down."
                  : "this daemon does not expose quota observation."
              }
            />
          )}

          {snapshot.isError && !snapshotUnavailable && (
            <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} title="Failed to load quota snapshot" />
          )}

          {snapshot.isSuccess &&
            (() => {
              const snap = readQuotaSnapshot(snapshot.data);
              if (!snap.hasSignal) {
                return <p className="obs-dashboard__note">No rate-limit signal observed for this provider.</p>;
              }
              return (
                <div className="obs-stat-row" role="list" aria-label="Quota snapshot">
                  <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                    <span className="obs-stat-tile__value">{snap.remaining ?? "—"}</span>
                    <span className="obs-stat-tile__label">Remaining</span>
                  </div>
                  <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                    <span className="obs-stat-tile__value">{snap.limit ?? "—"}</span>
                    <span className="obs-stat-tile__label">Limit</span>
                  </div>
                  <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                    <span className="obs-stat-tile__value">{formatEpoch(snap.resetAt)}</span>
                    <span className="obs-stat-tile__label">Resets</span>
                  </div>
                  <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                    <span className="obs-stat-tile__value">
                      {snap.activeCooldownMs !== undefined ? `${Math.round(snap.activeCooldownMs / 1000)}s` : "—"}
                    </span>
                    <span className="obs-stat-tile__label">Active cooldown</span>
                  </div>
                  <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                    <span className="obs-stat-tile__value">{snap.recentRateLimitCount}</span>
                    <span className="obs-stat-tile__label">Recent 429s</span>
                  </div>
                </div>
              );
            })()}

          <form
            className="obs-quota__fanout"
            onSubmit={(e) => {
              e.preventDefault();
              fanout.mutate();
            }}
          >
            <h3>Fan-out advisor</h3>
            <p className="obs-dashboard__note">
              Assesses whether spawning N agents likely exhausts this provider's quota window right now — an
              advisory grounded in observed signals, not a guarantee.
            </p>
            <div className="obs-filter-grid">
              <label className="obs-filter-field">
                <span>Agent count</span>
                <input type="number" min="1" value={agentCount} onChange={(e) => setAgentCount(e.target.value)} required />
              </label>
              <label className="obs-filter-field">
                <span>Calls per agent (optional)</span>
                <input type="number" min="1" value={callsPerAgent} onChange={(e) => setCallsPerAgent(e.target.value)} />
              </label>
              <button type="submit" className="obs-btn obs-btn--primary" disabled={fanout.isPending || !activeProvider}>
                {fanout.isPending ? "Checking…" : "Check fan-out"}
              </button>
            </div>

            {fanoutUnavailable && (
              <UnavailableState
                capability="quota.fanout.get"
                description={
                  fanoutWsDown
                    ? "the fan-out advisor requires the realtime bridge, which is currently down."
                    : "this daemon does not serve the fan-out advisor."
                }
              />
            )}
            {fanout.isError && !fanoutUnavailable && <p className="obs-inline-form__error">{formatError(fanout.error)}</p>}

            {fanout.isSuccess &&
              (() => {
                const result = readQuotaFanoutResult(fanout.data);
                const tone = result.verdict === "likely-exhausts" ? "bad" : result.verdict === "unlikely" ? "ok" : "neutral";
                return (
                  <div className="obs-quota__verdict" role="status">
                    <span className={`badge ${tone}`}>{result.verdict}</span>
                    <span className="obs-quota__advisory-label">Advisory — not a guarantee</span>
                    <p>{result.reason}</p>
                  </div>
                );
              })()}
          </form>
        </>
      )}
    </section>
  );
}
