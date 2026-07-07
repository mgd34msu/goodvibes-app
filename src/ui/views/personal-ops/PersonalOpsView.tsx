// Personal Ops — docs/FEATURES.md §9. Email inbox/compose, calendar agenda +
// ICS, and one-shot reminders under a unified daily briefing header whose
// chips (today's events / pending approvals / running tasks / unread inbox)
// each deep-link to the owning surface. Tab state rides ?filter[tab]= so
// palette jumps and briefing chips compose (docs/UX.md §2).

import { useEffect, useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../lib/queries.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useUrlState } from "../../lib/router.ts";
import { ErrorBoundary, ErrorState } from "../../components/feedback.tsx";
import { BriefingChips, useBriefing, type BriefingJumpTarget } from "./BriefingChips.tsx";
import { EmailPanel } from "./EmailPanel.tsx";
import { CalendarPanel } from "./CalendarPanel.tsx";
import { RemindersPanel } from "./RemindersPanel.tsx";
import { poKeys } from "./personal-ops-data.ts";

type PersonalOpsTab = "inbox" | "calendar" | "reminders";

const TAB_LABELS: Record<PersonalOpsTab, string> = {
  inbox: "Inbox",
  calendar: "Calendar",
  reminders: "Reminders",
};

function tabFromFilter(value: string | undefined): PersonalOpsTab {
  return value === "calendar" || value === "reminders" ? value : "inbox";
}

export function PersonalOpsView(): ReactElement {
  const queryClient = useQueryClient();
  const { filters, setFilters, setView } = useUrlState();
  const tab = tabFromFilter(filters["tab"]);

  // Palette-command → panel-modal intents (each bump opens the modal once).
  const [composeSignal, setComposeSignal] = useState(0);
  const [eventSignal, setEventSignal] = useState(0);
  const [reminderSignal, setReminderSignal] = useState(0);

  const briefing = useBriefing();

  const selectTab = (next: PersonalOpsTab) => setFilters({ tab: next === "inbox" ? undefined : next });

  const jump = (target: BriefingJumpTarget) => {
    if (target === "approvals" || target === "tasks") {
      // Approvals AND tasks both live in the Approvals & Tasks view.
      setView("approvals");
      return;
    }
    selectTab(target === "events" ? "calendar" : "inbox");
  };

  // View-scoped palette commands — live only while this view is mounted.
  // The `run` closures only touch React setters (stable) and window.history
  // (module-level), so registration does not need to churn per URL change.
  useEffect(() => {
    registerCommand({
      id: "personalOps.compose",
      title: "Compose Email",
      group: "assistant",
      keywords: ["email", "mail", "write", "send", "draft"],
      run: () => setComposeSignal((n) => n + 1),
    });
    registerCommand({
      id: "personalOps.newEvent",
      title: "New Calendar Event",
      group: "assistant",
      keywords: ["calendar", "event", "meeting", "schedule"],
      run: () => setEventSignal((n) => n + 1),
    });
    registerCommand({
      id: "personalOps.newReminder",
      title: "New Reminder",
      group: "assistant",
      keywords: ["reminder", "remind", "at", "alarm"],
      run: () => setReminderSignal((n) => n + 1),
    });
    registerCommand({
      id: "personalOps.refresh",
      title: "Refresh Personal Ops",
      group: "assistant",
      keywords: ["personal", "ops", "inbox", "calendar", "reminders", "reload"],
      run: () => {
        void queryClient.invalidateQueries({ queryKey: poKeys.emailRoot });
        void queryClient.invalidateQueries({ queryKey: poKeys.calendarRoot });
        void queryClient.invalidateQueries({ queryKey: queryKeys.automation });
      },
    });
    return () => {
      unregisterCommand("personalOps.compose");
      unregisterCommand("personalOps.newEvent");
      unregisterCommand("personalOps.newReminder");
      unregisterCommand("personalOps.refresh");
    };
  }, [queryClient]);

  // Palette intents also switch to the tab that owns the modal they open.
  useEffect(() => {
    if (composeSignal > 0) setFilters({ tab: undefined }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeSignal]);
  useEffect(() => {
    if (eventSignal > 0) setFilters({ tab: "calendar" }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSignal]);
  useEffect(() => {
    if (reminderSignal > 0) setFilters({ tab: "reminders" }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderSignal]);

  return (
    <ErrorBoundary fallback={(error, reset) => <ErrorState error={error} onRetry={reset} title="Personal Ops failed" />}>
      <div className="personal-ops-view">
        <BriefingChips briefing={briefing} onJump={jump} />

        <div className="po-tabs" role="tablist" aria-label="Personal Ops surfaces">
          {(Object.keys(TAB_LABELS) as PersonalOpsTab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "po-tab po-tab--active" : "po-tab"}
              onClick={() => selectTab(id)}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </div>

        {tab === "inbox" && (
          <EmailPanel composeSignal={composeSignal} onComposeSignalConsumed={() => setComposeSignal(0)} />
        )}
        {tab === "calendar" && (
          <CalendarPanel createSignal={eventSignal} onCreateSignalConsumed={() => setEventSignal(0)} />
        )}
        {tab === "reminders" && (
          <RemindersPanel
            createSignal={reminderSignal}
            onCreateSignalConsumed={() => setReminderSignal(0)}
            onOpenAutomation={() => setView("automation")}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
