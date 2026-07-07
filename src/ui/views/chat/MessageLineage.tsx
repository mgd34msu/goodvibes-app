// Honest-lineage disclosure: retained (superseded) history behind a
// regenerate/edit fork is folded, never hidden — the daemon retains it and so
// does the UI. Ported from goodvibes-webui src/views/chat/MessageLineage.tsx.

import { ChevronDown, ChevronRight, History, Paperclip } from "lucide-react";
import { useCallback, useState } from "react";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import type { ChatMessage } from "./types.ts";
import { retainedHistoryLabel, sortByCreatedAt, supersededReason as reasonOf, type SupersededReason } from "./lineage.ts";
import { attachmentLabel, bestId, messageAttachments, messageText, messageTone } from "./message-utils.ts";

interface MessageLineageProps {
  priorMessages?: readonly ChatMessage[];
  reason?: SupersededReason;
  revisionOf?: string;
}

function RetainedMessage({ message }: { message: ChatMessage }) {
  const tone = messageTone(message);
  const text = messageText(message);
  const attachments = messageAttachments(message);
  return (
    <article className={`retained-message ${tone}`} aria-label={`Retained ${tone} message`}>
      <span className="retained-message__role">{tone === "user" ? "You" : "Assistant"}</span>
      <div className="retained-message__body">
        {text ? <MarkdownMessage content={text} /> : null}
        {attachments.length > 0 && (
          <div className="retained-message__attachments">
            {attachments.map((attachment, index) => (
              <span key={`retained-attachment-${index}`} className="retained-message__attachment">
                <Paperclip size={11} aria-hidden="true" /> {attachmentLabel(attachment)}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export function MessageLineage({ priorMessages, reason, revisionOf }: MessageLineageProps) {
  const [showRetained, setShowRetained] = useState(false);
  const toggleRetained = useCallback(() => setShowRetained((current) => !current), []);

  const retained = priorMessages ? sortByCreatedAt(priorMessages) : [];
  const hasRetained = retained.length > 0;
  const retainedReason: SupersededReason | undefined = hasRetained
    ? (reason ?? reasonOf(retained[0]))
    : revisionOf
      ? "edit"
      : undefined;
  const isEdited = Boolean(revisionOf) || retainedReason === "edit";

  if (!hasRetained && !isEdited) return null;

  return (
    <div className="message-lineage">
      <button
        type="button"
        className="message-lineage__toggle"
        aria-expanded={showRetained}
        disabled={!hasRetained}
        onClick={toggleRetained}
        title={hasRetained ? "Show or hide retained history" : "Edited message"}
      >
        {hasRetained ? (
          showRetained ? (
            <ChevronDown size={12} aria-hidden="true" />
          ) : (
            <ChevronRight size={12} aria-hidden="true" />
          )
        ) : (
          <History size={12} aria-hidden="true" />
        )}
        <span>{hasRetained ? retainedHistoryLabel(retainedReason, retained.length) : "Edited"}</span>
      </button>
      {showRetained && hasRetained && (
        <div className="message-lineage__retained" role="group" aria-label="Retained history">
          <p className="message-lineage__note">
            Kept as history — the daemon retains superseded messages, they are never deleted.
          </p>
          {retained.map((retainedMessage, index) => (
            <RetainedMessage key={`${bestId(retainedMessage) || "retained"}-${index}`} message={retainedMessage} />
          ))}
        </div>
      )}
    </div>
  );
}

export function messageIsEdited(reason: SupersededReason | undefined, revisionOf: string | undefined): boolean {
  return Boolean(revisionOf) || reason === "edit";
}
