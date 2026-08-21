// Pure-logic coverage for src/ui/views/settings/owner-profile.ts.
//
// Every payload below is a VERBATIM capture from a scratch daemon
// (@pellux/goodvibes-daemon 1.28.19 / sdk 2.0.17) driven over its HTTP routes:
// profile.status and profile.read on an empty profile, then set → set again
// (supersede) → provenance → undo → append → get (present and absent) → forget
// (nothing to forget), plus the 400 the route returns for a surface outside its
// five-value enum.

import { describe, expect, test } from "bun:test";
import {
  APP_PROFILE_AUTHORITY,
  APP_PROFILE_SURFACE,
  STALE_VIEW_NOTE,
  buildProfileAppendInput,
  buildProfileForgetInput,
  buildProfileSetInput,
  buildProfileUndoInput,
  deletedWhat,
  forgetReportLine,
  mostRecentSupersededIndex,
  profileDisabledLine,
  profileStateBadgeTone,
  profileStateLabel,
  profileTargetId,
  profileUnavailableLine,
  provenanceSummary,
  readProfileDocument,
  readProfileFieldAnswer,
  readProfilePersonAnswer,
  readProfileProvenanceAnswer,
  readProfileStatus,
  readProfileWriteOutcome,
  sectionHoldsThirdPartyData,
  tierNote,
  writeReportLine,
} from "../src/ui/views/settings/owner-profile.ts";

const LIVE_STATUS_EMPTY = {
  kind: "loaded",
  path: "/tmp/scratch/.goodvibes/daemon/owner-profile.md",
  exists: false,
  lineCount: 1,
  fieldCount: 0,
  proseLineCount: 0,
  sections: [],
  invalidFields: [],
};

const LIVE_READ_POPULATED = {
  state: {
    kind: "loaded",
    path: "/tmp/scratch/.goodvibes/daemon/owner-profile.md",
    exists: true,
    lineCount: 4,
    fieldCount: 1,
    proseLineCount: 0,
    sections: ["Location"],
    invalidFields: [],
  },
  sections: [
    {
      heading: "Location",
      tier: "closed",
      fields: [
        {
          fieldId: "location.city",
          label: "city",
          value: "Detroit",
          valid: true,
          provenance: {
            surface: "hand-edit",
            date: "2026-08-21",
            said: "(edited in the GoodVibes desktop app)",
          },
        },
      ],
      prose: [],
    },
  ],
};

const LIVE_SET = {
  ok: true,
  reason: null,
  changes: [{ kind: "set", fieldId: "location.city", section: "Location", label: "city", superseded: false }],
  disclosure: "Noted — saved your city to your profile.",
};

const LIVE_SET_SUPERSEDING = {
  ...LIVE_SET,
  changes: [{ kind: "set", fieldId: "location.city", section: "Location", label: "city", superseded: true }],
};

const LIVE_PROVENANCE = {
  fieldId: "location.city",
  present: true,
  provenance: { surface: "hand-edit", date: "2026-08-21", said: "(edited in the GoodVibes desktop app)" },
  handEdited: false,
  superseded: [
    {
      lineIndex: 4,
      fieldId: "location.city",
      section: "Location",
      text: "city: Detroit",
      value: "Detroit",
      supersededOn: "2026-08-21",
      previousLine: 'city: Detroit — hand-edit, 2026-08-21, "(edited in the GoodVibes desktop app)"',
      provenance: { surface: "hand-edit", date: "2026-08-21", said: "(edited in the GoodVibes desktop app)" },
    },
  ],
};

const LIVE_UNDO = {
  ok: true,
  reason: null,
  changes: [{ kind: "undo", fieldId: "location.city", section: "Location", label: "city", superseded: false }],
  disclosure: "Noted — put your city back in your profile.",
};

const LIVE_APPEND = {
  ok: true,
  reason: null,
  changes: [{ kind: "append", fieldId: null, section: "Notes", label: "note", superseded: false }],
  disclosure: "Noted — saved a note under Notes to your profile.",
};

