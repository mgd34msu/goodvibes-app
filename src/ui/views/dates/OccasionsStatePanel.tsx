// State and sweep: what the machine-owned store is holding, and running one
// approach pass on demand.
//
// occasions.state is the only shape on this page with no answer, no gift and no
// date anywhere in it (counts and reasons only), which is what makes THAT half
// safe to read out in a support context. The store PATH is shown for the same
// reason the daemon returns it: so the owner knows where his own machine keeps
// this.
//
// The sweep report below it is NOT in that class and must never be described as
// if it were: conflictMessages quote the daemon's raised sentences, which name
// the occasion and therefore the person ("Your profile has 2 different dates
// recorded for Robin birthday"), and a raised nudge names people too. The
// safety claim in the UI is scoped to the counts list and the sweep block
// carries its own warning.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, PlayCircle, RefreshCw } from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { useToast } from "../../lib/toast.ts";
import { formatError } from "../../lib/errors.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { pollWhileVisible } from "./use-view-visible.ts";
import {
  datesApi,
  datesRefusal,
  DATES_POLL_MS,
  formatEpoch,
  housekeepingNote,
  sweepOutcomeNote,
  type SweepReport,
} from "./dates-data.ts";

export function OccasionsStatePanel({ visible }: { visible: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [report, setReport] = useState<SweepReport | null>(null);

  const state = useQuery({
    queryKey: queryKeys.occasionsState,
    queryFn: datesApi.state,
    retry: false,
    refetchInterval: pollWhileVisible(visible, DATES_POLL_MS),
  });

  const sweep = useMutation({
    mutationFn: datesApi.sweep,
    onSuccess: async (result) => {
      setReport(result);
      await queryClient.invalidateQueries({ queryKey: queryKeys.occasions });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to run the sweep", description: formatError(error), tone: "danger" }),
  });

  const refusal = state.isError ? datesRefusal(state.error, "occasions.state") : null;
  const data = state.data;

  return (
    <section className="dates-section" aria-labelledby="dates-state-heading">
      <div className="dates-section__header">
        <h2 id="dates-state-heading">What the store holds</h2>
        <div className="dates-section__meta">
          <button
            type="button"
            className="dates-icon-button"
            title="Refresh"
            aria-label="Refresh the occasions state disclosure"
            onClick={() => void state.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={state.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      {state.isPending && <SkeletonBlock variant="text" lines={3} />}
      {refusal && <UnavailableState capability={refusal.capability} description={refusal.description} />}
      {state.isError && !refusal && (
        <ErrorState error={state.error} onRetry={() => void state.refetch()} title="Failed to read the store state" />
      )}

      {data?.corruption && (
        <div className="dates-corruption" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>The store was found unreadable: {data.corruption}</span>
        </div>
      )}

      {data && (
        <>
          <dl className="dates-state__counts">
            <dt>Acknowledgements</dt>
            <dd>{data.acknowledgements}</dd>
            <dt>Gift records</dt>
            <dd>{data.giftRecords}</dd>
            <dt>Open items</dt>
            <dd>{data.openItems}</dd>
            <dt>Interviews</dt>
            <dd>{data.interviews}</dd>
            <dt>Calendar mirrors</dt>
            <dd>{data.mirrors}</dd>
            <dt>Open items reconciled on load</dt>
            <dd>{data.reconciledOpenItems}</dd>
          </dl>
          {data.path && (
            <p className="dates-state__path">
              <Database size={13} aria-hidden="true" /> <code>{data.path}</code>
            </p>
          )}
          <p className="dates-state__note">
            The counts above are the whole of what the store discloses: no answer, no gift, no date and no name. That
            list is the one part of this page safe to put in a support bundle. Nothing below this line is.
          </p>
          {data.lastSweep && (
            <p className="dates-state__last-sweep">
              Last housekeeping pass {formatEpoch(data.lastSweep.sweptAt)}. {housekeepingNote(data.lastSweep)}
            </p>
          )}
        </>
      )}

      <div className="dates-sweep">
        <button
          type="button"
          className="dates-sweep__button"
          disabled={sweep.isPending}
          aria-busy={sweep.isPending}
          onClick={() => sweep.mutate()}
        >
          <PlayCircle size={15} aria-hidden="true" /> {sweep.isPending ? "Running…" : "Run the approach sweep now"}
        </button>
        <p className="dates-form__hint">
          Housekeeping runs first and unconditionally, so a machine with raising switched off still reaps.
        </p>

        {report && (
          <div className="dates-sweep__report" role="status">
            <p className="dates-sweep__outcome">{sweepOutcomeNote(report)}</p>
            {report.housekeeping && <p className="dates-sweep__housekeeping">{housekeepingNote(report.housekeeping)}</p>}
            {report.mirrored > 0 && <p>Mirrored {report.mirrored} occasion(s) to the calendar.</p>}
            {report.resumedInterviews.length > 0 && (
              <p>Resumed {report.resumedInterviews.length} interview(s) left mid-thread.</p>
            )}
            {report.conflictMessages.length > 0 && (
              <>
                <p className="dates-sweep__names-warning">
                  The sentences below are what the daemon raised, word for word, so they name the occasions and the
                  people they are about. Unlike the counts above, this is not something to paste into a support
                  thread.
                </p>
                <ul className="dates-sweep__conflicts">
                  {report.conflictMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </>
            )}
            {report.deliveries.length > 0 && (
              <ul className="dates-sweep__deliveries">
                {report.deliveries.map((delivery) => (
                  <li key={delivery.channel}>
                    <span className={`badge ${delivery.delivered ? "ok" : "bad"}`}>{delivery.channel}</span>
                    <span>
                      {delivery.delivered
                        ? "delivered"
                        : `did not land${delivery.failure ? `: ${delivery.failure}` : ""}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {report.nudge && report.deliveries.length === 0 && !report.hold && (
              <p className="dates-sweep__pull-only">
                Nothing was pushed anywhere. With occasions.nudgeChannel empty in daemon config, a nudge waits to be
                pulled, which is what Open items above does.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
