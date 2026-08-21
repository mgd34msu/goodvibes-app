// Coverage for src/ui/views/payments/payments-data.ts: the boundary parsers
// for all seven payments verbs, the card-draft validation, the money
// conversions, the refusal triage, and the containment properties that make
// this surface safe to have at all.
//
// ── What was measured, and what it means for these fixtures ─────────────────
//
// A scratch daemon (@pellux/goodvibes-daemon 1.28.19 / sdk 2.0.17) was driven
// over its HTTP routes in an isolated home on a scratch port. Every one of the
// seven verbs answers 501 NOT_INVOKABLE on that build:
//
//   GET  /api/payments/budget            501 NOT_INVOKABLE
//   GET  /api/payments/cards             501 NOT_INVOKABLE
//   POST /api/payments/cards             501 NOT_INVOKABLE
//   DELETE /api/payments/cards/{id}      501 NOT_INVOKABLE
//   POST /api/payments/checkout/begin    501 NOT_INVOKABLE (400 first if the body is short)
//   POST /api/payments/checkout/fill-card 501 NOT_INVOKABLE (400 first if the body is short)
//   GET  /api/payments/purchases         501 NOT_INVOKABLE
//
// with the body "The descriptor is advertised and its route is real, but no
// handler is attached on this daemon, so the capability is not wired up in
// this composition." Setting `payments.enabled=true` through config.set (200,
// persisted to the daemon's settings.json) changed nothing, and neither did
// restarting with `--enable payments` so the flag was live from boot. The
// handlers are attached when the daemon is composed, not by a setting.
//
// So unlike the occasions fixtures, the success-path payloads below are NOT
// captures from a live daemon: there was no daemon in reach that would answer
// these verbs. They are built from the SDK's own published output schemas
// (platform/control-plane/operator-contract-schemas-payments.ts), field for
// field, and that provenance is stated rather than implied. The REFUSAL
// payloads are verbatim captures.
//
// Every card number in this file is the documented test PAN, and it appears
// only where the daemon's own documented shape puts one: as the `number` on a
// cards.create input. No response shape in this domain carries one, so none of
// the response fixtures has anywhere to put it.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WEBUI_CARD_ENTRY_CONDITIONS,
  mayEnterCardDetails,
  mayOfferCardEntryFlow,
} from "@pellux/goodvibes-sdk/platform/payments";
import { HttpError } from "../src/ui/lib/http.ts";
import { queryKeys } from "../src/ui/lib/queries.ts";
import {
  CARD_ENTRY_CONDITIONS,
  CARD_ENTRY_SURFACE,
  CARD_INPUT_GUARDS,
  CARD_PLACEHOLDERS,
  PAYMENTS_POLL_MS,
  buildCardCreateInput,
  buildCheckoutBeginInput,
  buildFillCardInput,
  cardExpiryLabel,
  cardInstrumentLabel,
  cardStoredNote,
  checkoutDraftMissing,
  describeAppCardEntryRefusal,
  describeFillResult,
  emptyCardDraft,
  emptyCheckoutDraft,
  emptyFillCardDraft,
  fillCardDraftMissing,
  formatMinorUnits,
  majorTextToMinorUnits,
  mayOfferCardEntry,
  minorUnitExponent,
  outcomeTone,
  parseBeginResult,
  parseBudgetStatus,
  parseCardCreated,
  parseCardDeleted,
  parseCardsList,
  parseFillResult,
  parsePurchasesList,
  paymentsRefusal,
  poolTone,
  recourseNote,
  type CardDraft,
} from "../src/ui/views/payments/payments-data.ts";

/** The documented test PAN. Not a card. */
const TEST_PAN = "4242424242424242";

function draft(overrides: Partial<CardDraft> = {}): CardDraft {
  return {
    ...emptyCardDraft(),
    label: "Everyday",
    kind: "virtual",
    number: TEST_PAN,
    expiry: "12/34",
    cvv: "123",
    cardholderName: "A Cardholder",
    ...overrides,
  };
}

// ─── Refusal triage ──────────────────────────────────────────────────────────