const LIVE_FORGET_NOTHING = {
  ok: false,
  reason: "Your profile has no phone recorded, so there was nothing to forget.",
  changes: [],
  disclosure: "",
};

describe("readProfileDocument", () => {
  test("the live populated read", () => {
    const document = readProfileDocument(LIVE_READ_POPULATED);
    expect(document?.state).toBe("loaded");
    expect(document?.path).toContain("owner-profile.md");
    expect(document?.sections).toHaveLength(1);
    const field = document?.sections[0]?.fields[0];
    expect(field?.fieldId).toBe("location.city");
    expect(field?.value).toBe("Detroit");
    expect(field?.valid).toBe(true);
    expect(field?.provenance?.surface).toBe("hand-edit");
  });

  test("a loaded, empty profile is loaded with no sections", () => {
    const document = readProfileDocument({ state: LIVE_STATUS_EMPTY, sections: [] });
    expect(document?.state).toBe("loaded");
    expect(document?.sections).toEqual([]);
  });

  test("an unreadable profile keeps its reason and renders NO sections", () => {
    // "I could not open the file" must never render as "I know nothing about
    // you", and content must never appear beneath the banner saying so.
    const document = readProfileDocument({
      state: { kind: "unavailable", path: "/tmp/p.md", reason: "EACCES: permission denied" },
      sections: LIVE_READ_POPULATED.sections,
    });
    expect(document?.state).toBe("unavailable");
    expect(document?.reason).toBe("EACCES: permission denied");
    expect(document?.sections).toEqual([]);
  });

  test("a disabled profile also renders no sections", () => {
    const document = readProfileDocument({
      state: { kind: "disabled", path: "/tmp/p.md" },
      sections: LIVE_READ_POPULATED.sections,
    });
    expect(document?.state).toBe("disabled");
    expect(document?.sections).toEqual([]);
  });

  test("a body that is not a profile is null, never an empty profile", () => {
    expect(readProfileDocument({})).toBeNull();
    expect(readProfileDocument(null)).toBeNull();
    expect(readProfileDocument({ state: { kind: "loaded" } })).toBeNull();
    expect(readProfileDocument({ state: { kind: "confused", path: "/tmp/p.md" } })).toBeNull();
  });

  test("an unrecognized tier reads as CLOSED, the containing direction", () => {
    const document = readProfileDocument({
      state: { kind: "loaded", path: "/tmp/p.md" },
      sections: [{ heading: "Somewhere", tier: "translucent", fields: [], prose: [] }],
    });
    expect(document?.sections[0]?.tier).toBe("closed");
  });

  test("an invalid field keeps its value AND its reason", () => {
    const document = readProfileDocument({
      state: { kind: "loaded", path: "/tmp/p.md" },
      sections: [
        {
          heading: "Commerce",
          tier: "closed",
          fields: [
            { fieldId: "commerce.currency", label: "currency", value: "dollars", valid: false, invalidReason: "expected a 3-letter ISO-4217 currency code" },
          ],
          prose: [],
        },
      ],
    });
    const field = document?.sections[0]?.fields[0];
    expect(field?.value).toBe("dollars");
    expect(field?.valid).toBe(false);
    expect(field?.invalidReason).toContain("ISO-4217");
  });

  test("prose lines keep their index, text and suffix", () => {
    const document = readProfileDocument({
      state: { kind: "loaded", path: "/tmp/p.md" },
      sections: [
        {
          heading: "Notes",
          tier: "closed",
          fields: [],
          prose: [
            { lineIndex: 7, section: "Notes", text: "Allergic to shellfish", provenance: { surface: "tui", date: "2026-08-01", said: "I am allergic to shellfish" } },
            { section: "Notes", text: "no index, dropped" },
          ],
        },
      ],
    });
    const prose = document?.sections[0]?.prose;
    expect(prose).toHaveLength(1);
    expect(prose?.[0]?.lineIndex).toBe(7);
    expect(prose?.[0]?.provenance?.surface).toBe("tui");
  });
});

