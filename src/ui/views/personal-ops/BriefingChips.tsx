// Unified daily briefing — the composed dashboard row shared by Personal Ops
// (header chips) and Home (richer card). Five sources, each honestly degraded
// per-source (docs/FEATURES.md §9 "honest per-source degradation"): a failed
// source renders a "—" chip with the cause in plain words, never a fake zero.
// deliveries.list is the row's own 5th source (docs/GAPS.md §9 row 1).

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardCheck, Inbox, ListTodo, Send } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { useApprovalsSnapshot, useTasksSnapshot, type TaskSummary } from "../../lib/approvals.ts";
import { formatError } from "../../lib/errors.ts";
import { asRecord, firstArray } from "../../lib/wire.ts";
import {
  calendarRefusal,
  capabilityRefusal,
  emailRefusal,
  endOfDayIso,
  parseCalendarEvents,
  parseInboxMessages,
  startOfDayIso,
  useCalendarEvents,
  useEmailInbox,
  type CalendarEvent,
  type EmailInboxMessage,
  type SurfaceRefusal,
} from "./personal-ops-data.ts";

export type BriefingJumpTarget = "events" | "approvals" | "tasks" | "inbox" | "deliveries";

/** Poll cadence for deliveries.list — no wire event drives this chip. */
const DELIVERIES_POLL_MS = 30_000;

export interface BriefingSource<T> {
  /** null while degraded — the chip shows "—", never a fabricated 0. */
  count: number | null;
  items: T[];
  loading: boolean;
  refusal: SurfaceRefusal;
  /** Plain-words cause when count === null (refusal title or error text). */
  degradedNote: string;
}

export interface DeliveryRow {
  id: string;
  label: string;
  status: string;
}

function parseDeliveryRows(value: unknown): DeliveryRow[] {
  return firstArray(asRecord(value), ["attempts", "deliveries", "items"]).map((raw) => {
    const record = asRecord(raw);
    const target = asRecord(record["target"]);
    const labelParts = [target["label"], target["address"], target["surfaceKind"], target["kind"], record["jobId"]];
    const label = labelParts.find((v): v is string => typeof v === "string" && v.trim() !== "") ?? "(delivery)";
    const status = typeof record["status"] === "string" ? record["status"] : "unknown";
    return { id: typeof record["id"] === "string" ? record["id"] : "", label, status };
  });
}

export interface BriefingData {
  todayEvents: BriefingSource<CalendarEvent>;
  inbox: BriefingSource<EmailInboxMessage>;
  approvals: BriefingSource<never>;
  tasks: BriefingSource<TaskSummary>;
  deliveries: BriefingSource<DeliveryRow>;
}

