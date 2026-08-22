// Cards: what is on file, and the intake flow that puts one there.
//
// ── The security model, and where each decision came from ───────────────────
//
// This panel mirrors two existing surfaces rather than inventing a third
// model. The tui's /payments card (goodvibes-tui
// src/input/commands/payment-card-intake.ts) is where the rules about what may
// be shown, stored and said come from; the webui's PaymentCardEntry is where
// the browser-specific hardening comes from, and a webview is a browser for
// every purpose that matters here.
//
// Mirrored from the tui, decision by decision:
//
//  - CONCEALED, NOT PLAINTEXT. The tui takes every card secret through
//    `beginConcealedInput` and refuses outright when concealed input is
//    unavailable rather than falling back to an unmasked prompt. The number
//    and the verification code are concealed here for the same reason, and
//    the concealment is not optional or toggleable.
//  - NOTHING IS ECHOED. The tui prints "stored securely (hidden)" and a
//    per-field "set / not set", never the value. Here the success toast names
//    the card by its label and the metadata the daemon sent back, the list
//    shows `brand ···last4`, and no code path renders a submitted value again.
//  - NOTHING IS LOGGED. The tui keeps card material out of the transcript,
//    input history and every log line. There is no console call anywhere in
//    this file, and validation problems name a FIELD, never a value
//    (buildCardCreateInput).
//  - THE FLOW IS GATED, AND THE GATE IS REAL. The tui checks the SDK's
//    entry-surface allowlist before it prompts, even though it is itself
//    always on the list, on the grounds that the check should exist before a
//    path to this command appears from somewhere else. Same here, through
//    mayOfferCardEntry / CARD_ENTRY_SURFACE.
//  - A REFUSED SURFACE IS NOT ASKED. The tui prints the refusal and returns
//    without prompting; the SDK's reasoning is that the prompt is itself the
//    harm. When the gate refuses, this renders no inputs at all, not disabled
//    ones, not a hidden form.
//  - CANCELLING LEAVES NOTHING BEHIND. Esc in the tui stops the chain and
//    stores nothing further. Cancel here clears the whole draft, not just the
//    field in focus.
//  - THE EXAMPLES ARE OBVIOUSLY FAKE. The tui's own prompts use
//    4242424242424242, 12/34 and 123; CARD_PLACEHOLDERS carries the same ones.
//
// Added from the webui, all of them browser problems a terminal does not have:
// visual concealment via CSS rather than a password-typed input (which is the
// loudest possible signal to a password manager, and the owner's fifth
// condition is that these fields must not present as saveable), the
// CARD_INPUT_GUARDS attribute set, no <form> element and no `name` attributes,
// and a plain async submit instead of useMutation because a mutation retains
// its `variables` (see CARD_SUBMIT_IS_NOT_A_MUTATION).

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Lock, RefreshCw, Trash2 } from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { useToast } from "../../lib/toast.ts";
import { formatError } from "../../lib/errors.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  CARD_ENTRY_CONDITIONS,
  CARD_ENTRY_SURFACE,
  CARD_INPUT_GUARDS,
  CARD_PLACEHOLDERS,
  PAYMENTS_POLL_MS,
  buildCardCreateInput,
  cardExpiryLabel,
  cardInstrumentLabel,
  cardStoredNote,
  describeAppCardEntryRefusal,
  emptyCardDraft,
  formatMinorUnits,
  mayOfferCardEntry,
  paymentsApi,
  paymentsRefusal,
  type CardDraft,
  type CardDraftProblem,
  type StoredCard,
} from "./payments-data.ts";

/** The currency the issuer cap is read in. The daemon's own default when the
 *  budget verb cannot be reached to say otherwise (`payments.currency`). */
const FALLBACK_CURRENCY = "USD";

