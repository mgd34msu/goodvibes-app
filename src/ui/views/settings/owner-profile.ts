// Wire readers, view types and display helpers for the daemon's nine
// owner-profile verbs (profile.read / .get / .person / .provenance / .status /
// .set / .append / .forget / .undo).
//
// WHAT THE PROFILE IS. One Markdown file the daemon keeps, holding what the
// platform knows about its owner. It is a DOCUMENT he writes, not a table: the
// writer never normalizes a line he typed, so neither does this reader, and
// prose stays prose instead of being restyled into fields.
//
// MECHANICAL FIELDS vs PROSE. A field (`city:`, `shipping address:`) is
// addressed by its `fieldId` and can be superseded and undone. A prose bullet
// is addressed by its CONTENT (its section plus its exact text) and never by
// its position: the owner edits this file himself, so an index taken from an
// earlier read may name a different line by the time a click arrives, and
// profile.forget refuses a lineIndex outright for exactly that reason.
// `lineIndex` is kept here as a React key and document order, and must never
// reach a verb.
//
// TIERS. Open-tier content is in the agent's context every turn. Closed-tier
// content is reachable only by a named call, and each read is disclosed. A tier
// string this client does not recognize is read as CLOSED, the one guess made
// here, made in the containing direction.
//
// THREE HONEST STATES. `loaded`, `disabled` and `unavailable` are three
// different sentences, and "I could not open the file" must never render as "I
// know nothing about you". A reader that returns null means "the answer did not
// carry a profile at all", which is a fourth thing again, and never a success.
//
// CONTAINMENT. Nothing here logs and nothing here persists. profile.status's
// shape has no `value` property anywhere, which is what makes it safe in a
// support bundle, and this reader does not reintroduce one.

import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

export type ProfileState = "loaded" | "disabled" | "unavailable";
export type ProfileTier = "open" | "closed";

/** The provenance suffix a learned line carries: which surface, when, and the
 *  owner's exact words. A line with no suffix carries no provenance at all. */
export interface ProfileProvenance {
  surface: string;
  date: string;
  said: string;
}

/** A mechanical field. `valid: false` still carries the value, verbatim. */
export interface ProfileField {
  fieldId: string;
  /** The label as written in the document, e.g. `shipping address`. */
  label: string;
  value: string;
  valid: boolean;
  invalidReason?: string;
  provenance?: ProfileProvenance;
}

/** A prose line, preserved as written. */
export interface ProfileProseLine {
  /** Document order and a stable React key. NEVER sent to a verb. */
  lineIndex: number;
  section: string;
  text: string;
  provenance?: ProfileProvenance;
}

export interface ProfileSection {
  /** The heading as written; the owner's renames are respected. */
  heading: string;
  tier: ProfileTier;
  fields: ProfileField[];
  prose: ProfileProseLine[];
}

export interface ProfileDocument {
  state: ProfileState;
  /** Why it could not be read, when the state is 'unavailable'. */
  reason?: string;
  path: string;
  sections: ProfileSection[];
}

export interface ProfileInvalidField {
  fieldId: string;
  reason: string;
}

/** profile.status: state, path, section NAMES, counts, invalid reasons. No values. */
export interface ProfileStatus {
  state: ProfileState;
  reason?: string;
  path: string;
  exists?: boolean;
  sections: string[];
  lineCount?: number;
  fieldCount?: number;
  proseLineCount?: number;
  invalidFields: ProfileInvalidField[];
}

/** One retained predecessor. Undo promotes exactly one of these back. */
export interface ProfileSupersededValue {
  fieldId: string;
  section: string;
  value: string;
  supersededOn: string;
  /** Position of the history comment in the file. Used ONLY for ordering and
   *  as a React key, exactly as ProfileProseLine's is; never sent to a verb. */
  lineIndex: number;
  provenance?: ProfileProvenance;
}

export interface ProfileProvenanceAnswer {
  fieldId: string;
  /** Whether the field is in the document at all. */
  present: boolean;
  /** True when the field exists but carries no suffix: he wrote it by hand,
   *  and saying so is the honest answer rather than inventing a source. */
  handEdited: boolean;
  provenance?: ProfileProvenance;
  superseded: ProfileSupersededValue[];
}

/** One thing a write did. Names the field; never repeats the value. */
export interface ProfileChange {
  kind: string;
  fieldId: string | null;
  section: string;
  label: string;
  superseded: boolean;
}

/** What every write verb answers. `ok: false` always carries a reason. */
export interface ProfileWriteOutcome {
  ok: boolean;
  reason?: string;
  changes: ProfileChange[];
  disclosure: string;
}

