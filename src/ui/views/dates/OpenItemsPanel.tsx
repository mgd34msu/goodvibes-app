// Open items: everything unresolved, pulled rather than pushed.
//
// occasions.pending is how a surface that is not a push destination receives a
// nudge. It carries the occasion and the person and NEVER the date: proximity
// is a word ("approaching", "soon", "imminent"), not a count of days. That is
// the whole difference between this panel and Upcoming, and it is why nothing
// here formats a date or a countdown even though the ids would let it.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Inbox, RefreshCw } from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { useToast } from "../../lib/toast.ts";
import { formatError } from "../../lib/errors.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { InterviewCard } from "./InterviewCard.tsx";
import { pollWhileVisible } from "./use-view-visible.ts";
import {
  answerLabel,
  conflictResolutionNote,
  datesApi,
  datesRefusal,
  DATES_POLL_MS,
  kindLabel,
  pendingIsEmpty,
  proximityTone,
  type OccasionAnswer,
} from "./dates-data.ts";

export function OpenItemsPanel({ visible }: { visible: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const pending = useQuery({
    queryKey: queryKeys.occasionsPending,
    queryFn: datesApi.pending,
    retry: false,
    refetchInterval: pollWhileVisible(visible, DATES_POLL_MS),
  });

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: queryKeys.occasions });

  const answer = useMutation({
    mutationFn: ({ occasionId, value }: { occasionId: string; value: OccasionAnswer }) =>
      // No occurrence is sent from here on purpose: the nudge does not carry
      // one, and the daemon resolves the current occurrence itself. Supplying a
      // guess would answer for a year nobody asked about.
      datesApi.answer(occasionId, value, ""),
    onSuccess: async (outcome) => {
      await invalidateAll();
      if (!outcome.ok) {
        toast({ title: "Not recorded", description: outcome.reason ?? undefined, tone: "danger" });
        return;
      }
      toast({
        title: "Answer recorded",
        description: outcome.interview ? "A gift interview opened for it, just below." : undefined,
        tone: "success",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to record the answer", description: formatError(error), tone: "danger" }),
  });

  const acknowledge = useMutation({
    mutationFn: (occasionId: string) => datesApi.acknowledge(occasionId, ""),
    onSuccess: async (outcome) => {
      await invalidateAll();
      toast({
        title: outcome.ok ? "Marked as in hand" : "Not recorded",
        description: outcome.ok ? outcome.reply : (outcome.reason ?? undefined),
        tone: outcome.ok ? "success" : "danger",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to mark it in hand", description: formatError(error), tone: "danger" }),
  });

  const resolveConflict = useMutation({
    mutationFn: (occasionId: string) => datesApi.resolveConflict(occasionId),
    onSuccess: async (resolution) => {
      await invalidateAll();
      toast({
        title: resolution.resolved ? "Conflict closed" : "Nothing was being raised",
        description: conflictResolutionNote(resolution),
        tone: "info",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to close the conflict", description: formatError(error), tone: "danger" }),
  });

  const refusal = pending.isError ? datesRefusal(pending.error, "occasions.pending") : null;
  const data = pending.data;

  // An interview record carries occasionId and no title. The nudge subjects and
  // the acknowledged list in this SAME response both carry both, so the title
  // comes from there when it is there. Deliberately not looked up in
  // occasions.list: that response carries dates, and nothing in this panel is
  // allowed to have one within reach.
  const occasionTitles = new Map<string, string>();
  for (const subject of [...(data?.nudge?.subjects ?? []), ...(data?.acknowledged ?? [])]) {
    if (subject.title) occasionTitles.set(subject.occasionId, subject.title);
  }

  return (
    <section className="dates-section" aria-labelledby="dates-open-heading">
      <div className="dates-section__header">
        <h2 id="dates-open-heading">Open items</h2>
        <div className="dates-section__meta">
          <button
            type="button"
            className="dates-icon-button"
            title="Refresh"
            aria-label="Refresh open items"
            onClick={() => void pending.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={pending.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      {pending.isPending && <SkeletonBlock variant="text" lines={4} />}
      {refusal && <UnavailableState capability={refusal.capability} description={refusal.description} />}
      {pending.isError && !refusal && (
        <ErrorState error={pending.error} onRetry={() => void pending.refetch()} title="Failed to load open items" />
      )}

      {data && pendingIsEmpty(data) && (
        <EmptyState
          icon={<Inbox size={20} aria-hidden="true" />}
          title="Nothing outstanding"
          description="No nudge waiting, no conflict open, no interview left mid-thread. Nothing unresolved is ever dropped, so this being empty means there is nothing."
        />
      )}

      {data?.nudge && (
        <div className="dates-nudge">
          <p className="dates-nudge__message">
            <BellRing size={15} aria-hidden="true" /> {data.nudge.message}
          </p>
          <ul className="dates-nudge__subjects">
            {data.nudge.subjects.map((subject) => (
              <li key={subject.occasionId} className="dates-nudge__subject">
                <div className="dates-nudge__subject-main">
                  <span className="dates-row__title">{subject.title}</span>
                  {subject.person && <span className="dates-row__person">for {subject.person}</span>}
                  <span className="badge neutral">{kindLabel(subject.kind)}</span>
                  <span className={`badge ${proximityTone(subject.proximity)}`}>{subject.proximity}</span>
                  {subject.acknowledged && <span className="badge ok">In hand</span>}
                </div>
                {data.nudge?.answerable && (
                  <div className="dates-row__actions">
                    {(["yes", "no", "later"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="dates-answer-button"
                        disabled={answer.isPending}
                        onClick={() => answer.mutate({ occasionId: subject.occasionId, value })}
                      >
                        {answerLabel(value)}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="dates-answer-button"
                      disabled={acknowledge.isPending}
                      title="Stop raising it without answering yes or no"
                      onClick={() => acknowledge.mutate(subject.occasionId)}
                    >
                      In hand
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!data.nudge.answerable && (
            <p className="dates-nudge__foot">
              This one is not answerable: it is telling you something rather than asking.
            </p>
          )}
        </div>
      )}

      {data && data.acknowledged.length > 0 && (
        <div className="dates-acknowledged">
          <h3>In hand</h3>
          <p className="dates-acknowledged__lead">
            Still open and still listed: only the pushing stopped. These expire with their occurrence, so next year
            asks fresh.
          </p>
          <ul className="dates-acknowledged__list">
            {data.acknowledged.map((subject) => (
              <li key={subject.occasionId}>
                <span className="dates-row__title">{subject.title}</span>
                {subject.person && <span className="dates-row__person">for {subject.person}</span>}
                <span className={`badge ${proximityTone(subject.proximity)}`}>{subject.proximity}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.conflicts.length > 0 && (
        <div className="dates-conflicts">
          <h3>Conflicts being raised</h3>
          <ul className="dates-conflicts__list">
            {data.conflicts.map((conflict) => (
              <li key={conflict.occasionId} className="dates-conflict">
                <span className="dates-conflict__message">{conflict.message}</span>
                <button
                  type="button"
                  className="dates-row__link"
                  disabled={resolveConflict.isPending}
                  onClick={() => resolveConflict.mutate(conflict.occasionId)}
                >
                  Stop raising this
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.interviews.length > 0 && (
        <div className="dates-interviews">
          <h3>Gift ideas in progress</h3>
          <p className="dates-interviews__lead">
            A thread you walked away from resumes where you left it, never from the beginning.
          </p>
          <ul className="dates-interviews__list">
            {data.interviews.map((interview) => (
              <InterviewCard
                key={interview.interviewId}
                interview={interview}
                occasionTitle={occasionTitles.get(interview.occasionId)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
