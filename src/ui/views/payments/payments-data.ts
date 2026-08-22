// Data layer for the Payments surface (the seven `payments.*` verbs).
//
// Cribs, both read in full before a line of this was written:
//   - goodvibes-tui src/input/commands/payment-card-intake.ts, the security
//     model for card entry, mirrored decision by decision below.
//   - goodvibes-webui src/components/settings/PaymentCardEntry.tsx and
//     src/lib/payments-cards.ts, the browser-side hardening and the draft
//     validation, which this app needs for the same reasons a browser does.
//
// CARD MATERIAL CONTRACT. A card number, an expiry, a CVV and a cardholder
// name go one way: into `payments.cards.create` and no further. Four rules
// follow, and they are enforced here rather than left to each component:
//
//  1. Nothing echoes. No parser in this file reads a card value back off the
//     wire, because no response carries one, the daemon's own schemas have no
//     property that could (operator-contract-schemas-payments.ts). `last4` and
//     `brand` are the whole of what a surface ever learns about an instrument,
//     and they arrive already reduced. Nothing here widens them.
//  2. Nothing is logged. No console call in this module or its panels takes a
//     draft, a field, or a submitted input, and none of it reaches a
//     diagnostics bundle. `budgetStatus` is the one shape here that is SAFE in
//     one: it is limits and totals with no instrument anywhere in it.
//  3. Nothing is cached. A card draft never becomes a React Query key, a query
//     variable, or a mutation's retained `variables`. See CARD_SUBMIT_IS_NOT_A_MUTATION.
//  4. Nothing is computed that the daemon already answered. Pool remainders,
//     the day key, the timezone, whether a purchase stepped shipping down,
//     all arrive decided. The daemon owns `daemon.timezone`, and a locally
//     recomputed "today" is how a spent budget silently refills.
//
// Refusals are rendered as answers in the daemon's own words: an `outcome`, a
// `reason`, a `failedField` is printed as the thing it is, never flattened
// into "something went wrong".

import { gv } from "../../lib/gv.ts";
import { isMethodNotInvokableError, isMethodUnavailableError } from "../../lib/errors.ts";
import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

// ---------------------------------------------------------------------------
// Poll cadence
// ---------------------------------------------------------------------------

/**
 * `payments.*` publishes no wire event, so freshness is a poll plus
 * mutation-driven invalidation, the same treatment occasions and fleet get.
 *
 * 60s: the only things that move without this app touching them are a purchase
 * the agent made and the reservations it holds, and a purchase is minutes wide
 * by design (the veto and approval windows are configured in minutes). A
 * mutation from here invalidates immediately, so this cadence only covers
 * changes made somewhere else.
 *
 * The Payments view is `keepAlive: false` (views/registry.tsx), so it unmounts
 * when hidden and these polls stop with it. That is a deliberate part of the
 * card-material story, not just a polling decision: see CARD_STATE_IS_NOT_KEPT_ALIVE.
 */
export const PAYMENTS_POLL_MS = 60_000;

// ---------------------------------------------------------------------------
// Refusal triage
// ---------------------------------------------------------------------------

export interface PaymentsRefusal {
  capability: string;
  description: string;
}

/**
 * The composition gate, measured rather than guessed.
 *
 * Verified against a scratch daemon (@pellux/goodvibes-daemon 1.28.19, sdk
 * 2.0.17) in an isolated home on a scratch port: ALL SEVEN payments verbs
 * answer 501 NOT_INVOKABLE, with the body "The descriptor is advertised and
 * its route is real, but no handler is attached on this daemon, so the
 * capability is not wired up in this composition."
 *
 * That is not the config gate and must not be reported as one. Measured, in
 * order: setting `payments.enabled=true` through `config.set` persisted fine
 * (200, written to the daemon's own settings.json) and changed nothing;
 * restarting the daemon with `--enable payments` so the flag was live from
 * boot changed nothing either. The handlers are attached by whoever composes
 * the daemon (`registerPaymentsGatewayMethods`, routes/payments.ts), and this
 * daemon build's composition does not attach them. No setting reachable from
 * this app moves that.
 *
 * So the honest sentence names the composition, not a config key the owner
 * could go and set, telling him to switch on `payments.enabled` would send
 * him to a setting that demonstrably does not fix it.
 */