export function CardsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const cards = useQuery({
    queryKey: queryKeys.paymentsCards,
    queryFn: paymentsApi.cards,
    retry: false,
    refetchInterval: PAYMENTS_POLL_MS,
  });

  const budget = useQuery({
    queryKey: queryKeys.paymentsBudget,
    queryFn: paymentsApi.budget,
    retry: false,
    // Read here only for the currency the issuer cap is entered in. The panel
    // below owns rendering the budget itself.
    refetchInterval: PAYMENTS_POLL_MS,
  });
  const currency = budget.data?.currency || FALLBACK_CURRENCY;

  const offered = mayOfferCardEntry(CARD_ENTRY_SURFACE);

  const [draft, setDraft] = useState<CardDraft>(emptyCardDraft);
  const [problem, setProblem] = useState<CardDraftProblem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Two refs, both about a response arriving after the thing that asked for it
  // has gone: `alive` is false once this panel unmounts, and `submitSeq`
  // identifies which submit a resolved promise belongs to. Without them a slow
  // create can clear a draft the owner has since started retyping, or announce
  // a stored card into a view that is no longer on screen.
  const alive = useRef(true);
  const submitSeq = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // The component's own state goes with the unmount (this view is
      // keepAlive:false, so hiding it unmounts it), and bumping the sequence
      // makes any in-flight submit's continuation a no-op rather than a late
      // write into a dead component.
      submitSeq.current += 1;
    };
  }, []);

  const remove = useMutation({
    // The variables here are a card id, which is metadata the list already
    // shows. Nothing card-material goes through a mutation in this file.
    mutationFn: (id: string) => paymentsApi.deleteCard(id),
    onSuccess: async (outcome) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      if (!outcome.deleted) {
        toast({
          title: "Card not deleted",
          description: "The daemon reported the card as still on file.",
          tone: "danger",
        });
        return;
      }
      toast({
        title: "Card deleted",
        description:
          outcome.secretsCleared > 0
            ? `${outcome.secretsCleared} stored secret ${outcome.secretsCleared === 1 ? "entry" : "entries"} cleared with it.`
            : "The daemon cleared no secret entries with it, so some of its material may already have been gone.",
        tone: "success",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to delete the card", description: formatError(error), tone: "danger" }),
  });

  async function submitCard(): Promise<void> {
    const built = buildCardCreateInput(draft, currency);
    if (!built.ok) {
      setProblem(built.problem);
      return;
    }
    setProblem(null);
    setSubmitting(true);
    const seq = (submitSeq.current += 1);
    try {
      const card = await paymentsApi.createCard(built.input);
      if (!alive.current || seq !== submitSeq.current) return;
      // Cleared FIRST, before anything that can throw or await, so the values
      // are out of component state at the earliest point the response allows.
      setDraft(emptyCardDraft());
      await queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      toast({ title: "Card stored", description: cardStoredNote(card), tone: "success" });
    } catch (error: unknown) {
      if (!alive.current || seq !== submitSeq.current) return;
      // The draft is deliberately NOT cleared on failure: a transport blip
      // should not cost the owner a full retype of a card he is holding. The
      // error text is the daemon's own and cannot contain what was sent, the
      // route discards the service's error rather than forwarding it, exactly
      // so a failure is not a read path.
      toast({ title: "Failed to store the card", description: formatError(error), tone: "danger" });
    } finally {
      if (alive.current && seq === submitSeq.current) setSubmitting(false);
    }
  }

  function cancelIntake(): void {
    // The whole draft, not the focused field. A cancelled intake leaves
    // nothing behind, the same as Esc part-way through the tui's chain.
    setDraft(emptyCardDraft());
    setProblem(null);
  }

  const refusal = cards.isError ? paymentsRefusal(cards.error, "payments.cards.list") : null;
  // The intake form can render during the initial load window and then vanish
  // when a refusal lands. The typed draft must not outlive the visible form:
  // clearing it here keeps card digits out of retained state the moment the
  // inputs stop being on screen.
  const intakeVisible = offered && !refusal;
  useEffect(() => {
    if (!intakeVisible) {
      setDraft(emptyCardDraft);
      setProblem(null);
    }
  }, [intakeVisible]);
  const rows = cards.data?.cards ?? [];
  const defaultCardId = cards.data?.defaultCardId ?? "";

  return (
    <section className="payments-section" aria-labelledby="payments-cards-heading">
      <div className="payments-section__header">
        <h2 id="payments-cards-heading">Cards</h2>
        <div className="payments-section__meta">
          <button
            type="button"
            className="payments-icon-button"
            title="Refresh"
            aria-label="Refresh cards"
            onClick={() => void cards.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={cards.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      {cards.isPending && <SkeletonBlock variant="text" lines={3} />}
      {refusal && <UnavailableState capability={refusal.capability} description={refusal.description} />}
      {cards.isError && !refusal && (
        <ErrorState error={cards.error} onRetry={() => void cards.refetch()} title="Failed to load cards" />
      )}

      {cards.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<CreditCard size={20} aria-hidden="true" />}
          title="No card on file"
          description="Without a card the payment capability refuses every purchase outright. That is the safe direction, not a fault."
        />
      )}

      {rows.length > 0 && (
        <ul className="payments-card-list">
          {rows.map((card) => (
            <CardRow
              key={card.id}
              card={card}
              currency={currency}
              isDefault={card.id === defaultCardId}
              onRemove={() => remove.mutate(card.id)}
              removing={remove.isPending && remove.variables === card.id}
            />
          ))}
        </ul>
      )}

      {!offered && (
        <p className="payments-entry-refusal" role="status">
          {describeAppCardEntryRefusal(CARD_ENTRY_SURFACE)}
        </p>
      )}

      {offered && !refusal && (
        <div className="payments-intake">
          <h3>
            <Lock size={15} aria-hidden="true" /> Add a card
          </h3>
          <p className="payments-intake__lead">
            The number and the verification code are concealed as you type and are posted straight to the daemon. They
            are never shown again, by anything: no verb reads them back, and nothing about them is kept here after this
            form is submitted or closed.
          </p>

          {/* No <form> element and no `name` on any input, both deliberate: a
              named field inside a form is what a password manager looks for
              when it decides whether to offer to save something. */}
          <div className="payments-intake__grid">
            <label>
              <span>Label</span>
              <input
                type="text"
                value={draft.label}
                placeholder="Everyday virtual card"
                aria-invalid={problem?.field === "label" || undefined}
                onChange={(event) => {
                  setDraft({ ...draft, label: event.target.value });
                }}
                {...CARD_INPUT_GUARDS}
              />
            </label>

            <label>
              <span>Kind</span>
              <select
                value={draft.kind}
                onChange={(event) => {
                  setDraft({ ...draft, kind: event.target.value === "real" ? "real" : "virtual" });
                }}
              >
                <option value="virtual">Virtual</option>
                <option value="real">Real</option>
              </select>
            </label>

            <label className="payments-intake__wide">
              <span>Card number</span>
              <input
                type="text"
                inputMode="numeric"
                className="payments-concealed"
                value={draft.number}
                placeholder={CARD_PLACEHOLDERS.number}
                aria-invalid={problem?.field === "number" || undefined}
                onChange={(event) => {
                  setDraft({ ...draft, number: event.target.value });
                }}
                {...CARD_INPUT_GUARDS}
              />
            </label>

            <label>
              <span>Expiry</span>
              <input
                type="text"
                inputMode="numeric"
                value={draft.expiry}
                placeholder={CARD_PLACEHOLDERS.expiry}
                aria-invalid={problem?.field === "expiry" || undefined}
                onChange={(event) => {
                  setDraft({ ...draft, expiry: event.target.value });
                }}
                {...CARD_INPUT_GUARDS}
              />
            </label>

            <label>
              <span>Verification code</span>
              <input
                type="text"
                inputMode="numeric"
                className="payments-concealed"
                value={draft.cvv}
                placeholder={CARD_PLACEHOLDERS.cvv}
                aria-invalid={problem?.field === "cvv" || undefined}
                onChange={(event) => {
                  setDraft({ ...draft, cvv: event.target.value });
                }}
                {...CARD_INPUT_GUARDS}
              />
            </label>

            <label className="payments-intake__wide">
              <span>Cardholder name</span>
              <input
                type="text"
                value={draft.cardholderName}
                placeholder={CARD_PLACEHOLDERS.cardholderName}
                aria-invalid={problem?.field === "cardholderName" || undefined}
                onChange={(event) => {
                  setDraft({ ...draft, cardholderName: event.target.value });
                }}
                {...CARD_INPUT_GUARDS}
              />
            </label>

            <label>
              <span>Issuer cap ({currency}, optional)</span>
              <input
                type="text"
                inputMode="decimal"
                value={draft.issuerCap}
                placeholder="250"
                aria-invalid={problem?.field === "issuerCap" || undefined}
                onChange={(event) => {
                  setDraft({ ...draft, issuerCap: event.target.value });
                }}
                {...CARD_INPUT_GUARDS}
              />
              <span className="payments-intake__hint">
                What you told the issuer this card may spend. Recorded as declared and never treated as enforcement:
                the daemon cannot verify it.
              </span>
            </label>
          </div>

          {problem && (
            <p className="payments-intake__problem" role="alert">
              {problem.message}
            </p>
          )}

          <div className="payments-intake__actions">
            <button type="button" disabled={submitting} onClick={() => void submitCard()}>
              {submitting ? "Storing…" : "Store card"}
            </button>
            <button type="button" className="payments-intake__cancel" onClick={cancelIntake} disabled={submitting}>
              Clear
            </button>
          </div>

          <details className="payments-intake__conditions">
            <summary>What this form holds itself to</summary>
            <ul>
              {CARD_ENTRY_CONDITIONS.map((condition) => (
                <li key={condition}>{condition}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}

interface CardRowProps {
  card: StoredCard;
  currency: string;
  isDefault: boolean;
  onRemove: () => void;
  removing: boolean;
}

function CardRow({ card, currency, isDefault, onRemove, removing }: CardRowProps) {
  const [confirming, setConfirming] = useState(false);
  const expiry = cardExpiryLabel(card);

  return (
    <li className="payments-card-row">
      <div className="payments-card-row__main">
        <div className="payments-card-row__titles">
          <span className="payments-card-row__label">{card.label || "Unlabelled card"}</span>
          {/* `last4` is what the daemon sent and all it sent. Rendered with a
              leading glyph rather than padded out to a full card shape, which
              would invent twelve digits of structure. */}
          <span className="payments-card-row__instrument">{cardInstrumentLabel(card)}</span>
        </div>
        <div className="payments-card-row__badges">
          {isDefault && <span className="badge ok">Default</span>}
          {card.kind && <span className="badge neutral">{card.kind}</span>}
          {card.materialComplete ? (
            <span className="badge ok">Material complete</span>
          ) : (
            <span className="badge warning">Material incomplete</span>
          )}
        </div>
      </div>

      <div className="payments-card-row__facts">
        {expiry && <span>Expires {expiry}</span>}
        {card.issuerCapMinorUnits !== null && (
          <span>Declared cap {formatMinorUnits(card.issuerCapMinorUnits, currency)}</span>
        )}
      </div>

      <div className="payments-card-row__actions">
        {confirming ? (
          <>
            <span className="payments-card-row__confirm">
              Delete this card and every secret stored under it?
              {isDefault && " It is the default, so purchases refuse until another card is chosen."}
            </span>
            <button type="button" className="payments-danger" disabled={removing} onClick={onRemove}>
              {removing ? "Deleting…" : "Delete"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={removing}>
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="payments-icon-button"
            title="Delete card"
            aria-label={`Delete ${card.label || "card"}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}
