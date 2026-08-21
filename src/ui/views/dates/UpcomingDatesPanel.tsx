// Upcoming: every occasion the owner profile declares, with the countdown the
// daemon computed, the answer recorded for this occurrence, and the writes.
//
// This is the ONE panel that renders dates. occasions.list is the owner asking
// his own system what it holds, which is the explicit ask that unlocks it; the
// pending/nudge path in OpenItemsPanel deliberately shows proximity words
// instead, and the two must not be made to look alike.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarHeart, Gift, Plus, RefreshCw, Trash2 } from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { useToast } from "../../lib/toast.ts";
import { formatError } from "../../lib/errors.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ProposalPreview, UnparsedLinesNote } from "./DatesFragments.tsx";
import { GiftHistoryPeek } from "./GiftHistoryPeek.tsx";
import { pollWhileVisible } from "./use-view-visible.ts";
import {
  answerLabel,
  answerTone,
  conflictResolutionNote,
  CONFIRM_UNVERIFIED_NOTE,
  datesApi,
  datesRefusal,
  DATES_POLL_MS,
  daysUntilLabel,
  duplicateWriteRefusal,
  EMPTY_OCCASION_DRAFT,
  findExistingOccasion,
  formatDateOnly,
  kindLabel,
  occasionProposalIsCurrent,
  subjectLabel,
  type OccasionAnswer,
  type OccasionDraft,
  type OccasionKind,
  type OccasionProposal,
  type OccasionRow,
} from "./dates-data.ts";

const KIND_OPTIONS: ReadonlyArray<{ value: OccasionKind; label: string; hint: string }> = [
  { value: "gift-giving", label: "Gift-giving", hint: "one you will want to sort something for" },
  { value: "remember-only", label: "Remember only", hint: "one to just remember" },
  { value: "neither", label: "Neither", hint: "on the file, raised at you for nothing" },
];

interface PendingRemoval {
  occasionId: string;
  title: string;
  /** The daemon's own sentence from the confirmed:false call. */
  sentence: string;
}

/** A preview, kept together with the draft that produced it so staleness is
 *  derived rather than remembered. */
interface StandingProposal {
  proposedFor: OccasionDraft;
  proposal: OccasionProposal;
}

