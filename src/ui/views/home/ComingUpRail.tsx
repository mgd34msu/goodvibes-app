// "Coming up" rail (docs/FEATURES.md §8): the next automation runs
// (schedules' nextRunAt) merged with the next calendar events, sorted by
// time. 60 s cache per the spec row; a failing source degrades to a muted
// note (silent-failure row) while the other keeps rendering.

import { useMemo, useState } from "react";
import { CalendarDays, Clock, Repeat } from "lucide-react";
import { EmptyState, SkeletonBlock } from "../../components/feedback.tsx";
import {
  addDays,
  calendarRefusal,
  capabilityRefusal,
  endOfDayIso,
  formatEpoch,
  parseCalendarEvents,
  parseScheduleJobs,
  useCalendarEvents,
  useScheduleJobs,
} from "../personal-ops/personal-ops-data.ts";

const RAIL_LIMIT = 8;

interface UpcomingItem {
  key: string;
  kind: "run" | "event";
  when: number;
  label: string;
  detail: string;
}

export function ComingUpRail({ onOpenCalendar, onOpenAutomation }: { onOpenCalendar: () => void; onOpenAutomation: () => void }) {
  // Window frozen at mount (now → +7 days) so the query key stays stable.
  // Freshness: the shared hooks poll at 30 s, inside the spec's 60 s TTL,
  // and share their cache entries with the Personal Ops panels.
  const [now] = useState(() => Date.now());
  const fromIso = useMemo(() => new Date(now).toISOString(), [now]);
  const toIso = useMemo(() => endOfDayIso(addDays(new Date(now), 7)), [now]);

  const schedules = useScheduleJobs();
  const events = useCalendarEvents(fromIso, toIso);

  const items = useMemo(() => {
    const merged: UpcomingItem[] = [];
    if (schedules.isSuccess) {
      for (const job of parseScheduleJobs(schedules.data)) {
        if (!job.enabled || job.nextRunAt === undefined || job.nextRunAt < now) continue;
        merged.push({
          key: `run-${job.id}`,
          kind: "run",
          when: job.nextRunAt,
          label: job.name,
          detail: job.kind === "at" ? "reminder" : `${job.kind} schedule`,
        });
      }
    }
    if (events.isSuccess) {
      for (const event of parseCalendarEvents(events.data)) {
        const start = Date.parse(event.start);
        if (!Number.isFinite(start) || start < now) continue;
        merged.push({
          key: `event-${event.id || event.start}`,
          kind: "event",
          when: start,
          label: event.title,
          detail: event.location || "calendar",
        });
      }
    }
    return merged.sort((a, b) => a.when - b.when).slice(0, RAIL_LIMIT);
  }, [schedules.isSuccess, schedules.data, events.isSuccess, events.data, now]);

  // Muted per-source degradation notes — the rail never goes blank silently.
  const notes: string[] = [];
  if (schedules.isError) {
    const refusal = capabilityRefusal(schedules.error, "automation.schedules.list", "");
    notes.push(refusal ? "schedules unavailable on this daemon" : "schedules failed to load");
  }
  if (events.isError) {
    const refusal = calendarRefusal(events.error, "calendar.events.list");
    notes.push(
      refusal?.kind === "unconfigured"
        ? "calendar not configured"
        : refusal
          ? "calendar unavailable on this daemon"
          : "calendar failed to load",
    );
  }

  const loading = schedules.isPending && events.isPending;
  const bothFailed = schedules.isError && events.isError;

  return (
    <section className="home-card home-coming-up" aria-label="Coming up">
      <div className="home-card__header">
        <span className="home-card__title">
          <Clock size={14} aria-hidden="true" /> Coming up
        </span>
        <span className="home-card__hint">next 7 days</span>
      </div>

      {loading && <SkeletonBlock variant="text" lines={3} />}

      {bothFailed && (
        <EmptyState
          title="Nothing to look ahead with"
          description={`Both sources are down: ${notes.join(" · ")}.`}
        />
      )}

      {!loading && !bothFailed && items.length === 0 && (
        <EmptyState
          title="Nothing scheduled"
          description="No upcoming automation runs or calendar events in the next 7 days."
        />
      )}

      {items.length > 0 && (
        <ul className="home-coming-up__list">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className="home-coming-up__row"
                onClick={item.kind === "event" ? onOpenCalendar : onOpenAutomation}
                aria-label={`${item.label} at ${formatEpoch(item.when)} — open ${item.kind === "event" ? "calendar" : "automation"}`}
              >
                {item.kind === "event" ? (
                  <CalendarDays size={13} aria-hidden="true" />
                ) : (
                  <Repeat size={13} aria-hidden="true" />
                )}
                <span className="home-coming-up__when">{formatEpoch(item.when)}</span>
                <span className="home-coming-up__label" title={item.label}>
                  {item.label}
                </span>
                <span className="home-coming-up__detail">{item.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {notes.length > 0 && !bothFailed && (
        <p className="home-card__footnote" role="status">
          Partial view: {notes.join(" · ")}
        </p>
      )}
    </section>
  );
}
