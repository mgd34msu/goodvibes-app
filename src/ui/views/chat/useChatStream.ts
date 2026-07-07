// Per-session companion-chat SSE stream (the sanctioned render-from-frames
// exception, docs/ARCHITECTURE.md §4). Ported from goodvibes-webui
// src/views/chat/useChatStream.ts, re-based on lib/sse.ts openSse — which
// reconnects forever with capped backoff, so the webui's "stream paused"
// terminal state becomes a persistent honest "reconnecting" health signal
// instead. Turn state machine: queued/submitted → running → streaming/tooling
// → completed | error | cancelled. STREAM_END is NOT terminal — a dropped
// stream flips health to 'reconnecting' while the daemon keeps working.

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { gv } from "../../lib/gv.ts";
import { openSse, type SseDispose } from "../../lib/sse.ts";
import { firstString } from "../../lib/wire.ts";
import { isSessionNotFoundError } from "../../lib/errors.ts";
import type { LocalCompanionMessage } from "./companion-chat.ts";
import type { ToolCallBlock, TurnMetrics } from "./types.ts";
import {
  ACTIVE_TURN_STATES,
  assistantContentFromCompletedTurn,
  companionEventType,
  usageFromPayload,
} from "./message-utils.ts";

export type StreamHealth = "idle" | "connecting" | "live" | "reconnecting";

interface UseChatStreamOptions {
  activeSessionId: string;
  liveTextRef: RefObject<string>;
  onSessionMissing: (sessionId: string) => void;
  setTurnState: Dispatch<SetStateAction<string>>;
  setTurnError: Dispatch<SetStateAction<string>>;
  setLiveText: Dispatch<SetStateAction<string>>;
  setLocalMessages: Dispatch<SetStateAction<LocalCompanionMessage[]>>;
  setPendingUserMessageId: Dispatch<SetStateAction<string>>;
  invalidateChatState: (sessionId: string) => Promise<void>;
  /** Fired with the assistant text when a turn completes (long-turn
   * notification + always-speak hooks live in the view). */
  onTurnCompleted?: (content: string, elapsedMs: number) => void;
  turnState: string;
}

export interface UseChatStreamResult {
  isStreaming: boolean;
  streamHealth: StreamHealth;
  /** Live tool-call blocks for the current (or just-finished) turn. */
  toolCalls: ToolCallBlock[];
  /** Live metrics for the thinking strip; null when no turn has run. */
  turnMetrics: TurnMetrics | null;
  /** Stop rendering the in-flight turn: closes the stream and marks the turn
   * cancelled. Honest note: companion chat has no server-side cancel verb —
   * the daemon may still finish the turn; the refetched list shows it. */
  stop: () => void;
  /** Re-open the stream after a stop (or to force a fresh connection). */
  retryStream: () => void;
}

