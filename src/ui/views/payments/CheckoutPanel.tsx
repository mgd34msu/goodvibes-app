// Checkout: driving `payments.checkout.begin` and `payments.checkout.fillCard`
// against a checkout page that is already open.
//
// ── What these two verbs actually are, and why this panel looks like this ────
//
// Neither verb is a button that buys something. Both take a live browser
// session id, a page id, and snapshot REFS pointing at boxes on the page the
// agent is currently looking at — `begin` also wants the cart as it was READ
// off that page, every amount as the string it appeared as. That shape exists
// because the daemon parses those strings with its own parser rather than
// trusting whoever did the reading, which is the difference between "1.299,00"
// meaning one thousand or one and a bit.
//
// So this is a console for a checkout the agent has already opened, not a
// shopping surface. It is here for the case where the owner wants to drive or
// resume one himself, or see exactly what the daemon says when asked. The
// fields are the descriptor's own required list, in its order, and nothing is
// invented to make the form look friendlier than the verb is.
//
// ── What is honest about the card here ──────────────────────────────────────
//
// `fillCard` is the one verb that causes a card to be typed, and it is the
// sharpest example of the containment rather than an exception to it: what
// goes in is a card id and a list of field NAMES with refs, and what comes
// back is a list of field names and a boolean. The daemon reads the material
// in its own process and does the typing. This panel therefore never has, asks
// for, or displays any card value, and a failure names the box that did not
// take the value and never the value.
//
// Each step reports what the daemon said. A refusal is printed as the sentence
// it is, with its outcome word intact.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, Keyboard } from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { formatError } from "../../lib/errors.ts";
import { ErrorState, UnavailableState } from "../../components/feedback.tsx";
import {
  CARD_FIELD_NAMES,
  PAYMENTS_POLL_MS,
  buildCheckoutBeginInput,
  checkoutDraftMissing,
  describeFillResult,
  emptyCheckoutDraft,
  emptyFillCardDraft,
  fillCardDraftMissing,
  formatMinorUnits,
  outcomeTone,
  paymentsApi,
  paymentsRefusal,
  type CardFieldName,
  type CheckoutBeginResult,
  type CheckoutDraft,
  type FillCardDraft,
  type FillCardResult,
} from "./payments-data.ts";