describe("paymentsRefusal", () => {
  // Verbatim capture from the scratch daemon.
  const notInvokable = new HttpError(
    501,
    "/api/payments/cards",
    JSON.stringify({
      error:
        "Gateway method is not invokable: payments.cards.list. The descriptor is advertised and its route is real, but no handler is attached on this daemon, so the capability is not wired up in this composition. This is a fixed answer, not a transient one — retrying will not change it.",
      code: "NOT_INVOKABLE",
    }),
  );

  test("names the composition, not a config key, on a 501", () => {
    const refusal = paymentsRefusal(notInvokable, "payments.cards.list");
    expect(refusal?.capability).toBe("payments.cards.list");
    expect(refusal?.description).toContain("no handler attached");
    // The measured fact that makes this the honest wording: enabling the
    // setting does not fix it, so the copy must not send the owner there as
    // if it would.
    expect(refusal?.description).toContain("payments.enabled does not change it");
  });

  test("separates 'this build has no handler' from 'this build has never heard of it'", () => {
    const unknown = new HttpError(
      404,
      "/api/payments/cards",
      JSON.stringify({ error: "Unknown gateway method", code: "METHOD_NOT_FOUND" }),
    );
    expect(paymentsRefusal(unknown, "payments.cards.list")?.description).toContain("does not carry the payments verbs");
    expect(paymentsRefusal(notInvokable, "x")?.description).not.toContain("does not carry the payments verbs");
  });

  test("a 400 is not a refusal: the daemon validates the body before it looks for a handler", () => {
    // Measured: an empty body on checkout/begin answers 400 INVALID_INPUT
    // "sessionId is required" even on a daemon that then 501s the same verb
    // once the body is well-formed. Treating a 400 as "capability missing"
    // would report a typo as an absent feature.
    const badInput = new HttpError(
      400,
      "/api/payments/checkout/begin",
      JSON.stringify({ error: "sessionId is required", code: "INVALID_INPUT", category: "bad_request" }),
    );
    expect(paymentsRefusal(badInput, "payments.checkout.begin")).toBeNull();
  });

  test("no error is no refusal", () => {
    expect(paymentsRefusal(null, "payments.cards.list")).toBeNull();
  });
});

// ─── The entry-surface gate ──────────────────────────────────────────────────

