// Calendar (docs/FEATURES.md §9): windowed agenda (day/week) over
// calendar.events.list, event peek (calendar.events.get), create
// (calendar.events.create, admin + ConfirmSurface), ICS export download and
// ICS import (admin + ConfirmSurface). Ports the webui CalendarView's
// three-way refusal taxonomy verbatim: unconfigured 412 / capability-missing
// 404-501 / genuine error — never folded into one generic failure.

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarPlus, Download, RefreshCw, Upload } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import {
  addDays,
  calendarRefusal,
  datetimeLocalToIso,
  downloadTextFile,
  endOfDayIso,
  formatDayHeading,
  formatTime,
  localDayKey,
  parseCalendarEvents,
  poKeys,
  startOfDayIso,
  useCalendarEvents,
  type CalendarEvent,
} from "./personal-ops-data.ts";

type AgendaMode = "day" | "week";

interface EventDraft {
  title: string;
  start: string; // datetime-local value
  end: string;
  location: string;
  description: string;
  attendees: string; // comma separated
}

const EMPTY_EVENT: EventDraft = { title: "", start: "", end: "", location: "", description: "", attendees: "" };

function splitAttendees(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function CalendarPanel({
  createSignal,
  onCreateSignalConsumed,
}: {
  /** >0 = a pending palette "New event" intent; consumed on mount/change. */
  createSignal: number;
  onCreateSignalConsumed: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const peek = usePeek();

  const [mode, setMode] = useState<AgendaMode>("week");
  // Anchor day, local midnight; day mode shows it, week mode shows 7 days out.
  const [anchor, setAnchor] = useState(() => new Date());
  const fromIso = startOfDayIso(anchor);
  const toIso = endOfDayIso(mode === "day" ? anchor : addDays(anchor, 6));

  const events = useCalendarEvents(fromIso, toIso);
  const items = events.isSuccess ? parseCalendarEvents(events.data) : [];
  const refusal = events.isError ? calendarRefusal(events.error, "calendar.events.list") : null;

  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<EventDraft>(EMPTY_EVENT);
  const [confirmingCreate, setConfirmingCreate] = useState(false);

  const [icsContent, setIcsContent] = useState("");
  const [confirmingImport, setConfirmingImport] = useState(false);

  // Palette command "New calendar event" bumps this counter from the view
  // root; the intent survives a tab switch (consumed on mount).
  useEffect(() => {
    if (createSignal > 0) {
      setDraft(EMPTY_EVENT);
      setCreateOpen(true);
      onCreateSignalConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSignal]);

  const invalidateCalendar = () => queryClient.invalidateQueries({ queryKey: poKeys.calendarRoot });

  const create = useMutation({
    // confirm:true is the SDK schema's own explicit-confirmation field for
    // this write (webui parity: only `confirm` goes on the wire — the
    // ConfirmSurface still collects the explicit user gesture in the UI).
    mutationFn: (input: EventDraft) =>
      gv.invoke("calendar.events.create", {
        body: {
          title: input.title.trim(),
          start: datetimeLocalToIso(input.start),
          end: datetimeLocalToIso(input.end),
          confirm: true,
          ...(input.location.trim() ? { location: input.location.trim() } : {}),
          ...(input.description.trim() ? { description: input.description.trim() } : {}),
          ...(splitAttendees(input.attendees).length > 0 ? { attendees: splitAttendees(input.attendees) } : {}),
        },
      }),
    onSuccess: async (result) => {
      setConfirmingCreate(false);
      setCreateOpen(false);
      setDraft(EMPTY_EVENT);
      await invalidateCalendar();
      const eventId = firstString(asRecord(result), ["eventId", "id", "uid"]);
      toast({ title: "Event created", description: eventId ? `Event id ${eventId}` : undefined, tone: "success" });
    },
    onError: (error: unknown) => {
      setConfirmingCreate(false);
      const note = calendarRefusal(error, "calendar.events.create");
      toast({
        title: "Create failed",
        description:
          note?.kind === "unconfigured"
            ? note.description
            : note?.kind === "unavailable"
              ? `The daemon does not serve ${note.capability}.`
              : formatError(error),
        tone: "danger",
      });
    },
  });

  const exportIcs = useMutation({
    mutationFn: () => gv.invoke("calendar.ics.export", { query: { from: fromIso, to: toIso } }),
    onSuccess: (result) => {
      const record = asRecord(result);
      const content = firstString(record, ["icsContent", "ics", "content"]);
      const count = firstNumber(record, ["eventCount", "count"]) ?? 0;
      if (!content) {
        toast({ title: "Export returned no content", tone: "warning" });
        return;
      }
      downloadTextFile(content, `calendar-${fromIso.slice(0, 10)}-to-${toIso.slice(0, 10)}.ics`, "text/calendar;charset=utf-8");
      toast({ title: `Exported ${count} event(s)`, tone: "success" });
    },
    onError: (error: unknown) => {
      const note = calendarRefusal(error, "calendar.ics.export");
      toast({
        title: "Export failed",
        description: note?.kind === "unconfigured" ? note.description : formatError(error),
        tone: "danger",
      });
    },
  });

  const importIcs = useMutation({
    mutationFn: (content: string) =>
      // Same confirm story as create: the schema's own confirm:true gate.
      gv.invoke("calendar.ics.import", { body: { icsContent: content, confirm: true } }),
    onSuccess: async (result) => {
      setConfirmingImport(false);
      setIcsContent("");
      await invalidateCalendar();
      const record = asRecord(result);
      const imported = firstNumber(record, ["imported", "count"]) ?? 0;
      const errors = firstArray(record, ["errors"]).filter((e): e is string => typeof e === "string");
      toast({
        title: `Imported ${imported} event(s)`,
        description: errors.length > 0 ? `${errors.length} row(s) failed: ${errors[0]}` : undefined,
        tone: errors.length > 0 ? "warning" : "success",
      });
    },
    onError: (error: unknown) => {
      setConfirmingImport(false);
      const note = calendarRefusal(error, "calendar.ics.import");
      toast({
        title: "Import failed",
        description: note?.kind === "unconfigured" ? note.description : formatError(error),
        tone: "danger",
      });
    },
  });

  async function handleIcsFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setIcsContent(await file.text());
    } catch (error) {
      toast({ title: "Could not read file", description: formatError(error), tone: "danger" });
    }
  }

  // Agenda: group the window's events by local day, sorted inside each group.
  const agenda = useMemo(() => {
    const byDay = new Map<string, CalendarEvent[]>();
    for (const item of [...items].sort((a, b) => a.start.localeCompare(b.start))) {
      const key = localDayKey(item.start);
      const bucket = byDay.get(key) ?? [];
      bucket.push(item);
      byDay.set(key, bucket);
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const openEventPeek = (calendarEvent: CalendarEvent) => {
    peek.open({
      title: calendarEvent.title,
      content: <CalendarEventPeek eventId={calendarEvent.id} fallback={calendarEvent} />,
    });
  };

  const draftValid =
    draft.title.trim().length > 0 && datetimeLocalToIso(draft.start) !== "" && datetimeLocalToIso(draft.end) !== "";

  const stepDays = mode === "day" ? 1 : 7;
  const windowLabel =
    mode === "day"
      ? formatDayHeading(fromIso)
      : `${formatDayHeading(fromIso)} – ${formatDayHeading(toIso)}`;

  return (
    <section className="po-panel" aria-label="Calendar agenda">
      <div className="po-toolbar">
        <span className="po-toolbar__summary">
          <CalendarDays size={14} aria-hidden="true" /> Agenda · {windowLabel}
        </span>
        <div className="po-toolbar__actions">
          <div className="po-segment" role="radiogroup" aria-label="Agenda window">
            {(["day", "week"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                className={mode === option ? "po-segment__option po-segment__option--active" : "po-segment__option"}
                onClick={() => setMode(option)}
              >
                {option === "day" ? "Day" : "Week"}
              </button>
            ))}
          </div>
          <button type="button" className="po-button" onClick={() => setAnchor(addDays(anchor, -stepDays))} aria-label="Previous window">
            ‹
          </button>
          <button type="button" className="po-button" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button type="button" className="po-button" onClick={() => setAnchor(addDays(anchor, stepDays))} aria-label="Next window">
            ›
          </button>
          <button type="button" className="po-button" onClick={() => { setDraft(EMPTY_EVENT); setCreateOpen(true); }}>
            <CalendarPlus size={14} aria-hidden="true" /> New event
          </button>
          <button
            type="button"
            className="po-icon-button"
            aria-label="Refresh events"
            onClick={() => void events.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={events.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      {events.isPending && <SkeletonBlock variant="text" lines={5} />}

      {refusal?.kind === "unconfigured" && (
        <EmptyState
          icon={<CalendarDays size={28} aria-hidden="true" />}
          title={refusal.title}
          description={refusal.description}
        />
      )}

      {refusal?.kind === "unavailable" && (
        <UnavailableState capability={refusal.capability} description={refusal.description} />
      )}

      {events.isError && !refusal && (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} title="Events failed to load" />
      )}

      {events.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<CalendarDays size={28} aria-hidden="true" />}
          title="No events in this window"
          description="Step the window, switch to week view, or create the first event."
        />
      )}

      {events.isSuccess && agenda.length > 0 && (
        <div className="po-agenda">
          {agenda.map(([dayKey, dayEvents]) => (
            <div key={dayKey} className="po-agenda__day">
              <h3 className="po-agenda__heading">{formatDayHeading(dayEvents[0]?.start ?? dayKey)}</h3>
              <ul className="po-agenda__list">
                {dayEvents.map((item, index) => (
                  <li key={item.id || `${dayKey}-${index}`}>
                    <button type="button" className="po-agenda__row" onClick={() => openEventPeek(item)}>
                      <span className="po-agenda__time">
                        {formatTime(item.start)}
                        {item.end ? ` – ${formatTime(item.end)}` : ""}
                      </span>
                      <span className="po-agenda__title">{item.title}</span>
                      {item.location && <span className="po-agenda__location">{item.location}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* ── ICS import/export row ──────────────────────────────────────── */}
      <div className="po-ics-row">
        <button
          type="button"
          className="po-button"
          onClick={() => exportIcs.mutate()}
          disabled={exportIcs.isPending}
          aria-busy={exportIcs.isPending}
        >
          <Download size={14} aria-hidden="true" />
          {exportIcs.isPending ? "Exporting…" : "Export window as .ics"}
        </button>
        <label className="po-button po-file-button">
          <Upload size={14} aria-hidden="true" /> Load .ics file…
          <input type="file" accept=".ics,text/calendar" onChange={(e) => void handleIcsFile(e)} className="sr-only" />
        </label>
        {icsContent && (
          <span className="po-ics-row__loaded">
            {icsContent.length.toLocaleString()} chars loaded
            <button type="button" className="po-button po-button--primary" onClick={() => setConfirmingImport(true)}>
              Import…
            </button>
            <button type="button" className="po-button" onClick={() => setIcsContent("")}>
              Clear
            </button>
          </span>
        )}
      </div>

      {/* ── Create modal ───────────────────────────────────────────────── */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New calendar event">
        <form
          className="po-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (draftValid) setConfirmingCreate(true);
          }}
        >
          <label className="po-form__label">
            Title
            <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <div className="po-form__split">
            <label className="po-form__label">
              Start
              <input
                type="datetime-local"
                value={draft.start}
                onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              />
            </label>
            <label className="po-form__label">
              End
              <input
                type="datetime-local"
                value={draft.end}
                onChange={(e) => setDraft({ ...draft, end: e.target.value })}
              />
            </label>
          </div>
          <label className="po-form__label">
            Location
            <input type="text" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
          </label>
          <label className="po-form__label">
            Description
            <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label className="po-form__label">
            Attendees (comma separated)
            <input type="text" value={draft.attendees} onChange={(e) => setDraft({ ...draft, attendees: e.target.value })} />
          </label>
          <div className="po-form__actions">
            <button type="button" className="po-button" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="po-button po-button--primary" disabled={!draftValid || create.isPending}>
              {create.isPending ? "Creating…" : "Create…"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmSurface
        open={confirmingCreate}
        action="Create calendar event"
        target={`“${draft.title.trim()}” · ${draft.start || "?"} → ${draft.end || "?"}`}
        blastRadius="Writes one event to the configured CalDAV calendar. Attendees are stored on the event; no invitations are emailed by this app."
        confirmLabel="Create event"
        onCancel={() => setConfirmingCreate(false)}
        onConfirm={() => create.mutate(draft)}
      />

      <ConfirmSurface
        open={confirmingImport}
        action="Import ICS into calendar"
        target={`${icsContent.length.toLocaleString()} characters of iCalendar data`}
        blastRadius="Every VEVENT in the file is written to the configured CalDAV calendar. Existing events are not modified, but imports are not deduplicated."
        confirmLabel="Import events"
        onCancel={() => setConfirmingImport(false)}
        onConfirm={() => importIcs.mutate(icsContent)}
      />
    </section>
  );
}

// ─── Event peek (calendar.events.get, list row as fallback) ──────────────────

function CalendarEventPeek({ eventId, fallback }: { eventId: string; fallback: CalendarEvent }) {
  const detail = useQuery({
    queryKey: poKeys.calendarEvent(eventId || fallback.title),
    queryFn: () => gv.invoke("calendar.events.get", { params: { eventId } }),
    enabled: eventId.length > 0,
    retry: false,
  });

  // The list row already carries the summary — render it while (or instead
  // of) the detail call, and note honestly when the detail read failed.
  const record = detail.isSuccess ? asRecord(detail.data) : {};
  const merged: CalendarEvent = {
    id: eventId,
    title: firstString(record, ["title", "summary"]) || fallback.title,
    start: firstString(record, ["start"]) || fallback.start,
    end: firstString(record, ["end"]) || fallback.end,
    location: firstString(record, ["location"]) || fallback.location,
    description: firstString(record, ["description"]) || fallback.description,
    attendees:
      firstArray(record, ["attendees"]).filter((a): a is string => typeof a === "string").length > 0
        ? firstArray(record, ["attendees"]).filter((a): a is string => typeof a === "string")
        : fallback.attendees,
  };
  const recurrence = firstString(record, ["recurrence"]);

  return (
    <div className="po-event-detail">
      <dl className="po-event-detail__meta">
        <dt>Starts</dt>
        <dd>
          {formatDayHeading(merged.start)} {formatTime(merged.start)}
        </dd>
        <dt>Ends</dt>
        <dd>
          {formatDayHeading(merged.end)} {formatTime(merged.end)}
        </dd>
        {merged.location && (
          <>
            <dt>Location</dt>
            <dd>{merged.location}</dd>
          </>
        )}
        {recurrence && (
          <>
            <dt>Repeats</dt>
            <dd>{recurrence}</dd>
          </>
        )}
        {merged.attendees.length > 0 && (
          <>
            <dt>Attendees</dt>
            <dd>{merged.attendees.join(", ")}</dd>
          </>
        )}
      </dl>
      {merged.description && <p className="po-event-detail__description">{merged.description}</p>}
      {detail.isError && (
        <p className="po-event-detail__note" role="status">
          Full detail read failed ({formatError(detail.error)}) — showing the agenda summary.
        </p>
      )}
      {!eventId && (
        <p className="po-event-detail__note" role="status">
          This event came back without an id — detail lookup is not possible; showing the agenda summary.
        </p>
      )}
    </div>
  );
}
