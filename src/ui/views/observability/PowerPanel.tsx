// Power — power.status.get / power.keepAwake.set (docs/FEATURES.md §17;
// owner ruling: ONE keep-awake toggle, no timer, no AC-only sub-option — the
// always-visible status-strip chip is the safety mechanism, not a timeout).
// Danger-toned block whenever the daemon's own automatic work inhibitor is
// held, naming its live reasons/heldSince/cap verbatim — never papered over.
//
// power.status.get carries a wire event (OPS_POWER_STATE_CHANGED via
// power.keepAwake.set's `events` list) but lib/realtime.ts's
// DOMAIN_INVALIDATIONS has no "ops"/"power" domain entry yet (verified: not
// in the events path this app subscribes to) — this polls sparsely as a
// fallback and always refreshes on the mutation's own response instead of
// waiting on a wire frame that never arrives. Noted for the integration gate.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { compactJson } from "../../lib/wire.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { readPowerStatus } from "./obs-wire.ts";

export function PowerPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const status = useQuery({
    queryKey: queryKeys.powerStatus,
    queryFn: () => gv.power.status(),
    refetchInterval: 45_000,
    retry: false,
  });

  const setKeepAwake = useMutation({
    mutationFn: (enabled: boolean) => gv.power.keepAwake(enabled),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.powerStatus, data);
      const next = readPowerStatus(data);
      toast({
        title: next.keepAwakeEnabled ? "Keep-awake enabled" : "Keep-awake disabled",
        description: next.keepAwakeNote ?? undefined,
        tone: "success",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Keep-awake change failed", description: formatError(error), tone: "danger" }),
  });

  const unavailable = status.isError && isMethodUnavailableError(status.error);
  const snapshot = status.isSuccess ? readPowerStatus(status.data) : undefined;

  return (
    <section className="obs-subsection">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">Power</span>
        <button type="button" className="obs-btn" aria-label="Refresh power status" onClick={() => void status.refetch()}>
          <RefreshCw size={14} aria-hidden="true" className={status.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      {status.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState capability="power.status.get" description="this daemon build reports no sleep-ownership state." />
      )}

      {status.isError && !unavailable && (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} title="Failed to load power status" />
      )}

      {snapshot && (
        <>
          <label className="obs-power__toggle">
            <input
              type="checkbox"
              checked={snapshot.keepAwakeEnabled}
              disabled={setKeepAwake.isPending}
              onChange={(e) => setKeepAwake.mutate(e.target.checked)}
              aria-label="Keep awake"
            />
            <span>
              <Moon size={14} aria-hidden="true" /> Keep awake
            </span>
          </label>
          <p className="obs-power__note">
            {snapshot.platform ? `Platform: ${snapshot.platform}. ` : ""}
            One toggle, no timer, no AC-only option — this is the always-visible safety switch.
          </p>
          {snapshot.keepAwakeNote && <p className="obs-power__note">{snapshot.keepAwakeNote}</p>}
          {snapshot.keepAwakeEnabled && snapshot.keepAwakeDeniedClasses.length > 0 && (
            <p className="obs-power__note">
              Refused by the OS: {snapshot.keepAwakeDeniedClasses.join(", ")} — controlled outside this app.
            </p>
          )}

          {snapshot.workHeld && (
            <div className="obs-power__inhibitor-block" role="status">
              <span className="badge bad">Sleep inhibitor held</span>
              <dl className="obs-power__facts">
                <dt>Reasons</dt>
                <dd>{snapshot.workReasons.length > 0 ? snapshot.workReasons.join("; ") : "not reported"}</dd>
                <dt>Held since</dt>
                <dd>{snapshot.workHeldSince !== null ? new Date(snapshot.workHeldSince).toLocaleString() : "unknown"}</dd>
                {snapshot.workCapMinutes !== undefined && (
                  <>
                    <dt>Cap</dt>
                    <dd>
                      {snapshot.workCapMinutes} min
                      {snapshot.workCapExpiresAt !== null
                        ? ` — expires ${new Date(snapshot.workCapExpiresAt).toLocaleString()}`
                        : ""}
                      {snapshot.workCapExpired ? " (expired)" : ""}
                    </dd>
                  </>
                )}
                <dt>Granted / denied</dt>
                <dd>
                  {snapshot.workGrantedClasses.join(", ") || "none"} granted
                  {snapshot.workDeniedClasses.length > 0 ? `; ${snapshot.workDeniedClasses.join(", ")} denied` : ""}
                </dd>
              </dl>
            </div>
          )}

          <details className="obs-raw-panel">
            <summary>Raw power.status.get payload</summary>
            <pre>{compactJson(status.data)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