describe("card entry surface", () => {
  test("the surface this app declares is one the SDK's own allowlist accepts", () => {
    // Checked against the REAL SDK functions, not a copy of them. If the
    // owner's allowlist ever changes, this fails instead of the panel quietly
    // offering card entry somewhere it should not.
    expect(mayOfferCardEntryFlow(CARD_ENTRY_SURFACE)).toBe(true);
    expect(mayEnterCardDetails(CARD_ENTRY_SURFACE)).toBe(true);
  });

  test("the local mirror agrees with the SDK on every surface that matters", () => {
    for (const surface of [
      "tui",
      "agent-terminal",
      "webui",
      "telegram",
      "ntfy",
      "discord",
      "slack",
      "whatsapp",
      "signal",
      "webhook",
      "email",
      "sms",
      "matrix",
      "app",
      "",
    ]) {
      expect(mayOfferCardEntry(surface)).toBe(mayOfferCardEntryFlow(surface));
    }
  });

  test("the mirrored conditions are the SDK's, up to punctuation", () => {
    // A mirror is only safe while it is identical. This is what stops it
    // drifting into a weaker version of what the owner actually attached.
    // Punctuation is normalized because the installed dist and the sdk repo
    // currently differ by an em-dash-to-comma prose cleanup under the same
    // version; semantic drift still fails, a punctuation republish does not.
    const normalize = (line: string): string =>
      line.replace(/[—,]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    expect(CARD_ENTRY_CONDITIONS.map(normalize)).toEqual([...WEBUI_CARD_ENTRY_CONDITIONS].map(normalize));
  });

  test("a refused surface is told no without being asked for anything", () => {
    const message = describeAppCardEntryRefusal("telegram");
    expect(message).toContain("cannot be entered");
    expect(message).toContain("TUI");
    // The refusal must not itself invite a card anywhere.
    expect(message).not.toContain(TEST_PAN);
  });
});

// ─── Card draft validation ───────────────────────────────────────────────────

describe("buildCardCreateInput", () => {
  test("builds the daemon's documented input shape", () => {
    const built = buildCardCreateInput(draft({ issuerCap: "250" }), "USD");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input).toEqual({
      label: "Everyday",
      kind: "virtual",
      number: TEST_PAN,
      expiryMonth: 12,
      expiryYear: 2034,
      cvv: "123",
      cardholderName: "A Cardholder",
      issuerCapMinorUnits: 25_000,
    });
  });

  test("strips separators out of the number rather than refusing a spaced one", () => {
    const built = buildCardCreateInput(draft({ number: "4242 4242 4242 4242" }), "USD");
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.input.number).toBe(TEST_PAN);
  });

  test("a two-digit year means this century", () => {
    const built = buildCardCreateInput(draft({ expiry: "07/29" }), "USD");
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.input.expiryYear).toBe(2029);
  });

  test("a four-digit year is taken as written", () => {
    const built = buildCardCreateInput(draft({ expiry: "07/2029" }), "USD");
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.input.expiryYear).toBe(2029);
  });

  test("an absent issuer cap is null, not zero", () => {
    // Zero is a real cap meaning "may spend nothing". Absent means undeclared.
    const built = buildCardCreateInput(draft({ issuerCap: "" }), "USD");
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.input.issuerCapMinorUnits).toBeNull();
  });

  test.each([
    ["label", draft({ label: "  " })],
    ["number", draft({ number: "12345" })],
    ["number", draft({ number: "12345678901234567890" })],
    ["expiry", draft({ expiry: "13/34" })],
    ["expiry", draft({ expiry: "not a date" })],
    ["cvv", draft({ cvv: "12" })],
    ["cvv", draft({ cvv: "12345" })],
    ["cvv", draft({ cvv: "abc" })],
    ["cardholderName", draft({ cardholderName: " " })],
    ["issuerCap", draft({ issuerCap: "1,299.00" })],
  ])("names the %s field when it is wrong", (field, bad) => {
    const built = buildCardCreateInput(bad, "USD");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.problem.field).toBe(field as keyof CardDraft);
  });

  test("NO validation message ever contains the value that failed", () => {
    // The containment property, stated as a test rather than a convention: a
    // validation message lands in a toast, a screen reader announcement and
    // sometimes a screenshot, which makes it a read path like any other.
    const bad: CardDraft[] = [
      draft({ number: "4111111111111" + "111111" }),
      draft({ cvv: "9999999" }),
      draft({ expiry: "4242424242424242" }),
      draft({ issuerCap: "4242424242424242" }),
      draft({ label: "", number: TEST_PAN }),
    ];
    for (const candidate of bad) {
      const built = buildCardCreateInput(candidate, "USD");
      if (built.ok) continue;
      const message = built.problem.message;
      // Empty fields are skipped: `toContain("")` is true of every string and
      // would pass this test for the wrong reason.
      for (const value of [candidate.number, candidate.cvv, candidate.expiry, candidate.issuerCap]) {
        if (value.length > 0) expect(message).not.toContain(value);
      }
      expect(message).not.toContain("4242");
      expect(message).not.toContain("9999999");
    }
  });

  test("the placeholders are obviously synthetic and match the tui's own prompts", () => {
    expect(CARD_PLACEHOLDERS.number).toBe(TEST_PAN);
    expect(CARD_PLACEHOLDERS.expiry).toBe("12/34");
    expect(CARD_PLACEHOLDERS.cvv).toBe("123");
  });

  test("every card input carries the password-manager guards", () => {
    expect(CARD_INPUT_GUARDS.autoComplete).toBe("off");
    expect(CARD_INPUT_GUARDS["data-1p-ignore"]).toBe("");
    expect(CARD_INPUT_GUARDS["data-lpignore"]).toBe("true");
    expect(CARD_INPUT_GUARDS["data-bwignore"]).toBe("true");
    expect(CARD_INPUT_GUARDS["data-form-type"]).toBe("other");
    expect(CARD_INPUT_GUARDS.spellCheck).toBe(false);
  });
});

// ─── Money ───────────────────────────────────────────────────────────────────