describe("readProfileStatus", () => {
  test("the live empty-profile status", () => {
    const status = readProfileStatus(LIVE_STATUS_EMPTY);
    expect(status?.state).toBe("loaded");
    expect(status?.exists).toBe(false);
    expect(status?.lineCount).toBe(1);
    expect(status?.fieldCount).toBe(0);
    expect(status?.sections).toEqual([]);
    expect(status?.invalidFields).toEqual([]);
  });

  test("invalid fields arrive with their reasons", () => {
    const status = readProfileStatus({
      ...LIVE_STATUS_EMPTY,
      invalidFields: [{ fieldId: "commerce.currency", reason: "expected a 3-letter ISO-4217 currency code" }, { reason: "orphan" }],
    });
    expect(status?.invalidFields).toHaveLength(1);
    expect(status?.invalidFields[0]?.fieldId).toBe("commerce.currency");
  });

  test("no value property is ever produced, which is what makes this verb safe in a bundle", () => {
    const status = readProfileStatus({ ...LIVE_STATUS_EMPTY, value: "should not survive" });
    expect(JSON.stringify(status)).not.toContain("should not survive");
  });

  test("a body without a load state is null", () => {
    expect(readProfileStatus({})).toBeNull();
    expect(readProfileStatus({ kind: "loaded" })).toBeNull();
  });
});

describe("readProfileProvenanceAnswer", () => {
  test("the live provenance answer, with its superseded predecessor", () => {
    const answer = readProfileProvenanceAnswer(LIVE_PROVENANCE);
    expect(answer?.present).toBe(true);
    expect(answer?.handEdited).toBe(false);
    expect(answer?.provenance?.said).toBe("(edited in the GoodVibes desktop app)");
    expect(answer?.superseded).toHaveLength(1);
    expect(answer?.superseded[0]?.value).toBe("Detroit");
    expect(answer?.superseded[0]?.supersededOn).toBe("2026-08-21");
  });

  test("a hand-edited field carries an explicit null provenance, which is DATA", () => {
    const answer = readProfileProvenanceAnswer({
      fieldId: "identity.name",
      present: true,
      handEdited: true,
      provenance: null,
      superseded: [],
    });
    expect(answer).not.toBeNull();
    expect(answer?.handEdited).toBe(true);
    expect(answer?.provenance).toBeUndefined();
  });

  test("an absent field answers present:false rather than inventing a value", () => {
    const answer = readProfileProvenanceAnswer({
      fieldId: "contact.email",
      present: false,
      handEdited: false,
      provenance: null,
      superseded: [],
    });
    expect(answer?.present).toBe(false);
  });

  test("a body missing handEdited must not read as hand edited", () => {
    const answer = readProfileProvenanceAnswer({ fieldId: "x", present: true, superseded: [] });
    expect(answer?.handEdited).toBe(false);
  });

  test("a body that is not a provenance answer is null", () => {
    expect(readProfileProvenanceAnswer({})).toBeNull();
    expect(readProfileProvenanceAnswer({ fieldId: "x" })).toBeNull();
  });

  test("each entry keeps its lineIndex, which is what orders them", () => {
    const answer = readProfileProvenanceAnswer(LIVE_PROVENANCE);
    expect(answer?.superseded[0]?.lineIndex).toBe(4);
  });
});

