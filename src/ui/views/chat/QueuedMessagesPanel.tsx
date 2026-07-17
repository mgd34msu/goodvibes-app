// QueuedMessagesPanel — messages submitted while a turn is still running sit
// queued (not yet delivered to the model) until that turn ends
// (sessions.queuedMessages.list/edit/delete, contract 1.11's interaction-wins
// round). Lets the operator review, edit, or drop a queued message before it
// is ever sent. Renders nothing when there is nothing queued (the common
// case) AND when the daemon can't answer for this session at all
// (SESSION_NOT_LOCAL / method-unavailable) — never a dead empty section, and
// never a scary error for an ambient panel that's usually just absent.
//
// No wire event exists for this verb family (same standing gap fleet.*/
// checkpoints.*/memory.* document elsewhere in this app) — polls while a turn
// is active, refetches explicitly on every mutation success. Ported from
// goodvibes-webui src/views/chat/QueuedMessagesPanel.tsx, with its
// window.confirm() replaced by this app's shared ConfirmSurface (UX bar:
// confirmation depth scales with destructiveness, never a native confirm()).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, X, Check } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError } from "../../lib/errors.ts";
import { firstString, asArray } from "../../lib/wire.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";

export interface QueuedMessagesPanelProps {
  sessionId: string;
  /** Poll only while a turn is actually active — a queued message can only exist then. */
  active: boolean;
}

const POLL_INTERVAL_MS = 2000;

interface QueuedMessageRow {
  id: string;
  text: string;
}

function rowsFrom(data: unknown): QueuedMessageRow[] {
  const messages = asArray((data as { messages?: unknown } | undefined)?.messages);
  return messages
    .map((entry) => ({ id: firstString(entry, ["id"]), text: firstString(entry, ["text"]) }))
    .filter((row) => row.id);
}

export function QueuedMessagesPanel({ sessionId, active }: QueuedMessagesPanelProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState("");
  const [draftText, setDraftText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<QueuedMessageRow | null>(null);

  const list = useQuery({
    queryKey: queryKeys.sessionQueuedMessages(sessionId),
    queryFn: () => gv.sessions.queuedMessages.list(sessionId),
    enabled: Boolean(sessionId),
    refetchInterval: active ? POLL_INTERVAL_MS : false,
    retry: false,
  });

  async function invalidate(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: queryKeys.sessionQueuedMessages(sessionId) });
  }

  const editMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => gv.sessions.queuedMessages.edit(sessionId, id, { text }),
    onSuccess: async () => {
      setEditingId("");
      setDraftText("");
      await invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => gv.sessions.queuedMessages.delete(sessionId, id),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidate();
    },
    onError: () => setDeleteTarget(null),
  });

  if (!sessionId || !list.isSuccess) return null;

  const messages = rowsFrom(list.data);
  if (messages.length === 0) return null;

  return (
    <div className="queued-messages-panel" aria-label="Queued messages">
      <p className="queued-messages-panel__note" role="note">
        Queued — the model has not seen these yet. They&apos;ll be sent once the current reply finishes. Edit or drop
        one before then.
      </p>
      <ul className="queued-messages-list">
        {messages.map((message) => (
          <li key={message.id} className="queued-message">
            {editingId === message.id ? (
              <form
                className="queued-message__edit-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = draftText.trim();
                  if (trimmed) editMutation.mutate({ id: message.id, text: trimmed });
                }}
              >
                <textarea
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  aria-label="Edit queued message"
                  rows={2}
                />
                <div className="queued-message__edit-actions">
                  <button
                    type="submit"
                    className="queued-message__save"
                    disabled={editMutation.isPending || !draftText.trim()}
                    aria-label="Save queued message"
                  >
                    <Check size={13} aria-hidden="true" /> Save
                  </button>
                  <button
                    type="button"
                    className="queued-message__cancel-edit"
                    onClick={() => {
                      setEditingId("");
                      setDraftText("");
                    }}
                    aria-label="Cancel editing queued message"
                  >
                    <X size={13} aria-hidden="true" /> Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <span className="queued-message__text">{message.text}</span>
                <div className="queued-message__actions">
                  <button
                    type="button"
                    className="queued-message__edit"
                    onClick={() => {
                      setEditingId(message.id);
                      setDraftText(message.text);
                    }}
                    aria-label="Edit queued message"
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="queued-message__delete"
                    disabled={deleteMutation.isPending}
                    onClick={() => setDeleteTarget(message)}
                    aria-label="Delete queued message"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {(editMutation.isError || deleteMutation.isError) && (
        <p className="banner warning" role="alert">
          {formatError(editMutation.error ?? deleteMutation.error)}
        </p>
      )}

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Drop queued message"
        target={deleteTarget?.text ?? ""}
        blastRadius="It will never be sent to the model. Nothing else in this chat is affected — you can retype it."
        confirmLabel="Drop message"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