export function UpcomingDatesPanel({ visible }: { visible: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const peek = usePeek();

  const [draft, setDraft] = useState<OccasionDraft>(EMPTY_OCCASION_DRAFT);
  const [standing, setStanding] = useState<StandingProposal | null>(null);
  const [removal, setRemoval] = useState<PendingRemoval | null>(null);

  const list = useQuery({
    queryKey: queryKeys.occasionsList,
    queryFn: datesApi.list,
    retry: false,
    refetchInterval: pollWhileVisible(visible, DATES_POLL_MS),
  });

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: queryKeys.occasions });

  const answer = useMutation({
    mutationFn: ({ row, value }: { row: OccasionRow; value: OccasionAnswer }) =>
      datesApi.answer(row.id, value, row.nextOccurrence ?? ""),
    onSuccess: async (outcome) => {
      await invalidateAll();
      if (!outcome.ok) {
        toast({ title: "Not recorded", description: outcome.reason ?? undefined, tone: "danger" });
        return;
      }
      toast({
        title: "Answer recorded",
        description: outcome.interview
          ? "A gift interview opened for it. It is waiting under Open items."
          : undefined,
        tone: "success",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to record the answer", description: formatError(error), tone: "danger" }),
  });

  const acknowledge = useMutation({
    mutationFn: (row: OccasionRow) => datesApi.acknowledge(row.id, row.nextOccurrence ?? ""),
    onSuccess: async (outcome) => {
      await invalidateAll();
      // The daemon's reply says exactly what acknowledging did and did not do
      // (the item stays open and enumerable; only the push stops). Shown as it
      // was written rather than summarised into "Acknowledged".
      toast({
        title: outcome.ok ? "Marked as in hand" : "Not recorded",
        description: outcome.ok ? outcome.reply : (outcome.reason ?? undefined),
        tone: outcome.ok ? "success" : "danger",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to mark it in hand", description: formatError(error), tone: "danger" }),
  });

  // Step one of the daemon's own two-step removal: ask with confirmed:false and
  // get back the sentence to put to the owner, then show THAT in the confirm
  // sheet rather than a blast-radius line this app invented.
  const askRemoval = useMutation({
    mutationFn: (row: OccasionRow) => datesApi.remove(row.id, false),
    onSuccess: (outcome, row) => {
      setRemoval({
        occasionId: row.id,
        title: row.title,
        sentence: outcome.reason ?? "Removing this drops the date and everything recorded against it.",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Could not prepare the removal", description: formatError(error), tone: "danger" }),
  });

  const confirmRemoval = useMutation({
    mutationFn: (occasionId: string) => datesApi.remove(occasionId, true),
    onSuccess: async (outcome) => {
      setRemoval(null);
      await invalidateAll();
      toast({
        title: outcome.ok ? "Removed" : "Not removed",
        description: outcome.ok
          ? `${outcome.disclosure} ${outcome.droppedRecords} record(s) kept against it went with it.`
          : (outcome.reason ?? undefined),
        tone: outcome.ok ? "success" : "danger",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to remove", description: formatError(error), tone: "danger" }),
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

  const propose = useMutation({
    mutationFn: async () => {
      // Capture the draft the preview is FOR, so a later edit can be detected.
      const proposedFor = draft;
      return { proposedFor, proposal: await datesApi.propose(proposedFor) };
    },
    onSuccess: (result) => setStanding(result),
    onError: (error: unknown) =>
      toast({ title: "Could not work out what to write", description: formatError(error), tone: "danger" }),
  });

  const confirm = useMutation({
    mutationFn: async (kind: OccasionKind) => {
      // Guard EVERY confirm, not just a retry. occasions.confirm appends with
      // no duplicate check of its own, propose reports nothing for an exact
      // repeat, and the resulting twin line is invisible to occasions.list and
      // makes removal refuse (all measured live). This read is the only place
      // a second identical line can still be stopped.
      const current = await queryClient.fetchQuery({
        queryKey: queryKeys.occasionsList,
        queryFn: datesApi.list,
      });
      const existing = findExistingOccasion(current.occasions, draft);
      if (existing) {
        return {
          ok: false,
          reason: duplicateWriteRefusal(existing),
          occasionId: existing.id,
          disclosure: "",
          droppedRecords: 0,
        };
      }
      return datesApi.confirm(draft, kind);
    },
    onSuccess: async (outcome) => {
      await invalidateAll();
      if (!outcome.ok) {
        // Covers both the daemon's own refusal and this panel's duplicate guard.
        setStanding(null);
        toast({ title: "Not written", description: outcome.reason ?? undefined, tone: "danger" });
        return;
      }
      setDraft(EMPTY_OCCASION_DRAFT);
      setStanding(null);
      toast({ title: "Saved", description: outcome.disclosure, tone: "success" });
    },
    onError: async (error: unknown) => {
      // A transport failure does NOT mean the daemon declined: it may have
      // committed and failed to report. Dropping the preview forces a
      // re-propose, and the guard above then finds the committed line instead
      // of writing a second one. The typed draft is deliberately kept, so
      // nothing has to be retyped.
      setStanding(null);
      await invalidateAll();
      toast({
        title: "Failed to save the date",
        description: `${formatError(error)} ${CONFIRM_UNVERIFIED_NOTE}`,
        tone: "danger",
      });
    },
  });

  const refusal = list.isError ? datesRefusal(list.error, "occasions.list") : null;
  const rows = list.data?.occasions ?? [];
  const canPreview = draft.title.trim().length > 0 && draft.date.trim().length > 0;
  // The daemon refuses a confirm without a kind rather than defaulting one, so
  // the button is gated on the same thing instead of letting it 400.
  const confirmKind: OccasionKind | "" = draft.kind;
  // A preview is shown only while it still describes what is typed. Derived on
  // every render rather than cleared by each onChange, so no field (the kind
  // radio included) can be forgotten and leave an approved sentence that
  // disagrees with what confirm would write.
  const proposal =
    standing && occasionProposalIsCurrent(standing.proposedFor, draft) ? standing.proposal : null;
  const proposalWentStale = standing !== null && proposal === null;

  return (
    <section className="dates-section" aria-labelledby="dates-upcoming-heading">
      <div className="dates-section__header">
        <h2 id="dates-upcoming-heading">Upcoming</h2>
        <div className="dates-section__meta">
          {list.data?.today && <span className="dates-section__today">Today is {list.data.today}</span>}
          {list.data?.timezone && <span className="dates-section__today">({list.data.timezone})</span>}
          <button
            type="button"
            className="dates-icon-button"
            title="Refresh"
            aria-label="Refresh important dates"
            onClick={() => void list.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      {list.isPending && <SkeletonBlock variant="text" lines={5} />}
      {refusal && <UnavailableState capability={refusal.capability} description={refusal.description} />}
      {list.isError && !refusal && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load important dates" />
      )}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<CalendarHeart size={20} aria-hidden="true" />}
          title="No dates on your profile yet"
          description="Add one below. It is written as a single line under Important dates in your owner profile, carrying where it came from."
        />
      )}

      {rows.length > 0 && (
        <ul className="dates-list">
          {rows.map((row) => (
            <li key={`${row.id}-${row.lineIndex}`} className="dates-row">
              <div className="dates-row__main">
                <div className="dates-row__titles">
                  <span className="dates-row__title">{row.title}</span>
                  {row.person && <span className="dates-row__person">for {row.person}</span>}
                </div>
                <div className="dates-row__badges">
                  <span className="badge neutral">{kindLabel(row.kind)}</span>
                  <span className="badge neutral">{subjectLabel(row.subject)}</span>
                  {row.recurrence === "annual" && <span className="badge neutral">Annual</span>}
                  {row.inLeadWindow && <span className="badge warning">In lead window</span>}
                  {row.mirrored && <span className="badge ok">Mirrored to calendar</span>}
                  {row.answer && <span className={`badge ${answerTone(row.answer)}`}>{answerLabel(row.answer)}</span>}
                </div>
              </div>

              <div className="dates-row__when">
                <span className="dates-row__countdown">{daysUntilLabel(row.daysUntil)}</span>
                <span className="dates-row__date">{formatDateOnly(row.nextOccurrence)}</span>
                <span className="dates-row__lead">lead {row.leadDays} days</span>
              </div>

              <div className="dates-row__actions">
                {(["yes", "no", "later"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="dates-answer-button"
                    disabled={answer.isPending}
                    onClick={() => answer.mutate({ row, value })}
                  >
                    {answerLabel(value)}
                  </button>
                ))}
                <button
                  type="button"
                  className="dates-answer-button"
                  disabled={acknowledge.isPending}
                  title="Stop raising it without answering yes or no"
                  onClick={() => acknowledge.mutate(row)}
                >
                  In hand
                </button>
                {row.kind === "gift-giving" && (
                  <button
                    type="button"
                    className="dates-row__link"
                    onClick={() =>
                      peek.open({
                        title: `Gift history: ${row.title}`,
                        content: <GiftHistoryPeek occasionId={row.id} title={row.title} />,
                      })
                    }
                  >
                    <Gift size={14} aria-hidden="true" /> Gift history
                  </button>
                )}
                <button
                  type="button"
                  className="dates-row__link dates-row__link--danger"
                  disabled={askRemoval.isPending}
                  onClick={() => askRemoval.mutate(row)}
                >
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </button>
              </div>

              {row.text && <p className="dates-row__line">{row.text}</p>}
            </li>
          ))}
        </ul>
      )}

      {list.data && <UnparsedLinesNote lines={list.data.unparsed} heading="Important dates" />}

      {list.data && list.data.conflicts.length > 0 && (
        <div className="dates-conflicts">
          <h3>Two dates recorded for one thing</h3>
          <p className="dates-conflicts__lead">
            Nothing was picked for you. Taking the newer value silently is the behaviour this exists to prevent, so
            both lines stay until you edit your profile.
          </p>
          <ul className="dates-conflicts__list">
            {list.data.conflicts.map((conflict) => (
              <li key={conflict.occasionId} className="dates-conflict">
                <div>
                  <span className="dates-conflict__title">{conflict.title}</span>
                  <span className="dates-conflict__dates">{conflict.dates.join(" vs. ")}</span>
                </div>
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

      <form
        className="dates-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canPreview) propose.mutate();
        }}
      >
        <h3>
          <Plus size={15} aria-hidden="true" /> Add a date
        </h3>
        <p className="dates-form__lead">
          Nothing is written until you confirm. Preview first: the daemon says back the one line it would add.
        </p>

        <div className="dates-form__grid">
          <label>
            <span>Title</span>
            <input
              type="text"
              value={draft.title}
              placeholder="Robin birthday"
              onChange={(event) => {
                setDraft({ ...draft, title: event.target.value });
              }}
            />
          </label>
          <label>
            <span>Date</span>
            <input
              type="text"
              value={draft.date}
              placeholder="08-27"
              onChange={(event) => {
                setDraft({ ...draft, date: event.target.value });
              }}
            />
            <span className="dates-form__hint">MM-DD for something annual, YYYY-MM-DD for a one-off.</span>
          </label>
          <label>
            <span>Person</span>
            <input
              type="text"
              value={draft.person}
              placeholder="Robin"
              onChange={(event) => {
                setDraft({ ...draft, person: event.target.value });
              }}
            />
          </label>
          <label>
            <span>Recurrence</span>
            <select
              value={draft.recurrence}
              onChange={(event) => {
                setDraft({ ...draft, recurrence: event.target.value === "once" ? "once" : "annual" });
              }}
            >
              <option value="annual">Annual</option>
              <option value="once">Once</option>
            </select>
          </label>
          <label>
            <span>Lead days</span>
            <input
              type="number"
              min={0}
              value={draft.leadDays}
              placeholder="leave blank for the default"
              onChange={(event) => {
                setDraft({ ...draft, leadDays: event.target.value });
              }}
            />
          </label>
        </div>

        <fieldset className="dates-form__kinds">
          <legend>What kind is it?</legend>
          <p className="dates-form__hint">
            Yours to say, never inferred: no rule that reads a title tells a birthday from a death anniversary.
          </p>
          {KIND_OPTIONS.map((option) => (
            <label key={option.value} className="dates-form__kind">
              <input
                type="radio"
                name="occasion-kind"
                value={option.value}
                checked={draft.kind === option.value}
                onChange={() => setDraft({ ...draft, kind: option.value })}
              />
              <span>{option.label}</span>
              <span className="dates-form__hint">{option.hint}</span>
            </label>
          ))}
        </fieldset>

        <div className="dates-form__actions">
          <button type="submit" disabled={!canPreview || propose.isPending}>
            {propose.isPending ? "Working it out…" : "Preview"}
          </button>
        </div>

        {proposalWentStale && (
          <p className="dates-proposal__needs-kind" role="status">
            You changed something since that preview, so it no longer describes what would be written. Preview again
            to see the line as it now stands.
          </p>
        )}

        {proposal && (
          <ProposalPreview proposal={proposal}>
            {proposal.needsKind && !confirmKind && (
              <p className="dates-proposal__needs-kind">Pick a kind above before this can be saved.</p>
            )}
            <button
              type="button"
              className="dates-form__confirm"
              disabled={!confirmKind || confirm.isPending}
              onClick={() => {
                if (confirmKind) confirm.mutate(confirmKind);
              }}
            >
              {confirm.isPending ? "Saving…" : "Confirm and save"}
            </button>
          </ProposalPreview>
        )}
      </form>

      <ConfirmSurface
        open={removal !== null}
        action="Remove an important date"
        target={removal?.title ?? ""}
        blastRadius={removal?.sentence ?? ""}
        danger
        confirmLabel="Remove it"
        onCancel={() => setRemoval(null)}
        onConfirm={() => {
          if (removal) confirmRemoval.mutate(removal.occasionId);
        }}
      />
    </section>
  );
}
