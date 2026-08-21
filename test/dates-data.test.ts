// Pure-logic coverage for src/ui/views/dates/dates-data.ts: the boundary
// parsers for all 17 occasions verbs, the interview-stage rule, the formatters,
// the refusal triage, and the write-input builders that carry the owner-profile
// write gate.
//
// Every payload below is a VERBATIM capture from a scratch daemon
// (@pellux/goodvibes-daemon 1.28.19 / sdk 2.0.17) driven over its HTTP routes
// in an isolated home: propose (refused date, accepted, needs-kind, conflicting)
// → confirm → list → answer yes → interview get/answer x3/record → gifts →
// acknowledge → plans propose/confirm/list → conflict resolve → sweep → state →
// remove (confirmed:false then true). Not a hand-written guess at the shape.

import { describe, expect, test } from "bun:test";
import { HttpError } from "../src/ui/lib/http.ts";
import {
  APP_PROFILE_AUTHORITY,
  APP_PROFILE_SURFACE,
} from "../src/ui/views/settings/owner-profile.ts";
import { pollWhileVisible } from "../src/ui/views/dates/use-view-visible.ts";
import {
  CONFIRM_UNVERIFIED_NOTE,
  DATES_ENTRY_UTTERANCE,
  DATES_POLL_MS,
  answerLabel,
  answerTone,
  buildOccasionConfirmInput,
  buildOccasionProposeInput,
  buildOccasionRemoveInput,
  buildPlanConfirmInput,
  buildPlanProposeInput,
  conflictResolutionNote,
  datesRefusal,
  daysUntilLabel,
  declaredDateText,
  draftOccasionId,
  duplicateWriteRefusal,
  findExistingOccasion,
  formatDateOnly,
  formatEpoch,
  housekeepingNote,
  interviewAnsweredCount,
  interviewStage,
  kindLabel,
  occasionProposalIsCurrent,
  planProposalIsCurrent,
  parseAcknowledgeOutcome,
  parseAnswerOutcome,
  parseConflictResolution,
  parseGiftHistory,
  parseInterviewEnvelope,
  parseOccasionsList,
  parseOccasionsState,
  parsePending,
  parsePlansList,
  parseProposal,
  parseSweepReport,
  parseWriteOutcome,
  pendingIsEmpty,
  proximityTone,
  subjectLabel,
  sweepHoldNote,
  sweepOutcomeNote,
  type OccasionDraft,
  type PlanDraft,
} from "../src/ui/views/dates/dates-data.ts";

// ─── Live captures ───────────────────────────────────────────────────────────

const LIVE_LIST_EMPTY = {
  today: "2026-08-21",
  timezone: "",
  occasions: [],
  unparsed: [],
  conflicts: [],
};

const LIVE_LIST_WITH_CONFLICT = {
  today: "2026-08-21",
  timezone: "",
  occasions: [
    {
      occasion: {
        id: "robin birthday",
        title: "Robin birthday",
        date: { kind: "recurring", month: 8, day: 27 },
        recurrence: "annual",
        kind: "gift-giving",
        person: "Robin",
        selfDeclared: false,
        subject: "other",
        leadDays: 14,
        mirrored: false,
        extras: [],
        lineIndex: 2,
        text: "Robin birthday · 08-27 · annual · gift-giving · for Robin · lead 14",
      },
      nextOccurrence: "2026-08-27",
      daysUntil: 6,
      leadDays: 14,
      inLeadWindow: true,
      answer: "acknowledged",
      mirrored: false,
    },
  ],
  unparsed: [],
  conflicts: [
    {
      occasionId: "robin birthday",
      title: "Robin birthday",
      dates: ["08-27", "09-02"],
      lineIndexes: [2, 3],
    },
  ],
};

const LIVE_PROPOSE_REFUSED = {
  ok: false,
  reason: '"August 27" is not a date I can read. Write it as MM-DD for something annual, or YYYY-MM-DD.',
  line: "",
  confirmation: "",
  needsKind: false,
  conflictsWith: [],
};

const LIVE_PROPOSE_NEEDS_KIND = {
  ok: true,
  reason: null,
  line: "Sam birthday · 09-03 · annual · remember-only · for Sam",
  confirmation:
    "Noted Sam birthday as 09-03 — right? And is that one you'll want to sort something for, one to just remember, or neither?",
  needsKind: true,
  conflictsWith: [],
};

const LIVE_PROPOSE_CONFLICTING = {
  ok: true,
  reason: null,
  line: "Robin birthday · 09-02 · annual · gift-giving · for Robin",
  confirmation: "Noted Robin birthday as 09-02 — right?",
  needsKind: false,
  conflictsWith: ["08-27"],
};

const LIVE_CONFIRM = {
  ok: true,
  reason: null,
  occasionId: "robin birthday",
  disclosure: "Noted — saved a note under Important dates to your profile.",
  droppedRecords: 0,
};

const LIVE_REMOVE_UNCONFIRMED = {
  ok: false,
  reason: "Removing this drops the date and everything recorded against it. Confirm to go ahead.",
  occasionId: "throwaway day",
  disclosure: "",
  droppedRecords: 0,
};

