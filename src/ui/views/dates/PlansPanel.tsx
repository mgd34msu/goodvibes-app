// Plans: dated ranges the owner profile declares, plus whichever one has him
// away today.
//
// Plans are ambient and never prompt. They exist so nothing is suggested into
// that window and so a nudge that would land while he is abroad moves to the
// day before he leaves, which is why this panel has no answer buttons and no
// open items: there is nothing here to reply to.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plane, Plus, RefreshCw } from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { useToast } from "../../lib/toast.ts";
import { formatError } from "../../lib/errors.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ProposalPreview, UnparsedLinesNote } from "./DatesFragments.tsx";
import { pollWhileVisible } from "./use-view-visible.ts";
import {
  CONFIRM_UNVERIFIED_NOTE,
  datesApi,
  datesRefusal,
  DATES_POLL_MS,
  EMPTY_PLAN_DRAFT,
  formatDateOnly,
  planProposalIsCurrent,
  type OccasionProposal,
  type PlanDraft,
} from "./dates-data.ts";

interface StandingPlanProposal {
  proposedFor: PlanDraft;
  proposal: OccasionProposal;
}

export function PlansPanel({ visible }: { visible: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [draft, setDraft] = useState<PlanDraft>(EMPTY_PLAN_DRAFT);
  const [standing, setStanding] = useState<StandingPlanProposal | null>(null);

  const plans = useQuery({
    queryKey: queryKeys.occasionsPlans,
    queryFn: datesApi.plans,
    retry: false,
    refetchInterval: pollWhileVisible(visible, DATES_POLL_MS),
  });

  const propose = useMutation({
    mutationFn: async () => {
      const proposedFor = draft;
      return { proposedFor, proposal: await datesApi.planPropose(proposedFor) };
    },
    onSuccess: (result) => setStanding(result),
    onError: (error: unknown) =>
      toast({ title: "Could not work out what to write", description: formatError(error), tone: "danger" }),
  });

  const confirm = useMutation({
    mutationFn: () => datesApi.planConfirm(draft),
    onSuccess: async (outcome) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.occasions });
      if (!outcome.ok) {
        setStanding(null);
        toast({ title: "Not written", description: outcome.reason ?? undefined, tone: "danger" });
        return;
      }
      setDraft(EMPTY_PLAN_DRAFT);
      setStanding(null);
      toast({ title: "Saved", description: outcome.disclosure, tone: "success" });
    },
    onError: async (error: unknown) => {
      // Same unverified-write rule the occasion confirm uses: a transport
      // failure may still have committed, so the preview goes and a retry has
      // to re-propose against a refreshed list.
      setStanding(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.occasions });
      toast({
        title: "Failed to save the plan",
        description: `${formatError(error)} ${CONFIRM_UNVERIFIED_NOTE}`,
        tone: "danger",
      });
    },
  });

  const refusal = plans.isError ? datesRefusal(plans.error, "occasions.plans.list") : null;
  const rows = plans.data?.plans ?? [];
  const awayNow = plans.data?.awayNow ?? null;
  const canPreview =
    draft.title.trim().length > 0 && draft.from.trim().length > 0 && draft.to.trim().length > 0;
  const proposal = standing && planProposalIsCurrent(standing.proposedFor, draft) ? standing.proposal : null;
  const proposalWentStale = standing !== null && proposal === null;

  return (
    <section className="dates-section" aria-labelledby="dates-plans-heading">
      <div className="dates-section__header">
        <h2 id="dates-plans-heading">Plans</h2>
        <div className="dates-section__meta">
          <button
            type="button"
            className="dates-icon-button"
            title="Refresh"
            aria-label="Refresh plans"
            onClick={() => void plans.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={plans.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      {awayNow && (
        <div className="dates-away-now" role="status">
          <Plane size={16} aria-hidden="true" />
          <span>
            You are away today: {awayNow.title}
            {awayNow.destination ? `, in ${awayNow.destination}` : ""}, until {formatDateOnly(awayNow.to)}.
          </span>
        </div>
      )}

      {plans.isPending && <SkeletonBlock variant="text" lines={4} />}
      {refusal && <UnavailableState capability={refusal.capability} description={refusal.description} />}
      {plans.isError && !refusal && (
        <ErrorState error={plans.error} onRetry={() => void plans.refetch()} title="Failed to load plans" />
      )}

      {plans.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<MapPin size={20} aria-hidden="true" />}
          title="No plans on your profile"
          description="A plan is a dated range with attributes. It never prompts you: it is there so nothing gets suggested into that window."
        />
      )}

      {rows.length > 0 && (
        <ul className="dates-list">
          {rows.map((plan) => (
            <li key={`${plan.id}-${plan.lineIndex}`} className="dates-row dates-row--plan">
              <div className="dates-row__main">
                <div className="dates-row__titles">
                  <span className="dates-row__title">{plan.title}</span>
                  {plan.destination && <span className="dates-row__person">in {plan.destination}</span>}
                </div>
                <div className="dates-row__badges">
                  {plan.away && <span className="badge warning">Away</span>}
                  {plan.extras.map((extra) => (
                    <span key={extra} className="badge neutral">
                      {extra}
                    </span>
                  ))}
                </div>
              </div>
              <div className="dates-row__when">
                <span className="dates-row__date">
                  {formatDateOnly(plan.from)} to {formatDateOnly(plan.to)}
                </span>
              </div>
              {plan.text && <p className="dates-row__line">{plan.text}</p>}
            </li>
          ))}
        </ul>
      )}

      {plans.data && <UnparsedLinesNote lines={plans.data.unparsed} heading="Plans" />}

      <form
        className="dates-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canPreview) propose.mutate();
        }}
      >
        <h3>
          <Plus size={15} aria-hidden="true" /> Add a plan
        </h3>
        <p className="dates-form__lead">Nothing is written until you confirm.</p>

        <div className="dates-form__grid">
          <label>
            <span>Title</span>
            <input
              type="text"
              value={draft.title}
              placeholder="Lisbon trip"
              onChange={(event) => {
                setDraft({ ...draft, title: event.target.value });
              }}
            />
          </label>
          <label>
            <span>From</span>
            <input
              type="text"
              value={draft.from}
              placeholder="2026-09-10"
              onChange={(event) => {
                setDraft({ ...draft, from: event.target.value });
              }}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="text"
              value={draft.to}
              placeholder="2026-09-18"
              onChange={(event) => {
                setDraft({ ...draft, to: event.target.value });
              }}
            />
          </label>
          <label>
            <span>Destination</span>
            <input
              type="text"
              value={draft.destination}
              placeholder="Lisbon"
              onChange={(event) => {
                setDraft({ ...draft, destination: event.target.value });
              }}
            />
          </label>
        </div>

        <label className="dates-form__checkbox">
          <input
            type="checkbox"
            checked={draft.away}
            onChange={(event) => {
              setDraft({ ...draft, away: event.target.checked });
            }}
          />
          <span>I will be away from home during this</span>
          <span className="dates-form__hint">
            Opt-in, never assumed: a kitchen being redone from the 3rd to the 10th is a real dated range that is not
            you leaving the house.
          </span>
        </label>

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
            <button
              type="button"
              className="dates-form__confirm"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? "Saving…" : "Confirm and save"}
            </button>
          </ProposalPreview>
        )}
      </form>
    </section>
  );
}