export function paymentsRefusal(error: unknown, capability: string): PaymentsRefusal | null {
  if (!error) return null;
  if (isMethodNotInvokableError(error)) {
    return {
      capability,
      description:
        "this daemon advertises the payments verbs but has no handler attached for them, so the payment capability is not wired up in this composition. Switching on payments.enabled does not change it: the handlers are attached when the daemon is composed, not by a setting.",
    };
  }
  if (isMethodUnavailableError(error)) {
    return {
      capability,
      description: "the connected daemon build does not carry the payments verbs at all.",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Where card details may be TYPED
// ---------------------------------------------------------------------------

/**
 * The surface this app declares when it asks whether it may offer card entry.
 *
 * The ruling lives in the SDK (platform/payments/entry-surface.ts) and its
 * allowlist is exactly `tui`, `agent-terminal`, `webui`. The reasoning it
 * gives for the list is about where a typed number COMES TO REST: a card typed
 * into a hosted chat is on that provider's servers, in history this app cannot
 * erase, and it went through their infrastructure before reaching us.
 *
 * This app's card panel is a webview operator surface, the same React panel
 * the webui ships, rendered by a local webview, posting over the same
 * authenticated daemon channel, so `webui` is the member of that list it
 * actually is, and it is claimed here rather than a fourth name being invented
 * for the allowlist. Every one of the six conditions the owner attached to
 * webui card entry is met, and more easily than in a browser: there is no URL
 * bar, no browser history, and no browser password manager in this webview.
 *
 * ── Why this claims `webui` where owner-profile.ts refuses to ────────────
 *
 * views/settings/owner-profile.ts declares `hand-edit` and explicitly will NOT
 * say `webui`, because a profile write STORES its surface as provenance and
 * naming a different client there would attribute a line to a client that
 * never touched it. Nothing of the sort happens here: `payments.cards.create`
 * has no surface field in either direction (see its input schema), so this
 * name never reaches the wire. It answers one local question, may this
 * surface put card inputs on screen, and the true answer to that is the one
 * the webui gets, for the reasons the ruling itself gives.
 *
 * test/payments-data.test.ts checks this against the SDK's REAL
 * `mayOfferCardEntryFlow`, so if the allowlist ever changes the test fails
 * rather than this comment quietly going stale.
 */
export const CARD_ENTRY_SURFACE = "webui";

/**
 * The conditions the owner attached to webui card entry, mirrored from the
 * SDK's `WEBUI_CARD_ENTRY_CONDITIONS` so a reader has them without going back
 * to a transcript, and so the panel can show what it is holding itself to.
 *
 * Mirrored rather than imported because src/ui may not reach into the SDK's
 * Bun-only platform subpaths at all (scripts/check-boundaries.ts, which reads
 * this file line by line and does not care that a match is inside a comment).
 * The test asserts this list is verbatim-equal to the SDK's, which is the part
 * that keeps a mirror from drifting into a weaker version of the original.
 */
export const CARD_ENTRY_CONDITIONS: readonly string[] = [
  "Card fields are posted over the authenticated daemon channel, the same path as any other secret.",
  "Card values never appear in a URL, not a query parameter, not a fragment, not a path segment.",
  "Card values are never rendered back after entry: no response returns them and no field is repopulated from the server.",
  'Every card field carries autocomplete="off".',
  "Card fields must not present as ones a password manager offers to save.",
  "No card value is retained in DOM state, cleared from component state after submit, never left in a store, a form-library cache, or state that survives navigation.",
];

/**
 * The allowlist, mirrored for the same reason the conditions are.
 *
 * An allowlist deliberately, copied as one: a denylist ships every surface
 * added after it was written, and the direction to fail for card material is
 * closed.
 */
const CARD_ENTRY_SURFACES: readonly string[] = ["tui", "agent-terminal", "webui"];

export function mayOfferCardEntry(surface: string): boolean {
  return CARD_ENTRY_SURFACES.includes(surface.trim().toLowerCase());
}

/**
 * What the panel says instead of rendering inputs when the gate refuses.
 *
 * The SDK's own wording for this ("the prompt is itself the harm": a surface
 * that cannot accept the answer must never ask the question) is why the
 * refusing branch renders NO fields at all rather than disabled ones. This is
 * a safety net on today's build, since CARD_ENTRY_SURFACE is on the allowlist,
 * and it exists so the refusal is already written the day this panel is
 * reachable from somewhere it should not be.
 */
export function describeAppCardEntryRefusal(surface: string): string {
  return [
    `Card details cannot be entered from ${surface || "this surface"}, so this panel does not ask for them.`,
    "Enter the card at a terminal instead: the TUI, the agent terminal, or the web UI.",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Minor units per major unit for a currency.
 *
 * Read out of Intl rather than assumed to be 100: JPY has no minor unit and
 * KWD has three, and a hardcoded 100 turns an issuer cap into one worth a
 * hundred times too much or too little. Falls back to 2 for a code Intl does
 * not know, which is the only safe guess left.
 */
export function minorUnitExponent(currency: string): number {
  try {
    const options = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).resolvedOptions();
    return options.maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Integer minor units rendered in the currency the daemon named. When the
 * daemon named no currency, the minor units render bare and labeled: guessing
 * a symbol would also guess the exponent, and a JPY total read as USD is
 * wrong in symbol and by 100x in magnitude.
 */
export function formatMinorUnits(minorUnits: number | null, currency: string): string {
  if (minorUnits === null || !Number.isFinite(minorUnits)) return "—";
  if (!currency) return `${minorUnits} minor units`;
  const exponent = minorUnitExponent(currency);
  const major = minorUnits / 10 ** exponent;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(major);
  } catch {
    return `${major.toFixed(exponent)} ${currency}`.trim();
  }
}

/**
 * A typed major-unit amount to integer minor units, or null when it is not an
 * amount.
 *
 * Refuses anything ambiguous instead of guessing. Grouping separators are not
 * accepted at all: "1.299,00" and "1,299.00" are the same keystrokes meaning
 * two different numbers, and the wrong reading is off by a factor of a
 * thousand. The daemon takes the same position on every amount it parses off a
 * checkout page.
 */
export function majorTextToMinorUnits(text: string, currency: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const exponent = minorUnitExponent(currency);
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > exponent) return null;
  const padded = fraction.padEnd(exponent, "0");
  const combined = `${whole}${padded}`;
  const value = Number(combined);
  return Number.isSafeInteger(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Wire shapes (sdk platform/control-plane/operator-contract-schemas-payments.ts)
// ---------------------------------------------------------------------------

export interface BudgetPool {
  limit: number;
  spent: number;
  reserved: number;
  remaining: number;
}

export interface BudgetStatus {
  enabled: boolean;
  dayKey: string;
  timezone: string;
  currency: string;
  item: BudgetPool;
  overage: BudgetPool;
  tolerance: BudgetPool;
  reservationCount: number;
  isPaymentsLeader: boolean;
}

export interface StoredCard {
  id: string;
  label: string;
  brand: string;
  /** The last four digits, as the daemon reduced them. Never widened here. */
  last4: string;
  kind: string;
  expiryMonth: number;
  expiryYear: number;
  issuerCapMinorUnits: number | null;
  addedAt: string;
  /** Whether every required secret field is present. Never the values. */
  materialComplete: boolean;
}

export interface CardsList {
  cards: StoredCard[];
  defaultCardId: string;
}

export interface CardDeleteOutcome {
  id: string;
  deleted: boolean;
  secretsCleared: number;
}

export interface Purchase {
  purchaseId: string;
  atUtc: string;
  dayKey: string;
  timezone: string;
  merchantDomain: string;
  item: string;
  currency: string;
  itemMinorUnits: number;
  taxMinorUnits: number;
  feesMinorUnits: number;
  shippingMinorUnits: number;
  totalMinorUnits: number;
  shippingTierRequested: string;
  shippingTierUsed: string;
  steppedDown: boolean;
  itemPoolDraw: number;
  overagePoolDraw: number;
  tolerancePoolDraw: number;
  cardLast4: string;
  windowKind: string;
  windowOutcome: string;
  answeredBy: string | null;
  outcome: string;
  refusalReason: string | null;
  merchantOrderId: string | null;
  refundedAt: string | null;
  merchantRecognised: boolean;
  merchantQualifier: string | null;
  merchantDiscovered: boolean;
}

export interface PurchasesList {
  purchases: Purchase[];
  total: number;
}

export interface CheckoutBeginResult {
  outcome: string;
  purchaseId: string | null;
  reason: string | null;
  merchantOrderId: string | null;
  totalMinorUnits: number | null;
  currency: string | null;
  shippingTierUsed: string | null;
  steppedDown: boolean;
  challengeStep: string | null;
}

export interface FillCardResult {
  ok: boolean;
  /** Field NAMES, which is all this response can carry. */
  filled: string[];
  failedField: string | null;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Boundary parsers
// ---------------------------------------------------------------------------

function readNumber(record: Record<string, unknown>, key: string): number {
  return firstNumber(record, [key]) ?? 0;
}

function nullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function parsePool(value: unknown): BudgetPool {
  const record = asRecord(value);
  return {
    limit: readNumber(record, "limit"),
    spent: readNumber(record, "spent"),
    reserved: readNumber(record, "reserved"),
    remaining: readNumber(record, "remaining"),
  };
}

export function parseBudgetStatus(payload: unknown): BudgetStatus {
  const record = asRecord(payload);
  return {
    enabled: record["enabled"] === true,
    dayKey: firstString(record, ["dayKey"]),
    timezone: firstString(record, ["timezone"]),
    currency: firstString(record, ["currency"]),
    item: parsePool(record["item"]),
    overage: parsePool(record["overage"]),
    tolerance: parsePool(record["tolerance"]),
    reservationCount: readNumber(record, "reservationCount"),
    // Absent is treated as NOT the leader. A defaulted `true` here is the
    // convenience the SDK's gates.ts calls out by name: on a clustered install
    // the wrong answer is a double-spend.
    isPaymentsLeader: record["isPaymentsLeader"] === true,
  };
}

export function parseCard(value: unknown): StoredCard {
  const record = asRecord(value);
  return {
    id: firstString(record, ["id"]),
    label: firstString(record, ["label"]),
    brand: firstString(record, ["brand"]),
    last4: firstString(record, ["last4"]),
    kind: firstString(record, ["kind"]),
    expiryMonth: readNumber(record, "expiryMonth"),
    expiryYear: readNumber(record, "expiryYear"),
    issuerCapMinorUnits: nullableNumber(record, "issuerCapMinorUnits"),
    addedAt: firstString(record, ["addedAt"]),
    materialComplete: record["materialComplete"] === true,
  };
}

export function parseCardsList(payload: unknown): CardsList {
  const record = asRecord(payload);
  return {
    cards: asArray(record["cards"]).map(parseCard),
    defaultCardId: firstString(record, ["defaultCardId"]),
  };
}

/** `cards.create` answers with the metadata record and nothing else. */
export function parseCardCreated(payload: unknown): StoredCard {
  return parseCard(asRecord(payload)["card"]);
}

export function parseCardDeleted(payload: unknown): CardDeleteOutcome {
  const record = asRecord(payload);
  return {
    id: firstString(record, ["id"]),
    deleted: record["deleted"] === true,
    secretsCleared: readNumber(record, "secretsCleared"),
  };
}

export function parsePurchase(value: unknown): Purchase {
  const record = asRecord(value);
  return {
    purchaseId: firstString(record, ["purchaseId"]),
    atUtc: firstString(record, ["atUtc"]),
    dayKey: firstString(record, ["dayKey"]),
    timezone: firstString(record, ["timezone"]),
    merchantDomain: firstString(record, ["merchantDomain"]),
    item: firstString(record, ["item"]),
    currency: firstString(record, ["currency"]),
    itemMinorUnits: readNumber(record, "itemMinorUnits"),
    taxMinorUnits: readNumber(record, "taxMinorUnits"),
    feesMinorUnits: readNumber(record, "feesMinorUnits"),
    shippingMinorUnits: readNumber(record, "shippingMinorUnits"),
    totalMinorUnits: readNumber(record, "totalMinorUnits"),
    shippingTierRequested: firstString(record, ["shippingTierRequested"]),
    shippingTierUsed: firstString(record, ["shippingTierUsed"]),
    steppedDown: record["steppedDown"] === true,
    itemPoolDraw: readNumber(record, "itemPoolDraw"),
    overagePoolDraw: readNumber(record, "overagePoolDraw"),
    tolerancePoolDraw: readNumber(record, "tolerancePoolDraw"),
    cardLast4: firstString(record, ["cardLast4"]),
    windowKind: firstString(record, ["windowKind"]),
    windowOutcome: firstString(record, ["windowOutcome"]),
    answeredBy: nullableString(record, "answeredBy"),
    outcome: firstString(record, ["outcome"]),
    refusalReason: nullableString(record, "refusalReason"),
    merchantOrderId: nullableString(record, "merchantOrderId"),
    refundedAt: nullableString(record, "refundedAt"),
    merchantRecognised: record["merchantRecognised"] === true,
    merchantQualifier: nullableString(record, "merchantQualifier"),
    merchantDiscovered: record["merchantDiscovered"] === true,
  };
}

export function parsePurchasesList(payload: unknown): PurchasesList {
  const record = asRecord(payload);
  const purchases = asArray(record["purchases"]).map(parsePurchase);
  return {
    purchases,
    // `total` is the ledger's count, which is not the same as how many came
    // back under `limit`. Falling back to the page length would silently claim
    // the page IS the ledger.
    total: firstNumber(record, ["total"]) ?? purchases.length,
  };
}

export function parseBeginResult(payload: unknown): CheckoutBeginResult {
  const record = asRecord(payload);
  return {
    outcome: firstString(record, ["outcome"]),
    purchaseId: nullableString(record, "purchaseId"),
    reason: nullableString(record, "reason"),
    merchantOrderId: nullableString(record, "merchantOrderId"),
    totalMinorUnits: nullableNumber(record, "totalMinorUnits"),
    currency: nullableString(record, "currency"),
    shippingTierUsed: nullableString(record, "shippingTierUsed"),
    steppedDown: record["steppedDown"] === true,
    challengeStep: nullableString(record, "challengeStep"),
  };
}

export function parseFillResult(payload: unknown): FillCardResult {
  const record = asRecord(payload);
  return {
    ok: record["ok"] === true,
    filled: asArray(record["filled"]).filter((entry): entry is string => typeof entry === "string"),
    failedField: nullableString(record, "failedField"),
    reason: nullableString(record, "reason"),
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * A stored card's instrument line.
 *
 * Built only from what arrived: the daemon reduced the number to `last4`
 * before it left its process, and this puts a leading glyph in front of those
 * four digits rather than padding them out to a card-shaped string. A rendered
 * "•••• •••• •••• 4242" invents twelve digits of structure the daemon
 * deliberately did not send.
 */
export function cardInstrumentLabel(card: StoredCard): string {
  const brand = card.brand || "Card";
  const tail = card.last4 ? `···${card.last4}` : "···";
  return `${brand} ${tail}`;
}

/** MM/YYYY from the two numbers the daemon sent. */
export function cardExpiryLabel(card: StoredCard): string {
  if (!card.expiryMonth || !card.expiryYear) return "";
  return `${String(card.expiryMonth).padStart(2, "0")}/${card.expiryYear}`;
}

export function poolTone(pool: BudgetPool): string {
  if (pool.limit <= 0) return "neutral";
  if (pool.remaining <= 0) return "bad";
  if (pool.remaining <= pool.limit / 5) return "warning";
  return "ok";
}

/**
 * The outcome word the daemon chose, as a badge tone.
 *
 * Unknown outcomes read neutral rather than good: a word this app has not seen
 * before is not evidence that a purchase went well.
 */
export function outcomeTone(outcome: string): string {
  if (outcome === "purchased" || outcome === "committed") return "ok";
  if (outcome === "refused" || outcome === "failed" || outcome === "abandoned") return "bad";
  if (outcome === "awaiting-approval" || outcome === "in-veto-window") return "warning";
  return "neutral";
}

export function formatUtc(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * What silence meant on this purchase.
 *
 * `merchantRecognised` is in the row because it is the fact that decided
 * whether the daemon asked before buying or only offered a veto. Without it a
 * reader sees that one purchase asked and another did not and cannot see why.
 */
export function recourseNote(purchase: Purchase): string {
  if (purchase.merchantRecognised) {
    return purchase.merchantQualifier
      ? `Established recourse: ${purchase.merchantQualifier}.`
      : "Established recourse.";
  }
  return "No established recourse recorded for this merchant.";
}

// ---------------------------------------------------------------------------
// Card intake: the draft, and what may be done with it
// ---------------------------------------------------------------------------

/**
 * CARD_STATE_IS_NOT_KEPT_ALIVE.
 *
 * Every other draft-holding view in this app argues for `keepAlive: true` so a
 * half-typed form survives a view switch. This view argues the opposite and
 * the registry sets `keepAlive: false`, because the thing that would survive
 * is a card number sitting in component state behind whatever the owner looked
 * at next, for as long as the app stays open. Losing a half-typed card on a
 * view switch is the correct trade, and it is the sixth of
 * CARD_ENTRY_CONDITIONS ("never left in state that survives navigation")
 * enforced by the shell rather than promised by a component.
 */
export interface CardDraft {
  label: string;
  kind: "virtual" | "real";
  number: string;
  expiry: string;
  cvv: string;
  cardholderName: string;
  issuerCap: string;
}

export function emptyCardDraft(): CardDraft {
  return { label: "", kind: "virtual", number: "", expiry: "", cvv: "", cardholderName: "", issuerCap: "" };
}

/**
 * CARD_SUBMIT_IS_NOT_A_MUTATION.
 *
 * The card submit deliberately does NOT go through `useMutation`, which is the
 * house pattern everywhere else in this app. React Query retains a mutation's
 * `variables` for the life of the mutation observer (and exposes them on
 * `.variables`), so a `useMutation` whose input is the card draft keeps the
 * number and the CVV in the query client after the call has finished. The
 * webui made the same call for the same reason; this is the note so the next
 * person to "tidy this up into a mutation like everything else" knows what it
 * would cost.
 *
 * The same rule is why no card field is ever part of a query key.
 */
export const CARD_SUBMIT_IS_NOT_A_MUTATION = true;

/**
 * Attributes every card input carries, mirrored from the webui's
 * CARD_INPUT_GUARDS.
 *
 * `autoComplete: "off"` is the owner's fourth condition. The rest are the
 * fifth: 1Password, LastPass and Bitwarden each read their own attribute to
 * decide whether to offer to save a field, and `data-form-type: other`
 * suppresses the generic heuristics. A password manager that saves a card
 * field has copied it somewhere this system does not control, which is the
 * whole thing the condition exists to prevent.
 */
export const CARD_INPUT_GUARDS = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

/**
 * Placeholders for the card fields.
 *
 * The number is the documented test PAN and the rest are obviously synthetic,
 * copied from the tui's own prompts (payment-card-intake.ts CARD_SECRET_FIELDS)
 * so the two surfaces show the owner the same examples. Nothing here is or
 * resembles a real instrument.
 */
export const CARD_PLACEHOLDERS = {
  number: "4242424242424242",
  expiry: "12/34",
  cvv: "123",
  cardholderName: "as printed on the card",
} as const;

/** A draft problem, named by FIELD. Never carries the value that failed. */
export interface CardDraftProblem {
  field: keyof CardDraft;
  message: string;
}

export interface CardCreateInput {
  label: string;
  kind: "virtual" | "real";
  number: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  cardholderName: string;
  issuerCapMinorUnits: number | null;
}

const digitsOf = (value: string): string => value.replace(/\D/g, "");

/**
 * Validate a draft and build the daemon's input shape, or report which field
 * is wrong.
 *
 * Every message names the FIELD and never the value, for the same reason the
 * daemon's own fill result reports a `failedField` and no content: a validation
 * message is a read path like any other, and it ends up in a toast, a screen
 * reader announcement and possibly a screenshot.
 *
 * Luhn is deliberately not checked, matching the webui. A card that fails Luhn
 * is a typo the issuer will reject in a way the owner can act on, and a local
 * checksum that silently disagrees with a real card is worse than no check.
 */
export function buildCardCreateInput(
  draft: CardDraft,
  currency: string,
): { ok: true; input: CardCreateInput } | { ok: false; problem: CardDraftProblem } {
  const label = draft.label.trim();
  if (!label) {
    return { ok: false, problem: { field: "label", message: "Give the card a label so it can be told apart in a list." } };
  }

  const number = digitsOf(draft.number);
  if (number.length < 13 || number.length > 19) {
    return {
      ok: false,
      problem: { field: "number", message: "A card number is 13 to 19 digits. Check the number and enter it again." },
    };
  }

  const expiryMatch = /^(0[1-9]|1[0-2])\s*[/-]\s*(\d{2}|\d{4})$/.exec(draft.expiry.trim());
  if (!expiryMatch) {
    return { ok: false, problem: { field: "expiry", message: "Expiry goes in as MM/YY or MM/YYYY." } };
  }
  const expiryMonth = Number(expiryMatch[1]);
  const rawYear = expiryMatch[2] ?? "";
  // A two-digit year is expanded into THIS century rather than a sliding
  // window: a card printed 12/34 means 2034, and no issuer prints one that
  // expired eighty years ago.
  const expiryYear = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  if (expiryYear < 2000 || expiryYear > 2099) {
    return { ok: false, problem: { field: "expiry", message: "Expiry year must be in this century." } };
  }

  const cvv = draft.cvv.trim();
  if (!/^\d{3,4}$/.test(cvv)) {
    return { ok: false, problem: { field: "cvv", message: "The verification code is 3 or 4 digits." } };
  }

  const cardholderName = draft.cardholderName.trim();
  if (!cardholderName) {
    return {
      ok: false,
      problem: { field: "cardholderName", message: "The cardholder name has to match what is printed on the card." },
    };
  }

  let issuerCapMinorUnits: number | null = null;
  const capText = draft.issuerCap.trim();
  if (capText) {
    issuerCapMinorUnits = majorTextToMinorUnits(capText, currency);
    if (issuerCapMinorUnits === null) {
      return {
        ok: false,
        problem: {
          field: "issuerCap",
          message: `Enter the cap as a plain amount in ${currency || "the card currency"}, digits and at most one decimal point, with no grouping separators.`,
        },
      };
    }
  }

  return {
    ok: true,
    input: { label, kind: draft.kind, number, expiryMonth, expiryYear, cvv, cardholderName, issuerCapMinorUnits },
  };
}

/**
 * What the owner is told after a card is stored.
 *
 * Built from the METADATA the daemon sent back, which is the only thing there
 * is to build it from. The tui prints "stored securely (hidden)" and nothing
 * about the value; this says which card is now on file in the same terms the
 * list uses.
 */
export function cardStoredNote(card: StoredCard): string {
  const instrument = cardInstrumentLabel(card);
  return card.materialComplete
    ? `${card.label || "Card"} is on file as ${instrument}.`
    : `${card.label || "Card"} is on file as ${instrument}, but the daemon reports its stored material as incomplete.`;
}

// ---------------------------------------------------------------------------
// Checkout inputs
// ---------------------------------------------------------------------------

export type CardFieldName = "number" | "expiry" | "expiryMonth" | "expiryYear" | "cvv" | "cardholderName";

export const CARD_FIELD_NAMES: readonly CardFieldName[] = [
  "number",
  "expiry",
  "expiryMonth",
  "expiryYear",
  "cvv",
  "cardholderName",
];

/**
 * One "put this card field in that box" instruction.
 *
 * `ref` is a snapshot ref from the page the agent is looking at, and `field` is
 * a NAME. Neither is a value: the daemon reads the material in its own process
 * and does the typing, which is what lets the model orchestrate a purchase
 * without ever holding the instrument.
 */
export interface CardFieldTarget {
  field: CardFieldName;
  ref: string;
}

export interface CheckoutLineDraft {
  label: string;
  quantity: string;
  unitPrice: string;
}

export interface ShippingOptionDraft {
  label: string;
  cost: string;
}

export interface CheckoutDraft {
  sessionId: string;
  pageId: string;
  merchantDomain: string;
  checkoutUrl: string;
  item: string;
  cardId: string;
  requestedLabel: string;
  requestedQuantity: string;
  lines: CheckoutLineDraft[];
  tax: string;
  shippingOptions: ShippingOptionDraft[];
  statedTotal: string;
  currency: string;
  orderSummaryText: string;
  cardFields: CardFieldTarget[];
  placeOrderTarget: string;
  preferredTier: string;
  expirySeparator: string;
  twoDigitYear: boolean;
  requestedMax: string;
}

export function emptyCheckoutDraft(): CheckoutDraft {
  return {
    sessionId: "",
    pageId: "",
    merchantDomain: "",
    checkoutUrl: "",
    item: "",
    cardId: "",
    requestedLabel: "",
    requestedQuantity: "1",
    lines: [{ label: "", quantity: "1", unitPrice: "" }],
    tax: "",
    shippingOptions: [{ label: "", cost: "" }],
    statedTotal: "",
    currency: "",
    orderSummaryText: "",
    cardFields: [{ field: "number", ref: "" }],
    placeOrderTarget: "",
    preferredTier: "",
    expirySeparator: "",
    twoDigitYear: false,
    requestedMax: "",
  };
}

/**
 * The fields `payments.checkout.begin` refuses without.
 *
 * Taken from the descriptor's own `required` list rather than from reading the
 * handler, so this app cannot end up stricter or looser than the published
 * contract. `requestedLines`, `lines`, `shippingOptions` and `cardFields` also
 * carry `minItems: 1`, which is why an empty row is not a filled one.
 */
export function checkoutDraftMissing(draft: CheckoutDraft): string[] {
  const missing: string[] = [];
  if (!draft.sessionId.trim()) missing.push("sessionId");
  if (!draft.pageId.trim()) missing.push("pageId");
  if (!draft.merchantDomain.trim()) missing.push("merchantDomain");
  if (!draft.checkoutUrl.trim()) missing.push("checkoutUrl");
  if (!draft.item.trim()) missing.push("item");
  if (!draft.cardId.trim()) missing.push("cardId");
  if (!draft.requestedLabel.trim()) missing.push("requestedLines");
  if (!draft.lines.some((line) => line.label.trim() && line.unitPrice.trim())) missing.push("lines");
  if (!draft.shippingOptions.some((option) => option.label.trim() && option.cost.trim())) {
    missing.push("shippingOptions");
  }
  if (!draft.cardFields.some((target) => target.ref.trim())) missing.push("cardFields");
  if (!draft.placeOrderTarget.trim()) missing.push("placeOrderTarget");
  return missing;
}

/**
 * Build the begin body.
 *
 * Every amount goes as a STRING exactly as it was read off the page. The
 * daemon parses them with its own parser, which refuses anything ambiguous;
 * parsing them here and sending numbers would mean the daemon trusting this
 * app to have read "1.299,00" the same way it would, and that is the mistake
 * that costs a factor of a thousand.
 */
export function buildCheckoutBeginInput(draft: CheckoutDraft): Record<string, unknown> {
  const quantity = Number(draft.requestedQuantity.trim());
  const body: Record<string, unknown> = {
    sessionId: draft.sessionId.trim(),
    pageId: draft.pageId.trim(),
    merchantDomain: draft.merchantDomain.trim(),
    checkoutUrl: draft.checkoutUrl.trim(),
    item: draft.item.trim(),
    cardId: draft.cardId.trim(),
    requestedLines: [
      {
        label: draft.requestedLabel.trim(),
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      },
    ],
    lines: draft.lines
      .filter((line) => line.label.trim() && line.unitPrice.trim())
      .map((line) => ({
        label: line.label.trim(),
        quantity: line.quantity.trim() || "1",
        unitPrice: line.unitPrice.trim(),
      })),
    fees: [],
    shippingOptions: draft.shippingOptions
      .filter((option) => option.label.trim() && option.cost.trim())
      .map((option) => ({ label: option.label.trim(), cost: option.cost.trim() })),
    orderSummaryText: draft.orderSummaryText,
    cardFields: draft.cardFields
      .filter((target) => target.ref.trim())
      .map((target) => ({ field: target.field, ref: target.ref.trim() })),
    addressFields: [],
    shippingTargets: [],
    placeOrderTarget: draft.placeOrderTarget.trim(),
    twoDigitYear: draft.twoDigitYear,
  };
  // Optional keys are omitted rather than sent empty: the schema types `tax`
  // and `statedTotal` as strings the daemon will PARSE, and an empty string is
  // an amount it would have to refuse rather than an absent one.
  if (draft.tax.trim()) body["tax"] = draft.tax.trim();
  if (draft.statedTotal.trim()) body["statedTotal"] = draft.statedTotal.trim();
  if (draft.currency.trim()) body["currency"] = draft.currency.trim().toUpperCase();
  if (draft.preferredTier.trim()) body["preferredTier"] = draft.preferredTier.trim();
  if (draft.expirySeparator) body["expirySeparator"] = draft.expirySeparator;
  if (draft.requestedMax.trim()) body["requestedMax"] = draft.requestedMax.trim();
  return body;
}

export interface FillCardDraft {
  sessionId: string;
  pageId: string;
  targets: CardFieldTarget[];
  expirySeparator: string;
  twoDigitYear: boolean;
}

export function emptyFillCardDraft(): FillCardDraft {
  return { sessionId: "", pageId: "", targets: [{ field: "number", ref: "" }], expirySeparator: "", twoDigitYear: false };
}

export function fillCardDraftMissing(draft: FillCardDraft): string[] {
  const missing: string[] = [];
  if (!draft.sessionId.trim()) missing.push("sessionId");
  if (!draft.pageId.trim()) missing.push("pageId");
  if (!draft.targets.some((target) => target.ref.trim())) missing.push("targets");
  return missing;
}

export function buildFillCardInput(draft: FillCardDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    sessionId: draft.sessionId.trim(),
    pageId: draft.pageId.trim(),
    targets: draft.targets
      .filter((target) => target.ref.trim())
      .map((target) => ({ field: target.field, ref: target.ref.trim() })),
    twoDigitYear: draft.twoDigitYear,
  };
  if (draft.expirySeparator) body["expirySeparator"] = draft.expirySeparator;
  return body;
}

/**
 * A fill result as a sentence.
 *
 * Names fields and nothing else, because field names and a boolean are the
 * entire content of the response. A failure says which box did not take the
 * value, never what the value was.
 */
export function describeFillResult(result: FillCardResult): string {
  if (result.ok) {
    return result.filled.length > 0
      ? `Filled ${result.filled.join(", ")}.`
      : "The daemon reported success without naming a filled field.";
  }
  const failed = result.failedField ? `Stopped at ${result.failedField}.` : "Stopped without naming a field.";
  const filled = result.filled.length > 0 ? ` Filled first: ${result.filled.join(", ")}.` : "";
  const reason = result.reason ? ` ${result.reason}` : "";
  return `${failed}${filled}${reason}`;
}

// ---------------------------------------------------------------------------
// The verbs
// ---------------------------------------------------------------------------

export const paymentsApi = {
  budget: async (): Promise<BudgetStatus> => parseBudgetStatus(await gv.payments.budget.status()),
  cards: async (): Promise<CardsList> => parseCardsList(await gv.payments.cards.list()),
  /**
   * The one call in this app that carries card material.
   *
   * `input` is built immediately before the call and is not stored, returned,
   * logged, or handed to React Query. The response is metadata.
   */
  createCard: async (input: CardCreateInput): Promise<StoredCard> =>
    parseCardCreated(await gv.payments.cards.create(input)),
  deleteCard: async (id: string): Promise<CardDeleteOutcome> =>
    parseCardDeleted(await gv.payments.cards.delete(id)),
  purchases: async (limit: number, dayKey: string): Promise<PurchasesList> =>
    parsePurchasesList(await gv.payments.purchases.list({ limit, ...(dayKey ? { dayKey } : {}) })),
  beginCheckout: async (draft: CheckoutDraft): Promise<CheckoutBeginResult> =>
    parseBeginResult(await gv.payments.checkout.begin(buildCheckoutBeginInput(draft))),
  fillCard: async (draft: FillCardDraft): Promise<FillCardResult> =>
    parseFillResult(await gv.payments.checkout.fillCard(buildFillCardInput(draft))),
} as const;
