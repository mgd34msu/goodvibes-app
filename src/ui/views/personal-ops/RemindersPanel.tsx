// Reminders (docs/FEATURES.md §9 + §5 row "Reminders (one-shot `at`
// schedules)"): automation.schedules.list filtered CLIENT-SIDE to
// kind === "at" (the wire has no kind filter), plus create through
// ConfirmSurface. Recurring cron/every schedules belong to the Automation
// view — a count + jump link keeps that boundary honest.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, BellPlus, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  capabilityRefusal,
  datetimeLocalToIso,
  formatEpoch,
  parseScheduleJobs,
  useScheduleJobs,
} from "./personal-ops-data.ts";

interface ReminderDraft {
  text: string;
  when: string; // datetime-local value
}

const EMPTY_REMINDER: ReminderDraft = { text: "", when: "" };

export function RemindersPanel({
  active = true,
  createSignal,
  onCreateSignalConsumed,
  onOpenAutomation,
}: {
  /** False while this tab is hidden behind another Personal Ops tab (the
   * panel stays mounted so an in-progress reminder draft survives the switch
   * — item 1 — but its poll pauses while hidden — item 18). */
  active?: boolean;
  /** >0 = a pending palette "New reminder" intent; consumed on mount/change. */
  createSignal: number;
  onCreateSignalConsumed: () => void;
  onOpenAutomation: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const schedules = useScheduleJobs(true, active);
  const jobs = schedules.isSuccess ? parseScheduleJobs(schedules.data) : [];
  const reminders = jobs
    .filter((job) => job.kind === "at")
    .sort((a, b) => (a.at ?? a.nextRunAt ?? 0) - (b.at ?? b.nextRunAt ?? 0));
  const recurringCount = jobs.length - reminders.length;
  const refusal = schedules.isError
    ? capabilityRefusal(
        schedules.error,
        "automation.schedules.list",
        "one-shot reminders cannot be listed or created.",
      )
    : null;

  const [draft, setDraft] = useState<ReminderDraft>(EMPTY_REMINDER);
  const [confirming, setConfirming] = useState(false);

  // Palette command "New reminder" bumps this counter from the view root;
  // the panel stays mounted across a tab switch (see PersonalOpsView) so this
  // waits for `active` before focusing — the input cannot take real focus
  // while its tab is display:none.
  const formRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (createSignal > 0 && active) {
      formRef.current?.focus();
      onCreateSignalConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSignal, active]);

  // Auto-dismiss the confirm overlay when this tab is hidden behind another
  // Personal Ops tab — an invisible Modal would otherwise keep trapping
  // Tab/Escape globally. The draft text is untouched, so switching back
  // leaves it exactly as typed (item 1).
  useEffect(() => {
    if (!active) setConfirming(false);
  }, [active]);

  const create = useMutation({
    // automation.schedules.create is not confirm-gated on the wire; the
    // ConfirmSurface is the app-side gate the FEATURES row requires.
    mutationFn: (input: ReminderDraft) =>
      gv.invoke("automation.schedules.create", {
        body: {
          name: input.text.trim().slice(0, 60),
          prompt: input.text.trim(),
          kind: "at",
          at: datetimeLocalToIso(input.when),
        },
      }),
    onSuccess: async () => {
      setConfirming(false);
      setDraft(EMPTY_REMINDER);
      // Prefix invalidation: refreshes this panel AND the Automation view's
      // queries under the shared "automation" key prefix.
      await queryClient.invalidateQueries({ queryKey: queryKeys.automation });
      toast({ title: "Reminder scheduled", tone: "success" });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Reminder failed", description: formatError(error), tone: "danger" });
    },
  });

  const whenIso = datetimeLocalToIso(draft.when);
  const whenInFuture = whenIso !== "" && Date.parse(whenIso) > Date.now();
  const draftValid = draft.text.trim().length > 0 && whenInFuture;

  return (
    <section className="po-panel" aria-label="Reminders">
      <div className="po-toolbar">
        <span className="po-toolbar__summary">
          <AlarmClock size={14} aria-hidden="true" /> Reminders
          {schedules.isSuccess ? ` · ${reminders.length} one-shot` : ""}
        </span>
        <button
          type="button"
          className="po-icon-button"
          aria-label="Refresh reminders"
          onClick={() => void schedules.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={schedules.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {/* ── Create form ─────────────────────────────────────────────────── */}
      <form
        className="po-reminder-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (draftValid) setConfirming(true);
        }}
      >
        <input
          ref={formRef}
          type="text"
          className="po-reminder-form__text"
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          placeholder="Remind me to…"
          aria-label="Reminder text"
        />
        <input
          type="datetime-local"
          className="po-reminder-form__when"
          value={draft.when}
          onChange={(e) => setDraft({ ...draft, when: e.target.value })}
          aria-label="Reminder time"
        />
        <button type="submit" className="po-button po-button--primary" disabled={!draftValid || create.isPending}>
          <BellPlus size={14} aria-hidden="true" />
          {create.isPending ? "Scheduling…" : "Remind me…"}
        </button>
      </form>
      {draft.when !== "" && !whenInFuture && (
        <p className="po-form__note" role="status">
          Pick a time in the future — one-shot schedules in the past never fire.
        </p>
      )}

      {schedules.isPending && <SkeletonBlock variant="text" lines={4} />}

      {refusal?.kind === "unavailable" && (
        <UnavailableState capability={refusal.capability} description={refusal.description} />
      )}

      {schedules.isError && !refusal && (
        <ErrorState
          error={schedules.error}
          onRetry={() => void schedules.refetch()}
          title="Reminders failed to load"
        />
      )}

      {schedules.isSuccess && reminders.length === 0 && (
        <EmptyState
          icon={<AlarmClock size={28} aria-hidden="true" />}
          title="No reminders"
          description="One-shot reminders you schedule here run as daemon `at` schedules and fire exactly once."
        />
      )}

      {schedules.isSuccess && reminders.length > 0 && (
        <ul className="po-reminder-list">
          {reminders.map((reminder) => (
            <li key={reminder.id} className="po-reminder-row">
              <span className="po-reminder-row__when">{formatEpoch(reminder.at ?? reminder.nextRunAt)}</span>
              <span className="po-reminder-row__name" title={reminder.prompt}>
                {reminder.name}
              </span>
              <StatusBadge value={reminder.enabled ? reminder.status : "paused"} />
            </li>
          ))}
        </ul>
      )}

      {schedules.isSuccess && recurringCount > 0 && (
        <p className="po-panel__footnote">
          {recurringCount} recurring schedule{recurringCount === 1 ? "" : "s"} (cron/every) live in{" "}
          <button type="button" className="po-link" onClick={onOpenAutomation}>
            Automation
          </button>
          .
        </p>
      )}

      <ConfirmSurface
        open={confirming}
        action="Create reminder"
        target={`“${draft.text.trim()}” at ${draft.when ? new Date(draft.when).toLocaleString() : "?"}`}
        blastRadius="Registers a one-shot daemon schedule (kind: at) that runs this prompt once at the chosen time and then completes."
        confirmLabel="Schedule reminder"
        onCancel={() => setConfirming(false)}
        onConfirm={() => create.mutate(draft)}
      />
    </section>
  );
}