describe("money", () => {
  test("the exponent is the currency's, never a hardcoded 100", () => {
    expect(minorUnitExponent("USD")).toBe(2);
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(minorUnitExponent("KWD")).toBe(3);
  });

  test("major text converts with the currency's own exponent", () => {
    expect(majorTextToMinorUnits("19.99", "USD")).toBe(1999);
    expect(majorTextToMinorUnits("250", "USD")).toBe(25_000);
    expect(majorTextToMinorUnits("500", "JPY")).toBe(500);
    expect(majorTextToMinorUnits("1.5", "KWD")).toBe(1500);
  });

  test("anything ambiguous is refused rather than guessed", () => {
    // Grouping separators are the factor-of-a-thousand mistake: "1.299,00"
    // and "1,299.00" are the same keystrokes meaning different numbers.
    expect(majorTextToMinorUnits("1,299.00", "USD")).toBeNull();
    expect(majorTextToMinorUnits("1.299,00", "USD")).toBeNull();
    expect(majorTextToMinorUnits("$20", "USD")).toBeNull();
    expect(majorTextToMinorUnits("", "USD")).toBeNull();
    expect(majorTextToMinorUnits("abc", "USD")).toBeNull();
    // More decimal places than the currency has is a number we would have to
    // round, and rounding someone's money silently is not this app's call.
    expect(majorTextToMinorUnits("19.999", "USD")).toBeNull();
  });

  test("formatting an absent amount says so instead of printing zero", () => {
    expect(formatMinorUnits(null, "USD")).toBe("—");
    expect(formatMinorUnits(0, "USD")).not.toBe("—");
  });
});

// ─── Parsers ─────────────────────────────────────────────────────────────────

describe("parseBudgetStatus", () => {
  const payload = {
    enabled: true,
    dayKey: "2026-08-20",
    timezone: "Europe/London",
    currency: "GBP",
    item: { limit: 10_000, spent: 2500, reserved: 1000, remaining: 6500 },
    overage: { limit: 2000, spent: 300, reserved: 0, remaining: 1700 },
    tolerance: { limit: 0, spent: 0, reserved: 0, remaining: 0 },
    reservationCount: 1,
    isPaymentsLeader: true,
  };

  test("reads every field the output schema declares", () => {
    expect(parseBudgetStatus(payload)).toEqual(payload);
  });

  test("an absent leader flag is NOT the leader", () => {
    // A defaulted `true` here is the convenience the SDK's gates.ts calls out
    // by name: on a clustered install the wrong answer is a double-spend.
    const { isPaymentsLeader: _omitted, ...withoutFlag } = payload;
    expect(parseBudgetStatus(withoutFlag).isPaymentsLeader).toBe(false);
    expect(parseBudgetStatus({}).isPaymentsLeader).toBe(false);
  });

  test("an absent enabled flag is off", () => {
    expect(parseBudgetStatus({}).enabled).toBe(false);
  });

  test("survives a garbage payload without inventing numbers", () => {
    const parsed = parseBudgetStatus(null);
    expect(parsed.item).toEqual({ limit: 0, spent: 0, reserved: 0, remaining: 0 });
    expect(parsed.currency).toBe("");
  });
});

describe("parseCardsList", () => {
  const payload = {
    cards: [
      {
        id: "card-1",
        label: "Everyday",
        brand: "Visa",
        last4: "4242",
        kind: "virtual",
        expiryMonth: 12,
        expiryYear: 2034,
        issuerCapMinorUnits: 25_000,
        addedAt: "2026-08-20T10:00:00.000Z",
        materialComplete: true,
      },
    ],
    defaultCardId: "card-1",
  };

  test("reads the metadata record the list schema declares", () => {
    const parsed = parseCardsList(payload);
    expect(parsed.defaultCardId).toBe("card-1");
    expect(parsed.cards[0]).toEqual(payload.cards[0]);
  });

  test("materialComplete absent means incomplete", () => {
    // "Every required secret is present" is a claim, and an absent claim is
    // not a true one. Defaulting it to true would show "complete" for a card
    // the daemon never said that about.
    const parsed = parseCardsList({ cards: [{ id: "c", last4: "4242" }], defaultCardId: "" });
    expect(parsed.cards[0]?.materialComplete).toBe(false);
  });

  test("an undeclared issuer cap stays null", () => {
    const parsed = parseCardsList({ cards: [{ id: "c" }], defaultCardId: "" });
    expect(parsed.cards[0]?.issuerCapMinorUnits).toBeNull();
  });

  test("create answers with the metadata record and nothing more", () => {
    const card = parseCardCreated({ card: payload.cards[0] });
    expect(card.id).toBe("card-1");
    expect(card.last4).toBe("4242");
    // There is no property on a parsed card that could hold card material.
    expect(Object.keys(card).sort()).toEqual([
      "addedAt",
      "brand",
      "expiryMonth",
      "expiryYear",
      "id",
      "issuerCapMinorUnits",
      "kind",
      "label",
      "last4",
      "materialComplete",
    ]);
  });

  test("a delete reports whether it happened and how much it cleared", () => {
    expect(parseCardDeleted({ id: "card-1", deleted: true, secretsCleared: 4 })).toEqual({
      id: "card-1",
      deleted: true,
      secretsCleared: 4,
    });
    // Absent `deleted` is not a deletion.
    expect(parseCardDeleted({ id: "card-1" }).deleted).toBe(false);
  });
});

