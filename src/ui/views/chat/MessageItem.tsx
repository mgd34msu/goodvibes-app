// One transcript message: lineage disclosure, markdown body (auto-collapsed
// past the display threshold), attachments, delivery state, and the action
// row (copy · save · edit-and-branch · resend/regenerate · bookmark · speak ·
// artifacts). Ported from goodvibes-webui src/views/chat/MessageItem.tsx.

import { Bookmark, Check, Clock, Copy, Download, Layers, Pencil, Paperclip, RotateCcw, Square, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { useArtifactsPanel } from "./ArtifactsPanel.tsx";
import { MessageLineage, messageIsEdited } from "./MessageLineage.tsx";
import { SpeakButton } from "./SpeakButton.tsx";
import { downloadContent } from "./chat-local.ts";
import { formatCombo } from "../../lib/keybindings.ts";
import type { SupersededReason } from "./lineage.ts";

// Platform-aware submit hint (Ctrl on Linux/Windows, ⌘ on macOS); the handler
// accepts both ctrl and meta, so the assistive label must match the OS.
const SUBMIT_HINT = formatCombo("mod+Enter");
import {
  attachmentLabel,
  attachmentMeta,
  bestId,
  deliveryState,
  messageAttachments,
  messageText,
  messageTimestamp,
  messageTone,
} from "./message-utils.ts";
import type { ChatMessage } from "./types.ts";

interface MessageItemProps {
  message: ChatMessage;
  index: number;
  isSendPending: boolean;
  copiedMessageId: string;
  lineNumbers: boolean;
  /** Auto-collapse threshold in lines (display.collapseThreshold). */
  collapseThreshold: number;
  bookmarked: boolean;
  priorMessages?: readonly ChatMessage[];
  reason?: SupersededReason;
  revisionOf?: string;
  /** Snippet of the user message this assistant reply answers, shown only
   * when that pairing is NOT the plain preceding message in the transcript
   * (a queued send or a steer jumping the queue broke positional pairing —
   * see message-utils.ts `messageInReplyTo`). */
  replyToSnippet?: string;
  onCopyMessage: (message: ChatMessage) => void;
  onResendMessage: (message: ChatMessage) => void;
  onRegenerateFrom: (messageId: string) => void;
  onEditMessage?: (messageId: string, newText: string) => void;
  onToggleBookmark: (messageId: string, snippet: string) => void;
}

export function MessageItem({
  message,
  index,
  isSendPending,
  copiedMessageId,
  lineNumbers,
  collapseThreshold,
  bookmarked,
  priorMessages,
  reason,
  revisionOf,
  replyToSnippet,
  onCopyMessage,
  onResendMessage,
  onRegenerateFrom,
  onEditMessage,
  onToggleBookmark,
}: MessageItemProps) {
  const id = bestId(message) || `${index}`;
  const tone = messageTone(message);
  const state = deliveryState(message);
  const text = messageText(message);
  const { openArtifacts } = useArtifactsPanel();
  const canRetry = Boolean(text) && (tone === "user" || tone === "assistant");
  const timestamp = messageTimestamp(message);
  const attachments = messageAttachments(message);
  const isEdited = messageIsEdited(reason, revisionOf);

  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-collapse long messages (threshold in transcript lines).
  const lineCount = useMemo(() => (text ? text.split("\n").length : 0), [text]);
  const collapsible = lineCount > collapseThreshold;
  const [expanded, setExpanded] = useState(false);
  const visibleText =
    collapsible && !expanded ? `${text.split("\n").slice(0, collapseThreshold).join("\n")}\n…` : text;

  const handleEditStart = useCallback(() => {
    setEditDraft(text);
    setIsEditing(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [text]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditDraft("");
  }, []);

  const handleEditSubmit = useCallback(() => {
    const trimmed = editDraft.trim();
    if (!trimmed || isSendPending) return;
    onEditMessage?.(id, trimmed);
    setIsEditing(false);
    setEditDraft("");
  }, [editDraft, id, isSendPending, onEditMessage]);

  const handleEditKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleEditSubmit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        handleEditCancel();
      }
    },
    [handleEditSubmit, handleEditCancel],
  );

  return (
    <article className={`message ${tone}`} data-message-id={id}>
      <MessageLineage
        priorMessages={priorMessages}
        {...(reason ? { reason } : {})}
        {...(revisionOf ? { revisionOf } : {})}
      />

      <div className="message-bubble">
        {replyToSnippet && (
          <div className="message-reply-context">
            <span aria-hidden="true">↩</span> Replying to: “{replyToSnippet}”
          </div>
        )}
        {timestamp !== "unknown" && (
          <div className="message-meta">
            <span>{timestamp}</span>
            {isEdited && <span className="message-meta__edited"> · edited</span>}
          </div>
        )}

        {isEditing && tone === "user" ? (
          <div className="message-edit-area">
            <textarea
              ref={textareaRef}
              className="message-edit-textarea"
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              onKeyDown={handleEditKeyDown}
              aria-label="Edit message"
              rows={3}
            />
            <div className="message-edit-actions">
              <button type="button" className="message-edit-cancel" onClick={handleEditCancel} aria-label="Cancel edit">
                Cancel
              </button>
              <button
                type="button"
                className="message-edit-submit"
                onClick={handleEditSubmit}
                disabled={!editDraft.trim() || isSendPending}
                aria-label={`Send edited message and branch (${SUBMIT_HINT})`}
              >
                Send &amp; branch
              </button>
            </div>
          </div>
        ) : (
          <>
            {text && <MarkdownMessage content={visibleText} lineNumbers={lineNumbers} />}
            {collapsible && (
              <button
                type="button"
                className="message-collapse-toggle"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "Collapse" : `Show full message (${lineCount} lines)`}
              </button>
            )}
            {attachments.length > 0 && (
              <div className="message-attachments">
                {attachments.map((attachment, attachmentIndex) => (
                  <div key={`${id}-attachment-${attachmentIndex}`} className="message-attachment">
                    <Paperclip size={13} aria-hidden="true" />
                    <div>
                      <strong>{attachmentLabel(attachment)}</strong>
                      {attachmentMeta(attachment) && <span>{attachmentMeta(attachment)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!text && attachments.length === 0 && <p className="message-raw">{JSON.stringify(message)}</p>}
          </>
        )}
      </div>

      <div className="message-actions">
        <div className="message-actions-inner">
          {state && (
            <span
              className={`delivery-indicator ${state}`}
              title={
                state === "failed"
                  ? "Not sent"
                  : state === "local"
                    ? "Pending"
                    : state === "queued"
                      ? "Queued — will run once the current turn finishes"
                      : state === "cancelled"
                        ? "Stopped — this reply was interrupted before it finished"
                        : "Sent"
              }
            >
              {state === "failed" ? (
                <X size={12} aria-hidden="true" />
              ) : state === "queued" ? (
                <>
                  <Clock size={11} aria-hidden="true" />
                  <span className="delivery-indicator-label">queued</span>
                </>
              ) : state === "cancelled" ? (
                <>
                  <Square size={10} aria-hidden="true" />
                  <span className="delivery-indicator-label">stopped</span>
                </>
              ) : (
                <Check size={12} aria-hidden="true" />
              )}
            </span>
          )}

          <button type="button" title="Copy message" aria-label="Copy message" onClick={() => onCopyMessage(message)}>
            <Copy size={13} aria-hidden="true" />
          </button>

          {text && (
            <button
              type="button"
              title="Save message to file"
              aria-label="Save message to file"
              onClick={() => downloadContent(`message-${id}.md`, "text/markdown", text)}
            >
              <Download size={13} aria-hidden="true" />
            </button>
          )}

          {tone === "user" && canRetry && !isEditing && onEditMessage !== undefined && (
            <button
              type="button"
              title="Edit and branch"
              aria-label="Edit and branch from this message"
              disabled={isSendPending}
              onClick={handleEditStart}
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
          )}

          {canRetry && !isEditing && (
            <button
              type="button"
              title={tone === "assistant" ? "Regenerate response" : state === "failed" ? "Retry send" : "Resend message"}
              aria-label={tone === "assistant" ? "Regenerate response" : state === "failed" ? "Retry send" : "Resend message"}
              disabled={isSendPending}
              onClick={() => (tone === "assistant" ? onRegenerateFrom(id) : onResendMessage(message))}
            >
              <RotateCcw size={13} aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            title={bookmarked ? "Remove bookmark" : "Bookmark message"}
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark message"}
            aria-pressed={bookmarked}
            className={bookmarked ? "message-action-bookmark is-active" : "message-action-bookmark"}
            onClick={() => onToggleBookmark(id, text.slice(0, 120))}
          >
            <Bookmark size={13} aria-hidden="true" />
          </button>

          {tone === "assistant" && text && <SpeakButton messageId={id} text={text} />}

          {tone === "assistant" && (text || attachments.length > 0) && (
            <button
              type="button"
              title="View artifacts"
              aria-label="View artifacts from this message"
              className="message-action-artifacts"
              onClick={() => openArtifacts(message)}
            >
              <Layers size={13} aria-hidden="true" />
            </button>
          )}

          {copiedMessageId === id && <span className="message-action-label">copied</span>}
        </div>
      </div>
    </article>
  );
}