/** A People lookup: the lines matching one name, and nothing else. */
export interface ProfilePersonAnswer {
  name: string;
  lines: ProfileProseLine[];
  disclosure: string;
}

/**
 * What a mutating verb is being asked about. A field by id; a prose line by its
 * section plus its exact text.
 */
export type ProfileTarget =
  | { kind: "field"; fieldId: string }
  | { kind: "line"; section: string; text: string };

// ---------------------------------------------------------------------------
// Primitive readers
// ---------------------------------------------------------------------------

const STATES: readonly ProfileState[] = ["loaded", "disabled", "unavailable"];

function readState(kind: unknown): ProfileState | undefined {
  return STATES.find((state) => state === kind);
}

function readTier(tier: unknown): ProfileTier {
  // The one guess in this file, and it is made in the containing direction: a
  // section this client cannot classify is treated as the more protected of the
  // two, never as freely-injected open-tier content.
  return tier === "open" ? "open" : "closed";
}

function readProvenance(value: unknown): ProfileProvenance | undefined {
  const record = asRecord(value);
  const surface = record["surface"];
  const date = record["date"];
  const said = record["said"];
  if (typeof surface !== "string" || typeof date !== "string" || typeof said !== "string") return undefined;
  return { surface, date, said };
}

// ---------------------------------------------------------------------------
// profile.read
// ---------------------------------------------------------------------------

function readField(value: unknown): ProfileField | null {
  const record = asRecord(value);
  const fieldId = firstString(record, ["fieldId"]);
  const label = firstString(record, ["label"]);
  if (!fieldId || !label) return null;
  const text = record["value"];
  if (typeof text !== "string") return null;
  const invalidReason = firstString(record, ["invalidReason"]);
  const provenance = readProvenance(record["provenance"]);
  return {
    fieldId,
    label,
    value: text,
    // Absent is treated as valid: only an explicit false is a validation
    // failure, and a failure always arrives with its reason.
    valid: record["valid"] !== false,
    ...(invalidReason ? { invalidReason } : {}),
    ...(provenance ? { provenance } : {}),
  };
}

function readProseLine(value: unknown): ProfileProseLine | null {
  const record = asRecord(value);
  const lineIndex = firstNumber(record, ["lineIndex"]);
  const text = record["text"];
  if (lineIndex === undefined || typeof text !== "string") return null;
  const provenance = readProvenance(record["provenance"]);
  return {
    lineIndex,
    section: firstString(record, ["section"]),
    text,
    ...(provenance ? { provenance } : {}),
  };
}

function readSection(value: unknown): ProfileSection | null {
  const record = asRecord(value);
  const heading = firstString(record, ["heading"]);
  if (!heading) return null;
  return {
    heading,
    tier: readTier(record["tier"]),
    fields: asArray(record["fields"])
      .map(readField)
      .filter((field): field is ProfileField => field !== null),
    prose: asArray(record["prose"])
      .map(readProseLine)
      .filter((line): line is ProfileProseLine => line !== null),
  };
}

/**
 * The whole document, or null when the answer does not carry one.
 *
 * Null is "render the honest could-not-be-read state", NOT an empty profile.
 * Sections are dropped for a non-loaded state, so a disabled or unreadable
 * profile can never render content beneath its own banner.
 */
export function readProfileDocument(value: unknown): ProfileDocument | null {
  const record = asRecord(value);
  const stateRecord = asRecord(record["state"]);
  const state = readState(stateRecord["kind"]);
  const path = firstString(stateRecord, ["path"]);
  if (state === undefined || !path) return null;
  const reason = firstString(stateRecord, ["reason"]);
  return {
    state,
    ...(reason ? { reason } : {}),
    path,
    sections:
      state === "loaded"
        ? asArray(record["sections"])
            .map(readSection)
            .filter((section): section is ProfileSection => section !== null)
        : [],
  };
}

// ---------------------------------------------------------------------------
// profile.status
// ---------------------------------------------------------------------------

function readInvalidField(value: unknown): ProfileInvalidField | null {
  const record = asRecord(value);
  const fieldId = firstString(record, ["fieldId"]);
  if (!fieldId) return null;
  return { fieldId, reason: firstString(record, ["reason"]) || "no reason given" };
}

