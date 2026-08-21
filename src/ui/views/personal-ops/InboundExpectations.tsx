// The inbound half of the mail surface (docs/FEATURES.md §9): the watcher's
// disclosure verb (email.inbound.status) as a toolbar chip that opens the full
// disclosure in a peek, and the open verification expectations
// (email.expectation.list/open/cancel) as list rows.
//
// What an expectation IS, because the UI must not overstate it: an already
// authorized workstream declaring, BEFORE it submits a signup or checkout form,
// that one message is expected at one address from one service domain inside a
// bounded window. A matching message proves control of that address and grants
// nothing else, which is why every row renders the daemon's own
// `authority: evidence-only` verbatim instead of paraphrasing it.
//
// Both verbs are WS-only on the contract (no REST path), so they ride the
// /app/ws bridge through gv.invoke like every other [ws] method here. Cancel of
// an id that is not open answers `cancelled: false`, which the daemon documents
// as an answer rather than a failure, so it is reported as info, never danger.

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MailCheck, Plus, RefreshCw, X } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { asRecord } from "../../lib/wire.ts";
import { Modal } from "../../components/Modal.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import {
  formatRemaining,
  inboundMailRefusal,
  inboundStatusLabel,
  inboundStatusTone,
  parseExpectationTotal,
  parseExpectations,
  parseInboundStatus,
  poKeys,
  useEmailExpectations,
  useEmailInboundStatus,
  type EmailExpectation,
  type EmailInboundStatus,
} from "./personal-ops-data.ts";

// ─── Status chip (email.inbound.status) ──────────────────────────────────────

export function InboundStatusChip({ active }: { active: boolean }) {
  const peek = usePeek();
  const status = useEmailInboundStatus(true, active);

  if (status.isPending) {
    return (
      <span className="po-inbound-chip po-inbound-chip--pending" aria-label="Inbound mail status loading">
        Inbound: …
      </span>
    );
  }

  if (status.isError) {
    const refusal = inboundMailRefusal(status.error, "email.inbound.status");
    return (
      <span
        className="po-inbound-chip po-inbound-chip--off"
        title={refusal ? refusal.description : formatError(status.error)}
      >
        Inbound: off
      </span>
    );
  }

  const parsed = parseInboundStatus(status.data);
  const tone = inboundStatusTone(parsed);
  return (
    <button
      type="button"
      className={`po-inbound-chip po-inbound-chip--${tone}`}
      onClick={() =>
        peek.open({ title: "Inbound mail watcher", content: <InboundStatusDetail status={parsed} /> })
      }
      title={parsed.reason || parsed.sourceDetail || "Open the full inbound-mail disclosure"}
    >
      <MailCheck size={13} aria-hidden="true" /> {inboundStatusLabel(parsed)}
    </button>
  );
}