describe("mostRecentSupersededIndex: which entry Undo restores", () => {
  // The wire carries no marker, and the list is NOT ordered by recency: the
  // parser walks the file top to bottom, so it arrives in ascending lineIndex.
  // The daemon picks differently, and this mirrors its rule exactly rather than
  // assuming the last entry wins. From the SDK's owner-profile/writer.ts,
  // mostRecentSuperseded sorts on supersededOn ascending, ties broken on
  // lineIndex ascending, then pops: latest date, and among equal dates the one
  // furthest down the document.
  function entry(value: string, supersededOn: string, lineIndex: number) {
    return { fieldId: "location.city", section: "Location", value, supersededOn, lineIndex };
  }

  test("nothing to undo", () => {
    expect(mostRecentSupersededIndex([])).toBe(-1);
  });

  test("a single entry is the one", () => {
    expect(mostRecentSupersededIndex([entry("Detroit", "2026-08-21", 4)])).toBe(0);
  });

  test("the latest DATE wins, even when it is not last in document order", () => {
    // A file the owner hand-edited: the newer correction sits above the older
    // one. Assuming "last element" here would restore the wrong value and the
    // panel would have labelled the wrong row.
    const entries = [entry("Newer", "2026-08-21", 3), entry("Older", "2026-01-01", 9)];
    expect(mostRecentSupersededIndex(entries)).toBe(0);
  });

  test("among equal dates, the one further down the document wins", () => {
    const entries = [entry("First", "2026-08-21", 4), entry("Second", "2026-08-21", 7)];
    expect(mostRecentSupersededIndex(entries)).toBe(1);
  });

  test("equal dates out of document order still pick the larger lineIndex", () => {
    const entries = [entry("Lower", "2026-08-21", 12), entry("Higher", "2026-08-21", 5)];
    expect(mostRecentSupersededIndex(entries)).toBe(0);
  });

  test("the live two-correction case: the second set is what Undo restores", () => {
    // Matches the sequence verified live (Detroit, then Ypsilanti, then undo
    // returned Ypsilanti).
    const entries = [entry("Detroit", "2026-08-21", 4), entry("Ypsilanti", "2026-08-21", 6)];
    const index = mostRecentSupersededIndex(entries);
    expect(index).toBe(1);
    expect(entries[index]?.value).toBe("Ypsilanti");
  });
});

describe("readProfileFieldAnswer", () => {
  test("the live present answer, including the section profile.read does not send", () => {
    const answer = readProfileFieldAnswer({
      fieldId: "location.city",
      present: true,
      field: {
        fieldId: "location.city",
        label: "city",
        value: "Ypsilanti",
        valid: true,
        section: "Location",
        provenance: { surface: "hand-edit", date: "2026-08-21", said: "(edited in the GoodVibes desktop app settings)" },
      },
      disclosure: "",
    });
    expect(answer?.present).toBe(true);
    expect(answer?.field?.value).toBe("Ypsilanti");
    expect(answer?.section).toBe("Location");
    expect(answer?.disclosure).toBe("");
  });

  test("the live absent answer carries no field at all", () => {
    const answer = readProfileFieldAnswer({ fieldId: "contact.email", present: false, disclosure: "" });
    expect(answer?.present).toBe(false);
    expect(answer?.field).toBeUndefined();
  });

  test("a closed-tier read carries the disclosure the owner would be shown", () => {
    const answer = readProfileFieldAnswer({
      fieldId: "commerce.shippingAddress",
      present: true,
      field: { fieldId: "commerce.shippingAddress", label: "shipping address", value: "1 Main St", valid: true, section: "Commerce" },
      disclosure: "Used your shipping address from your profile.",
    });
    expect(answer?.disclosure).toContain("shipping address");
  });

  test("a body that is not a field lookup is null", () => {
    expect(readProfileFieldAnswer({})).toBeNull();
    expect(readProfileFieldAnswer({ fieldId: "location.city" })).toBeNull();
  });
});

describe("readProfilePersonAnswer", () => {
  test("lines and disclosure", () => {
    const answer = readProfilePersonAnswer({
      name: "Sarah",
      lines: [{ lineIndex: 12, section: "People", text: "Sarah: sister, birthday 3 March" }],
      disclosure: "Used Sarah's details from your profile.",
    });
    expect(answer?.name).toBe("Sarah");
    expect(answer?.lines).toHaveLength(1);
    expect(answer?.disclosure).toContain("Sarah");
  });

  test("a name with no lines is an honest empty answer, not a null one", () => {
    const answer = readProfilePersonAnswer({ name: "Nobody", lines: [], disclosure: "" });
    expect(answer?.lines).toEqual([]);
    expect(answer?.disclosure).toBe("");
  });

  test("a body with no name is null", () => {
    expect(readProfilePersonAnswer({ lines: [] })).toBeNull();
  });
});