export function readProfileStatus(value: unknown): ProfileStatus | null {
  const record = asRecord(value);
  const state = readState(record["kind"]);
  const path = firstString(record, ["path"]);
  if (state === undefined || !path) return null;
  const reason = firstString(record, ["reason"]);
  const lineCount = firstNumber(record, ["lineCount"]);
  const fieldCount = firstNumber(record, ["fieldCount"]);
  const proseLineCount = firstNumber(record, ["proseLineCount"]);
  return {
    state,
    ...(reason ? { reason } : {}),
    path,
    ...(typeof record["exists"] === "boolean" ? { exists: record["exists"] } : {}),
    sections: asArray(record["sections"]).filter((name): name is string => typeof name === "string"),
    ...(lineCount === undefined ? {} : { lineCount }),
    ...(fieldCount === undefined ? {} : { fieldCount }),
    ...(proseLineCount === undefined ? {} : { proseLineCount }),
    invalidFields: asArray(record["invalidFields"])
      .map(readInvalidField)
      .filter((entry): entry is ProfileInvalidField => entry !== null),
  };
}

// ---------------------------------------------------------------------------
// profile.get
// ---------------------------------------------------------------------------

/** One named field lookup: what a consumer asking by name gets back. */
export interface ProfileFieldAnswer {
  fieldId: string;
  present: boolean;
  field?: ProfileField;
  /**
   * The heading the field sits under. profile.get sends this and profile.read
   * does not: read already groups fields under their heading, so repeating it
   * per field there would be noise.
   */
  section: string;
  /** The line the owner would be shown for a closed-tier read; "" when there
   *  is nothing to disclose (an open-tier field, or the receipts turned off). */
  disclosure: string;
}

export function readProfileFieldAnswer(value: unknown): ProfileFieldAnswer | null {
  const record = asRecord(value);
  const fieldId = firstString(record, ["fieldId"]);
  if (!fieldId || typeof record["present"] !== "boolean") return null;
  const field = readField(record["field"]);
  return {
    fieldId,
    present: record["present"],
    ...(field ? { field } : {}),
    section: firstString(asRecord(record["field"]), ["section"]),
    disclosure: firstString(record, ["disclosure"]),
  };
}

// ---------------------------------------------------------------------------
// profile.provenance
// ---------------------------------------------------------------------------

function readSupersededValue(value: unknown): ProfileSupersededValue | null {
  const record = asRecord(value);
  const fieldId = firstString(record, ["fieldId"]);
  const text = record["value"];
  if (!fieldId || typeof text !== "string") return null;
  const provenance = readProvenance(record["provenance"]);
  return {
    fieldId,
    section: firstString(record, ["section"]),
    value: text,
    supersededOn: firstString(record, ["supersededOn"]),
    lineIndex: firstNumber(record, ["lineIndex"]) ?? 0,
    ...(provenance ? { provenance } : {}),
  };
}

/**
 * Which retained value profile.undo would promote back, by index into the list
 * as it arrived, or -1 when there is nothing to undo.
 *
 * The wire carries no marker for this and the list is not ordered by recency:
 * it is built by the parser walking the file top to bottom, so it arrives in
 * ascending lineIndex. The daemon picks by a different rule, and this mirrors it
 * exactly rather than assuming the last entry wins: `mostRecentSuperseded` in
 * the SDK's owner-profile/writer.ts sorts on `supersededOn` ascending, breaking
 * ties on `lineIndex` ascending ("history is appended in order"), and pops the
 * end. So the answer is the LATEST date, and among equal dates the one furthest
 * down the document.
 *
 * The two rules agree on a file only this app wrote, and disagree on one the
 * owner has edited by hand, which is precisely the file this feature exists for.
 */
export function mostRecentSupersededIndex(entries: readonly ProfileSupersededValue[]): number {
  let best = -1;
  entries.forEach((entry, index) => {
    if (best === -1) {
      best = index;
      return;
    }
    const winner = entries[best];
    if (!winner) return;
    const newer =
      entry.supersededOn === winner.supersededOn
        ? entry.lineIndex > winner.lineIndex
        : entry.supersededOn > winner.supersededOn;
    if (newer) best = index;
  });
  return best;
}

/**
 * Where a field came from, or null when the body carries nothing recognizable.
 *
 * `provenance` is explicitly nullable on the wire for a hand-edited field, so a
 * null there is data, not a malformed answer: it pairs with handEdited:true and
 * is reported as "you wrote this yourself", never dressed up as a source.
 */
export function readProfileProvenanceAnswer(value: unknown): ProfileProvenanceAnswer | null {
  const record = asRecord(value);
  const fieldId = firstString(record, ["fieldId"]);
  if (!fieldId || typeof record["present"] !== "boolean") return null;
  const provenance = readProvenance(record["provenance"]);
  return {
    fieldId,
    present: record["present"],
    // A body missing the flag must not read as "hand edited".
    handEdited: record["handEdited"] === true,
    ...(provenance ? { provenance } : {}),
    superseded: asArray(record["superseded"])
      .map(readSupersededValue)
      .filter((entry): entry is ProfileSupersededValue => entry !== null),
  };
}