export function CheckoutPanel() {
  const cards = useQuery({
    queryKey: queryKeys.paymentsCards,
    queryFn: paymentsApi.cards,
    retry: false,
    refetchInterval: PAYMENTS_POLL_MS,
  });
  const cardRows = cards.data?.cards ?? [];

  const [draft, setDraft] = useState<CheckoutDraft>(emptyCheckoutDraft);
  const [fill, setFill] = useState<FillCardDraft>(emptyFillCardDraft);
  const [beginResult, setBeginResult] = useState<CheckoutBeginResult | null>(null);
  const [beginError, setBeginError] = useState<string | null>(null);
  const [beginning, setBeginning] = useState(false);
  const [fillResult, setFillResult] = useState<FillCardResult | null>(null);
  const [fillError, setFillError] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);

  // Same late-response discipline the card intake uses: a begin can take as
  // long as a checkout takes, and the owner can have changed the draft or left
  // the view by the time it answers. A superseded attempt must not overwrite
  // the outcome of the one that replaced it.
  const alive = useRef(true);
  const beginSeq = useRef(0);
  const fillSeq = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      beginSeq.current += 1;
      fillSeq.current += 1;
    };
  }, []);

  const missing = checkoutDraftMissing(draft);
  const fillMissing = fillCardDraftMissing(fill);

  async function runBegin(): Promise<void> {
    if (missing.length > 0) return;
    setBeginning(true);
    setBeginError(null);
    setBeginResult(null);
    const seq = (beginSeq.current += 1);
    try {
      const result = await paymentsApi.beginCheckout(draft);
      if (!alive.current || seq !== beginSeq.current) return;
      setBeginResult(result);
    } catch (error: unknown) {
      if (!alive.current || seq !== beginSeq.current) return;
      setBeginError(formatError(error));
    } finally {
      if (alive.current && seq === beginSeq.current) setBeginning(false);
    }
  }

  async function runFill(): Promise<void> {
    if (fillMissing.length > 0) return;
    setFilling(true);
    setFillError(null);
    setFillResult(null);
    const seq = (fillSeq.current += 1);
    try {
      const result = await paymentsApi.fillCard(fill);
      if (!alive.current || seq !== fillSeq.current) return;
      setFillResult(result);
    } catch (error: unknown) {
      if (!alive.current || seq !== fillSeq.current) return;
      setFillError(formatError(error));
    } finally {
      if (alive.current && seq === fillSeq.current) setFilling(false);
    }
  }

  // The capability probe rides on the cards read rather than a call of its
  // own: begin and fillCard are both writes, and probing a write by attempting
  // one is not a probe. When cards.list is refused for a composition reason,
  // these two are refused for the same reason.
  const refusal = cards.isError ? paymentsRefusal(cards.error, "payments.checkout.begin") : null;

  return (
    <section className="payments-section" aria-labelledby="payments-checkout-heading">
      <div className="payments-section__header">
        <h2 id="payments-checkout-heading">Checkout</h2>
      </div>

      <p className="payments-checkout__lead">
        These two verbs act on a checkout page the agent already has open: they take a browser session, a page, and
        refs to the boxes on it. Nothing here opens a page or finds a product. Amounts go to the daemon exactly as they
        were read off the page, as text, because the daemon parses them itself rather than trusting a caller&rsquo;s
        reading.
      </p>

      {refusal && <UnavailableState capability={refusal.capability} description={refusal.description} />}

      {cards.isError && !refusal && (
        <ErrorState
          error={cards.error}
          onRetry={() => void cards.refetch()}
          title="Failed to read the stored cards"
        />
      )}

      <div className="payments-checkout__step">
        <h3>
          <CircleDollarSign size={15} aria-hidden="true" /> Begin a purchase
        </h3>

        <div className="payments-checkout__grid">
          <TextField
            label="Session id"
            value={draft.sessionId}
            onChange={(value) => setDraft({ ...draft, sessionId: value })}
          />
          <TextField label="Page id" value={draft.pageId} onChange={(value) => setDraft({ ...draft, pageId: value })} />
          <TextField
            label="Merchant domain"
            value={draft.merchantDomain}
            placeholder="example.com"
            onChange={(value) => setDraft({ ...draft, merchantDomain: value })}
          />
          <TextField
            label="Checkout URL"
            value={draft.checkoutUrl}
            onChange={(value) => setDraft({ ...draft, checkoutUrl: value })}
          />
          <TextField
            label="Item, in the owner's own words"
            value={draft.item}
            hint="Never a page title: this is what was asked for, and the cart is checked against it."
            onChange={(value) => setDraft({ ...draft, item: value })}
          />
          <label>
            <span>Card</span>
            <select value={draft.cardId} onChange={(event) => setDraft({ ...draft, cardId: event.target.value })}>
              <option value="">Choose a card</option>
              {cardRows.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.label || card.id} ···{card.last4}
                </option>
              ))}
            </select>
          </label>

          <TextField
            label="Asked for: label"
            value={draft.requestedLabel}
            onChange={(value) => setDraft({ ...draft, requestedLabel: value })}
          />
          <TextField
            label="Asked for: quantity"
            value={draft.requestedQuantity}
            onChange={(value) => setDraft({ ...draft, requestedQuantity: value })}
          />

          <TextField
            label="Cart line: label"
            value={draft.lines[0]?.label ?? ""}
            onChange={(value) =>
              setDraft({
                ...draft,
                lines: [{ ...(draft.lines[0] ?? { label: "", quantity: "1", unitPrice: "" }), label: value }],
              })
            }
          />
          <TextField
            label="Cart line: quantity, as shown"
            value={draft.lines[0]?.quantity ?? ""}
            onChange={(value) =>
              setDraft({
                ...draft,
                lines: [{ ...(draft.lines[0] ?? { label: "", quantity: "1", unitPrice: "" }), quantity: value }],
              })
            }
          />
          <TextField
            label="Cart line: unit price, as shown"
            value={draft.lines[0]?.unitPrice ?? ""}
            placeholder="19.99"
            hint="Copy it exactly as the page prints it. The daemon parses it."
            onChange={(value) =>
              setDraft({
                ...draft,
                lines: [{ ...(draft.lines[0] ?? { label: "", quantity: "1", unitPrice: "" }), unitPrice: value }],
              })
            }
          />

          <TextField
            label="Shipping option: label"
            value={draft.shippingOptions[0]?.label ?? ""}
            onChange={(value) =>
              setDraft({ ...draft, shippingOptions: [{ ...(draft.shippingOptions[0] ?? { label: "", cost: "" }), label: value }] })
            }
          />
          <TextField
            label="Shipping option: cost, as shown"
            value={draft.shippingOptions[0]?.cost ?? ""}
            onChange={(value) =>
              setDraft({ ...draft, shippingOptions: [{ ...(draft.shippingOptions[0] ?? { label: "", cost: "" }), cost: value }] })
            }
          />

          <TextField
            label="Tax, as shown (optional)"
            value={draft.tax}
            onChange={(value) => setDraft({ ...draft, tax: value })}
          />
          <TextField
            label="Stated total, as shown (optional)"
            value={draft.statedTotal}
            onChange={(value) => setDraft({ ...draft, statedTotal: value })}
          />
          <TextField
            label="Currency (optional)"
            value={draft.currency}
            placeholder="USD"
            onChange={(value) => setDraft({ ...draft, currency: value })}
          />
          <TextField
            label="Most it may cost (optional)"
            value={draft.requestedMax}
            onChange={(value) => setDraft({ ...draft, requestedMax: value })}
          />

          <CardTargetField
            label="Card field target"
            field={draft.cardFields[0]?.field ?? "number"}
            ref_={draft.cardFields[0]?.ref ?? ""}
            onField={(field) => setDraft({ ...draft, cardFields: [{ field, ref: draft.cardFields[0]?.ref ?? "" }] })}
            onRef={(ref) =>
              setDraft({ ...draft, cardFields: [{ field: draft.cardFields[0]?.field ?? "number", ref }] })
            }
          />
          <TextField
            label="Place-order target"
            value={draft.placeOrderTarget}
            onChange={(value) => setDraft({ ...draft, placeOrderTarget: value })}
          />
          <label>
            <span>Preferred delivery tier (optional)</span>
            <select
              value={draft.preferredTier}
              onChange={(event) => setDraft({ ...draft, preferredTier: event.target.value })}
            >
              <option value="">Let the ladder choose</option>
              <option value="normal">normal</option>
              <option value="fast">fast</option>
              <option value="fastest">fastest</option>
            </select>
          </label>
        </div>

        <label className="payments-checkout__summary">
          <span>Order summary text, as the page printed it</span>
          <textarea
            rows={3}
            value={draft.orderSummaryText}
            onChange={(event) => setDraft({ ...draft, orderSummaryText: event.target.value })}
          />
        </label>

        <div className="payments-checkout__actions">
          <button type="button" disabled={missing.length > 0 || beginning} onClick={() => void runBegin()}>
            {beginning ? "Asking the daemon…" : "Begin"}
          </button>
          {missing.length > 0 && (
            <span className="payments-checkout__missing">
              The daemon refuses a begin without: {missing.join(", ")}.
            </span>
          )}
        </div>

        {beginError && (
          <p className="payments-checkout__error" role="alert">
            {beginError}
          </p>
        )}

        {beginResult && <BeginOutcome result={beginResult} />}

        <details className="payments-checkout__wire">
          <summary>What would be sent</summary>
          {/* The begin body has no property that can hold card material — the
              card is named by id and the boxes by ref — so showing it is safe
              in a way the intake form's input never would be. */}
          <pre>{JSON.stringify(buildCheckoutBeginInput(draft), null, 2)}</pre>
        </details>
      </div>

      <div className="payments-checkout__step">
        <h3>
          <Keyboard size={15} aria-hidden="true" /> Type the card into the page
        </h3>
        <p className="payments-checkout__lead">
          The daemon reads the stored card in its own process and types it. This asks it to, by naming which field goes
          in which box; no card value passes through this app in either direction, and a failure names the box.
        </p>

        <div className="payments-checkout__grid">
          <TextField
            label="Session id"
            value={fill.sessionId}
            onChange={(value) => setFill({ ...fill, sessionId: value })}
          />
          <TextField label="Page id" value={fill.pageId} onChange={(value) => setFill({ ...fill, pageId: value })} />
          <CardTargetField
            label="Target"
            field={fill.targets[0]?.field ?? "number"}
            ref_={fill.targets[0]?.ref ?? ""}
            onField={(field) => setFill({ ...fill, targets: [{ field, ref: fill.targets[0]?.ref ?? "" }] })}
            onRef={(ref) => setFill({ ...fill, targets: [{ field: fill.targets[0]?.field ?? "number", ref }] })}
          />
          <TextField
            label="Expiry separator (optional)"
            value={fill.expirySeparator}
            placeholder="/"
            hint="Some checkouts want 07/2029, some want 07 / 29."
            onChange={(value) => setFill({ ...fill, expirySeparator: value })}
          />
        </div>

        <label className="payments-checkout__checkbox">
          <input
            type="checkbox"
            checked={fill.twoDigitYear}
            onChange={(event) => setFill({ ...fill, twoDigitYear: event.target.checked })}
          />
          <span>The expiry box takes a two-digit year</span>
        </label>

        <div className="payments-checkout__actions">
          <button type="button" disabled={fillMissing.length > 0 || filling} onClick={() => void runFill()}>
            {filling ? "Typing…" : "Fill card"}
          </button>
          {fillMissing.length > 0 && (
            <span className="payments-checkout__missing">
              The daemon refuses a fill without: {fillMissing.join(", ")}.
            </span>
          )}
        </div>

        {fillError && (
          <p className="payments-checkout__error" role="alert">
            {fillError}
          </p>
        )}

        {fillResult && (
          <p className={`payments-checkout__outcome ${fillResult.ok ? "ok" : "bad"}`} role="status">
            {describeFillResult(fillResult)}
          </p>
        )}
      </div>
    </section>
  );
}