describe("parsePurchasesList", () => {
  const purchase = {
    purchaseId: "p-1",
    atUtc: "2026-08-20T09:30:00.000Z",
    dayKey: "2026-08-20",
    timezone: "Europe/London",
    merchantDomain: "example.com",
    item: "printer paper",
    currency: "GBP",
    itemMinorUnits: 1299,
    taxMinorUnits: 260,
    feesMinorUnits: 0,
    shippingMinorUnits: 399,
    totalMinorUnits: 1958,
    shippingTierRequested: "fast",
    shippingTierUsed: "normal",
    steppedDown: true,
    itemPoolDraw: 1299,
    overagePoolDraw: 659,
    tolerancePoolDraw: 0,
    cardLast4: "4242",
    windowKind: "veto",
    windowOutcome: "expired-unanswered",
    answeredBy: null,
    outcome: "purchased",
    refusalReason: null,
    merchantOrderId: "ORD-9",
    refundedAt: null,
    merchantRecognised: true,
    merchantQualifier: "major-retailer",
    merchantDiscovered: false,
  };

  test("reads every field the purchase schema declares", () => {
    const parsed = parsePurchasesList({ purchases: [purchase], total: 12 });
    expect(parsed.purchases[0]).toEqual(purchase);
    expect(parsed.total).toBe(12);
  });

  test("the ledger's total is not replaced by the page length", () => {
    // `total` is how many the ledger holds; the rows are one page of them.
    // Falling back to the page length would claim the page IS the ledger.
    const parsed = parsePurchasesList({ purchases: [purchase], total: 40 });
    expect(parsed.total).toBe(40);
    expect(parsed.purchases).toHaveLength(1);
  });

  test("a missing total falls back to what actually arrived", () => {
    expect(parsePurchasesList({ purchases: [purchase] }).total).toBe(1);
  });

  test("the only instrument on a purchase is its last four digits", () => {
    const parsed = parsePurchasesList({ purchases: [purchase], total: 1 });
    const row = parsed.purchases[0];
    expect(row?.cardLast4).toBe("4242");
    expect(Object.keys(row ?? {})).not.toContain("cardNumber");
    expect(Object.keys(row ?? {})).not.toContain("cvv");
  });

  test("recourse is reported as the fact that decided what silence meant", () => {
    expect(recourseNote(purchase)).toContain("major-retailer");
    expect(recourseNote({ ...purchase, merchantRecognised: false, merchantQualifier: null })).toContain(
      "No established recourse",
    );
  });
});