// ---------------------------------------------------------------------------
// profile.person
// ---------------------------------------------------------------------------

export function readProfilePersonAnswer(value: unknown): ProfilePersonAnswer | null {
  const record = asRecord(value);
  const name = firstString(record, ["name"]);
  if (!name) return null;
  return {
    name,
    lines: asArray(record["lines"])
      .map(readProseLine)
      .filter((line): line is ProfileProseLine => line !== null),
    disclosure: firstString(record, ["disclosure"]),
  };
}

// ---------------------------------------------------------------------------
// profile.set / .append / .forget / .undo
// ---------------------------------------------------------------------------

function readChange(value: unknown): ProfileChange | null {
  const record = asRecord(value);
  const section = firstString(record, ["section"]);
  const label = firstString(record, ["label"]);
  if (!section || !label) return null;
  return {
    kind: firstString(record, ["kind"]),
    fieldId: firstString(record, ["fieldId"]) || null,
    section,
    label,
    superseded: record["superseded"] === true,
  };
}

/**
 * Every write verb's answer, or null when the body did not carry one.
 *
 * `ok` is required by the contract, so its absence is a MALFORMED answer rather
 * than a failure, and the two are reported differently. Null must never render
 * as a success: for a delete in particular, a daemon that did not say it
 * deleted has not told us it deleted.
 */
export function readProfileWriteOutcome(value: unknown): ProfileWriteOutcome | null {
  const record = asRecord(value);
  if (typeof record["ok"] !== "boolean") return null;
  const reason = firstString(record, ["reason"]);
  return {
    ok: record["ok"],
    ...(reason ? { reason } : {}),
    changes: asArray(record["changes"])
      .map(readChange)
      .filter((change): change is ProfileChange => change !== null),
    disclosure: firstString(record, ["disclosure"]),
  };
}

// ---------------------------------------------------------------------------
// Write inputs
// ---------------------------------------------------------------------------

/**
 * The surface name a write from THIS app declares.
 *
 * It has to be one of the daemon's own five (tui | agent | webui | voice |
 * hand-edit); anything else is a 400 from the route's readSurface, verified
 * live: `surface: "app"` is refused, naming the five. None of them is this
 * desktop app, so the choice is which true statement to make, and `hand-edit`
 * is the one the daemon itself defines as "the owner typed it himself", which
 * is exactly what a value typed into the form below is. Claiming `webui` would
 * name a DIFFERENT client as the source of a line it never touched, and the
 * whole point of the provenance suffix is that it can be trusted.
 *
 * The `said` below carries the rest of the answer, so the resulting line names
 * this app explicitly rather than leaving "hand-edit" to be read as a text
 * editor.
 */
export const APP_PROFILE_SURFACE = "hand-edit";

/** The `said` a settings-surface write records. Not a quote of the owner's
 *  words, because there were none: he typed a value into a form, and the line
 *  says so instead of inventing a sentence he never said. */
export const SETTINGS_EDIT_UTTERANCE = "(edited in the GoodVibes desktop app settings)";

/**
 * The authority every write from this surface claims: where the fact came from.
 *
 * This surface can say `owner-direct` honestly, because the only thing that
 * reaches these calls is the owner typing into his own settings page: no page
 * content, no message body, no document composes them. An agent must NOT
 * hardcode this: it can genuinely be handed a purported fact by an email or a
 * web page and has to say which so the daemon can refuse.
 */
export const APP_PROFILE_AUTHORITY = "owner-direct";

export function buildProfileSetInput(fieldId: string, value: string): Record<string, unknown> {
  return {
    fieldId,
    value,
    surface: APP_PROFILE_SURFACE,
    said: SETTINGS_EDIT_UTTERANCE,
    authority: APP_PROFILE_AUTHORITY,
  };
}

export function buildProfileAppendInput(section: string, text: string): Record<string, unknown> {
  return {
    section,
    text,
    surface: APP_PROFILE_SURFACE,
    said: SETTINGS_EDIT_UTTERANCE,
    authority: APP_PROFILE_AUTHORITY,
  };
}

/**
 * The forget body: a target plus the required authority, and NO lineIndex. The
 * daemon 400s on a lineIndex outright rather than silently ignoring it, because
 * accepting a stale position would delete the wrong line and report success.
 */
export function buildProfileForgetInput(target: ProfileTarget): Record<string, unknown> {
  return target.kind === "field"
    ? { fieldId: target.fieldId, authority: APP_PROFILE_AUTHORITY }
    : { section: target.section, text: target.text, authority: APP_PROFILE_AUTHORITY };
}