function BeginOutcome({ result }: { result: CheckoutBeginResult }) {
  return (
    <div className="payments-begin-outcome" role="status">
      <div className="payments-begin-outcome__header">
        <span className={`badge ${outcomeTone(result.outcome)}`}>{result.outcome || "unstated"}</span>
        {result.totalMinorUnits !== null && (
          <span className="payments-begin-outcome__total">
            {formatMinorUnits(result.totalMinorUnits, result.currency ?? "")}
          </span>
        )}
      </div>

      {/* The daemon's own sentence, printed as it came. */}
      {result.reason && <p className="payments-begin-outcome__reason">{result.reason}</p>}

      <dl className="payments-begin-outcome__facts">
        {result.purchaseId && (
          <div>
            <dt>Purchase</dt>
            <dd>{result.purchaseId}</dd>
          </div>
        )}
        {result.merchantOrderId && (
          <div>
            <dt>Merchant order</dt>
            <dd>{result.merchantOrderId}</dd>
          </div>
        )}
        {result.shippingTierUsed && (
          <div>
            <dt>Delivery used</dt>
            <dd>
              {result.shippingTierUsed}
              {result.steppedDown ? " (stepped down to fit the overage pool)" : ""}
            </dd>
          </div>
        )}
        {result.challengeStep && (
          <div>
            <dt>Interrupted at</dt>
            <dd>{result.challengeStep}</dd>
          </div>
        )}
      </dl>

      {result.challengeStep && (
        <p className="payments-begin-outcome__challenge">
          The submit was interrupted by a step only a person can clear. Nothing further is attempted automatically.
        </p>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="payments-intake__hint">{hint}</span>}
    </label>
  );
}

function CardTargetField({
  label,
  field,
  ref_,
  onField,
  onRef,
}: {
  label: string;
  field: CardFieldName;
  ref_: string;
  onField: (field: CardFieldName) => void;
  onRef: (ref: string) => void;
}) {
  return (
    <label className="payments-target-field">
      <span>{label}</span>
      <div className="payments-target-field__row">
        <select value={field} onChange={(event) => onField(event.target.value as CardFieldName)}>
          {CARD_FIELD_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={ref_}
          placeholder="snapshot ref"
          aria-label={`${label} ref`}
          onChange={(event) => onRef(event.target.value)}
        />
      </div>
    </label>
  );
}
