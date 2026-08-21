// Shared data layer for the Personal Ops surface (docs/FEATURES.md §9) and the
// Home assistant cockpit (§8/§22 rows), both view dirs are owned by the same
// wave agent, so Home imports from here rather than duplicating parsers.
//
// HONESTY CONTRACT (ported from goodvibes-webui CalendarView's three-way
// refusal taxonomy, applied to every optional personal surface):
//  1. UNCONFIGURED, the daemon's *_NOT_CONFIGURED / *_CREDENTIALS_MISSING
//     refusal (412 on newer daemons, 400 + code on the pinned 1.0.0 build).
//     Rendered as a neutral pointer to the exact config keys, never a fault.
//  2. NOT AVAILABLE, 404 "unknown gateway method" / 501 "not invokable":
//     the CAPABILITY itself is missing from this daemon build.
//  3. GENUINE ERROR, everything else: ErrorState with cause + retry.
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

// ─── Query keys (LOCAL to this surface, lib/queries.ts is not edited) ──────
// email.* / calendar.* have NO wire events (pinned upstream, see
// lib/realtime.ts header) → their queries poll. automation.* keys are nested
// under the shared `queryKeys.automation` prefix so a future automation-domain
// invalidation fans out here too.

export const poKeys = {
  emailRoot: ["personal-ops", "email"] as const,
  emailInbox: ["personal-ops", "email", "inbox"] as const,
  emailMessage: (uid: number) => ["personal-ops", "email", "inbox", "message", uid] as const,
  emailInboundStatus: ["personal-ops", "email", "inbound-status"] as const,
  emailExpectations: ["personal-ops", "email", "expectations"] as const,
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

/**
 * Refusal triage for the four inbound-mail verbs (email.inbound.status and
 * email.expectation.list/open/cancel).
 *
 * Their descriptors ship in every 2.x contract, but the daemon only attaches
 * handlers when it is actually watching a mailbox: composeInboundMail returns
 * null when `surfaces.email.inbound.accounts` is empty, and the four verbs then
 * answer 501 NOT_INVOKABLE (verified against a locally spawned daemon, which
 * flipped to 200 on all four the moment that key held a JSON array with one
 * address). So 501 here means "no watched mailbox", not "this daemon build
 * cannot do inbound mail", and the copy names the key that turns it on rather
 * than sending the reader off to look for a newer daemon.
 *
 * The mailbox connection keys (surfaces.email.host/user) are a SEPARATE gate
 * covered by emailRefusal, so this is deliberately not folded into it.
 */
export function inboundMailRefusal(error: unknown, capability: string): SurfaceRefusal {
  if (!error) return null;
  if (isMethodNotInvokableError(error)) {
    return {
      kind: "unconfigured",
      title: "The inbound-mail watcher is not watching anything",
      description:
        "Set surfaces.email.inbound.accounts in daemon config to a JSON array holding the address to watch (for example [\"you@example.com\"]) and restart the daemon. Until then it registers no verification expectations and discloses no status.",
    };
  }
  if (isMethodUnavailableError(error)) {
    return {
      kind: "unavailable",
      capability,
      description: "the connected daemon build does not carry the inbound-mail verbs at all.",
    };
  }
  return null;
}

/** Calendar refusal triage, config keys from the webui CalendarView contract. */
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

// ─── Inbound-mail wire shapes (SDK control-plane/method-catalog-email.ts) ────

/**
 * One open verification expectation, as email.expectation.list and the
 * expectations array inside email.inbound.status both report it.
 *
 * `authority` is carried rather than assumed: the daemon puts the literal
 * 'evidence-only' on every record, and a matching message proves control of an
 * address and grants nothing else. The inbound-status copy of the record omits
 * `kind` and `authority`, hence both being optional here.
 */
export interface EmailExpectation {
  id: string;
  serviceDomain: string;
  recipientAddress: string;
  purpose: string;
  openedAt: string;
  expiresAt: string;
  remainingMs: number | undefined;
  kind: string;
  authority: string;
}

function parseExpectation(raw: unknown): EmailExpectation {
  const record = asRecord(raw);
  return {
    id: firstString(record, ["id"]),
    serviceDomain: firstString(record, ["serviceDomain"]),
    recipientAddress: firstString(record, ["recipientAddress"]),
    purpose: firstString(record, ["purpose"]),
    openedAt: firstString(record, ["openedAt"]),
    expiresAt: firstString(record, ["expiresAt"]),
    remainingMs: firstNumber(record, ["remainingMs"]),
    kind: firstString(record, ["kind"]),
    authority: firstString(record, ["authority"]),
  };
}

export function parseExpectations(value: unknown): EmailExpectation[] {
  return firstArray(asRecord(value), ["expectations"]).map(parseExpectation);
}

/** `total` off email.expectation.list; falls back to the array length. */
export function parseExpectationTotal(value: unknown): number {
  return firstNumber(asRecord(value), ["total"]) ?? parseExpectations(value).length;
}

export interface EmailInboundStatus {
  enabled: boolean;
  running: boolean;
  /** Daemon vocabulary, rendered verbatim ("inactive", "idle", "polling", …). */
  mode: string;
  reason: string;
  account: string;
  mailbox: string;
  /** The source's cost stated as the daemon's own sentence, never a computed
   * "real-time" claim: latency is prose on the wire for exactly that reason. */
  sourceLatency: string;
  sourceBasis: string;
  sourceDetail: string;
  /** Absent before the watcher has probed anything; absence is not a state. */
  capabilityState: string;
  capabilityReason: string;
  capabilityFix: string;
  cursorCount: number;
  expectations: EmailExpectation[];
  expectationsOpen: number;
  expectationsMaxOpen: number | undefined;
  /** Whether arriving mail is actually being announced to the owner. */
  noticeState: string;
  noticeReason: string;
  noticeFix: string;
  /** Per-store readability rows, reported verbatim. */
  stores: Array<{ store: string; state: string; detail: string }>;
}

export function parseInboundStatus(value: unknown): EmailInboundStatus {
  const record = asRecord(value);
  const source = asRecord(record["source"]);
  const capability = asRecord(record["capability"]);
  const notice = asRecord(record["noticeDelivery"]);
  const retention = asRecord(record["retention"]);
  const expectationRetention = asRecord(retention["expectations"]);
  return {
    enabled: record["enabled"] === true,
    running: record["running"] === true,
    mode: firstString(record, ["mode"]) || "unknown",
    reason: firstString(record, ["reason"]),
    account: firstString(record, ["account"]),
    mailbox: firstString(record, ["mailbox"]),
    sourceLatency: firstString(source, ["latency"]),
    sourceBasis: firstString(source, ["basis"]),
    sourceDetail: firstString(source, ["detail"]),
    capabilityState: firstString(capability, ["state"]),
    capabilityReason: firstString(capability, ["reason"]),
    capabilityFix: firstString(capability, ["fix"]),
    cursorCount: firstArray(record, ["cursors"]).length,
    expectations: parseExpectations(record),
    expectationsOpen: firstNumber(expectationRetention, ["open"]) ?? firstArray(record, ["expectations"]).length,
    expectationsMaxOpen: firstNumber(expectationRetention, ["maxOpen"]),
    noticeState: firstString(notice, ["state"]),
    noticeReason: firstString(notice, ["reason"]),
    noticeFix: firstString(notice, ["fix"]),
    stores: firstArray(record, ["stores"]).map((raw) => {
      const store = asRecord(raw);
      return {
        store: firstString(store, ["store"]),
        state: firstString(store, ["state"]),
        detail: firstString(store, ["detail"]),
      };
    }),
  };
}

/** Chip text for the watcher: what it is doing, and why when it is not. */
export function inboundStatusLabel(status: EmailInboundStatus): string {
  if (status.running) return `Inbound: ${status.mode}`;
  return status.enabled ? `Inbound: ${status.mode} (not running)` : `Inbound: ${status.mode}`;
}

/**
 * ok / warning / bad for the chip, from the same fields the label reads.
 * The daemon's capability states are exactly healthy / degraded / insufficient
 * (STATE_BY_REASON in the sdk's inbound capability module); degraded means
 * polling without IDLE, running but slower, so it warns rather than fails.
 */
export function inboundStatusTone(status: EmailInboundStatus): "ok" | "warning" | "bad" {
  if (status.capabilityState === "insufficient") return "bad";
  if (status.capabilityState === "degraded") return "warning";
  // An unrecognized future state warns rather than failing red or passing green.
  if (status.capabilityState && status.capabilityState !== "healthy") return "warning";
  if (status.noticeState && status.noticeState !== "ok") return "warning";
  if (status.running) return "ok";
  return "warning";
}

/** "12m 30s" style remaining window; "expired" at or below zero, "" when absent. */
export function formatRemaining(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms <= 0) return "expired";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
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
  /** "at" | "cron" | "every", daemon vocabulary rendered verbatim. */
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

/**
 * @param active Gates the 30 s poll (item 18, no polling while the tab that
 * owns this panel is hidden behind another Personal Ops tab). Defaults to
 * true so call sites outside the tab shell (Home, briefing chips) keep
 * polling exactly as before.
 */
export function useEmailInbox(enabled = true, active = true): UseQueryResult<unknown> {
  return useQuery({
    queryKey: poKeys.emailInbox,
    // No wire event exists for email.*, a targeted 30 s poll keeps the inbox
    // fresh without hammering the IMAP endpoint.
    queryFn: () => gv.invoke("email.inbox.list", { query: { limit: 50 } }),
    refetchInterval: active ? PERSONAL_OPS_POLL_MS : false,
    // 412/404 refusals should render their honest state immediately.
    retry: false,
    enabled,
  });
}

/**
 * The inbound-mail watcher's disclosure verb. WS-only on the contract, so this
 * goes over the /app/ws bridge rather than a REST path.
 * @param active see {@link useEmailInbox}.
 */
export function useEmailInboundStatus(enabled = true, active = true): UseQueryResult<unknown> {
  return useQuery({
    queryKey: poKeys.emailInboundStatus,
    queryFn: () => gv.invoke("email.inbound.status", { body: {} }),
    refetchInterval: active ? PERSONAL_OPS_POLL_MS : false,
    retry: false,
    enabled,
  });
}

/**
 * Open verification expectations. Their windows are measured in minutes, so
 * this polls faster than the 30 s personal-ops cadence: a remaining-window
 * readout that is half a minute stale is a readout of a window that may have
 * already closed.
 * @param active see {@link useEmailInbox}.
 */
export const EXPECTATION_POLL_MS = 10_000;

export function useEmailExpectations(enabled = true, active = true): UseQueryResult<unknown> {
  return useQuery({
    queryKey: poKeys.emailExpectations,
    queryFn: () => gv.invoke("email.expectation.list", { body: {} }),
    refetchInterval: active ? EXPECTATION_POLL_MS : false,
    retry: false,
    enabled,
  });
}

/** @param active see {@link useEmailInbox}. */
export function useCalendarEvents(
  fromIso: string,
  toIso: string,
  enabled = true,
  active = true,
): UseQueryResult<unknown> {
  return useQuery({
    queryKey: poKeys.calendarEvents(fromIso, toIso),
    // calendar.* has NO wire events (pinned upstream), targeted 30 s poll.
    queryFn: () => gv.invoke("calendar.events.list", { query: { from: fromIso, to: toIso, limit: 100 } }),
    refetchInterval: active ? PERSONAL_OPS_POLL_MS : false,
    retry: false,
    enabled,
  });
}

/** @param active see {@link useEmailInbox}. */
export function useScheduleJobs(enabled = true, active = true): UseQueryResult<unknown> {
  return useQuery({
    queryKey: poKeys.schedules,
    // automation.* is not in DOMAIN_INVALIDATIONS (no wire event), 30 s poll.
    queryFn: () => gv.invoke("automation.schedules.list"),
    refetchInterval: active ? PERSONAL_OPS_POLL_MS : false,
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