const LIVE_ANSWER_YES = {
  ok: true,
  reason: null,
  interview: {
    interviewId: "interview:robin birthday@2026-08-27",
    occasionId: "robin birthday",
    occurrence: "2026-08-27",
    steps: [
      { id: "direction", prompt: "What has Robin been into lately?", opensFrom: "" },
      { id: "contrast", prompt: "Something to keep, or something to do together?", opensFrom: "" },
      { id: "budget", prompt: "Roughly what are you looking to spend?", opensFrom: "" },
    ],
    nextStep: { id: "direction", prompt: "What has Robin been into lately?", opensFrom: "" },
    complete: false,
    landedOn: null,
  },
};

// After the third answer: every question is answered, nextStep is null, and
// `complete` is STILL false. This is the state the whole flow turns on.
const LIVE_INTERVIEW_AWAITING_OUTCOME = {
  present: true,
  interview: {
    ...LIVE_ANSWER_YES.interview,
    nextStep: null,
    complete: false,
    landedOn: null,
  },
};

const LIVE_INTERVIEW_RECORDED = {
  present: true,
  interview: {
    ...LIVE_ANSWER_YES.interview,
    nextStep: null,
    complete: true,
    landedOn: "A weekend pottery class for two",
  },
};

const LIVE_INTERVIEW_MID = {
  present: true,
  interview: {
    ...LIVE_ANSWER_YES.interview,
    nextStep: { id: "contrast", prompt: "Something to keep, or something to do together?", opensFrom: "" },
    complete: false,
    landedOn: null,
  },
};

const LIVE_GIFTS = {
  occasionId: "robin birthday",
  gifts: [
    {
      occasionId: "robin birthday",
      occurrence: "2026-08-27",
      recordedAt: 1787279104679,
      landedOn: "A weekend pottery class for two",
      notes: "Pottery and long walks · Something to do together · Around 80",
    },
  ],
};

const LIVE_ACKNOWLEDGE = {
  ok: true,
  reason: null,
  reply:
    "Noted — you have Robin birthday in hand, so I will stop raising it. It stays on your dates and I will still answer if you ask about it. Nothing else has changed; your other dates are unaffected.",
};

const LIVE_PENDING_ACKNOWLEDGED = {
  today: "2026-08-21",
  nudge: null,
  acknowledged: [
    {
      occasionId: "robin birthday",
      title: "Robin birthday",
      person: "Robin",
      kind: "gift-giving",
      proximity: "approaching",
      subject: "other",
      acknowledged: true,
    },
  ],
  conflicts: [],
  interviews: [],
};

// Captured after widening occasions.activeHours to 00:00-23:59 and sweeping,
// so a nudge was actually raised instead of held.
const LIVE_PENDING_WITH_NUDGE = {
  today: "2026-08-21",
  nudge: {
    id: "occasions-pending-2026-08-21",
    raisedAt: 1787279955951,
    subjects: [
      {
        occasionId: "jordan birthday",
        title: "Jordan birthday",
        person: "Jordan",
        kind: "gift-giving",
        proximity: "soon",
        subject: "other",
        acknowledged: false,
      },
    ],
    message: "Jordan birthday is coming up soon. Do you want to sort something for it?",
    answerable: true,
  },
  conflicts: [
    {
      occasionId: "robin birthday",
      message:
        "Your profile has 2 different dates recorded for Robin birthday. Nothing has been changed — which one is right?",
    },
  ],
  acknowledged: [LIVE_PENDING_ACKNOWLEDGED.acknowledged[0]],
  interviews: [],
};

// The same sweep, which raised the nudge AND reported the one configured
// destination going quiet with the daemon's own failure text.
const LIVE_SWEEP_RAISED_UNDELIVERED = {
  ranAt: 1787279939419,
  today: "2026-08-21",
  hold: null,
  nudge: LIVE_PENDING_WITH_NUDGE.nudge,
  conflictMessages: [
    "Your profile has 2 different dates recorded for Robin birthday. Nothing has been changed — which one is right?",
  ],
  resumedInterviews: [],
  delivered: false,
  deliveryChannel: "telegram",
  deliveryId: null,
  deliveries: [{ channel: "telegram", delivered: false, deliveryId: null, failure: "Missing Telegram bot token" }],
  mirrored: 0,
  housekeeping: {
    sweptAt: 1787279939419,
    expiredAcknowledgements: 0,
    orphanedRecords: 0,
    expiredOpenItems: 0,
    agedGiftRecords: 0,
    droppedInterviews: 0,
    staleMirrors: 0,
  },
};

const LIVE_PENDING_EMPTY = {
  today: "2026-08-21",
  nudge: null,
  acknowledged: [],
  conflicts: [],
  interviews: [],
};

const LIVE_PLANS = {
  today: "2026-08-21",
  plans: [
    {
      id: "lisbon trip",
      title: "Lisbon trip",
      from: "2026-09-10",
      to: "2026-09-18",
      away: true,
      destination: "Lisbon",
      extras: [],
      lineIndex: 6,
      text: "Lisbon trip · 2026-09-10..2026-09-18 · away · in Lisbon",
    },
  ],
  unparsed: [],
  awayNow: null,
};

const LIVE_SWEEP_QUIET_HOURS = {
  ranAt: 1787279129581,
  today: "2026-08-21",
  hold: "quiet-hours",
  nudge: null,
  conflictMessages: [],
  resumedInterviews: [],
  delivered: false,
  deliveryChannel: "",
  deliveryId: null,
  deliveries: [],
  mirrored: 0,
  housekeeping: {
    sweptAt: 1787279129581,
    expiredAcknowledgements: 0,
    orphanedRecords: 0,
    expiredOpenItems: 0,
    agedGiftRecords: 0,
    droppedInterviews: 0,
    staleMirrors: 0,
  },
};

