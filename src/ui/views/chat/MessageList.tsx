// Transcript: honest-lineage nodes + the live streaming bubble (deltas paint
// as they arrive — the sanctioned render-from-frames exception), tool-call
// blocks, thinking strip, and jump-to-bottom. Ported from goodvibes-webui
// src/views/chat/MessageList.tsx.

import { ArrowDown } from "lucide-react";
import type { RefObject } from "react";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { useReducedMotion } from "../../components/motion.tsx";
import { MessageItem } from "./MessageItem.tsx";
import { ToolCallBlocks, ThinkingStrip, ContextMeter } from "./TurnActivity.tsx";
import { lineageNodeKey, type LineageNode } from "./lineage.ts";
import { messageInReplyTo, messageText, messageTone } from "./message-utils.ts";
import type { ChatMessage, ToolCallBlock, TurnMetrics } from "./types.ts";

interface MessageListProps {
  nodes: LineageNode[];
  liveText: string;
  turnState: string;
  toolCalls: ToolCallBlock[];
  turnMetrics: TurnMetrics | null;
  showJumpToBottom: boolean;
  isSendPending: boolean;
  isStreaming: boolean;
  copiedMessageId: string;
  lineNumbers: boolean;
  collapseThreshold: number;
  bookmarkedIds: ReadonlySet<string>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onJumpToBottom: () => void;
  onCopyMessage: (message: ChatMessage) => void;
  onResendMessage: (message: ChatMessage) => void;
  onRegenerateFrom: (messageId: string) => void;
  onEditMessage?: (messageId: string, newText: string) => void;
  onToggleBookmark: (messageId: string, snippet: string) => void;
  onStop?: () => void;
}

export function MessageList({
  nodes,
  liveText,
  turnState,
  toolCalls,
  turnMetrics,
  showJumpToBottom,
  isSendPending,
  isStreaming,
  copiedMessageId,
  lineNumbers,
  collapseThreshold,
  bookmarkedIds,
  scrollRef,
  onScroll,
  onJumpToBottom,
  onCopyMessage,
  onResendMessage,
  onRegenerateFrom,
  onEditMessage,
  onToggleBookmark,
  onStop,
}: MessageListProps) {
  const reducedMotion = useReducedMotion();
  const showStreamControls = isStreaming && Boolean(liveText);

  return (
    <>
      <div className="messages chat-conversation" ref={scrollRef} onScroll={onScroll}>
        {nodes.map((node, index) => {
          const nodeId = node.message.id ?? node.message.messageId ?? "";
          // Queue-when-busy sends and steer both break simple positional
          // pairing (the message right above this one in the transcript is
          // not necessarily what it answers) — when the daemon's inReplyTo
          // disagrees with the plain preceding message, surface a snippet of
          // what it actually answers instead of leaving the mismatch mute.
          const inReplyTo = messageInReplyTo(node.message);
          const precedingId = index > 0 ? (nodes[index - 1]!.message.id ?? nodes[index - 1]!.message.messageId ?? "") : "";
          const repliesOutOfOrder = messageTone(node.message) === "assistant" && Boolean(inReplyTo) && inReplyTo !== precedingId;
          const replyToMessage = repliesOutOfOrder
            ? nodes.find((n) => (n.message.id ?? n.message.messageId ?? "") === inReplyTo)?.message
            : undefined;
          const replyToSnippet = replyToMessage ? messageText(replyToMessage).slice(0, 80) : "";
          return (
            <MessageItem
              key={lineageNodeKey(node, index)}
              message={node.message}
              index={index}
              isSendPending={isSendPending}
              copiedMessageId={copiedMessageId}
              lineNumbers={lineNumbers}
              collapseThreshold={collapseThreshold}
              bookmarked={bookmarkedIds.has(nodeId)}
              priorMessages={node.priorMessages}
              {...(node.reason ? { reason: node.reason } : {})}
              {...(node.revisionOf ? { revisionOf: node.revisionOf } : {})}
              {...(replyToSnippet ? { replyToSnippet } : {})}
              onCopyMessage={onCopyMessage}
              onResendMessage={onResendMessage}
              onRegenerateFrom={onRegenerateFrom}
              {...(onEditMessage ? { onEditMessage } : {})}
              onToggleBookmark={onToggleBookmark}
            />
          );
        })}

        {(isStreaming || toolCalls.length > 0) && <ToolCallBlocks blocks={toolCalls} />}

        {liveText && (
          <div aria-live="polite" aria-atomic="false">
            <article className="message assistant streaming">
              <div className="message-bubble">
                <div className="message-meta">
                  <span>GoodVibes is responding</span>
                </div>
                <MarkdownMessage content={liveText} lineNumbers={lineNumbers} />
                {showStreamControls && (
                  <div className="stream-controls">
                    <span
                      className={`stream-caret${reducedMotion ? " stream-caret--reduced" : ""}`}
                      aria-hidden="true"
                    />
                    {onStop && (
                      <button type="button" className="stream-stop-btn" onClick={onStop} aria-label="Stop generating">
                        Stop
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
          </div>
        )}

        <ThinkingStrip
          turnState={turnState}
          metrics={turnMetrics}
          streaming={isStreaming}
          {...(onStop && !liveText ? { onStop } : {})}
        />
        <ContextMeter metrics={turnMetrics} />
      </div>

      {showJumpToBottom && (
        <button
          type="button"
          className="jump-to-bottom"
          onClick={onJumpToBottom}
          title="Jump to latest message"
          aria-label="Jump to latest message"
        >
          <ArrowDown size={16} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