export function buildProfileUndoInput(fieldId: string): Record<string, unknown> {
  return { fieldId, authority: APP_PROFILE_AUTHORITY };
}

/** A stable string for React keys. Never rendered to the operator. */
export function profileTargetId(target: ProfileTarget): string {
  return target.kind === "field" ? `field:${target.fieldId}` : `line:${target.section}:${target.text}`;
}

// ---------------------------------------------------------------------------
// Third-party personal data
// ---------------------------------------------------------------------------

function normalizeHeading(heading: string): string {
  return heading.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The section holding facts about people who never agreed to be in a database. */
export const THIRD_PARTY_SECTION_HEADINGS: ReadonlySet<string> = new Set(["people"]);

export function sectionHoldsThirdPartyData(section: Pick<ProfileSection, "heading">): boolean {
  return THIRD_PARTY_SECTION_HEADINGS.has(normalizeHeading(section.heading));
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function profileStateLabel(state: ProfileState): string {
  switch (state) {
    case "loaded":
      return "Loaded";
    case "disabled":
      return "Turned off";
    case "unavailable":
      return "Could not be read";
  }
}

export function profileStateBadgeTone(state: ProfileState): "ok" | "neutral" | "bad" {
  switch (state) {
    case "loaded":
      return "ok";
    case "disabled":
      return "neutral";
    case "unavailable":
      return "bad";
  }
}

/** What a tier means for the agent, in plain terms. */
export function tierNote(tier: ProfileTier): string {
  return tier === "open"
    ? "Open: this is in the agent's context every turn, so it never has to ask."
    : "Closed: never put in the agent's context. It is read only when something asks for it by name, and every read is disclosed.";
}

export function profileUnavailableLine(reason: string | undefined, path: string): string {
  const head = reason
    ? `Your profile could not be read: ${reason}`
    : "Your profile could not be read, and the daemon did not give a reason";
  return `${head} (${path})`;
}

export function profileDisabledLine(): string {
  return "Your profile is turned off, so nothing is loaded. Turn on profile.enabled in Daemon config to use it.";
}

/** One line for a provenance record: which surface, when, and the words recorded. */
export function provenanceSummary(provenance: ProfileProvenance): string {
  return `${provenance.surface}, ${provenance.date}: "${provenance.said}"`;
}

export interface ProfileReport {
  tone: "ok" | "info" | "warning";
  text: string;
}

/**
 * What a write actually did, in one line.
 *
 * A refusal is reported in the DAEMON's own words, which is what keeps "there
 * was nothing to forget" and "that write was refused" two different sentences
 * without this surface guessing which one it is looking at. A no-op is never
 * rendered as a success.
 */
export function writeReportLine(
  outcome: ProfileWriteOutcome | null,
  fallbackSuccess: string,
  malformed: string,
): ProfileReport {
  if (outcome === null) return { tone: "warning", text: malformed };
  if (!outcome.ok) {
    return { tone: "info", text: outcome.reason ?? "The daemon refused that, without saying why." };
  }
  return { tone: "ok", text: outcome.disclosure || fallbackSuccess };
}

/** What a delete removed, named from the daemon's own change list. */
export function deletedWhat(outcome: ProfileWriteOutcome, fallbackLabel: string): string {
  const labels = outcome.changes.map((change) => change.label).filter((label) => label.length > 0);
  return labels.length > 0 ? labels.join(", ") : fallbackLabel;
}

/**
 * Appended whenever a delete finds nothing to delete.
 *
 * A forget names a row this page rendered from an earlier read, so a failure
 * usually means the file has moved on since, because the owner edited it himself or
 * another surface did. Saying only "nothing was removed" would be true and
 * useless; the useful part is that the page may no longer match the file. It
 * says MAY rather than asserting a change, because one failure branch is not
 * staleness at all (two identical notes are refused as ambiguous, with the file
 * exactly as the page showed it).
 */
export const STALE_VIEW_NOTE =
  "This page may no longer match the file, so it is being re-read.";

export function forgetReportLine(outcome: ProfileWriteOutcome | null, label: string): ProfileReport {
  if (outcome === null) {
    return {
      tone: "warning",
      text: `The daemon answered, but did not say whether ${label} was deleted. Check the profile below before assuming it went.`,
    };
  }
  if (!outcome.ok) {
    const reason = outcome.reason ?? "Nothing was deleted, and the daemon did not say why.";
    return { tone: "warning", text: `${reason} ${STALE_VIEW_NOTE}` };
  }
  return { tone: "ok", text: `Deleted ${deletedWhat(outcome, label)} from your profile.` };
}