const LIVE_STATE = {
  path: "/tmp/scratch/.goodvibes/tui/control-plane/occasions-state.json",
  acknowledgements: 1,
  giftRecords: 1,
  openItems: 1,
  interviews: 1,
  mirrors: 0,
  lastSweep: LIVE_SWEEP_QUIET_HOURS.housekeeping,
  reconciledOpenItems: 0,
  corruption: null,
};

const LIVE_CONFLICT_UNRESOLVED = { occasionId: "robin birthday", resolved: false };

// ─── occasions.list ──────────────────────────────────────────────────────────

describe("parseOccasionsList", () => {
  test("reads an empty profile without inventing rows", () => {
    const parsed = parseOccasionsList(LIVE_LIST_EMPTY);
    expect(parsed.today).toBe("2026-08-21");
    expect(parsed.timezone).toBe("");
    expect(parsed.occasions).toEqual([]);
    expect(parsed.conflicts).toEqual([]);
  });

  test("flattens the nested occasion view and keeps the server's countdown", () => {
    const row = parseOccasionsList(LIVE_LIST_WITH_CONFLICT).occasions[0];
    expect(row?.id).toBe("robin birthday");
    expect(row?.title).toBe("Robin birthday");
    expect(row?.person).toBe("Robin");
    expect(row?.kind).toBe("gift-giving");
    expect(row?.subject).toBe("other");
    expect(row?.dateKind).toBe("recurring");
    expect(row?.dateYear).toBeNull();
    expect(row?.dateMonth).toBe(8);
    expect(row?.dateDay).toBe(27);
    expect(row?.nextOccurrence).toBe("2026-08-27");
    expect(row?.daysUntil).toBe(6);
    expect(row?.leadDays).toBe(14);
    expect(row?.declaredLeadDays).toBe(14);
    expect(row?.inLeadWindow).toBe(true);
    expect(row?.answer).toBe("acknowledged");
    expect(row?.mirrored).toBe(false);
    expect(row?.lineIndex).toBe(2);
  });

  test("carries the two-dates conflict rather than picking one", () => {
    const conflict = parseOccasionsList(LIVE_LIST_WITH_CONFLICT).conflicts[0];
    expect(conflict?.occasionId).toBe("robin birthday");
    expect(conflict?.dates).toEqual(["08-27", "09-02"]);
    expect(conflict?.lineIndexes).toEqual([2, 3]);
  });

  test("reports unparsed lines verbatim with the daemon's reason", () => {
    const parsed = parseOccasionsList({
      ...LIVE_LIST_EMPTY,
      unparsed: [{ lineIndex: 4, text: "mums bday sometime in may", reason: "no date I can read" }],
    });
    expect(parsed.unparsed).toEqual([
      { lineIndex: 4, text: "mums bday sometime in may", reason: "no date I can read" },
    ]);
  });

  test("an unknown answer value degrades to null rather than leaking through", () => {
    const parsed = parseOccasionsList({
      ...LIVE_LIST_EMPTY,
      occasions: [{ ...LIVE_LIST_WITH_CONFLICT.occasions[0], answer: "maybe" }],
    });
    expect(parsed.occasions[0]?.answer).toBeNull();
  });

  test("survives hostile shapes", () => {
    for (const value of [null, undefined, 42, "text", [], { occasions: "no" }]) {
      const parsed = parseOccasionsList(value);
      expect(parsed.occasions).toEqual([]);
      expect(parsed.unparsed).toEqual([]);
      expect(parsed.conflicts).toEqual([]);
    }
  });
});

// ─── propose / confirm / remove ──────────────────────────────────────────────

describe("parseProposal", () => {
  test("keeps a refusal's own words, which carry the fix", () => {
    const parsed = parseProposal(LIVE_PROPOSE_REFUSED);
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe(
      '"August 27" is not a date I can read. Write it as MM-DD for something annual, or YYYY-MM-DD.',
    );
    expect(parsed.confirmation).toBe("");
  });

  test("carries needsKind and the confirmation that asks for it", () => {
    const parsed = parseProposal(LIVE_PROPOSE_NEEDS_KIND);
    expect(parsed.ok).toBe(true);
    expect(parsed.needsKind).toBe(true);
    expect(parsed.reason).toBeNull();
    expect(parsed.confirmation).toContain("one to just remember, or neither?");
  });

  test("carries the date already recorded that disagrees", () => {
    expect(parseProposal(LIVE_PROPOSE_CONFLICTING).conflictsWith).toEqual(["08-27"]);
  });

  test("drops non-string entries from conflictsWith", () => {
    expect(parseProposal({ conflictsWith: ["08-27", 902, null] }).conflictsWith).toEqual(["08-27"]);
  });
});

describe("parseWriteOutcome", () => {
  test("reads a successful confirm", () => {
    const parsed = parseWriteOutcome(LIVE_CONFIRM);
    expect(parsed.ok).toBe(true);
    expect(parsed.occasionId).toBe("robin birthday");
    expect(parsed.disclosure).toBe("Noted — saved a note under Important dates to your profile.");
    expect(parsed.droppedRecords).toBe(0);
  });

  test("a confirmed:false removal is a sentence to put to the owner, not an error", () => {
    const parsed = parseWriteOutcome(LIVE_REMOVE_UNCONFIRMED);
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe(
      "Removing this drops the date and everything recorded against it. Confirm to go ahead.",
    );
  });
});