export function useChatStream({
  activeSessionId,
  liveTextRef,
  onSessionMissing,
  setTurnState,
  setTurnError,
  setLiveText,
  setLocalMessages,
  setPendingUserMessageId,
  invalidateChatState,
  onTurnCompleted,
  turnState,
}: UseChatStreamOptions): UseChatStreamResult {
  const disposeRef = useRef<SseDispose | null>(null);
  const stoppedRef = useRef(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [streamHealth, setStreamHealth] = useState<StreamHealth>("idle");
  const [toolCalls, setToolCalls] = useState<ToolCallBlock[]>([]);
  const [turnMetrics, setTurnMetrics] = useState<TurnMetrics | null>(null);
  const onTurnCompletedRef = useRef(onTurnCompleted);
  onTurnCompletedRef.current = onTurnCompleted;

  const stop = useCallback(() => {
    stoppedRef.current = true;
    disposeRef.current?.();
    disposeRef.current = null;
    liveTextRef.current = "";
    setLiveText("");
    setStreamHealth("idle");
    setTurnState("cancelled");
    setTurnError("Stopped rendering. Companion chat has no wire cancel — the daemon may still finish this turn; it will appear in the history if it does.");
  }, [liveTextRef, setLiveText, setTurnError, setTurnState]);

  const retryStream = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      setStreamHealth("idle");
      return undefined;
    }
    // Per-effect epoch: a superseding effect (session switch / retry / unmount)
    // runs this cleanup first, so late callbacks from the old stream go inert.
    let cancelled = false;
    stoppedRef.current = false;
    setLiveText("");
    liveTextRef.current = "";
    setTurnError("");
    setToolCalls([]);
    setStreamHealth("connecting");

    let hadDrop = false;

    const dispose = openSse(gv.chat.events.streamPath(activeSessionId), {
      onReady: () => {
        if (cancelled || stoppedRef.current) return;
        setStreamHealth("live");
        if (hadDrop) {
          hadDrop = false;
          // Only clear the reconnecting label if nothing has moved state on.
          setTurnState((current) => (current === "reconnecting" ? "syncing" : current));
          setTurnError((current) => (current.startsWith("Reconnecting") ? "" : current));
          // Anything streamed while the channel was down is in the DB now.
          void invalidateChatState(activeSessionId);
        }
      },
      onEvent: (eventName, payload) => {
        if (cancelled || stoppedRef.current) return;
        if (eventName !== "message" && !eventName.startsWith("companion-chat")) return;
        const payloadSessionId = firstString(payload, ["sessionId"]);
        if (payloadSessionId && payloadSessionId !== activeSessionId) return;
        const type = companionEventType(eventName, payload);
        const turnId = firstString(payload, ["turnId"]);

        if (type === "turn.started") {
          setTurnState("running");
          setToolCalls([]);
          setTurnMetrics({ turnId, startedAt: Date.now(), deltaChars: 0 });
          void invalidateChatState(activeSessionId);
          return;
        }

        if (type === "turn.delta") {
          const delta = firstString(payload, ["delta"]);
          if (delta) {
            liveTextRef.current += delta;
            setLiveText((current) => current + delta);
            setTurnMetrics((current) =>
              current && current.turnId === turnId
                ? { ...current, deltaChars: current.deltaChars + delta.length }
                : { turnId, startedAt: current?.startedAt ?? Date.now(), deltaChars: delta.length },
            );
          }
          setTurnState("streaming");
          return;
        }

        if (type === "turn.tool_call") {
          const toolCallId = firstString(payload, ["toolCallId"]) || `tool-${Date.now()}`;
          const toolName = firstString(payload, ["toolName"]) || "tool";
          const input = (payload as Record<string, unknown> | null)?.["toolInput"];
          setToolCalls((current) => [...current, { toolCallId, toolName, input, status: "running" }]);
          setTurnState("tooling");
          return;
        }

        if (type === "turn.tool_result") {
          const toolCallId = firstString(payload, ["toolCallId"]);
          const record = payload as Record<string, unknown> | null;
          const isError = record?.["isError"] === true;
          setToolCalls((current) =>
            current.map((block) =>
              block.toolCallId === toolCallId
                ? { ...block, result: record?.["result"], status: isError ? "error" : "completed" }
                : block,
            ),
          );
          setTurnState("tooling");
          return;
        }

        if (type === "turn.completed") {
          const assistantContent = assistantContentFromCompletedTurn(payload, liveTextRef.current);
          const usage = usageFromPayload(payload);
          setTurnMetrics((current) => {
            const base = current ?? { turnId, startedAt: Date.now(), deltaChars: 0 };
            const elapsed = Date.now() - base.startedAt;
            onTurnCompletedRef.current?.(assistantContent, elapsed);
            return usage ? { ...base, usage } : base;
          });
          if (assistantContent) {
            setLocalMessages((current) => [
              ...current,
              {
                id:
                  firstString(payload, ["assistantMessageId", "messageId"]) ||
                  `assistant-${turnId || Date.now()}`,
                sessionId: activeSessionId,
                role: "assistant" as const,
                content: assistantContent,
                createdAt: Date.now(),
                deliveryState: "sent" as const,
              },
            ]);
            setPendingUserMessageId("");
            setTurnState("completed");
          } else {
            setTurnState("syncing");
          }
          setLiveText("");
          liveTextRef.current = "";
          void invalidateChatState(activeSessionId);
          return;
        }

        if (type === "turn.error") {
          setTurnState("error");
          setTurnError(firstString(payload, ["error"]) || "Companion chat turn failed.");
          void invalidateChatState(activeSessionId);
        }
      },
      onError: (error) => {
        if (cancelled || stoppedRef.current) return;
        if (isSessionNotFoundError(normalizeSseError(error))) {
          onSessionMissing(activeSessionId);
          return;
        }
        hadDrop = true;
        setStreamHealth("reconnecting");
        // Only claim 'reconnecting' for the TURN when one is actually in
        // flight — an idle chat with a dropped stream is a health issue, not
        // a turn state.
        setTurnState((current) => (ACTIVE_TURN_STATES.includes(current) ? "reconnecting" : current));
      },
    });
    disposeRef.current = dispose;

    return () => {
      cancelled = true;
      dispose();
      if (disposeRef.current === dispose) disposeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, retryNonce]);

  const isStreaming = ACTIVE_TURN_STATES.includes(turnState);

  return { isStreaming, streamHealth, toolCalls, turnMetrics, stop, retryStream };
}

/** lib/sse.ts throws plain Errors with { status, body } attached — wrap the
 * body so the shared error classifiers can read code/message shape. */
function normalizeSseError(error: unknown): unknown {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: unknown }).body;
    if (typeof body === "string" && body) {
      try {
        return { ...(error as object), body: JSON.parse(body) };
      } catch {
        return error;
      }
    }
  }
  return error;
}