describe("checkout results", () => {
  test("a begin result reads every declared field", () => {
    const payload = {
      outcome: "refused",
      purchaseId: null,
      reason: "payments are disabled",
      merchantOrderId: null,
      totalMinorUnits: null,
      currency: null,
      shippingTierUsed: null,
      steppedDown: false,
      challengeStep: null,
    };
    expect(parseBeginResult(payload)).toEqual(payload);
  });

  test("a fill result carries field names and a boolean, and that is all it can carry", () => {
    const parsed = parseFillResult({ ok: false, filled: ["number"], failedField: "cvv", reason: "box not found" });
    expect(parsed).toEqual({ ok: false, filled: ["number"], failedField: "cvv", reason: "box not found" });
    expect(Object.keys(parsed).sort()).toEqual(["failedField", "filled", "ok", "reason"]);
  });

  test("non-string entries are dropped from filled rather than rendered", () => {
    expect(parseFillResult({ ok: true, filled: ["number", 42, null] }).filled).toEqual(["number"]);
  });

  test("describeFillResult names the field that failed, never a value", () => {
    const failed = describeFillResult({ ok: false, filled: ["number"], failedField: "cvv", reason: "box not found" });
    expect(failed).toContain("cvv");
    expect(failed).toContain("box not found");
    expect(failed).not.toContain(TEST_PAN);

    expect(describeFillResult({ ok: true, filled: ["number", "cvv"], failedField: null, reason: null })).toContain(
      "Filled number, cvv",
    );
    // A success that names no field is reported as exactly that rather than
    // being dressed up as a completed fill.
    expect(describeFillResult({ ok: true, filled: [], failedField: null, reason: null })).toContain(
      "without naming a filled field",
    );
  });
});

// ─── Checkout input building ─────────────────────────────────────────────────