// ─── answer + interview ──────────────────────────────────────────────────────

describe("parseAnswerOutcome", () => {
  test("a yes on a gift-giving occasion returns the interview's first question", () => {
    const parsed = parseAnswerOutcome(LIVE_ANSWER_YES);
    expect(parsed.ok).toBe(true);
    expect(parsed.interview?.interviewId).toBe("interview:robin birthday@2026-08-27");
    expect(parsed.interview?.steps).toHaveLength(3);
    expect(parsed.interview?.nextStep?.id).toBe("direction");
    expect(parsed.interview?.complete).toBe(false);
  });

  test("a no carries no interview", () => {
    const parsed = parseAnswerOutcome({ ok: true, reason: null, interview: null });
    expect(parsed.interview).toBeNull();
  });
});

describe("interviewStage", () => {
  test("asking while a next step is outstanding", () => {
    const interview = parseInterviewEnvelope(LIVE_INTERVIEW_MID).interview;
    expect(interview).not.toBeNull();
    if (interview) {
      expect(interviewStage(interview)).toBe("asking");
      expect(interviewAnsweredCount(interview)).toBe(1);
    }
  });

  test("awaiting-outcome once every question is answered and complete is still false", () => {
    // The state the whole card flow turns on: reading `complete` alone would
    // render nothing at exactly the moment the one question that matters is due.
    const interview = parseInterviewEnvelope(LIVE_INTERVIEW_AWAITING_OUTCOME).interview;
    expect(interview).not.toBeNull();
    if (interview) {
      expect(interview.complete).toBe(false);
      expect(interview.nextStep).toBeNull();
      expect(interviewStage(interview)).toBe("awaiting-outcome");
      expect(interviewAnsweredCount(interview)).toBe(3);
    }
  });

  test("recorded once the outcome is written", () => {
    const interview = parseInterviewEnvelope(LIVE_INTERVIEW_RECORDED).interview;
    expect(interview).not.toBeNull();
    if (interview) {
      expect(interviewStage(interview)).toBe("recorded");
      expect(interview.landedOn).toBe("A weekend pottery class for two");
    }
  });

  test("present:false is an answer, not a parse failure", () => {
    const parsed = parseInterviewEnvelope({ present: false, interview: null });
    expect(parsed.present).toBe(false);
    expect(parsed.interview).toBeNull();
  });
});

// ─── gifts ───────────────────────────────────────────────────────────────────

describe("parseGiftHistory", () => {
  test("reads a record written by closing an interview", () => {
    const parsed = parseGiftHistory(LIVE_GIFTS);
    expect(parsed.occasionId).toBe("robin birthday");
    expect(parsed.gifts).toHaveLength(1);
    expect(parsed.gifts[0]?.occurrence).toBe("2026-08-27");
    expect(parsed.gifts[0]?.landedOn).toBe("A weekend pottery class for two");
    expect(parsed.gifts[0]?.notes).toBe("Pottery and long walks · Something to do together · Around 80");
    expect(parsed.gifts[0]?.recordedAt).toBe(1787279104679);
  });

  test("notes is optional on the wire and reads as empty", () => {
    const parsed = parseGiftHistory({
      occasionId: "x",
      gifts: [{ occasionId: "x", occurrence: "2025-01-01", recordedAt: 1, landedOn: "a book" }],
    });
    expect(parsed.gifts[0]?.notes).toBe("");
  });
});

// ─── acknowledge ─────────────────────────────────────────────────────────────

describe("parseAcknowledgeOutcome", () => {
  test("carries the daemon's reply verbatim, including what did NOT change", () => {
    const parsed = parseAcknowledgeOutcome(LIVE_ACKNOWLEDGE);
    expect(parsed.ok).toBe(true);
    expect(parsed.reply).toContain("It stays on your dates");
    expect(parsed.reply).toContain("your other dates are unaffected");
  });
});

// ─── pending ─────────────────────────────────────────────────────────────────

describe("parsePending", () => {
  test("an acknowledged occasion is still enumerable, under acknowledged[]", () => {
    const parsed = parsePending(LIVE_PENDING_ACKNOWLEDGED);
    expect(parsed.nudge).toBeNull();
    expect(parsed.acknowledged).toHaveLength(1);
    expect(parsed.acknowledged[0]?.proximity).toBe("approaching");
    expect(parsed.acknowledged[0]?.acknowledged).toBe(true);
    expect(pendingIsEmpty(parsed)).toBe(false);
  });

  test("nothing outstanding at all", () => {
    expect(pendingIsEmpty(parsePending(LIVE_PENDING_EMPTY))).toBe(true);
  });

  test("a raised nudge carries the person and a proximity word, and no date anywhere", () => {
    const parsed = parsePending(LIVE_PENDING_WITH_NUDGE);
    expect(parsed.nudge?.answerable).toBe(true);
    expect(parsed.nudge?.subjects[0]?.person).toBe("Jordan");
    expect(parsed.nudge?.subjects[0]?.proximity).toBe("soon");
    expect(parsed.nudge?.message).toBe("Jordan birthday is coming up soon. Do you want to sort something for it?");
    // The whole point of the pull path: a SUBJECT carries the occasion and the
    // person and no date, no countdown and no occurrence. (The nudge's own id
    // is stamped with today, which is its identity for the day, not a subject's
    // date, so the assertion is scoped to the subjects.)
    expect(JSON.stringify(parsed.nudge?.subjects)).not.toContain("2026");
    for (const subject of parsed.nudge?.subjects ?? []) {
      expect(Object.keys(subject).sort()).toEqual([
        "acknowledged",
        "kind",
        "occasionId",
        "person",
        "proximity",
        "subject",
        "title",
      ]);
    }
  });

  test("an open conflict arrives as a pre-built message rather than two dates", () => {
    const parsed = parsePending(LIVE_PENDING_WITH_NUDGE);
    expect(parsed.conflicts[0]?.occasionId).toBe("robin birthday");
    expect(parsed.conflicts[0]?.message).toContain("Nothing has been changed");
  });

  test("interviews left mid-thread come back as bare records with no present wrapper", () => {
    const parsed = parsePending({ ...LIVE_PENDING_EMPTY, interviews: [LIVE_INTERVIEW_MID.interview] });
    expect(parsed.interviews).toHaveLength(1);
    expect(parsed.interviews[0]?.interviewId).toBe("interview:robin birthday@2026-08-27");
    expect(parsed.interviews[0]?.nextStep?.id).toBe("contrast");
  });
});