/** Five briefing sources, each independently degradable. */
export function useBriefing(): BriefingData {
  const now = new Date();
  const events = useCalendarEvents(startOfDayIso(now), endOfDayIso(now));
  const inbox = useEmailInbox();
  // Approvals + tasks ride the shared queryKeys prefixes — the `permissions`
  // and `tasks` SSE domains invalidate them live; no extra polling here.
  const approvals = useApprovalsSnapshot();
  const tasks = useTasksSnapshot();
  const deliveries = useQuery({
    // Nested under the shared 'deliveries' prefix so the deliveries SSE
    // domain invalidation (if this daemon ever emits one) fans out here too.
    queryKey: [...queryKeys.deliveries, "briefing"],
    queryFn: () => gv.invoke("deliveries.list", { query: { limit: 20 } }),
    refetchInterval: DELIVERIES_POLL_MS,
    retry: false,
  });

  const eventItems = events.isSuccess ? parseCalendarEvents(events.data) : [];
  const eventsRefusal = events.isError ? calendarRefusal(events.error, "calendar.events.list") : null;
  const inboxItems = inbox.isSuccess ? parseInboxMessages(inbox.data) : [];
  const inboxRefusal = inbox.isError ? emailRefusal(inbox.error, "email.inbox.list") : null;
  const pendingApprovals = approvals.isSuccess
    ? approvals.data.approvals.filter((r) => r.status === "pending").length
    : null;
  const runningTaskItems = tasks.isSuccess
    ? tasks.data.tasks.filter((t) => t.status.toLowerCase() === "running")
    : [];
  const runningTasks = tasks.isSuccess ? (tasks.data.running ?? runningTaskItems.length) : null;
  const deliveryItems = deliveries.isSuccess ? parseDeliveryRows(deliveries.data) : [];
  const deliveriesRefusal = deliveries.isError
    ? capabilityRefusal(deliveries.error, "deliveries.list", "recent delivery attempts cannot be listed.")
    : null;

  return {
    todayEvents: {
      count: events.isSuccess ? eventItems.length : null,
      items: eventItems,
      loading: events.isPending,
      refusal: eventsRefusal,
      degradedNote: events.isError ? (eventsRefusal ? eventsRefusal.kind === "unconfigured" ? eventsRefusal.title : `${eventsRefusal.capability} unavailable` : formatError(events.error)) : "",
    },
    inbox: {
      count: inbox.isSuccess ? inboxItems.filter((m) => m.unread).length : null,
      items: inboxItems,
      loading: inbox.isPending,
      refusal: inboxRefusal,
      degradedNote: inbox.isError ? (inboxRefusal ? inboxRefusal.kind === "unconfigured" ? inboxRefusal.title : `${inboxRefusal.capability} unavailable` : formatError(inbox.error)) : "",
    },
    approvals: {
      count: pendingApprovals,
      items: [],
      loading: approvals.isPending,
      refusal: null,
      degradedNote: approvals.isError ? formatError(approvals.error) : "",
    },
    tasks: {
      count: runningTasks,
      items: runningTaskItems,
      loading: tasks.isPending,
      refusal: null,
      degradedNote: tasks.isError ? formatError(tasks.error) : "",
    },
    deliveries: {
      count: deliveries.isSuccess ? deliveryItems.length : null,
      items: deliveryItems,
      loading: deliveries.isPending,
      refusal: deliveriesRefusal,
      degradedNote: deliveries.isError
        ? deliveriesRefusal
          ? deliveriesRefusal.kind === "unconfigured"
            ? deliveriesRefusal.title
            : `${deliveriesRefusal.capability} unavailable`
          : formatError(deliveries.error)
        : "",
    },
  };
}

// ─── Chip row ─────────────────────────────────────────────────────────────────

interface ChipSpec {
  target: BriefingJumpTarget;
  label: string;
  icon: ReactNode;
  source: BriefingSource<unknown>;
}

export function BriefingChips({
  briefing,
  onJump,
}: {
  briefing: BriefingData;
  onJump: (target: BriefingJumpTarget) => void;
}) {
  const chips: ChipSpec[] = [
    {
      target: "events",
      label: "events today",
      icon: <CalendarDays size={14} aria-hidden="true" />,
      source: briefing.todayEvents,
    },
    {
      target: "approvals",
      label: "pending approvals",
      icon: <ClipboardCheck size={14} aria-hidden="true" />,
      source: briefing.approvals,
    },
    {
      target: "tasks",
      label: "running tasks",
      icon: <ListTodo size={14} aria-hidden="true" />,
      source: briefing.tasks,
    },
    {
      target: "inbox",
      label: "unread emails",
      icon: <Inbox size={14} aria-hidden="true" />,
      source: briefing.inbox,
    },
    {
      target: "deliveries",
      label: "recent deliveries",
      icon: <Send size={14} aria-hidden="true" />,
      source: briefing.deliveries,
    },
  ];

  return (
    <div className="briefing-chips" role="group" aria-label="Daily briefing">
      {chips.map((chip) => {
        const degraded = !chip.source.loading && chip.source.count === null;
        const value = chip.source.loading ? "…" : chip.source.count === null ? "—" : String(chip.source.count);
        return (
          <button
            key={chip.target}
            type="button"
            className={degraded ? "briefing-chip briefing-chip--degraded" : "briefing-chip"}
            onClick={() => onJump(chip.target)}
            title={degraded ? chip.source.degradedNote : `Open ${chip.label}`}
            aria-label={
              degraded
                ? `${chip.label}: unavailable — ${chip.source.degradedNote}`
                : `${value} ${chip.label} — open`
            }
          >
            {chip.icon}
            <span className="briefing-chip__count">{value}</span>
            <span className="briefing-chip__label">{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
}