function InboundStatusDetail({ status }: { status: EmailInboundStatus }) {
  return (
    <div className="po-inbound-detail">
      <dl className="po-inbound-detail__facts">
        <dt>Watching</dt>
        <dd>
          {status.account || "(no account)"} · {status.mailbox || "(no mailbox)"}
        </dd>
        <dt>Mode</dt>
        <dd>
          {status.mode}
          {status.reason ? `: ${status.reason}` : ""}
        </dd>
        <dt>Enabled</dt>
        <dd>{status.enabled ? "yes" : "no"}</dd>
        <dt>Running</dt>
        <dd>{status.running ? "yes" : "no"}</dd>
        <dt>Source</dt>
        <dd>
          {status.sourceBasis || "unknown"}
          {status.sourceDetail ? `: ${status.sourceDetail}` : ""}
        </dd>
        {/* The daemon states latency as a SENTENCE so that "real-time" is never
            claimed for a poll; it is rendered as given, never reformatted. */}
        {status.sourceLatency && (
          <>
            <dt>Delay</dt>
            <dd>{status.sourceLatency}</dd>
          </>
        )}
        {status.capabilityState && (
          <>
            <dt>Capability</dt>
            <dd>
              {status.capabilityState}
              {status.capabilityReason ? `: ${status.capabilityReason}` : ""}
              {status.capabilityFix ? ` Fix: ${status.capabilityFix}` : ""}
            </dd>
          </>
        )}
        <dt>Notices</dt>
        <dd>
          {status.noticeState || "unreported"}
          {status.noticeReason ? `: ${status.noticeReason}` : ""}
          {status.noticeFix ? ` Fix: ${status.noticeFix}` : ""}
        </dd>
        <dt>Cursors</dt>
        <dd>{status.cursorCount}</dd>
        <dt>Expectations</dt>
        <dd>
          {status.expectationsOpen} open
          {status.expectationsMaxOpen === undefined ? "" : ` of ${status.expectationsMaxOpen} slots`}
        </dd>
      </dl>
      {status.stores.length > 0 && (
        <div className="po-inbound-detail__stores">
          <span className="po-inbound-detail__stores-title">Persisted stores</span>
          <ul>
            {status.stores.map((store) => (
              <li key={store.store}>
                <code>{store.store}</code> · {store.state}
                {store.detail ? `: ${store.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Expectations list (email.expectation.list / .open / .cancel) ───────────

interface ExpectationDraft {
  serviceDomain: string;
  recipientAddress: string;
  purpose: string;
  /** Blank means "use the daemon's configured window", never a guessed number. */
  windowMinutes: string;
}

const EMPTY_EXPECTATION: ExpectationDraft = {
  serviceDomain: "",
  recipientAddress: "",
  purpose: "",
  windowMinutes: "",
};

export function ExpectationsPanel({ active }: { active: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [openFormShown, setOpenFormShown] = useState(false);
  const [draft, setDraft] = useState<ExpectationDraft>(EMPTY_EXPECTATION);

  const expectations = useEmailExpectations(true, active);
  const rows = expectations.isSuccess ? parseExpectations(expectations.data) : [];
  const total = expectations.isSuccess ? parseExpectationTotal(expectations.data) : 0;
  const refusal = expectations.isError ? inboundMailRefusal(expectations.error, "email.expectation.list") : null;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: poKeys.emailExpectations }),
      queryClient.invalidateQueries({ queryKey: poKeys.emailInboundStatus }),
    ]);

  const openExpectation = useMutation({
    mutationFn: (input: ExpectationDraft) => {
      const windowMinutes = Number(input.windowMinutes);
      return gv.invoke("email.expectation.open", {
        body: {
          serviceDomain: input.serviceDomain.trim(),
          recipientAddress: input.recipientAddress.trim(),
          purpose: input.purpose.trim(),
          // Only sent when the operator actually typed one: the daemon clamps
          // and defaults the window itself, and an invented value would be this
          // surface overriding a policy it does not own.
          ...(input.windowMinutes.trim() && Number.isFinite(windowMinutes) && windowMinutes > 0
            ? { windowMs: Math.round(windowMinutes * 60_000) }
            : {}),
        },
      });
    },
    onSuccess: async (result) => {
      setOpenFormShown(false);
      setDraft(EMPTY_EXPECTATION);
      await invalidate();
      const record = asRecord(result);
      toast({
        title: "Expectation open",
        description: `Evidence-only until ${String(record["expiresAt"] ?? "its window closes")}. A matching message proves control of the address and can start nothing.`,
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      const note = inboundMailRefusal(error, "email.expectation.open");
      toast({
        title: "Could not open the expectation",
        description: note ? note.description : formatError(error),
        tone: "danger",
      });
    },
  });

  const cancelExpectation = useMutation({
    mutationFn: (expectation: EmailExpectation) =>
      gv.invoke("email.expectation.cancel", { body: { id: expectation.id } }),
    onSuccess: async (result, expectation) => {
      await invalidate();
      // `cancelled: false` means the id was not open. A miss, which the verb
      // documents as an answer rather than a failure.
      const cancelled = asRecord(result)["cancelled"] === true;
      toast({
        title: cancelled ? "Expectation cancelled" : "Nothing to cancel",
        description: cancelled
          ? `${expectation.serviceDomain} → ${expectation.recipientAddress}; its slot is free again.`
          : "That expectation was already closed or expired.",
        tone: "info",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Cancel failed", description: formatError(error), tone: "danger" }),
  });

  const draftValid =
    draft.serviceDomain.trim().length > 0 &&
    draft.recipientAddress.trim().includes("@") &&
    draft.purpose.trim().length > 0;

  return (
    <section className="po-panel po-expectations" aria-label="Verification expectations">
      <div className="po-toolbar">
        <span className="po-toolbar__summary">
          <MailCheck size={14} aria-hidden="true" /> Expected messages
          {expectations.isSuccess ? ` · ${total} open` : ""}
        </span>
        <div className="po-toolbar__actions">
          <button
            type="button"
            className="po-button"
            disabled={Boolean(refusal)}
            onClick={() => {
              setDraft(EMPTY_EXPECTATION);
              setOpenFormShown(true);
            }}
          >
            <Plus size={14} aria-hidden="true" /> Expect a message
          </button>
          <button
            type="button"
            className="po-icon-button"
            aria-label="Refresh expectations"
            onClick={() => void expectations.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={expectations.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      {expectations.isPending && <SkeletonBlock variant="text" lines={3} />}

      {refusal?.kind === "unconfigured" && (
        <EmptyState
          icon={<MailCheck size={28} aria-hidden="true" />}
          title={refusal.title}
          description={refusal.description}
        />
      )}

      {refusal?.kind === "unavailable" && (
        <UnavailableState capability={refusal.capability} description={refusal.description} />
      )}

      {expectations.isError && !refusal && (
        <ErrorState
          error={expectations.error}
          onRetry={() => void expectations.refetch()}
          title="Expectations failed to load"
        />
      )}

      {expectations.isSuccess && rows.length === 0 && (
        <EmptyState
          title="No message is expected"
          description="A workstream that is about to sign up somewhere registers the message it expects here first, so an arriving verification can be correlated to it."
        />
      )}

      {expectations.isSuccess && rows.length > 0 && (
        <ul className="po-expectation-list">
          {rows.map((row) => (
            <li key={row.id} className="po-expectation-row">
              <span className="po-expectation-row__domain">{row.serviceDomain}</span>
              <span className="po-expectation-row__address">{row.recipientAddress}</span>
              <span className="po-expectation-row__purpose">{row.purpose}</span>
              <span className="po-expectation-row__window" title={`Opened ${row.openedAt}, expires ${row.expiresAt}`}>
                {formatRemaining(row.remainingMs) || row.expiresAt}
              </span>
              {row.authority && <span className="badge neutral">{row.authority}</span>}
              {row.kind && <span className="badge info">{row.kind}</span>}
              <button
                type="button"
                className="po-icon-button"
                aria-label={`Cancel the expectation for ${row.recipientAddress}`}
                disabled={cancelExpectation.isPending && cancelExpectation.variables?.id === row.id}
                onClick={() => cancelExpectation.mutate(row)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={openFormShown} onClose={() => setOpenFormShown(false)} title="Expect a verification message">
        <form
          className="po-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (draftValid && !openExpectation.isPending) openExpectation.mutate(draft);
          }}
        >
          <p className="po-form__note">
            Registers, in advance, that one message is expected at one address from one service domain. A matching
            message proves control of the address and grants no command authority: it can never start work, widen the
            expectation, or extend its window.
          </p>
          <label className="po-form__label">
            Service domain
            <input
              type="text"
              value={draft.serviceDomain}
              onChange={(e) => setDraft({ ...draft, serviceDomain: e.target.value })}
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="po-form__label">
            Recipient address
            <input
              type="text"
              value={draft.recipientAddress}
              onChange={(e) => setDraft({ ...draft, recipientAddress: e.target.value })}
              placeholder="you@example.com"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="po-form__label">
            Purpose
            <input
              type="text"
              value={draft.purpose}
              onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
              placeholder="Account signup confirmation"
              autoComplete="off"
            />
          </label>
          <label className="po-form__label">
            Window in minutes (optional)
            <input
              type="number"
              min={1}
              value={draft.windowMinutes}
              onChange={(e) => setDraft({ ...draft, windowMinutes: e.target.value })}
              placeholder="daemon default"
            />
          </label>
          <div className="po-form__actions">
            <button type="button" className="po-button" onClick={() => setOpenFormShown(false)}>
              Cancel
            </button>
            <button type="submit" className="po-button po-button--primary" disabled={!draftValid || openExpectation.isPending}>
              {openExpectation.isPending ? "Opening…" : "Open expectation"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