// ─── plans ───────────────────────────────────────────────────────────────────

describe("parsePlansList", () => {
  test("reads a confirmed away plan", () => {
    const parsed = parsePlansList(LIVE_PLANS);
    expect(parsed.plans).toHaveLength(1);
    expect(parsed.plans[0]?.away).toBe(true);
    expect(parsed.plans[0]?.destination).toBe("Lisbon");
    expect(parsed.plans[0]?.from).toBe("2026-09-10");
    expect(parsed.awayNow).toBeNull();
  });

  test("awayNow parses into the same row shape when set", () => {
    const parsed = parsePlansList({ ...LIVE_PLANS, awayNow: LIVE_PLANS.plans[0] });
    expect(parsed.awayNow?.id).toBe("lisbon trip");
    expect(parsed.awayNow?.away).toBe(true);
  });
});

// ─── conflict resolve ────────────────────────────────────────────────────────

describe("conflict resolution", () => {
  test("resolved:false is reported as nothing-was-being-raised, not a failure", () => {
    const parsed = parseConflictResolution(LIVE_CONFLICT_UNRESOLVED);
    expect(parsed.resolved).toBe(false);
    const note = conflictResolutionNote(parsed);
    expect(note).toContain("Nothing was being raised");
    expect(note).toContain("still both on your profile");
  });

  test("resolved:true says the dates are still both on the profile", () => {
    const note = conflictResolutionNote({ occasionId: "x", resolved: true });
    expect(note).toContain("will not be raised again");
    expect(note).toContain("only you can say which was right");
  });
});

// ─── sweep ───────────────────────────────────────────────────────────────────

describe("parseSweepReport", () => {
  test("a quiet-hours hold is a deliberate silence with housekeeping still done", () => {
    const parsed = parseSweepReport(LIVE_SWEEP_QUIET_HOURS);
    expect(parsed.hold).toBe("quiet-hours");
    expect(parsed.delivered).toBe(false);
    expect(parsed.housekeeping).not.toBeNull();
    const note = sweepOutcomeNote(parsed);
    expect(note).toContain("occasions.activeHours");
    expect(note).toContain("Nothing was dropped");
  });

  test("a disabled hold names the config key that switched raising off", () => {
    expect(sweepHoldNote("disabled")).toContain("occasions.enabled");
    expect(sweepHoldNote("disabled")).toContain("still listed here");
  });

  test("an unrecognised hold is quoted rather than guessed at", () => {
    expect(sweepHoldNote("some-future-hold")).toContain('"some-future-hold"');
  });

  test("a delivered sweep names the destination", () => {
    const parsed = parseSweepReport({
      ...LIVE_SWEEP_QUIET_HOURS,
      hold: null,
      delivered: true,
      deliveryChannel: "telegram",
      deliveries: [{ channel: "telegram", delivered: true, deliveryId: "d-1", failure: null }],
    });
    expect(sweepOutcomeNote(parsed)).toBe("Delivered to telegram.");
    expect(parsed.deliveries[0]?.deliveryId).toBe("d-1");
  });

  test("a per-destination failure is kept, so a channel gone quiet is nameable", () => {
    const parsed = parseSweepReport(LIVE_SWEEP_RAISED_UNDELIVERED);
    expect(parsed.hold).toBeNull();
    expect(parsed.nudge?.subjects[0]?.title).toBe("Jordan birthday");
    expect(parsed.deliveries[0]?.channel).toBe("telegram");
    expect(parsed.deliveries[0]?.delivered).toBe(false);
    expect(parsed.deliveries[0]?.failure).toBe("Missing Telegram bot token");
    // Raised but nowhere to land is NOT reported as delivered.
    expect(sweepOutcomeNote(parsed)).toBe("Raised a nudge but no destination took it.");
  });

  test("conflicts the sweep re-raised come through as the daemon's own sentences", () => {
    const parsed = parseSweepReport(LIVE_SWEEP_RAISED_UNDELIVERED);
    expect(parsed.conflictMessages[0]).toContain("Nothing has been changed");
  });

  test("nothing to raise reads as exactly that", () => {
    expect(sweepOutcomeNote(parseSweepReport({ ...LIVE_SWEEP_QUIET_HOURS, hold: null }))).toBe(
      "Ran with nothing to raise.",
    );
  });
});

