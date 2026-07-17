// Email inbox + compose (docs/FEATURES.md §9): email.inbox.list/.read reads,
// email.draft.create + email.send writes. Both writes are dangerous-flagged
// and go through ConfirmSurface; email.send additionally echoes the exact
// recipient in the confirm facts (the spec's "explicit recipient echo") and
// forwards confirm:true + explicitUserRequest on the wire — the daemon's
// register wrapper enforces both before the SMTP handler runs.

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Mail, PenSquare, RefreshCw, Reply } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { asRecord, firstString } from "../../lib/wire.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import {
  emailRefusal,
  formatEpoch,
  parseInboxMessages,
  parseMessageDetail,
  poKeys,
  useEmailInbox,
  type EmailInboxMessage,
} from "./personal-ops-data.ts";

interface ComposeDraft {
  to: string;
  subject: string;
  body: string;
  /** RFC-5322 Message-ID being replied to; empty for a fresh mail. */
  inReplyTo: string;
}

const EMPTY_COMPOSE: ComposeDraft = { to: "", subject: "", body: "", inReplyTo: "" };

function looksLikeAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.includes("@") && trimmed.length >= 3 && !trimmed.includes(" ");
}

export function EmailPanel({
  active = true,
  composeSignal,
  onComposeSignalConsumed,
}: {
  /** False while this tab is hidden behind another Personal Ops tab (the
   * panel stays mounted so a compose draft survives the switch — item 1 —
   * but its poll pauses while hidden — item 18). */
  active?: boolean;
  /** >0 = a pending palette "Compose email" intent; consumed on mount/change. */
  composeSignal: number;
  onComposeSignalConsumed: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const peek = usePeek();

  const inbox = useEmailInbox(true, active);
  const messages = inbox.isSuccess ? parseInboxMessages(inbox.data) : [];
  const refusal = inbox.isError ? emailRefusal(inbox.error, "email.inbox.list") : null;

  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState<ComposeDraft>(EMPTY_COMPOSE);
  // Which confirm surface is armed: draft save vs live send.
  const [confirming, setConfirming] = useState<"draft" | "send" | null>(null);

  // Palette command "Compose email" bumps this counter from the view root;
  // the intent survives a tab switch because the panel stays mounted (see
  // PersonalOpsView) and this effect re-checks once `active` flips true.
  useEffect(() => {
    if (composeSignal > 0 && active) {
      setDraft(EMPTY_COMPOSE);
      setComposeOpen(true);
      onComposeSignalConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeSignal, active]);

  // Auto-close any open overlay when this tab is hidden behind another
  // Personal Ops tab — an invisible Modal would otherwise keep trapping
  // Tab/Escape globally even though nothing is on screen. The draft text
  // itself is untouched, so reopening after switching back restores exactly
  // what was typed (item 1 — nothing expires on a tab switch).
  useEffect(() => {
    if (!active) {
      setComposeOpen(false);
      setConfirming(null);
    }
  }, [active]);

  const invalidateInbox = () => queryClient.invalidateQueries({ queryKey: poKeys.emailRoot });

  const createDraft = useMutation({
    // email.draft.create is admin + dangerous-flagged but its SDK contract has
    // no body.confirm field — the ConfirmSurface gates the UI, and only the
    // contract fields go on the wire (an unknown key could fail validation).
    mutationFn: (input: ComposeDraft) =>
      gv.invoke("email.draft.create", {
        body: {
          to: input.to.trim(),
          subject: input.subject.trim(),
          body: input.body,
          ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
        },
      }),
    onSuccess: async (result) => {
      setConfirming(null);
      setComposeOpen(false);
      setDraft(EMPTY_COMPOSE);
      await invalidateInbox();
      const draftId = firstString(asRecord(result), ["draftId"]);
      toast({
        title: "Draft saved to mailbox",
        description: draftId ? `Draft id ${draftId} — nothing was sent.` : "Nothing was sent.",
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      setConfirming(null);
      const note = emailRefusal(error, "email.draft.create");
      toast({
        title: "Draft failed",
        description: note && note.kind === "unconfigured" ? note.description : formatError(error),
        tone: "danger",
      });
    },
  });

  const send = useMutation({
    mutationFn: ({ input, meta }: { input: ComposeDraft; meta: ConfirmMetadata }) =>
      gv.invoke("email.send", {
        body: {
          to: input.to.trim(),
          subject: input.subject.trim(),
          body: input.body,
          ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
          // The daemon register wrapper requires BOTH before the handler runs.
          confirm: meta.confirm,
          explicitUserRequest: meta.explicitUserRequest,
        },
      }),
    onSuccess: async (result, variables) => {
      setConfirming(null);
      setComposeOpen(false);
      setDraft(EMPTY_COMPOSE);
      await invalidateInbox();
      const sentAt = firstString(asRecord(result), ["sentAt"]);
      toast({
        title: `Sent to ${variables.input.to.trim()}`,
        description: sentAt ? `Accepted by SMTP at ${sentAt}.` : undefined,
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      setConfirming(null);
      const note = emailRefusal(error, "email.send");
      toast({
        title: "Send failed",
        description: note && note.kind === "unconfigured" ? note.description : formatError(error),
        tone: "danger",
      });
    },
  });

  const openMessagePeek = (message: EmailInboxMessage) => {
    peek.open({
      title: message.subject,
      content: (
        <EmailMessagePeek
          uid={message.uid}
          onReply={(reply) => {
            peek.close();
            setDraft(reply);
            setComposeOpen(true);
          }}
        />
      ),
    });
  };

  const composeValid = looksLikeAddress(draft.to) && draft.subject.trim().length > 0 && draft.body.trim().length > 0;
  const unread = messages.filter((m) => m.unread).length;

  return (
    <section className="po-panel" aria-label="Email inbox">
      <div className="po-toolbar">
        <span className="po-toolbar__summary">
          <Inbox size={14} aria-hidden="true" /> Inbox
          {inbox.isSuccess ? ` · ${unread} unread of ${messages.length}` : ""}
        </span>
        <div className="po-toolbar__actions">
          <button type="button" className="po-button" onClick={() => setComposeOpen(true)}>
            <PenSquare size={14} aria-hidden="true" /> Compose
          </button>
          <button
            type="button"
            className="po-icon-button"
            aria-label="Refresh inbox"
            onClick={() => void inbox.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={inbox.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      {inbox.isPending && <SkeletonBlock variant="text" lines={5} />}

      {refusal?.kind === "unconfigured" && (
        <EmptyState
          icon={<Mail size={28} aria-hidden="true" />}
          title={refusal.title}
          description={refusal.description}
        />
      )}

      {refusal?.kind === "unavailable" && (
        <UnavailableState capability={refusal.capability} description={refusal.description} />
      )}

      {inbox.isError && !refusal && (
        <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} title="Inbox failed to load" />
      )}

      {inbox.isSuccess && messages.length === 0 && (
        <EmptyState
          icon={<Inbox size={28} aria-hidden="true" />}
          title="No unread mail"
          description="The daemon's inbox read defaults to unread messages — nothing is waiting for you."
        />
      )}

      {inbox.isSuccess && messages.length > 0 && (
        <ul className="po-mail-list">
          {messages.map((message) => (
            <li key={message.uid}>
              <button
                type="button"
                className={message.unread ? "po-mail-row po-mail-row--unread" : "po-mail-row"}
                onClick={() => openMessagePeek(message)}
              >
                <span className="po-mail-row__from">{message.from || "(unknown sender)"}</span>
                <span className="po-mail-row__subject">
                  {message.unread && <span className="po-mail-row__dot" aria-label="Unread" />}
                  {message.subject}
                </span>
                {message.bodyPreview && <span className="po-mail-row__preview">{message.bodyPreview}</span>}
                <span className="po-mail-row__date">{message.date ? formatEpoch(Date.parse(message.date) || undefined) : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Compose modal ──────────────────────────────────────────────── */}
      <Modal open={composeOpen} onClose={() => setComposeOpen(false)} title={draft.inReplyTo ? "Reply" : "Compose email"}>
        <form
          className="po-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (composeValid) setConfirming("send");
          }}
        >
          {draft.inReplyTo && (
            <p className="po-form__note">
              Replying to message <code>{draft.inReplyTo}</code>
            </p>
          )}
          <label className="po-form__label">
            To
            <input
              type="text"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              placeholder="person@example.com"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="po-form__label">
            Subject
            <input
              type="text"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className="po-form__label">
            Body
            <textarea
              rows={8}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <div className="po-form__actions">
            <button type="button" className="po-button" onClick={() => setComposeOpen(false)}>
              Discard
            </button>
            <button
              type="button"
              className="po-button"
              disabled={!composeValid || createDraft.isPending}
              onClick={() => setConfirming("draft")}
            >
              {createDraft.isPending ? "Saving…" : "Save as draft…"}
            </button>
            <button type="submit" className="po-button po-button--primary" disabled={!composeValid || send.isPending}>
              {send.isPending ? "Sending…" : "Send…"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Draft confirm: dangerous-flagged on the wire, nothing is delivered. */}
      <ConfirmSurface
        open={confirming === "draft"}
        action="Create email draft"
        target={`${draft.to.trim()} — “${draft.subject.trim()}”`}
        blastRadius="Writes one RFC-5322 draft into the mailbox Drafts folder over IMAP. Nothing is sent to the recipient."
        confirmLabel="Save draft"
        onCancel={() => setConfirming(null)}
        onConfirm={() => createDraft.mutate(draft)}
      />

      {/* Send confirm: danger styling + the recipient echoed verbatim. */}
      <ConfirmSurface
        open={confirming === "send"}
        action="Send email"
        target={draft.to.trim()}
        blastRadius="Delivers immediately over SMTP to the recipient above. A sent email cannot be recalled."
        danger
        confirmLabel="Send now"
        onCancel={() => setConfirming(null)}
        onConfirm={(meta) => send.mutate({ input: draft, meta })}
      >
        <div className="po-confirm-echo">
          <p>
            Recipient: <code>{draft.to.trim() || "(none)"}</code>
          </p>
          <p>
            Subject: <code>{draft.subject.trim() || "(none)"}</code>
          </p>
        </div>
      </ConfirmSurface>
    </section>
  );
}

// ─── Message peek (email.inbox.read) ─────────────────────────────────────────

function EmailMessagePeek({
  uid,
  onReply,
}: {
  uid: number;
  onReply: (draft: ComposeDraft) => void;
}) {
  const detailQuery = useQuery({
    queryKey: poKeys.emailMessage(uid),
    queryFn: () => gv.invoke("email.inbox.read", { params: { uid: String(uid) } }),
    retry: false,
  });

  if (detailQuery.isPending) return <SkeletonBlock variant="text" lines={6} />;

  if (detailQuery.isError) {
    const refusal = emailRefusal(detailQuery.error, "email.inbox.read");
    if (refusal?.kind === "unconfigured") {
      return <EmptyState title={refusal.title} description={refusal.description} />;
    }
    if (refusal?.kind === "unavailable") {
      return <UnavailableState capability={refusal.capability} description={refusal.description} />;
    }
    return (
      <ErrorState
        error={detailQuery.error}
        onRetry={() => void detailQuery.refetch()}
        title="Message failed to load"
      />
    );
  }

  const detail = parseMessageDetail(detailQuery.data);
  return (
    <div className="po-mail-detail">
      <dl className="po-mail-detail__meta">
        <dt>From</dt>
        <dd>{detail.from || "(unknown sender)"}</dd>
        <dt>Date</dt>
        <dd>{detail.date || "unknown"}</dd>
        <dt>Subject</dt>
        <dd>{detail.subject}</dd>
      </dl>
      <pre className="po-mail-detail__body">{detail.bodyText || "(empty body)"}</pre>
      {detail.attachments.length > 0 && (
        <div className="po-mail-detail__attachments">
          <span className="po-mail-detail__attachments-title">
            Attachments ({detail.attachments.length}) — metadata only, download is not on the wire
          </span>
          <ul>
            {detail.attachments.map((attachment, index) => (
              <li key={index}>
                {attachment.filename} · {attachment.contentType || "unknown type"} ·{" "}
                {formatBytes(attachment.sizeBytes)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="po-button"
        onClick={() =>
          onReply({
            to: detail.from,
            subject: detail.subject.toLowerCase().startsWith("re:") ? detail.subject : `Re: ${detail.subject}`,
            body: "",
            inReplyTo: detail.messageId,
          })
        }
      >
        <Reply size={14} aria-hidden="true" /> Reply
      </button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
