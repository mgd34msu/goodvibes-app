// Shared data layer for the Personal Ops surface (docs/FEATURES.md §9) and the
// Home assistant cockpit (§8/§22 rows) — both view dirs are owned by the same
// wave agent, so Home imports from here rather than duplicating parsers.
//
// HONESTY CONTRACT (ported from goodvibes-webui CalendarView's three-way
// refusal taxonomy, applied to every optional personal surface):
//  1. UNCONFIGURED — the daemon's *_NOT_CONFIGURED / *_CREDENTIALS_MISSING
//     refusal (412 on newer daemons, 400 + code on the pinned 1.0.0 build).
//     Rendered as a neutral pointer to the exact config keys, never a fault.
//  2. NOT AVAILABLE — 404 "unknown gateway method" / 501 "not invokable":
//     the CAPABILITY itself is missing from this daemon build.
//  3. GENUINE ERROR — everything else: ErrorState with cause + retry.
// Never fold any of these into a fourth "it's just empty" reading.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import {
  isMethodNotInvokableError,
  isMethodUnavailableError,
  isUnconfiguredError,
} from "../../lib/errors.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";

// ─── Query keys (LOCAL to this surface — lib/queries.ts is not edited) ──────
// email.* / calendar.* have NO wire events (pinned upstream, see
// lib/realtime.ts header) → their queries poll. automation.* keys are nested
// under the shared `queryKeys.automation` prefix so a future automation-domain
// invalidation fans out here too.

export const poKeys = {
  emailRoot: ["personal-ops", "email"] as const,
  emailInbox: ["personal-ops", "email", "inbox"] as const,
  emailMessage: (uid: number) => ["personal-ops", "email", "inbox", "message", uid] as const,
  calendarRoot: ["personal-ops", "calendar"] as const,
  calendarEvents: (from: string, to: string) => ["personal-ops", "calendar", "events", from, to] as const,
  calendarEvent: (eventId: string) => ["personal-ops", "calendar", "event", eventId] as const,
  schedules: [...queryKeys.automation, "schedules"] as const,
} as const;

/** Poll cadence for surfaces with no wire event (10-30 s band, docs rule). */
export const PERSONAL_OPS_POLL_MS = 30_000;

// ─── Three-way refusal taxonomy ──────────────────────────────────────────────

export interface UnconfiguredRefusal {
  kind: "unconfigured";
  title: string;
  description: string;
}

export interface UnavailableRefusal {
  kind: "unavailable";
  capability: string;
  description: string;
}

export type SurfaceRefusal = UnconfiguredRefusal | UnavailableRefusal | null;

/** Email refusal triage. Config keys match goodvibes-tui daemon
 * handlers/email/config.ts (surfaces.email.* with imap/smtp fallbacks). */
export function emailRefusal(error: unknown, capability: string): SurfaceRefusal {
  if (!error) return null;
  if (isUnconfiguredError(error)) {
    return {
      kind: "unconfigured",
      title: "Email isn't configured",
      description:
        "Bring your own mailbox: set surfaces.email.host (or surfaces.email.imap.host + surfaces.email.smtp.host) and surfaces.email.user in daemon config, and store the surfaces.email.password secret in the daemon credential store. Then retry.",
    };
  }
  if (isMethodUnavailableError(error) || isMethodNotInvokableError(error)) {
    return {
      kind: "unavailable",
      capability,
      description: "the connected daemon build has no email handler wired up.",
    };
  }
  return null;
}

/** Calendar refusal triage — config keys from the webui CalendarView contract. */
export function calendarRefusal(error: unknown, capability: string): SurfaceRefusal {
  if (!error) return null;
  if (isUnconfiguredError(error)) {
    return {
      kind: "unconfigured",
      title: "Calendar isn't configured",
      description:
        "Bring your own CalDAV endpoint: set surfaces.calendar.caldavUrl, surfaces.calendar.caldavUser, and surfaces.calendar.caldavPassword in daemon config, then retry.",
    };
  }
  if (isMethodUnavailableError(error) || isMethodNotInvokableError(error)) {
    return {
      kind: "unavailable",
      capability,
      description: "the connected daemon build has no calendar handler wired up.",
    };
  }
  return null;
}

/** Generic capability triage for surfaces with no config story (automation, deliveries). */
export function capabilityRefusal(error: unknown, capability: string, loss: string): SurfaceRefusal {
  if (!error) return null;
  if (isMethodUnavailableError(error) || isMethodNotInvokableError(error)) {
    return { kind: "unavailable", capability, description: loss };
  }
  return null;
}

// ─── Email wire shapes (goodvibes-tui handlers/email/validation.ts) ─────────

export interface EmailInboxMessage {
  uid: number;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
  bodyPreview: string;
  messageId: string;
}

export function parseInboxMessages(value: unknown): EmailInboxMessage[] {
  return firstArray(asRecord(value), ["messages", "items"]).map((raw) => {
    const record = asRecord(raw);
    return {
      uid: firstNumber(record, ["uid"]) ?? 0,
      from: firstString(record, ["from", "sender"]),
      subject: firstString(record, ["subject"]) || "(no subject)",
      date: firstString(record, ["date", "receivedAt"]),
      unread: record["unread"] === true,
      bodyPreview: firstString(record, ["bodyPreview", "preview", "snippet"]),
      messageId: firstString(record, ["messageId"]),
    };
  });
}