describe("housekeepingNote", () => {
  test("an empty pass says so instead of listing zeros", () => {
    expect(housekeepingNote(parseSweepReport(LIVE_SWEEP_QUIET_HOURS).housekeeping!)).toBe(
      "Housekeeping ran and found nothing to reap.",
    );
  });

  test("only what was actually reaped is named", () => {
    const note = housekeepingNote({
      sweptAt: 1,
      expiredAcknowledgements: 2,
      orphanedRecords: 0,
      expiredOpenItems: 1,
      agedGiftRecords: 0,
      droppedInterviews: 0,
      staleMirrors: 0,
    });
    expect(note).toContain("2 expired acknowledgement(s)");
    expect(note).toContain("1 expired open item(s)");
    expect(note).not.toContain("orphaned");
  });
});

// ─── state ───────────────────────────────────────────────────────────────────

describe("parseOccasionsState", () => {
  test("reads counts, the store path, and the last housekeeping pass", () => {
    const parsed = parseOccasionsState(LIVE_STATE);
    expect(parsed.acknowledgements).toBe(1);
    expect(parsed.giftRecords).toBe(1);
    expect(parsed.openItems).toBe(1);
    expect(parsed.interviews).toBe(1);
    expect(parsed.mirrors).toBe(0);
    expect(parsed.reconciledOpenItems).toBe(0);
    expect(parsed.corruption).toBeNull();
    expect(parsed.lastSweep?.sweptAt).toBe(1787279129581);
  });

  test("carries a corruption reason when the file was unreadable", () => {
    expect(parseOccasionsState({ ...LIVE_STATE, corruption: "unparseable json" }).corruption).toBe(
      "unparseable json",
    );
  });
});

// ─── formatters ──────────────────────────────────────────────────────────────

describe("daysUntilLabel", () => {
  test("reads the server's count and never derives one", () => {
    expect(daysUntilLabel(null)).toBe("—");
    expect(daysUntilLabel(0)).toBe("Today");
    expect(daysUntilLabel(1)).toBe("Tomorrow");
    expect(daysUntilLabel(6)).toBe("in 6 days");
    expect(daysUntilLabel(-3)).toBe("3 days ago");
  });
});

describe("formatDateOnly", () => {
  test("null reads as an em dash, not as an epoch", () => {
    expect(formatDateOnly(null)).toBe("—");
  });

  test("an unparseable value is shown exactly as it arrived", () => {
    expect(formatDateOnly("sometime in may")).toBe("sometime in may");
  });

  test("a real ISO date renders as a date", () => {
    expect(formatDateOnly("2026-08-27")).not.toBe("2026-08-27");
    expect(formatDateOnly("2026-08-27")).not.toContain("Invalid");
  });
});

describe("formatEpoch", () => {
  test("zero means never recorded", () => {
    expect(formatEpoch(0)).toBe("—");
  });
});

describe("declaredDateText", () => {
  test("a recurring date round-trips as zero-padded MM-DD", () => {
    expect(declaredDateText({ dateKind: "recurring", dateYear: null, dateMonth: 8, dateDay: 27 })).toBe("08-27");
    expect(declaredDateText({ dateKind: "recurring", dateYear: null, dateMonth: 1, dateDay: 3 })).toBe("01-03");
  });

  test("a dated one carries its year", () => {
    expect(declaredDateText({ dateKind: "dated", dateYear: 2026, dateMonth: 9, dateDay: 1 })).toBe("2026-09-01");
  });

  test("an absent month or day yields nothing rather than a half date", () => {
    expect(declaredDateText({ dateKind: "recurring", dateYear: null, dateMonth: null, dateDay: 27 })).toBe("");
  });
});

describe("labels and tones", () => {
  test("kinds read in the daemon's own vocabulary", () => {
    expect(kindLabel("gift-giving")).toBe("Gift-giving");
    expect(kindLabel("remember-only")).toBe("Remember only");
    expect(kindLabel("")).toBe("unstated");
  });

  test("later is not a decline, so it does not read as one", () => {
    expect(answerLabel("later")).toBe("Later");
    expect(answerTone("later")).toBe("neutral");
    expect(answerTone("no")).toBe("neutral");
    expect(answerTone("yes")).toBe("ok");
  });

  test("acknowledged reads as in hand", () => {
    expect(answerLabel("acknowledged")).toBe("In hand");
  });

  test("proximity words map to tones without becoming counts", () => {
    expect(proximityTone("imminent")).toBe("bad");
    expect(proximityTone("soon")).toBe("warning");
    expect(proximityTone("approaching")).toBe("neutral");
  });

  test("unattributed is a real state, not a missing value", () => {
    expect(subjectLabel("unattributed")).toBe("No one named");
    expect(subjectLabel("owner")).toBe("Yours");
    expect(subjectLabel("other")).toBe("Someone else's");
  });
});

// ─── refusal triage ──────────────────────────────────────────────────────────

