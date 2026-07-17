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
import { errorCode, formatError, isMethodUnavailableError, isSessionNotFoundError } from "../../lib/errors.ts";
import { isSessionNotLocalError, isToolCallNotRunningError } from "./session-runtime.ts";
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
  /** Surfaces a non-benign sessions.toolCalls.cancel failure (anything past
   * the quiet SESSION_NOT_LOCAL / TOOL_CALL_NOT_RUNNING / method-unavailable
   * degrades below) — the view toasts it. */
  notifyToolCancelError?: (message: string) => void;
}

export interface UseChatStreamResult {
  isStreaming: boolean;
  streamHealth: StreamHealth;
  /** Live tool-call blocks for the current (or just-finished) turn. */
  toolCalls: ToolCallBlock[];
  /** callIds with a cancel request in flight (or awaiting their settling
   * tool_result frame) — MessageList shows these as "cancelling…" instead of
   * offering the cancel affordance again. Cleared the moment the matching
   * turn.tool_result frame arrives, per the A2 brief: mark cancelled locally
   * immediately, but only actually remove the affordance once that frame
   * lands (never assume the wire settled just because the request returned). */
  cancellingToolCallIds: ReadonlySet<string>;
  /** Cancel ONE in-flight tool call (sessions.toolCalls.cancel) without
   * touching the rest of the turn. */
  cancelToolCall: (callId: string) => void;
  /** True once a cancel attempt has come back isMethodUnavailableError — this
   * daemon build has never heard of the verb, so MessageList stops offering
   * the affordance instead of failing the same way on every call. */
  toolCancelUnavailable: boolean;
  /** Live metrics for the thinking strip; null when no turn has run. */
  turnMetrics: TurnMetrics | null;
  /** True server-side stop (daemon >= 1.11, docs/GAPS.md §1 row 39 —
   * previously wire-blocked, see docs/turn-cancel-request.md): calls
   * `gv.chat.turns.cancel(sessionId, {turnId})` (the current turn's id when
   * known from `turnMetrics`, omitted for a very-early stop before
   * `turn.started` has delivered one — the daemon finds the active turn by
   * sessionId alone) and leaves the stream OPEN. Nothing else happens here on
   * success: the terminal `turn.cancelled` SSE event (handled in `onEvent`
   * below) is the authoritative signal that converges every subscriber to
   * this session, including this client — closing the stream here would
   * race that convergence. A benign 404 `NO_ACTIVE_TURN` (the turn finished
   * naturally before the stop landed) is a quiet no-op. `isMethodUnavailableError`
   * (a pre-1.11 daemon that has never heard of this verb) falls back to the
   * old local-only behavior — stop rendering, mark cancelled locally, say
   * plainly that the daemon may still finish the turn server-side. */
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
  notifyToolCancelError,
}: UseChatStreamOptions): UseChatStreamResult {
  const disposeRef = useRef<SseDispose | null>(null);
  const stoppedRef = useRef(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [streamHealth, setStreamHealth] = useState<StreamHealth>("idle");
  const [toolCalls, setToolCalls] = useState<ToolCallBlock[]>([]);
  const [cancellingToolCallIds, setCancellingToolCallIds] = useState<Set<string>>(new Set());
  const [toolCancelUnavailable, setToolCancelUnavailable] = useState(false);
  const [turnMetrics, setTurnMetrics] = useState<TurnMetrics | null>(null);
  const onTurnCompletedRef = useRef(onTurnCompleted);
  onTurnCompletedRef.current = onTurnCompleted;
  const notifyToolCancelErrorRef = useRef(notifyToolCancelError);
  notifyToolCancelErrorRef.current = notifyToolCancelError;

  // sessions.toolCalls.cancel(sessionId, callId) — cancels ONE running tool
  // call, leaving the turn and every other running call untouched. Marks the
  // call "cancelling" immediately for feedback; the mark is cleared by the
  // turn.tool_result handler below (the call truly ends when that frame
  // arrives, not when this request returns) or, on failure, right away here.
  const cancelToolCall = useCallback(
    (callId: string) => {
      if (!activeSessionId || !callId) return;
      setCancellingToolCallIds((current) => {
        if (current.has(callId)) return current;
        const next = new Set(current);
        next.add(callId);
        return next;
      });
      void gv.sessions.toolCalls.cancel(activeSessionId, callId).catch((error: unknown) => {
        setCancellingToolCallIds((current) => {
          if (!current.has(callId)) return current;
          const next = new Set(current);
          next.delete(callId);
          return next;
        });
        // Benign: SESSION_NOT_LOCAL (this isn't the daemon's own live
        // session — see session-runtime.ts), or TOOL_CALL_NOT_RUNNING (the
        // call already settled — its tool_result frame is on the way or
        // already landed). Neither is worth alarming the operator over.
        if (isSessionNotLocalError(error) || isToolCallNotRunningError(error)) return;
        if (isMethodUnavailableError(error)) {
          setToolCancelUnavailable(true);
          return;
        }
        notifyToolCancelErrorRef.current?.(formatError(error));
      });
    },
    [activeSessionId],
  );

  // The pre-1.11 behavior, kept as the honest fallback for a daemon that has
  // never heard of companion.chat.turns.cancel: stops RENDERING only.
  const stopLocally = useCallback(() => {
    stoppedRef.current = true;
    disposeRef.current?.();
    disposeRef.current = null;
    liveTextRef.current = "";
    setLiveText("");
    setStreamHealth("idle");
  }, [liveTextRef, setLiveText]);

  const stop = useCallback(() => {
    if (!activeSessionId) return;
    const turnId = turnMetrics?.turnId;
    setTurnState("stopping");
    setTurnError("");
    void gv.chat.turns.cancel(activeSessionId, turnId ? { turnId } : undefined).catch((error: unknown) => {
      if (isMethodUnavailableError(error)) {
        stopLocally();
        setTurnState("stopped locally");
        setTurnError(
          "Stopped rendering only — this daemon does not support stopping a turn server-side " +
            "(needs daemon 1.11+). The reply may still finish and will appear in the history.",
        );
        return;
      }
      if (errorCode(error) === "NO_ACTIVE_TURN") {
        // Benign: the turn finished naturally before the stop landed. The
        // terminal turn.completed/turn.error already settled (or is about
        // to settle) the turn state; only reset from 'stopping' if nothing
        // else has moved it on since the click.
        setTurnState((current) => (current === "stopping" ? "idle" : current));
        void invalidateChatState(activeSessionId);
        return;
      }
      setTurnState("error");
      setTurnError(formatError(error));
    });
    // On success nothing else happens here: the terminal turn.cancelled
    // event on the open stream (below) is the authoritative signal, for this
    // client AND every other subscriber to this session.
  }, [activeSessionId, invalidateChatState, setTurnError, setTurnState, stopLocally, turnMetrics]);

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
    setCancellingToolCallIds(new Set());
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
          setCancellingToolCallIds(new Set());
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
          // The call has now truly ended (per the A2 brief: only clear the
          // "cancelling" mark once this frame arrives, not when the cancel
          // request merely returned).
          setCancellingToolCallIds((current) => {
            if (!current.has(toolCallId)) return current;
            const next = new Set(current);
            next.delete(toolCallId);
            return next;
          });
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

        if (type === "turn.cancelled") {
          // Terminal, exactly like turn.completed/turn.error — the daemon has
          // already persisted the honest partial (deliveryState "cancelled")
          // when partialPersisted is true, closed any dangling tool calls with
          // a synthetic error turn.tool_result BEFORE this event (handled by
          // the turn.tool_result branch above), and this is the ONE signal
          // that ends 'stopping' for every subscriber, not just the client
          // that clicked Stop.
          const assistantContent = assistantContentFromCompletedTurn(payload, liveTextRef.current);
          const usage = usageFromPayload(payload);
          setTurnMetrics((current) => {
            const base = current ?? { turnId, startedAt: Date.now(), deltaChars: 0 };
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
                deliveryState: "cancelled" as const,
              },
            ]);
          }
          // Safety net: the daemon's tool_result events for dangling calls
          // should already have flipped every open block above, but a stale
          // one (e.g. this client missed the tool_result frame) never stays
          // "running" forever once the turn is definitively over.
          setToolCalls((current) =>
            current.map((block) => (block.status === "running" ? { ...block, status: "error" as const } : block)),
          );
          setPendingUserMessageId("");
          setTurnState("cancelled");
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

  return {
    isStreaming,
    streamHealth,
    toolCalls,
    cancellingToolCallIds,
    cancelToolCall,
    toolCancelUnavailable,
    turnMetrics,
    stop,
    retryStream,
  };
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