describe("readProfileWriteOutcome", () => {
  test("the live set, undo and append results", () => {
    expect(readProfileWriteOutcome(LIVE_SET)?.ok).toBe(true);
    expect(readProfileWriteOutcome(LIVE_SET)?.disclosure).toContain("saved your city");
    expect(readProfileWriteOutcome(LIVE_SET_SUPERSEDING)?.changes[0]?.superseded).toBe(true);
    expect(readProfileWriteOutcome(LIVE_UNDO)?.changes[0]?.kind).toBe("undo");
    // A section-level change names no field, and null is the wire's own answer.
    expect(readProfileWriteOutcome(LIVE_APPEND)?.changes[0]?.fieldId).toBeNull();
  });

  test("a refusal keeps the daemon's own sentence", () => {
    const outcome = readProfileWriteOutcome(LIVE_FORGET_NOTHING);
    expect(outcome?.ok).toBe(false);
    expect(outcome?.reason).toBe("Your profile has no phone recorded, so there was nothing to forget.");
    expect(outcome?.changes).toEqual([]);
  });

  test("a null reason on a success is absent, never the string 'null'", () => {
    expect(readProfileWriteOutcome(LIVE_SET)?.reason).toBeUndefined();
  });

  test("a body that never said ok is null, and must not be read as success", () => {
    expect(readProfileWriteOutcome({})).toBeNull();
    expect(readProfileWriteOutcome({ changes: [], disclosure: "" })).toBeNull();
  });
});

describe("write inputs", () => {
  test("set states surface, said and authority on every call", () => {
    expect(buildProfileSetInput("location.city", "Detroit")).toEqual({
      fieldId: "location.city",
      value: "Detroit",
      surface: APP_PROFILE_SURFACE,
      said: expect.any(String),
      authority: APP_PROFILE_AUTHORITY,
    });
  });

  test("the surface is one the daemon's enum accepts", () => {
    // routes/owner-profile.ts's readSurface refuses anything else with a 400,
    // verified live: surface "app" is rejected, naming these five.
    expect(["tui", "agent", "webui", "voice", "hand-edit"]).toContain(APP_PROFILE_SURFACE);
  });

  test("the authority is owner-direct, and it is always stated", () => {
    expect(APP_PROFILE_AUTHORITY).toBe("owner-direct");
    expect(buildProfileAppendInput("Notes", "x")["authority"]).toBe("owner-direct");
    expect(buildProfileUndoInput("location.city")["authority"]).toBe("owner-direct");
    expect(buildProfileForgetInput({ kind: "field", fieldId: "contact.phone" })["authority"]).toBe("owner-direct");
  });

  test("forget addresses a field by id and a line by its content", () => {
    expect(buildProfileForgetInput({ kind: "field", fieldId: "contact.phone" })).toEqual({
      fieldId: "contact.phone",
      authority: "owner-direct",
    });
    expect(buildProfileForgetInput({ kind: "line", section: "Notes", text: "Allergic to shellfish" })).toEqual({
      section: "Notes",
      text: "Allergic to shellfish",
      authority: "owner-direct",
    });
  });

  test("forget NEVER sends a lineIndex, which the daemon refuses outright", () => {
    const body = buildProfileForgetInput({ kind: "line", section: "Notes", text: "Allergic to shellfish" });
    expect("lineIndex" in body).toBe(false);
  });

  test("target ids are stable and distinct", () => {
    expect(profileTargetId({ kind: "field", fieldId: "contact.phone" })).toBe("field:contact.phone");
    expect(profileTargetId({ kind: "line", section: "Notes", text: "hi" })).toBe("line:Notes:hi");
  });
});