describe("datesRefusal", () => {
  test("404 METHOD_NOT_FOUND is a missing capability", () => {
    const error = new HttpError(
      404,
      "/api/occasions",
      JSON.stringify({ error: "Unknown gateway method", code: "METHOD_NOT_FOUND" }),
    );
    expect(datesRefusal(error, "occasions.list")?.capability).toBe("occasions.list");
  });

  test("501 NOT_INVOKABLE gets the same treatment", () => {
    const error = new HttpError(501, "/api/occasions", JSON.stringify({ error: "not invokable" }));
    expect(datesRefusal(error, "occasions.list")).not.toBeNull();
  });

  test("a genuine 500 is NOT triaged as unavailable", () => {
    const error = new HttpError(500, "/api/occasions", JSON.stringify({ error: "boom" }));
    expect(datesRefusal(error, "occasions.list")).toBeNull();
  });

  test("no error is no refusal", () => {
    expect(datesRefusal(null, "occasions.list")).toBeNull();
  });
});

// ─── write inputs ────────────────────────────────────────────────────────────

const FULL_DRAFT: OccasionDraft = {
  title: "  Robin birthday  ",
  date: " 08-27 ",
  kind: "gift-giving",
  person: " Robin ",
  recurrence: "annual",
  leadDays: "14",
};

describe("buildOccasionProposeInput", () => {
  test("trims and carries every stated field", () => {
    expect(buildOccasionProposeInput(FULL_DRAFT)).toEqual({
      title: "Robin birthday",
      date: "08-27",
      kind: "gift-giving",
      person: "Robin",
      recurrence: "annual",
      leadDays: 14,
    });
  });

  test("an unstated kind is left OFF the body, which is what makes needsKind fire", () => {
    const body = buildOccasionProposeInput({ ...FULL_DRAFT, kind: "" });
    expect("kind" in body).toBe(false);
  });

  test("an unstated person and lead are omitted rather than sent empty", () => {
    const body = buildOccasionProposeInput({ ...FULL_DRAFT, person: "  ", leadDays: "" });
    expect("person" in body).toBe(false);
    expect("leadDays" in body).toBe(false);
  });

  test("leadDays 0 is kept: the day itself is not the same as unstated", () => {
    expect(buildOccasionProposeInput({ ...FULL_DRAFT, leadDays: "0" })["leadDays"]).toBe(0);
  });

  test("a non-numeric lead is dropped rather than sent as NaN", () => {
    const body = buildOccasionProposeInput({ ...FULL_DRAFT, leadDays: "soon" });
    expect("leadDays" in body).toBe(false);
  });
});

describe("buildOccasionConfirmInput", () => {
  test("carries the owner-profile write gate: surface, a said, and authority", () => {
    const body = buildOccasionConfirmInput(FULL_DRAFT, "gift-giving");
    expect(body["surface"]).toBe(APP_PROFILE_SURFACE);
    expect(body["authority"]).toBe(APP_PROFILE_AUTHORITY);
    expect(body["said"]).toBe(DATES_ENTRY_UTTERANCE);
  });

  test("the said names this app rather than inventing a sentence the owner never spoke", () => {
    expect(DATES_ENTRY_UTTERANCE).toContain("GoodVibes desktop app");
    expect(DATES_ENTRY_UTTERANCE).toContain("entered");
  });

  test("the chosen kind wins over an empty draft kind", () => {
    expect(buildOccasionConfirmInput({ ...FULL_DRAFT, kind: "" }, "remember-only")["kind"]).toBe("remember-only");
  });
});

describe("buildOccasionRemoveInput", () => {
  test("always states an authority, which the daemon 400s without", () => {
    expect(buildOccasionRemoveInput("robin birthday", false)).toEqual({
      occasionId: "robin birthday",
      confirmed: false,
      authority: APP_PROFILE_AUTHORITY,
    });
  });

  test("confirmed is passed through exactly, never defaulted to true", () => {
    expect(buildOccasionRemoveInput("x", true)["confirmed"]).toBe(true);
    expect(buildOccasionRemoveInput("x", false)["confirmed"]).toBe(false);
  });
});

const PLAN_DRAFT: PlanDraft = {
  title: " Lisbon trip ",
  from: " 2026-09-10 ",
  to: " 2026-09-18 ",
  away: true,
  destination: " Lisbon ",
};

// ─── Proposal freshness (every field, kind included) ─────────────────────────

describe("occasionProposalIsCurrent", () => {
  test("an untouched draft keeps its preview", () => {
    expect(occasionProposalIsCurrent(FULL_DRAFT, { ...FULL_DRAFT })).toBe(true);
  });

  // The regression this exists for: the kind radio was the one field whose
  // edit did not drop the standing preview, and the daemon renders kind INTO
  // the line, so the preview said "remember-only" while confirm wrote
  // "gift-giving". Freshness is now derived, so kind is not a special case.
  test("changing the kind invalidates the preview, exactly like every other field", () => {
    expect(occasionProposalIsCurrent(FULL_DRAFT, { ...FULL_DRAFT, kind: "remember-only" })).toBe(false);
  });

  test("every field of the draft invalidates the preview", () => {
    const edits: Array<[string, OccasionDraft]> = [
      ["title", { ...FULL_DRAFT, title: "Something else" }],
      ["date", { ...FULL_DRAFT, date: "09-01" }],
      ["kind", { ...FULL_DRAFT, kind: "neither" }],
      ["person", { ...FULL_DRAFT, person: "Someone else" }],
      ["recurrence", { ...FULL_DRAFT, recurrence: "once" }],
      ["leadDays", { ...FULL_DRAFT, leadDays: "3" }],
    ];
    for (const [field, edited] of edits) {
      expect({ field, current: occasionProposalIsCurrent(FULL_DRAFT, edited) }).toEqual({
        field,
        current: false,
      });
    }
  });

  test("clearing the kind invalidates too, since that is what makes needsKind fire", () => {
    expect(occasionProposalIsCurrent(FULL_DRAFT, { ...FULL_DRAFT, kind: "" })).toBe(false);
  });

  test("whitespace-only edits do NOT invalidate, because they change no wire field", () => {
    expect(occasionProposalIsCurrent(FULL_DRAFT, { ...FULL_DRAFT, title: "Robin birthday" })).toBe(true);
  });

  test("plan previews follow the same rule on every field", () => {
    expect(planProposalIsCurrent(PLAN_DRAFT, { ...PLAN_DRAFT })).toBe(true);
    for (const edited of [
      { ...PLAN_DRAFT, title: "Other" },
      { ...PLAN_DRAFT, from: "2026-09-11" },
      { ...PLAN_DRAFT, to: "2026-09-19" },
      { ...PLAN_DRAFT, away: false },
      { ...PLAN_DRAFT, destination: "Porto" },
    ]) {
      expect(planProposalIsCurrent(PLAN_DRAFT, edited)).toBe(false);
    }
  });
});