export interface EmailMessageDetail {
  uid: number;
  from: string;
  subject: string;
  date: string;
  messageId: string;
  bodyText: string;
  attachments: Array<{ filename: string; contentType: string; sizeBytes: number }>;
}

export function parseMessageDetail(value: unknown): EmailMessageDetail {
  const record = asRecord(value);
  return {
    uid: firstNumber(record, ["uid"]) ?? 0,
    from: firstString(record, ["from", "sender"]),
    subject: firstString(record, ["subject"]) || "(no subject)",
    date: firstString(record, ["date", "receivedAt"]),
    messageId: firstString(record, ["messageId"]),
    bodyText: firstString(record, ["bodyText", "body", "text"]),
    attachments: firstArray(record, ["attachments"]).map((raw) => {
      const a = asRecord(raw);
      return {
        filename: firstString(a, ["filename", "name"]) || "attachment",
        contentType: firstString(a, ["contentType", "type"]),
        sizeBytes: firstNumber(a, ["sizeBytes", "size"]) ?? 0,
      };
    }),
  };
}

// ─── Calendar wire shapes (webui goodvibes.ts calendar contract) ─────────────

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
  description: string;
  attendees: string[];
}

export function parseCalendarEvents(value: unknown): CalendarEvent[] {
  return firstArray(asRecord(value), ["events", "items"]).map((raw) => {
    const record = asRecord(raw);
    return {
      id: firstString(record, ["id", "eventId", "uid"]),
      title: firstString(record, ["title", "summary"]) || "(untitled event)",
      start: firstString(record, ["start"]),
      end: firstString(record, ["end"]),
      location: firstString(record, ["location"]),
      description: firstString(record, ["description"]),
      attendees: firstArray(record, ["attendees"]).filter((a): a is string => typeof a === "string"),
    };
  });
}

// ─── Automation schedule wire shape (SDK foundation-client-types) ────────────

export interface ScheduleJob {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  /** "at" | "cron" | "every" — daemon vocabulary rendered verbatim. */
  kind: string;
  /** kind:"at" fire time, epoch ms. */
  at: number | undefined;
  nextRunAt: number | undefined;
  lastRunAt: number | undefined;
  prompt: string;
}

export function parseScheduleJobs(value: unknown): ScheduleJob[] {
  return firstArray(asRecord(value), ["jobs", "schedules", "items"]).map((raw) => {
    const record = asRecord(raw);
    const schedule = asRecord(record["schedule"]);
    const execution = asRecord(record["execution"]);
    return {
      id: firstString(record, ["id"]),
      name: firstString(record, ["name", "label"]) || "(unnamed)",
      enabled: record["enabled"] !== false,
      status: firstString(record, ["status"]) || "unknown",
      kind: firstString(schedule, ["kind"]) || "unknown",
      at: firstNumber(schedule, ["at"]),
      nextRunAt: firstNumber(record, ["nextRunAt"]),
      lastRunAt: firstNumber(record, ["lastRunAt"]),
      prompt: firstString(execution, ["prompt", "template"]),
    };
  });
}

// ─── Shared queries ───────────────────────────────────────────────────────────

export function useEmailInbox(enabled = true): UseQueryResult<unknown> {
  return useQuery({
    queryKey: poKeys.emailInbox,
    // No wire event exists for email.* — a targeted 30 s poll keeps the inbox
    // fresh without hammering the IMAP endpoint.
    queryFn: () => gv.invoke("email.inbox.list", { query: { limit: 50 } }),
    refetchInterval: PERSONAL_OPS_POLL_MS,
    // 412/404 refusals should render their honest state immediately.
    retry: false,
    enabled,
  });
}

export function useCalendarEvents(fromIso: string, toIso: string, enabled = true): UseQueryResult<unknown> {
  return useQuery({
    queryKey: poKeys.calendarEvents(fromIso, toIso),
    // calendar.* has NO wire events (pinned upstream) — targeted 30 s poll.
    queryFn: () => gv.invoke("calendar.events.list", { query: { from: fromIso, to: toIso, limit: 100 } }),
    refetchInterval: PERSONAL_OPS_POLL_MS,
    retry: false,
    enabled,
  });
}

export function useScheduleJobs(enabled = true): UseQueryResult<unknown> {
  return useQuery({
    queryKey: poKeys.schedules,
    // automation.* is not in DOMAIN_INVALIDATIONS (no wire event) — 30 s poll.
    queryFn: () => gv.invoke("automation.schedules.list"),
    refetchInterval: PERSONAL_OPS_POLL_MS,
    retry: false,
    enabled,
  });
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

export function startOfDayIso(date: Date): string {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString();
}

export function endOfDayIso(date: Date): string {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy.toISOString();
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** "14:05" style local time from an ISO string; empty when unparseable. */
export function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Mon, Jul 7" style local day heading from an ISO string. */
export function formatDayHeading(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Local date+time from an epoch-ms number; "unknown" when absent. */
export function formatEpoch(ms: number | undefined): string {
  if (ms === undefined) return "unknown";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Local calendar-day bucket key ("2026-07-07") for agenda grouping. */
export function localDayKey(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** datetime-local input value → ISO string; empty in = empty out. */
export function datetimeLocalToIso(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

/** Trigger a browser download of text content (used for .ics export). */
export function downloadTextFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