describe("third-party data", () => {
  test("People is marked, whatever case or spacing the heading uses", () => {
    expect(sectionHoldsThirdPartyData({ heading: "People" })).toBe(true);
    expect(sectionHoldsThirdPartyData({ heading: "  people " })).toBe(true);
    expect(sectionHoldsThirdPartyData({ heading: "Notes" })).toBe(false);
  });
});

describe("display", () => {
  test("the three states are three different sentences", () => {
    expect(profileStateLabel("loaded")).toBe("Loaded");
    expect(profileStateLabel("disabled")).toBe("Turned off");
    expect(profileStateLabel("unavailable")).toBe("Could not be read");
    expect(profileStateBadgeTone("loaded")).toBe("ok");
    expect(profileStateBadgeTone("disabled")).toBe("neutral");
    expect(profileStateBadgeTone("unavailable")).toBe("bad");
    expect(profileDisabledLine()).toContain("turned off");
  });

  test("the unavailable line names the reason, or says there was none", () => {
    expect(profileUnavailableLine("EACCES", "/tmp/p.md")).toBe("Your profile could not be read: EACCES (/tmp/p.md)");
    expect(profileUnavailableLine(undefined, "/tmp/p.md")).toContain("did not give a reason");
  });

  test("tier notes", () => {
    expect(tierNote("open")).toContain("every turn");
    expect(tierNote("closed")).toContain("disclosed");
  });

  test("provenance summary", () => {
    expect(provenanceSummary({ surface: "tui", date: "2026-08-01", said: "I live in Detroit" })).toBe(
      'tui, 2026-08-01: "I live in Detroit"',
    );
  });
});

describe("report lines", () => {
  test("a success prefers the daemon's own disclosure", () => {
    const report = writeReportLine(readProfileWriteOutcome(LIVE_SET), "Saved.", "malformed");
    expect(report.tone).toBe("ok");
    expect(report.text).toBe("Noted — saved your city to your profile.");
  });

  test("a success with no disclosure falls back to the caller's sentence", () => {
    const report = writeReportLine(readProfileWriteOutcome({ ...LIVE_SET, disclosure: "" }), "Saved city.", "malformed");
    expect(report.text).toBe("Saved city.");
  });

  test("a refusal is relayed in the daemon's words, and is NOT a success", () => {
    const report = writeReportLine(readProfileWriteOutcome(LIVE_FORGET_NOTHING), "Saved.", "malformed");
    expect(report.tone).toBe("info");
    expect(report.text).toContain("nothing to forget");
  });

  test("a body that never said ok is reported as unsaid, never as done", () => {
    const report = writeReportLine(null, "Saved.", "The daemon did not say whether anything changed.");
    expect(report.tone).toBe("warning");
    expect(report.text).toBe("The daemon did not say whether anything changed.");
  });

  test("a delete names what actually went, from the daemon's change list", () => {
    const outcome = readProfileWriteOutcome({
      ok: true,
      reason: null,
      changes: [{ kind: "forget", fieldId: "contact.phone", section: "Contact", label: "phone", superseded: false }],
      disclosure: "",
    });
    expect(outcome && deletedWhat(outcome, "that")).toBe("phone");
    expect(forgetReportLine(outcome, "phone").text).toBe("Deleted phone from your profile.");
    expect(forgetReportLine(outcome, "phone").tone).toBe("ok");
  });

  test("a delete that removed nothing warns AND says the page may be stale", () => {
    const report = forgetReportLine(readProfileWriteOutcome(LIVE_FORGET_NOTHING), "phone");
    expect(report.tone).toBe("warning");
    expect(report.text).toContain("nothing to forget");
    expect(report.text).toContain(STALE_VIEW_NOTE);
  });

  test("a delete the daemon never confirmed is never rendered as a deletion", () => {
    const report = forgetReportLine(null, "phone");
    expect(report.tone).toBe("warning");
    expect(report.text).toContain("did not say whether phone was deleted");
    expect(report.text).not.toContain("Deleted");
  });
});
