// One gift interview, rendered as the conversation it is: the questions the
// daemon asked, the one it is waiting on, and finally the question the whole
// thread exists for, which is what you landed on.
//
// The interview NEVER recommends a gift. It guides the owner to his own idea,
// which is also why the thing recorded at the end is what he settled on rather
// than anything this app or the daemon suggested. Nothing here proposes an
// answer, pre-fills a field, or offers a "suggestions" affordance.
//
// Answers already given are not echoed back: they are not on the wire. The card
// says a step is answered and stops there rather than inventing the text.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, MessageCircleQuestion, Sparkle } from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { useToast } from "../../lib/toast.ts";
import { formatError } from "../../lib/errors.ts";
import {
  datesApi,
  interviewAnsweredCount,
  interviewStage,
  type InterviewProgress,
} from "./dates-data.ts";

export interface InterviewCardProps {
  interview: InterviewProgress;
  /** Title for the occasion when the caller knows it; the id otherwise. */
  occasionTitle?: string;
}

export function InterviewCard({ interview, occasionTitle }: InterviewCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");

  const stage = interviewStage(interview);
  const answered = interviewAnsweredCount(interview);

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.occasions });
  };

  const answerStep = useMutation({
    mutationFn: (text: string) => {
      const stepId = interview.nextStep?.id ?? "";
      return datesApi.interviewAnswer(interview.interviewId, stepId, text);
    },
    onSuccess: async (envelope) => {
      setDraft("");
      await invalidateAll();
      if (!envelope.present) {
        toast({
          title: "That interview is no longer open",
          description: "The daemon is not holding it any more, so nothing was recorded.",
          tone: "info",
        });
        return;
      }
      // Always say something. The daemon accepts a re-answer to a step, and an
      // unknown stepId, with present:true either way and no refusal to render,
      // so silence on submit is indistinguishable from the reply going nowhere.
      // The copy states the one thing that is true in every accepted case: it
      // is recorded, and it stands in place of anything answered before for
      // that question, here or on another surface.
      toast({
        title: "Reply recorded",
        description: "It replaces any earlier answer to that question, including one given on another surface.",
        tone: "success",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to record the answer", description: formatError(error), tone: "danger" }),
  });

  const recordOutcome = useMutation({
    mutationFn: (landedOn: string) => datesApi.interviewRecord(interview.interviewId, landedOn),
    onSuccess: async (envelope) => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.occasionsGifts(interview.occasionId) });
      await invalidateAll();
      toast({
        title: envelope.present ? "Written to gift history" : "That interview is no longer open",
        description: envelope.present
          ? "Kept beyond this year's answers on purpose, so next year does not steer you where this year already went."
          : "Nothing was recorded.",
        tone: envelope.present ? "success" : "info",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to write the gift record", description: formatError(error), tone: "danger" }),
  });

  const busy = answerStep.isPending || recordOutcome.isPending;
  const heading = occasionTitle || interview.occasionId;

  return (
    <li className="dates-interview">
      <div className="dates-interview__head">
        <span className="dates-interview__title">
          <Sparkle size={14} aria-hidden="true" /> Gift ideas for {heading}
        </span>
        <span className="dates-interview__meta">
          {interview.occurrence} · {answered} of {interview.steps.length} answered
        </span>
      </div>

      <ol className="dates-interview__thread">
        {interview.steps.map((step, index) => {
          const isCurrent = interview.nextStep?.id === step.id;
          const isAnswered = index < answered;
          return (
            <li
              key={step.id}
              className={
                isCurrent
                  ? "dates-interview__step dates-interview__step--current"
                  : isAnswered
                    ? "dates-interview__step dates-interview__step--answered"
                    : "dates-interview__step"
              }
            >
              <span className="dates-interview__marker" aria-hidden="true">
                {isAnswered ? <Check size={14} /> : <MessageCircleQuestion size={14} />}
              </span>
              <span className="dates-interview__prompt">{step.prompt}</span>
              {isAnswered && <span className="dates-interview__answered">Answered</span>}
            </li>
          );
        })}
      </ol>

      {stage === "asking" && interview.nextStep && (
        <form
          className="dates-interview__reply"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) answerStep.mutate(draft.trim());
          }}
        >
          <label>
            <span>{interview.nextStep.prompt}</span>
            <textarea
              value={draft}
              rows={2}
              placeholder="In your own words"
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || draft.trim().length === 0}>
            {answerStep.isPending ? "Recording…" : "Answer"}
          </button>
        </form>
      )}

      {stage === "awaiting-outcome" && (
        <form
          className="dates-interview__reply dates-interview__reply--outcome"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) recordOutcome.mutate(draft.trim());
          }}
        >
          <label>
            <span>What did you land on?</span>
            <textarea
              value={draft}
              rows={2}
              placeholder="The thing you settled on"
              onChange={(event) => setDraft(event.target.value)}
            />
            <span className="dates-interview__hint">
              Every question is answered. This closes the thread and writes one line to the gift history. Your
              choice, recorded as yours.
            </span>
          </label>
          <button type="submit" disabled={busy || draft.trim().length === 0}>
            {recordOutcome.isPending ? "Writing…" : "Record it"}
          </button>
        </form>
      )}

      {stage === "recorded" && (
        <p className="dates-interview__landed">
          You landed on: <strong>{interview.landedOn ?? "—"}</strong>
        </p>
      )}
    </li>
  );
}
