// Data layer for the Dates surface (the occasions domain's 17 verbs).
// Crib: goodvibes-webui src/views/dates/DatesView.tsx, which is where the
// section split and the propose-then-confirm two-step come from.
//
// PERSONAL DATA CONTRACT. Everything on this wire is people: names,
// relationships, dates, and what the owner decided to give someone. Three
// rules follow and are enforced here rather than left to each component:
//
//  1. Parse at the boundary. Every wire payload becomes a typed record built
//     from named keys only. No component reads a raw response.
//  2. Nothing is logged. No console call takes an occasion, a person, a gift,
//     or an interview answer, and none of these are put in a diagnostics
//     bundle. `occasions.state` is the one shape that is SAFE in one, because
//     it holds counts and no values; it is the only thing here a support
//     bundle may carry.
//  3. Nothing is computed that the daemon already answered. `daysUntil`,
//     `nextOccurrence`, `inLeadWindow` and `proximity` all arrive decided.
//     Recomputing them locally would let this app and the daemon disagree
//     about what day it is, and the daemon owns the timezone (`daemon.timezone`).
//
// Refusals are rendered as answers in the daemon's own words: a `reason`, a
// `hold`, or a `resolved:false` is printed as the sentence it is, never
// flattened into "something went wrong".

import { gv } from "../../lib/gv.ts";
import { isMethodNotInvokableError, isMethodUnavailableError } from "../../lib/errors.ts";
import { asArray, asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { APP_PROFILE_AUTHORITY, APP_PROFILE_SURFACE } from "../settings/owner-profile.ts";

// ---------------------------------------------------------------------------
// Poll cadence
// ---------------------------------------------------------------------------

/**
 * occasions.* publishes NO wire event, so freshness here is a poll plus
 * mutation-driven invalidation, the same treatment checkin and fleet get.
 *
 * 60s rather than the 30s the busier surfaces use: the daemon's own approach
 * sweep runs on `occasions.sweepIntervalMinutes` (default 60), so nothing this
 * view reads can change faster than that unless the owner changed it here, and
 * a mutation invalidates immediately in that case.
 */
export const DATES_POLL_MS = 60_000;

// ---------------------------------------------------------------------------
// Refusal triage
// ---------------------------------------------------------------------------

export interface DatesRefusal {
  capability: string;
  description: string;
}

/**
 * The only capability gate measured on a live daemon: whether the build
 * carries the occasions verbs at all.
 *
 * Verified against a scratch daemon (@pellux/goodvibes-daemon 1.28.19, sdk
 * 2.0.17) in an isolated home: all 17 verbs answered 200 with no config set,
 * including the four reads on a profile holding no dates. So unlike inbound
 * mail, there is no 501 "cataloged but not wired" state to name a config key
 * for. `occasions.enabled` does NOT gate any verb: it gates whether the sweep
 * RAISES anything, and the sweep reports that itself as hold:"disabled"
 * (see sweepHoldNote), which is a different sentence in a different place.
 */
export function datesRefusal(error: unknown, capability: string): DatesRefusal | null {
  if (!error) return null;
  if (isMethodUnavailableError(error) || isMethodNotInvokableError(error)) {
    return {
      capability,
      description:
        "the connected daemon build does not carry the occasions verbs, so dates, plans and gift history cannot be read or written from here.",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wire shapes (sdk platform/control-plane/method-catalog-occasions.ts)
// ---------------------------------------------------------------------------

export type OccasionKind = "gift-giving" | "remember-only" | "neither";
export type OccasionAnswer = "yes" | "no" | "later" | "acknowledged";
export type OccasionRecurrence = "annual" | "once";
export type OccasionProximity = "approaching" | "soon" | "imminent";

const OCCASION_KINDS: readonly OccasionKind[] = ["gift-giving", "remember-only", "neither"];
const OCCASION_ANSWERS: readonly OccasionAnswer[] = ["yes", "no", "later", "acknowledged"];

/** The kind's own label. Never inferred from a title: no rule that reads a
 *  label tells a birthday from a death anniversary, which is why the daemon
 *  refuses a confirm without one. */
export function kindLabel(kind: string): string {
  if (kind === "gift-giving") return "Gift-giving";
  if (kind === "remember-only") return "Remember only";
  if (kind === "neither") return "Neither";
  return kind || "unstated";
}

export function answerLabel(answer: string): string {
  if (answer === "yes") return "Yes";
  if (answer === "no") return "No";
  if (answer === "later") return "Later";
  if (answer === "acknowledged") return "In hand";
  return answer;
}

/** Badge tone for an answer. `later` is NOT a decline (it comes back roughly
 *  halfway to the date), so it reads as neutral rather than bad. */
export function answerTone(answer: string): string {
  if (answer === "yes") return "ok";
  if (answer === "no") return "neutral";
  if (answer === "acknowledged") return "ok";
  return "neutral";
}

/** Proximity is a word the daemon chose, never a count of days. A nudge
 *  deliberately carries no date, and this mapping keeps it that way. */
export function proximityTone(proximity: string): string {
  if (proximity === "imminent") return "bad";
  if (proximity === "soon") return "warning";
  return "neutral";
}

function readKind(record: Record<string, unknown>, key: string): OccasionKind | "" {
  const value = record[key];
  return typeof value === "string" && (OCCASION_KINDS as readonly string[]).includes(value)
    ? (value as OccasionKind)
    : "";
}

function readAnswer(value: unknown): OccasionAnswer | null {
  return typeof value === "string" && (OCCASION_ANSWERS as readonly string[]).includes(value)
    ? (value as OccasionAnswer)
    : null;
}

function readBool(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

/** A number that is meaningfully nullable on the wire: absent and null both
 *  mean "not declared", which is NOT the same as zero (leadDays 0 means the
 *  day itself). */
function nullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export interface OccasionRow {
  id: string;
  title: string;
  /** The declared date as the daemon parsed it: `recurring` carries no year. */
  dateKind: string;
  dateYear: number | null;
  dateMonth: number | null;
  dateDay: number | null;
  recurrence: string;
  kind: string;
  person: string;
  selfDeclared: boolean;
  subject: string;
  /** What the LINE declares; null when it declares nothing and the policy
   *  default applies. Distinct from `leadDays` below, which is the effective
   *  one the daemon actually uses. */
  declaredLeadDays: number | null;
  extras: string[];
  lineIndex: number;
  text: string;
  nextOccurrence: string | null;
  daysUntil: number | null;
  leadDays: number;
  inLeadWindow: boolean;
  answer: OccasionAnswer | null;
  mirrored: boolean;
}

function parseOccasionRow(raw: unknown): OccasionRow {
  const view = asRecord(raw);
  const occasion = asRecord(view["occasion"]);
  const date = asRecord(occasion["date"]);
  return {
    id: firstString(occasion, ["id"]),
    title: firstString(occasion, ["title"]),
    dateKind: firstString(date, ["kind"]),
    dateYear: nullableNumber(date, "year"),
    dateMonth: nullableNumber(date, "month"),
    dateDay: nullableNumber(date, "day"),
    recurrence: firstString(occasion, ["recurrence"]),
    kind: readKind(occasion, "kind"),
    person: firstString(occasion, ["person"]),
    selfDeclared: readBool(occasion, "selfDeclared"),
    subject: firstString(occasion, ["subject"]),
    declaredLeadDays: nullableNumber(occasion, "leadDays"),
    extras: asArray(occasion["extras"]).filter((item): item is string => typeof item === "string"),
    lineIndex: firstNumber(occasion, ["lineIndex"]) ?? -1,
    text: firstString(occasion, ["text"]),
    nextOccurrence: nullableString(view, "nextOccurrence"),
    daysUntil: nullableNumber(view, "daysUntil"),
    leadDays: firstNumber(view, ["leadDays"]) ?? 0,
    inLeadWindow: readBool(view, "inLeadWindow"),
    answer: readAnswer(view["answer"]),
    mirrored: readBool(view, "mirrored"),
  };
}

/** A line under the heading the reader could not type. Reported, never
 *  rewritten: the owner's own words stay on his own file. */
export interface UnparsedLine {
  lineIndex: number;
  text: string;
  reason: string;
}

function parseUnparsedLines(record: Record<string, unknown>): UnparsedLine[] {
  return firstArray(record, ["unparsed"]).map((raw) => {
    const line = asRecord(raw);
    return {
      lineIndex: firstNumber(line, ["lineIndex"]) ?? -1,
      text: firstString(line, ["text"]),
      reason: firstString(line, ["reason"]),
    };
  });
}

/** Two different dates recorded for one thing. Never resolved automatically:
 *  only the owner knows which was right. */
export interface OccasionConflict {
  occasionId: string;
  title: string;
  dates: string[];
  lineIndexes: number[];
}

export interface OccasionsList {
  today: string;
  timezone: string;
  occasions: OccasionRow[];
  unparsed: UnparsedLine[];
  conflicts: OccasionConflict[];
}

export function parseOccasionsList(value: unknown): OccasionsList {
  const record = asRecord(value);
  return {
    today: firstString(record, ["today"]),
    timezone: firstString(record, ["timezone"]),
    occasions: firstArray(record, ["occasions"]).map(parseOccasionRow),
    unparsed: parseUnparsedLines(record),
    conflicts: firstArray(record, ["conflicts"]).map((raw) => {
      const conflict = asRecord(raw);
      return {
        occasionId: firstString(conflict, ["occasionId"]),
        title: firstString(conflict, ["title"]),
        dates: asArray(conflict["dates"]).filter((item): item is string => typeof item === "string"),
        lineIndexes: asArray(conflict["lineIndexes"]).filter(
          (item): item is number => typeof item === "number" && Number.isFinite(item),
        ),
      };
    }),
  };
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export interface PlanRow {
  id: string;
  title: string;
  from: string;
  to: string;
  away: boolean;
  destination: string;
  extras: string[];
  lineIndex: number;
  text: string;
}

function parsePlanRow(raw: unknown): PlanRow {
  const plan = asRecord(raw);
  return {
    id: firstString(plan, ["id"]),
    title: firstString(plan, ["title"]),
    from: firstString(plan, ["from"]),
    to: firstString(plan, ["to"]),
    away: readBool(plan, "away"),
    destination: firstString(plan, ["destination"]),
    extras: asArray(plan["extras"]).filter((item): item is string => typeof item === "string"),
    lineIndex: firstNumber(plan, ["lineIndex"]) ?? -1,
    text: firstString(plan, ["text"]),
  };
}

export interface PlansList {
  today: string;
  plans: PlanRow[];
  unparsed: UnparsedLine[];
  awayNow: PlanRow | null;
}

export function parsePlansList(value: unknown): PlansList {
  const record = asRecord(value);
  const awayNow = record["awayNow"];
  return {
    today: firstString(record, ["today"]),
    plans: firstArray(record, ["plans"]).map(parsePlanRow),
    unparsed: parseUnparsedLines(record),
    awayNow: awayNow && typeof awayNow === "object" ? parsePlanRow(awayNow) : null,
  };
}

// ─── Proposal (propose, plans.propose) ───────────────────────────────────────

export interface OccasionProposal {
  ok: boolean;
  reason: string | null;
  line: string;
  confirmation: string;
  needsKind: boolean;
  conflictsWith: string[];
}

export function parseProposal(value: unknown): OccasionProposal {
  const record = asRecord(value);
  return {
    ok: readBool(record, "ok"),
    reason: nullableString(record, "reason"),
    line: firstString(record, ["line"]),
    confirmation: firstString(record, ["confirmation"]),
    needsKind: readBool(record, "needsKind"),
    conflictsWith: asArray(record["conflictsWith"]).filter((item): item is string => typeof item === "string"),
  };
}

// ─── Write outcome (confirm, plans.confirm, remove) ──────────────────────────

export interface OccasionWriteOutcome {
  ok: boolean;
  reason: string | null;
  occasionId: string;
  disclosure: string;
  droppedRecords: number;
}

export function parseWriteOutcome(value: unknown): OccasionWriteOutcome {
  const record = asRecord(value);
  return {
    ok: readBool(record, "ok"),
    reason: nullableString(record, "reason"),
    occasionId: firstString(record, ["occasionId"]),
    disclosure: firstString(record, ["disclosure"]),
    droppedRecords: firstNumber(record, ["droppedRecords"]) ?? 0,
  };
}

// ─── Interview ───────────────────────────────────────────────────────────────

export interface InterviewStep {
  id: string;
  prompt: string;
  opensFrom: string;
}

export interface InterviewProgress {
  interviewId: string;
  occasionId: string;
  occurrence: string;
  steps: InterviewStep[];
  nextStep: InterviewStep | null;
  complete: boolean;
  landedOn: string | null;
}

function parseInterviewStep(raw: unknown): InterviewStep {
  const step = asRecord(raw);
  return {
    id: firstString(step, ["id"]),
    prompt: firstString(step, ["prompt"]),
    opensFrom: firstString(step, ["opensFrom"]),
  };
}

export function parseInterview(raw: unknown): InterviewProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const record = asRecord(raw);
  const nextStep = record["nextStep"];
  return {
    interviewId: firstString(record, ["interviewId"]),
    occasionId: firstString(record, ["occasionId"]),
    occurrence: firstString(record, ["occurrence"]),
    steps: firstArray(record, ["steps"]).map(parseInterviewStep),
    nextStep: nextStep && typeof nextStep === "object" ? parseInterviewStep(nextStep) : null,
    complete: readBool(record, "complete"),
    landedOn: nullableString(record, "landedOn"),
  };
}

/** The get/answer/record envelope. `present:false` means the daemon is not
 *  holding that interview any more, which is an answer, not an error. */
export interface InterviewEnvelope {
  present: boolean;
  interview: InterviewProgress | null;
}

export function parseInterviewEnvelope(value: unknown): InterviewEnvelope {
  const record = asRecord(value);
  return { present: readBool(record, "present"), interview: parseInterview(record["interview"]) };
}

/** occasions.answer's envelope: a yes on a gift-giving occasion opens the
 *  interview and returns its first question in the same response. */
export interface AnswerOutcome {
  ok: boolean;
  reason: string | null;
  interview: InterviewProgress | null;
}

export function parseAnswerOutcome(value: unknown): AnswerOutcome {
  const record = asRecord(value);
  return {
    ok: readBool(record, "ok"),
    reason: nullableString(record, "reason"),
    interview: parseInterview(record["interview"]),
  };
}

/**
 * Which card the interview shows next.
 *
 * `complete` and `nextStep` are independent on the wire, and the middle state
 * is the one that matters: every question answered, `nextStep` null, and
 * `complete` still false until occasions.interview.record is called with what
 * he landed on. Measured on a live daemon. Reading `complete` alone would
 * leave the flow with nothing to render at exactly the moment it needs to ask
 * the one question the whole interview exists for.
 */
export type InterviewStage = "asking" | "awaiting-outcome" | "recorded";

export function interviewStage(interview: InterviewProgress): InterviewStage {
  if (interview.complete) return "recorded";
  return interview.nextStep ? "asking" : "awaiting-outcome";
}

/** How many steps have an answer behind them, for the card's progress line.
 *  Derived from position, since the answers themselves never come back. */
export function interviewAnsweredCount(interview: InterviewProgress): number {
  if (!interview.nextStep) return interview.steps.length;
  const index = interview.steps.findIndex((step) => step.id === interview.nextStep?.id);
  return index < 0 ? 0 : index;
}

// ─── Nudge / pending ─────────────────────────────────────────────────────────

export interface NudgeSubject {
  occasionId: string;
  title: string;
  person: string;
  kind: string;
  proximity: string;
  subject: string;
  acknowledged: boolean;
}

function parseNudgeSubject(raw: unknown): NudgeSubject {
  const record = asRecord(raw);
  return {
    occasionId: firstString(record, ["occasionId"]),
    title: firstString(record, ["title"]),
    person: firstString(record, ["person"]),
    kind: readKind(record, "kind"),
    proximity: firstString(record, ["proximity"]),
    subject: firstString(record, ["subject"]),
    acknowledged: readBool(record, "acknowledged"),
  };
}

export interface OccasionNudge {
  id: string;
  raisedAt: number;
  subjects: NudgeSubject[];
  message: string;
  answerable: boolean;
}

function parseNudge(raw: unknown): OccasionNudge | null {
  if (!raw || typeof raw !== "object") return null;
  const record = asRecord(raw);
  return {
    id: firstString(record, ["id"]),
    raisedAt: firstNumber(record, ["raisedAt"]) ?? 0,
    subjects: firstArray(record, ["subjects"]).map(parseNudgeSubject),
    message: firstString(record, ["message"]),
    answerable: readBool(record, "answerable"),
  };
}

export interface PendingConflict {
  occasionId: string;
  message: string;
}

export interface OccasionsPending {
  today: string;
  nudge: OccasionNudge | null;
  conflicts: PendingConflict[];
  acknowledged: NudgeSubject[];
  interviews: InterviewProgress[];
}

export function parsePending(value: unknown): OccasionsPending {
  const record = asRecord(value);
  return {
    today: firstString(record, ["today"]),
    nudge: parseNudge(record["nudge"]),
    conflicts: firstArray(record, ["conflicts"]).map((raw) => {
      const conflict = asRecord(raw);
      return {
        occasionId: firstString(conflict, ["occasionId"]),
        message: firstString(conflict, ["message"]),
      };
    }),
    acknowledged: firstArray(record, ["acknowledged"]).map(parseNudgeSubject),
    interviews: firstArray(record, ["interviews"])
      .map(parseInterview)
      .filter((item): item is InterviewProgress => item !== null),
  };
}

/** True when nothing at all is outstanding, the empty state's only condition. */
export function pendingIsEmpty(pending: OccasionsPending): boolean {
  return (
    pending.nudge === null &&
    pending.conflicts.length === 0 &&
    pending.acknowledged.length === 0 &&
    pending.interviews.length === 0
  );
}

// ─── Acknowledge ─────────────────────────────────────────────────────────────

export interface AcknowledgeOutcome {
  ok: boolean;
  reason: string | null;
  /** The daemon's own sentence about what acknowledging did and did not do.
   *  Rendered verbatim rather than summarised: it is the thing that says the
   *  item stays enumerable and only the push stops. */
  reply: string;
}

export function parseAcknowledgeOutcome(value: unknown): AcknowledgeOutcome {
  const record = asRecord(value);
  return {
    ok: readBool(record, "ok"),
    reason: nullableString(record, "reason"),
    reply: firstString(record, ["reply"]),
  };
}

// ─── Conflict resolve ────────────────────────────────────────────────────────

export interface ConflictResolution {
  occasionId: string;
  resolved: boolean;
}

export function parseConflictResolution(value: unknown): ConflictResolution {
  const record = asRecord(value);
  return { occasionId: firstString(record, ["occasionId"]), resolved: readBool(record, "resolved") };
}

/**
 * What `resolved:false` means, said plainly.
 *
 * It is not a failure. The verb stops a RAISED conflict being re-raised, and
 * a conflict that has never been raised at you has nothing to stop. Measured
 * live: a profile holding two dates for one name lists the conflict under
 * occasions.list.conflicts and still answers resolved:false here, because no
 * sweep had pushed it yet. Reporting that as an error would teach the owner to
 * ignore the button.
 */
export function conflictResolutionNote(resolution: ConflictResolution): string {
  return resolution.resolved
    ? "This conflict will not be raised again. The two dates are still both on your profile: only you can say which was right."
    : "Nothing was being raised for this one, so there was nothing to stop. The two dates are still both on your profile.";
}

// ─── Sweep ───────────────────────────────────────────────────────────────────

export interface SweepHousekeeping {
  sweptAt: number;
  expiredAcknowledgements: number;
  orphanedRecords: number;
  expiredOpenItems: number;
  agedGiftRecords: number;
  droppedInterviews: number;
  staleMirrors: number;
}

function parseHousekeeping(raw: unknown): SweepHousekeeping | null {
  if (!raw || typeof raw !== "object") return null;
  const record = asRecord(raw);
  return {
    sweptAt: firstNumber(record, ["sweptAt"]) ?? 0,
    expiredAcknowledgements: firstNumber(record, ["expiredAcknowledgements"]) ?? 0,
    orphanedRecords: firstNumber(record, ["orphanedRecords"]) ?? 0,
    expiredOpenItems: firstNumber(record, ["expiredOpenItems"]) ?? 0,
    agedGiftRecords: firstNumber(record, ["agedGiftRecords"]) ?? 0,
    droppedInterviews: firstNumber(record, ["droppedInterviews"]) ?? 0,
    staleMirrors: firstNumber(record, ["staleMirrors"]) ?? 0,
  };
}

export interface NudgeDelivery {
  channel: string;
  delivered: boolean;
  deliveryId: string | null;
  failure: string | null;
}

export interface SweepReport {
  ranAt: number;
  today: string;
  hold: string | null;
  nudge: OccasionNudge | null;
  conflictMessages: string[];
  resumedInterviews: string[];
  delivered: boolean;
  deliveryChannel: string;
  deliveryId: string | null;
  deliveries: NudgeDelivery[];
  mirrored: number;
  housekeeping: SweepHousekeeping | null;
}

export function parseSweepReport(value: unknown): SweepReport {
  const record = asRecord(value);
  return {
    ranAt: firstNumber(record, ["ranAt"]) ?? 0,
    today: firstString(record, ["today"]),
    hold: nullableString(record, "hold"),
    nudge: parseNudge(record["nudge"]),
    conflictMessages: asArray(record["conflictMessages"]).filter(
      (item): item is string => typeof item === "string",
    ),
    resumedInterviews: asArray(record["resumedInterviews"]).filter(
      (item): item is string => typeof item === "string",
    ),
    delivered: readBool(record, "delivered"),
    deliveryChannel: firstString(record, ["deliveryChannel"]),
    deliveryId: nullableString(record, "deliveryId"),
    deliveries: firstArray(record, ["deliveries"]).map((raw) => {
      const delivery = asRecord(raw);
      return {
        channel: firstString(delivery, ["channel"]),
        delivered: readBool(delivery, "delivered"),
        deliveryId: nullableString(delivery, "deliveryId"),
        failure: nullableString(delivery, "failure"),
      };
    }),
    mirrored: firstNumber(record, ["mirrored"]) ?? 0,
    housekeeping: parseHousekeeping(record["housekeeping"]),
  };
}

/**
 * The sweep's `hold`, expanded into the setting that caused it.
 *
 * Both holds were reached live: a sweep run at 03:00 against a daemon with
 * default settings answered hold:"quiet-hours" with housekeeping still done.
 * Nothing is dropped by a hold, it waits, and the copy says so rather than
 * letting an empty result read as "there was nothing to say".
 */
export function sweepHoldNote(hold: string): string {
  if (hold === "quiet-hours") {
    return "Held for quiet hours: the sweep ran and deliberately delivered nothing, because the time is outside occasions.activeHours in daemon config (08:00-22:00 unless you changed it). Nothing was dropped, it waits for the active window. Housekeeping still ran.";
  }
  if (hold === "disabled") {
    return "Held because raising is switched off: occasions.enabled is false in daemon config. Your dates are still held, still listed here, and still answerable. Housekeeping still ran.";
  }
  return `The daemon held this sweep and named the reason "${hold}". Nothing was dropped.`;
}

/** One line for what a sweep did, built only from what it reported. */
export function sweepOutcomeNote(report: SweepReport): string {
  if (report.hold) return sweepHoldNote(report.hold);
  if (report.delivered) {
    return report.deliveryChannel
      ? `Delivered to ${report.deliveryChannel}.`
      : "Delivered.";
  }
  if (report.nudge) return "Raised a nudge but no destination took it.";
  return "Ran with nothing to raise.";
}

/** The housekeeping tally, only naming what was actually reaped. */
export function housekeepingNote(housekeeping: SweepHousekeeping): string {
  const parts: string[] = [];
  if (housekeeping.expiredAcknowledgements > 0)
    parts.push(`${housekeeping.expiredAcknowledgements} expired acknowledgement(s)`);
  if (housekeeping.orphanedRecords > 0) parts.push(`${housekeeping.orphanedRecords} orphaned record(s)`);
  if (housekeeping.expiredOpenItems > 0) parts.push(`${housekeeping.expiredOpenItems} expired open item(s)`);
  if (housekeeping.agedGiftRecords > 0) parts.push(`${housekeeping.agedGiftRecords} aged gift record(s)`);
  if (housekeeping.droppedInterviews > 0) parts.push(`${housekeeping.droppedInterviews} dropped interview(s)`);
  if (housekeeping.staleMirrors > 0) parts.push(`${housekeeping.staleMirrors} stale calendar mirror(s)`);
  return parts.length === 0 ? "Housekeeping ran and found nothing to reap." : `Housekeeping removed ${parts.join(", ")}.`;
}

// ─── State disclosure ────────────────────────────────────────────────────────

/**
 * Counts and reasons only. This is the ONE occasions shape with no answer, no
 * gift and no date anywhere in it, which is what makes it safe to show in a
 * support context; every other shape on this page is not.
 */
export interface OccasionsState {
  path: string;
  acknowledgements: number;
  giftRecords: number;
  openItems: number;
  interviews: number;
  mirrors: number;
  lastSweep: SweepHousekeeping | null;
  reconciledOpenItems: number;
  corruption: string | null;
}

export function parseOccasionsState(value: unknown): OccasionsState {
  const record = asRecord(value);
  return {
    path: firstString(record, ["path"]),
    acknowledgements: firstNumber(record, ["acknowledgements"]) ?? 0,
    giftRecords: firstNumber(record, ["giftRecords"]) ?? 0,
    openItems: firstNumber(record, ["openItems"]) ?? 0,
    interviews: firstNumber(record, ["interviews"]) ?? 0,
    mirrors: firstNumber(record, ["mirrors"]) ?? 0,
    lastSweep: parseHousekeeping(record["lastSweep"]),
    reconciledOpenItems: firstNumber(record, ["reconciledOpenItems"]) ?? 0,
    corruption: nullableString(record, "corruption"),
  };
}

// ─── Gift history ────────────────────────────────────────────────────────────

export interface GiftRecord {
  occasionId: string;
  occurrence: string;
  recordedAt: number;
  landedOn: string;
  notes: string;
}

export interface GiftHistory {
  occasionId: string;
  gifts: GiftRecord[];
}

export function parseGiftHistory(value: unknown): GiftHistory {
  const record = asRecord(value);
  return {
    occasionId: firstString(record, ["occasionId"]),
    gifts: firstArray(record, ["gifts"]).map((raw) => {
      const gift = asRecord(raw);
      return {
        occasionId: firstString(gift, ["occasionId"]),
        occurrence: firstString(gift, ["occurrence"]),
        recordedAt: firstNumber(gift, ["recordedAt"]) ?? 0,
        landedOn: firstString(gift, ["landedOn"]),
        notes: firstString(gift, ["notes"]),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * The countdown, read straight off the daemon's `daysUntil`.
 *
 * Never recomputed from `nextOccurrence`: the daemon reckons days in
 * `daemon.timezone` and this webview runs in the OS zone, so a locally derived
 * count would be a day out for anyone whose daemon is not where they are.
 */
export function daysUntilLabel(daysUntil: number | null): string {
  if (daysUntil === null) return "—";
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  if (daysUntil < 0) return `${Math.abs(daysUntil)} days ago`;
  return `in ${daysUntil} days`;
}

/** An ISO date the daemon already decided, rendered long. A value that does
 *  not parse is shown exactly as it arrived rather than as "Invalid Date". */
export function formatDateOnly(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

/** Epoch milliseconds to a local timestamp; 0 means "never recorded". */
export function formatEpoch(epochMs: number): string {
  if (!epochMs) return "—";
  return new Date(epochMs).toLocaleString();
}

/** The declared date as it reads on the owner's own line: MM-DD for something
 *  annual, YYYY-MM-DD for a one-off. Zero-padded so it round-trips into the
 *  form fields the daemon accepts. */
export function declaredDateText(row: Pick<OccasionRow, "dateKind" | "dateYear" | "dateMonth" | "dateDay">): string {
  if (row.dateMonth === null || row.dateDay === null) return "";
  const month = String(row.dateMonth).padStart(2, "0");
  const day = String(row.dateDay).padStart(2, "0");
  if (row.dateKind === "dated" && row.dateYear !== null) return `${row.dateYear}-${month}-${day}`;
  return `${month}-${day}`;
}

/** Whose date this is, in the daemon's own vocabulary. `unattributed` is a
 *  real state (a date with no person on it), not a missing value. */
export function subjectLabel(subject: string): string {
  if (subject === "owner") return "Yours";
  if (subject === "other") return "Someone else's";
  if (subject === "unattributed") return "No one named";
  return subject;
}

// ---------------------------------------------------------------------------
// Write inputs
// ---------------------------------------------------------------------------

/**
 * The `said` a Dates write records.
 *
 * The owner-profile write gate takes a verbatim quote of what he said, and
 * here there was no utterance: he filled in a form. So the line records that
 * instead of inventing a sentence. `surface` and `authority` are the app-wide
 * constants from views/settings/owner-profile.ts, imported rather than
 * restated so the two write sites cannot drift into claiming to be different
 * clients.
 */
export const DATES_ENTRY_UTTERANCE = "(entered on the Dates page of the GoodVibes desktop app)";

export interface OccasionDraft {
  title: string;
  date: string;
  kind: OccasionKind | "";
  person: string;
  recurrence: OccasionRecurrence;
  leadDays: string;
}

export const EMPTY_OCCASION_DRAFT: OccasionDraft = {
  title: "",
  date: "",
  kind: "",
  person: "",
  recurrence: "annual",
  leadDays: "",
};

function optionalLeadDays(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/** The propose body. Only `title` and `date` are required; an omitted kind is
 *  what makes the daemon answer needsKind and ask for it in the confirmation,
 *  so an empty kind is left OFF the body rather than sent as "". */
export function buildOccasionProposeInput(draft: OccasionDraft): Record<string, unknown> {
  const body: Record<string, unknown> = { title: draft.title.trim(), date: draft.date.trim() };
  if (draft.kind) body["kind"] = draft.kind;
  if (draft.person.trim()) body["person"] = draft.person.trim();
  if (draft.recurrence) body["recurrence"] = draft.recurrence;
  const leadDays = optionalLeadDays(draft.leadDays);
  if (leadDays !== undefined) body["leadDays"] = leadDays;
  return body;
}

/** The confirm body. Refused by the daemon without a kind (measured: 400
 *  INVALID_INPUT), which is deliberate, so the caller must have one. */
export function buildOccasionConfirmInput(draft: OccasionDraft, kind: OccasionKind): Record<string, unknown> {
  return {
    ...buildOccasionProposeInput(draft),
    kind,
    surface: APP_PROFILE_SURFACE,
    said: DATES_ENTRY_UTTERANCE,
    authority: APP_PROFILE_AUTHORITY,
  };
}

export interface PlanDraft {
  title: string;
  from: string;
  to: string;
  away: boolean;
  destination: string;
}

export const EMPTY_PLAN_DRAFT: PlanDraft = { title: "", from: "", to: "", away: false, destination: "" };

export function buildPlanProposeInput(draft: PlanDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: draft.title.trim(),
    from: draft.from.trim(),
    to: draft.to.trim(),
    // Away is opt-in rather than assumed: a dated range is not always him
    // leaving the house, so the flag is sent as stated either way.
    away: draft.away,
  };
  if (draft.destination.trim()) body["destination"] = draft.destination.trim();
  return body;
}

export function buildPlanConfirmInput(draft: PlanDraft): Record<string, unknown> {
  return {
    ...buildPlanProposeInput(draft),
    surface: APP_PROFILE_SURFACE,
    said: DATES_ENTRY_UTTERANCE,
    authority: APP_PROFILE_AUTHORITY,
  };
}

/** The remove body. `authority` is required and the daemon 400s without it
 *  (measured), because forget is gated on authority and nothing else. */
export function buildOccasionRemoveInput(occasionId: string, confirmed: boolean): Record<string, unknown> {
  return { occasionId, confirmed, authority: APP_PROFILE_AUTHORITY };
}

// ---------------------------------------------------------------------------
// Proposal freshness
// ---------------------------------------------------------------------------

/**
 * Is a returned preview still describing the draft on screen?
 *
 * Derived rather than remembered. A preview is only true of the draft that
 * produced it, and the daemon renders every field INTO the line it shows,
 * including `kind`. An edit that the form forgot to invalidate on would leave a
 * preview reading `remember-only` above a Confirm button that writes
 * `gift-giving`, and the owner would have approved a sentence the machine was
 * never going to write. Comparing the built bodies makes that unrepresentable
 * for every field at once, including any field added later, instead of relying
 * on each onChange handler to remember a clearing call.
 */
export function occasionProposalIsCurrent(proposedFor: OccasionDraft, draft: OccasionDraft): boolean {
  return (
    JSON.stringify(buildOccasionProposeInput(proposedFor)) === JSON.stringify(buildOccasionProposeInput(draft))
  );
}

export function planProposalIsCurrent(proposedFor: PlanDraft, draft: PlanDraft): boolean {
  return JSON.stringify(buildPlanProposeInput(proposedFor)) === JSON.stringify(buildPlanProposeInput(draft));
}

// ---------------------------------------------------------------------------
// Duplicate-write guard
// ---------------------------------------------------------------------------

/**
 * The occasion id the daemon will key this draft on.
 *
 * Measured: confirming "Jordan birthday" produced id "jordan birthday", and
 * "Alex anniversary" produced "alex anniversary". The id is the title folded to
 * lower case, so a draft can be matched against a listed row without writing
 * anything first.
 */
export function draftOccasionId(draft: OccasionDraft): string {
  return draft.title.trim().toLowerCase();
}

/**
 * The already-listed row this draft would write again, if there is one.
 *
 * This exists because `occasions.confirm` APPENDS unconditionally and nothing
 * upstream catches a repeat. Measured against a live daemon: confirming a line
 * that already existed verbatim returned ok:true a second time, `occasions.list`
 * still reported ONE row (rows are keyed by id, so the twin is invisible),
 * `conflicts` stayed empty because both lines agree on the date, and
 * `occasions.propose` beforehand reported `conflictsWith: []` with no other
 * signal. The damage only surfaces later, at removal, as
 *   "2 lines in Important dates read exactly that, so it is not clear which one
 *    you mean. Nothing was removed - edit the file directly."
 * which is a file the owner then has to repair by hand.
 *
 * So the guard cannot be a propose-time read of the wire; it has to be this
 * check against what is already listed, run before every confirm.
 */
export function findExistingOccasion(rows: OccasionRow[], draft: OccasionDraft): OccasionRow | undefined {
  const id = draftOccasionId(draft);
  const date = draft.date.trim();
  return rows.find((row) => row.id.toLowerCase() === id && declaredDateText(row) === date);
}

/** Why a confirm was refused locally, naming the row that is already there. */
export function duplicateWriteRefusal(existing: OccasionRow): string {
  return `"${existing.title}" is already on your profile with that date, as "${existing.text}". Writing it again would put a second identical line under Important dates, which nothing here could tell apart afterwards and which removal refuses to touch. Nothing was written. To change it, remove the existing one first and add it again.`;
}

/** The sentence shown when a confirm failed without saying whether it landed. */
export const CONFIRM_UNVERIFIED_NOTE =
  "The write did not report back, so it is not known whether it landed. The preview has been cleared and your typed values kept: preview again, and if the date is already on your profile this will say so instead of writing a second copy of it.";

// ---------------------------------------------------------------------------
// Typed calls
// ---------------------------------------------------------------------------

export const datesApi = {
  list: async (): Promise<OccasionsList> => parseOccasionsList(await gv.occasions.list()),
  plans: async (): Promise<PlansList> => parsePlansList(await gv.occasions.plans.list()),
  pending: async (): Promise<OccasionsPending> => parsePending(await gv.occasions.pending()),
  state: async (): Promise<OccasionsState> => parseOccasionsState(await gv.occasions.state()),
  gifts: async (occasionId: string): Promise<GiftHistory> =>
    parseGiftHistory(await gv.occasions.gifts(occasionId)),
  propose: async (draft: OccasionDraft): Promise<OccasionProposal> =>
    parseProposal(await gv.occasions.propose(buildOccasionProposeInput(draft))),
  confirm: async (draft: OccasionDraft, kind: OccasionKind): Promise<OccasionWriteOutcome> =>
    parseWriteOutcome(await gv.occasions.confirm(buildOccasionConfirmInput(draft, kind))),
  remove: async (occasionId: string, confirmed: boolean): Promise<OccasionWriteOutcome> =>
    parseWriteOutcome(await gv.occasions.remove(buildOccasionRemoveInput(occasionId, confirmed))),
  answer: async (occasionId: string, answer: OccasionAnswer, occurrence: string): Promise<AnswerOutcome> =>
    parseAnswerOutcome(
      await gv.occasions.answer({ occasionId, answer, ...(occurrence ? { occurrence } : {}) }),
    ),
  acknowledge: async (occasionId: string, occurrence: string): Promise<AcknowledgeOutcome> =>
    parseAcknowledgeOutcome(
      await gv.occasions.acknowledge({
        occasionId,
        // `explicit` is the truthful source here: a surface offered the action
        // and he took it. `conversation` would claim he said it in a reply.
        source: "explicit",
        ...(occurrence ? { occurrence } : {}),
      }),
    ),
  resolveConflict: async (occasionId: string): Promise<ConflictResolution> =>
    parseConflictResolution(await gv.occasions.conflictResolve(occasionId)),
  sweep: async (): Promise<SweepReport> => parseSweepReport(await gv.occasions.sweep()),
  interviewGet: async (interviewId: string): Promise<InterviewEnvelope> =>
    parseInterviewEnvelope(await gv.occasions.interview.get(interviewId)),
  interviewAnswer: async (interviewId: string, stepId: string, text: string): Promise<InterviewEnvelope> =>
    parseInterviewEnvelope(await gv.occasions.interview.answer({ interviewId, stepId, text })),
  interviewRecord: async (interviewId: string, landedOn: string): Promise<InterviewEnvelope> =>
    parseInterviewEnvelope(await gv.occasions.interview.record({ interviewId, landedOn })),
  planPropose: async (draft: PlanDraft): Promise<OccasionProposal> =>
    parseProposal(await gv.occasions.plans.propose(buildPlanProposeInput(draft))),
  planConfirm: async (draft: PlanDraft): Promise<OccasionWriteOutcome> =>
    parseWriteOutcome(await gv.occasions.plans.confirm(buildPlanConfirmInput(draft))),
} as const;