// ─── Duplicate-write guard ───────────────────────────────────────────────────

describe("findExistingOccasion", () => {
  const rows = parseOccasionsList(LIVE_LIST_WITH_CONFLICT).occasions;

  test("derives the id the daemon will key on: the title, folded down", () => {
    expect(draftOccasionId({ ...FULL_DRAFT, title: "  Jordan Birthday " })).toBe("jordan birthday");
  });

  test("finds the row a repeat confirm would duplicate", () => {
    const draft: OccasionDraft = { ...FULL_DRAFT, title: "Robin birthday", date: "08-27" };
    expect(findExistingOccasion(rows, draft)?.id).toBe("robin birthday");
  });

  test("matching ignores case and surrounding space, as the daemon's id rule does", () => {
    const draft: OccasionDraft = { ...FULL_DRAFT, title: "  ROBIN BIRTHDAY  ", date: "  08-27 " };
    expect(findExistingOccasion(rows, draft)).toBeDefined();
  });

  test("a different date for the same title is NOT a duplicate: that is a conflict, and the daemon owns it", () => {
    const draft: OccasionDraft = { ...FULL_DRAFT, title: "Robin birthday", date: "09-02" };
    expect(findExistingOccasion(rows, draft)).toBeUndefined();
  });

  test("a genuinely new date is not blocked", () => {
    const draft: OccasionDraft = { ...FULL_DRAFT, title: "Nobody birthday", date: "01-01" };
    expect(findExistingOccasion(rows, draft)).toBeUndefined();
  });

  test("an empty list blocks nothing", () => {
    expect(findExistingOccasion([], FULL_DRAFT)).toBeUndefined();
  });

  test("the refusal names the row and the line already on the profile", () => {
    const existing = rows[0];
    expect(existing).toBeDefined();
    if (existing) {
      const copy = duplicateWriteRefusal(existing);
      expect(copy).toContain("Robin birthday");
      expect(copy).toContain(existing.text);
      expect(copy).toContain("Nothing was written");
      // It has to say what to do instead, since the daemon's own removal
      // refuses once two identical lines exist.
      expect(copy).toContain("remove the existing one first");
    }
  });

  test("the unverified-write note keeps the typed values and demands a re-preview", () => {
    expect(CONFIRM_UNVERIFIED_NOTE).toContain("not known whether it landed");
    expect(CONFIRM_UNVERIFIED_NOTE).toContain("preview again");
  });
});

// ─── Poll gating for the keep-alive view ─────────────────────────────────────

describe("pollWhileVisible", () => {
  // Dates is keepAlive, so AppShell hides it with display:none and never
  // unmounts it. refetchInterval does not pause on an ancestor's display:none,
  // so without this gate four queries over personal data would poll forever
  // behind whatever the owner looked at next.
  test("polls at the view's cadence while it is on screen", () => {
    expect(pollWhileVisible(true, DATES_POLL_MS)).toBe(DATES_POLL_MS);
  });

  test("does not poll at all while hidden", () => {
    expect(pollWhileVisible(false, DATES_POLL_MS)).toBe(false);
  });
});

describe("plan write inputs", () => {
  test("propose trims and carries away as stated", () => {
    expect(buildPlanProposeInput(PLAN_DRAFT)).toEqual({
      title: "Lisbon trip",
      from: "2026-09-10",
      to: "2026-09-18",
      away: true,
      destination: "Lisbon",
    });
  });

  test("away:false is SENT rather than omitted: a dated range is not always leaving the house", () => {
    const body = buildPlanProposeInput({ ...PLAN_DRAFT, away: false });
    expect(body["away"]).toBe(false);
  });

  test("an unstated destination is omitted", () => {
    const body = buildPlanProposeInput({ ...PLAN_DRAFT, destination: "   " });
    expect("destination" in body).toBe(false);
  });

  test("confirm carries the same write gate as an occasion", () => {
    const body = buildPlanConfirmInput(PLAN_DRAFT);
    expect(body["surface"]).toBe(APP_PROFILE_SURFACE);
    expect(body["said"]).toBe(DATES_ENTRY_UTTERANCE);
    expect(body["authority"]).toBe(APP_PROFILE_AUTHORITY);
  });
});