describe("checkout inputs", () => {
  function fullDraft() {
    const base = emptyCheckoutDraft();
    return {
      ...base,
      sessionId: "s-1",
      pageId: "p-1",
      merchantDomain: "example.com",
      checkoutUrl: "https://example.com/checkout",
      item: "printer paper",
      cardId: "card-1",
      requestedLabel: "printer paper",
      requestedQuantity: "2",
      lines: [{ label: "printer paper", quantity: "2", unitPrice: "12.99" }],
      shippingOptions: [{ label: "standard", cost: "3.99" }],
      cardFields: [{ field: "number" as const, ref: "ref-number" }],
      placeOrderTarget: "ref-place",
    };
  }

  test("the required list matches what the daemon refuses without", () => {
    // Measured: an empty body answers 400 "sessionId is required" before the
    // handler lookup, so the client-side list has to be the descriptor's own.
    expect(checkoutDraftMissing(emptyCheckoutDraft())).toContain("sessionId");
    expect(checkoutDraftMissing(fullDraft())).toEqual([]);
  });

  test("an empty row is not a filled one", () => {
    // The array fields carry minItems:1, so a row of blanks would produce a
    // 400 no consumer could have predicted from a form that looked complete.
    const blankLine = { ...fullDraft(), lines: [{ label: "", quantity: "1", unitPrice: "" }] };
    expect(checkoutDraftMissing(blankLine)).toContain("lines");
    const blankRef = { ...fullDraft(), cardFields: [{ field: "number" as const, ref: "  " }] };
    expect(checkoutDraftMissing(blankRef)).toContain("cardFields");
  });

  test("amounts go out as the strings they were read as", () => {
    const body = buildCheckoutBeginInput(fullDraft());
    const lines = body["lines"] as { unitPrice: unknown; quantity: unknown }[];
    expect(lines[0]?.unitPrice).toBe("12.99");
    expect(lines[0]?.quantity).toBe("2");
    expect(typeof lines[0]?.unitPrice).toBe("string");
    // The one number on this path is the quantity the OWNER asked for, which
    // is a count he stated, not an amount read off a page.
    const requested = body["requestedLines"] as { quantity: unknown }[];
    expect(requested[0]?.quantity).toBe(2);
  });

  test("optional amounts are omitted rather than sent empty", () => {
    // An empty string is an amount the daemon would have to parse and refuse;
    // an absent key is an absent amount.
    const body = buildCheckoutBeginInput(fullDraft());
    expect(body).not.toHaveProperty("tax");
    expect(body).not.toHaveProperty("statedTotal");
    expect(body).not.toHaveProperty("preferredTier");
    expect(body).not.toHaveProperty("requestedMax");

    const withOptional = buildCheckoutBeginInput({
      ...fullDraft(),
      tax: "2.60",
      statedTotal: "29.57",
      currency: "gbp",
      preferredTier: "fast",
      requestedMax: "35.00",
    });
    expect(withOptional["tax"]).toBe("2.60");
    expect(withOptional["statedTotal"]).toBe("29.57");
    expect(withOptional["currency"]).toBe("GBP");
    expect(withOptional["preferredTier"]).toBe("fast");
  });

  test("no begin or fill body has a property that could hold card material", () => {
    const bodies = [
      buildCheckoutBeginInput(fullDraft()),
      buildFillCardInput({ ...emptyFillCardDraft(), sessionId: "s", pageId: "p", targets: [{ field: "cvv", ref: "r" }] }),
    ];
    for (const body of bodies) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(TEST_PAN);
      for (const forbidden of ["number\":\"4", "cvv\":\"1", "cardholderName\":\"", "expiryMonth"]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
    // `field: "cvv"` is a NAME and is expected; `cvv: <value>` is not.
    const fill = buildFillCardInput({
      ...emptyFillCardDraft(),
      sessionId: "s",
      pageId: "p",
      targets: [{ field: "cvv", ref: "r" }],
    });
    expect(fill).not.toHaveProperty("cvv");
    expect((fill["targets"] as { field: string }[])[0]?.field).toBe("cvv");
  });

  test("a fill needs a session, a page and at least one target", () => {
    expect(fillCardDraftMissing(emptyFillCardDraft())).toEqual(["sessionId", "pageId", "targets"]);
    expect(
      fillCardDraftMissing({ ...emptyFillCardDraft(), sessionId: "s", pageId: "p", targets: [{ field: "number", ref: "r" }] }),
    ).toEqual([]);
  });
});

// ─── Presentation ────────────────────────────────────────────────────────────

describe("presentation", () => {
  const card = {
    id: "card-1",
    label: "Everyday",
    brand: "Visa",
    last4: "4242",
    kind: "virtual",
    expiryMonth: 7,
    expiryYear: 2029,
    issuerCapMinorUnits: null,
    addedAt: "2026-08-20T10:00:00.000Z",
    materialComplete: true,
  };

  test("an instrument line is the brand and the four digits the daemon sent", () => {
    // Deliberately NOT padded out to a card-shaped "•••• •••• •••• 4242",
    // which would invent twelve digits of structure the daemon did not send.
    const label = cardInstrumentLabel(card);
    expect(label).toBe("Visa ···4242");
    expect(label.replace(/\D/g, "")).toBe("4242");
  });

  test("expiry renders from the two numbers, zero-padded", () => {
    expect(cardExpiryLabel(card)).toBe("07/2029");
    expect(cardExpiryLabel({ ...card, expiryMonth: 0, expiryYear: 0 })).toBe("");
  });

  test("the stored-card note says which card, never what was typed", () => {
    const note = cardStoredNote(card);
    expect(note).toContain("Everyday");
    expect(note).toContain("···4242");
    expect(note).not.toContain(TEST_PAN);
    expect(cardStoredNote({ ...card, materialComplete: false })).toContain("incomplete");
  });

  test("pool tone reads empty as bad and nearly empty as a warning", () => {
    expect(poolTone({ limit: 1000, spent: 0, reserved: 0, remaining: 1000 })).toBe("ok");
    expect(poolTone({ limit: 1000, spent: 900, reserved: 0, remaining: 100 })).toBe("warning");
    expect(poolTone({ limit: 1000, spent: 1000, reserved: 0, remaining: 0 })).toBe("bad");
    // A zero limit is not a shortage, it is an unset budget.
    expect(poolTone({ limit: 0, spent: 0, reserved: 0, remaining: 0 })).toBe("neutral");
  });

  test("an outcome word this app has not seen is neutral, never good", () => {
    expect(outcomeTone("purchased")).toBe("ok");
    expect(outcomeTone("refused")).toBe("bad");
    expect(outcomeTone("awaiting-approval")).toBe("warning");
    expect(outcomeTone("something-new")).toBe("neutral");
  });
});

// ─── Containment, as properties of the source rather than of a comment ───────

describe("card material containment", () => {
  const viewDir = join(import.meta.dir, "..", "src", "ui", "views", "payments");
  const sources = readdirSync(viewDir).map((name) => ({
    name,
    text: readFileSync(join(viewDir, name), "utf8"),
  }));

  test("nothing in the payments surface logs", () => {
    // The tui's rule: card material never reaches the transcript, the input
    // history or a log line. The strongest version of that in a React surface
    // is that the files handling it do not log at all, so no future edit can
    // add a "helpful" dump of the draft.
    for (const source of sources) {
      const offenders = source.text
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter((entry) => /\bconsole\s*\.\s*(log|info|warn|error|debug|trace|dir|table)\b/.test(entry.line));
      expect({ file: source.name, offenders }).toEqual({ file: source.name, offenders: [] });
    }
  });

  test("no query key in the payments group can carry a card value", () => {
    // Query keys are retained by the client, enumerable through its cache, and
    // visible in devtools. Every payments key is a fixed tuple, or a number
    // and a day key that are already public in the rows they fetch.
    const keys: readonly unknown[][] = [
      [...queryKeys.payments],
      [...queryKeys.paymentsBudget],
      [...queryKeys.paymentsCards],
      [...queryKeys.paymentsPurchases(25, "2026-08-20")],
    ];
    for (const key of keys) {
      for (const segment of key) {
        expect(["string", "number"]).toContain(typeof segment);
        expect(String(segment)).not.toContain("4242");
      }
    }
    expect(queryKeys.paymentsPurchases(25, "2026-08-20")).toEqual(["payments", "purchases", 25, "2026-08-20"]);
  });

  test("the card panel does not use a mutation for the submit", () => {
    // React Query retains a mutation's `variables`, so a useMutation whose
    // input is the card draft keeps the number and the code in the query
    // client after the call finished. See CARD_SUBMIT_IS_NOT_A_MUTATION.
    const panel = sources.find((source) => source.name === "CardsPanel.tsx");
    expect(panel).toBeDefined();
    const mutations = panel?.text.match(/useMutation\(/g) ?? [];
    // Exactly one, and it is the delete, whose variable is a card id.
    expect(mutations).toHaveLength(1);
    expect(panel?.text).toContain("mutationFn: (id: string) => paymentsApi.deleteCard(id)");
  });

  test("the concealed fields are concealed without presenting as passwords", () => {
    const panel = sources.find((source) => source.name === "CardsPanel.tsx")?.text ?? "";
    // A password input is the loudest signal a password manager looks for,
    // and the owner's fifth condition is that these must not present as
    // saveable. Concealment comes from the stylesheet instead.
    expect(panel).not.toContain('type="password"');
    const concealed = panel.match(/className="payments-concealed"/g) ?? [];
    expect(concealed).toHaveLength(2);
    const css = readFileSync(
      join(import.meta.dir, "..", "src", "ui", "styles", "views", "payments.css"),
      "utf8",
    );
    expect(css).toContain("-webkit-text-security: disc");
  });

  test("the draft is cleared on submit and on cancel", () => {
    const panel = sources.find((source) => source.name === "CardsPanel.tsx")?.text ?? "";
    const clears = panel.match(/setDraft\(emptyCardDraft\(\)\)/g) ?? [];
    // One after a successful store, one on cancel. Unmount is handled by the
    // view being keepAlive:false, which drops the state with the component.
    expect(clears.length).toBeGreaterThanOrEqual(2);
  });

  test("the payments view is not kept alive", () => {
    // The card draft must not survive a view switch. This is the shell
    // enforcing the sixth condition rather than a component promising it.
    const registry = readFileSync(
      join(import.meta.dir, "..", "src", "ui", "views", "registry.tsx"),
      "utf8",
    );
    const entry = /payments: \{[\s\S]*?\},/.exec(registry)?.[0] ?? "";
    expect(entry).toContain("keepAlive: false");
  });

  test("late and superseded responses cannot write into a dead or moved-on panel", () => {
    // Both the intake and the checkout steps take a sequence number before
    // awaiting and check it, plus an alive flag, after.
    for (const name of ["CardsPanel.tsx", "CheckoutPanel.tsx"]) {
      const text = sources.find((source) => source.name === name)?.text ?? "";
      expect(text).toContain("alive.current = false");
      expect(text).toMatch(/if \(!alive\.current \|\| seq !== \w+\.current\) return;/);
    }
  });
});

describe("poll cadence", () => {
  test("polls at a minute, which is the cadence a purchase moves on", () => {
    expect(PAYMENTS_POLL_MS).toBe(60_000);
  });
});
