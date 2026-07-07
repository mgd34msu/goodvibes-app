// Optimistic send + honest-lineage fork verbs, ported from goodvibes-webui
// src/views/chat/useChatSend.ts onto the gv facade. Sends carry `content`
// (PostCompanionChatMessageInput in the pinned SDK contract). Never falls
// back to sessions.messages.create / sessions.followUp — companion chat only
// (webui docs/architecture.md rule). Includes the client-side send budget for
// the daemon's 30 msg/min companion rate limit (never silently dropped —
// the composer shows the budget and the block reason).

import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { useMutation } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { bestId } from "../../lib/wire.ts";
import {
  formatError,
  isAuthExpiredError,
  isSessionClosedError,
  isSessionNotFoundError,
} from "../../lib/errors.ts";
import {
  companionSessionFromDetail,
  extractMessageId,
  extractSessionId,
  type LocalCompanionMessage,
} from "./companion-chat.ts";
import { fileToBase64, uploadedArtifactId } from "./message-utils.ts";
import type { ChatMessage } from "./types.ts";

// ─── Send budget (30 msg/min/client daemon rate limit awareness) ─────────────

export const SEND_BUDGET_PER_MINUTE = 30;
const BUDGET_WINDOW_MS = 60_000;

let sendTimestamps: number[] = [];
const budgetListeners = new Set<() => void>();
let budgetSnapshot = { used: 0, remaining: SEND_BUDGET_PER_MINUTE, blocked: false };

function pruneBudget(): void {
  const cutoff = Date.now() - BUDGET_WINDOW_MS;
  sendTimestamps = sendTimestamps.filter((ts) => ts > cutoff);
  const used = sendTimestamps.length;
  const next = {
    used,
    remaining: Math.max(0, SEND_BUDGET_PER_MINUTE - used),
    blocked: used >= SEND_BUDGET_PER_MINUTE,
  };
  if (next.used !== budgetSnapshot.used || next.blocked !== budgetSnapshot.blocked) {
    budgetSnapshot = next;
    budgetListeners.forEach((fn) => fn());
  }
}

export function recordSend(): void {
  sendTimestamps.push(Date.now());
  pruneBudget();
}

export interface SendBudget {
  used: number;
  remaining: number;
  blocked: boolean;
}

/** Live send budget; re-prunes on a 1s tick while any send is in the window. */
export function useSendBudget(): SendBudget {
  return useSyncExternalStore(
    useCallback((onChange: () => void) => {
      budgetListeners.add(onChange);
      const timer = setInterval(() => pruneBudget(), 1_000);
      return () => {
        budgetListeners.delete(onChange);
        clearInterval(timer);
      };
    }, []),
    () => budgetSnapshot,
    () => budgetSnapshot,
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface AttachedArtifactRef {
  artifactId: string;
  label: string;
}

export interface SendVars {
  body: string;
  files: File[];
  /** Existing artifacts referenced via @-mention — no upload needed. */
  artifactRefs?: AttachedArtifactRef[];
}

interface UseChatSendOptions {
  activeSessionId: string;
  onActiveSessionChange: (sessionId: string) => void;
  onLocalSessionCreated: (session: unknown) => void;
  onSessionMissing: (sessionId: string) => void;
  setTurnState: Dispatch<SetStateAction<string>>;
  setTurnError: Dispatch<SetStateAction<string>>;
  setLiveText: Dispatch<SetStateAction<string>>;
  setLocalMessages: Dispatch<SetStateAction<LocalCompanionMessage[]>>;
  setPendingUserMessageId: Dispatch<SetStateAction<string>>;
  invalidateChatState: (sessionId: string) => Promise<void>;
  turnState: string;
  streamHealthy: boolean;
  /** Session defaults applied when a send has to create the session first. */
  createDefaults?: { provider?: string; model?: string };
}

export interface UseChatSendReturn {
  mutate: (vars: SendVars) => void;
  isPending: boolean;
  error: Error | null;
  editAndResend: (messageId: string, newText: string) => void;
  regenerateFrom: (messageId: string, messages: ChatMessage[]) => void;
  isLineagePending: boolean;
  lineageError: Error | null;
}

/** True for real server message ids (not client-synthesized optimistic ids). */
function isServerMessageId(id: string): boolean {
  if (!id) return false;
  return !id.startsWith("local-") && !id.startsWith("assistant-") && !id.startsWith("user-");
}

export function useChatSend({
  activeSessionId,
  onActiveSessionChange,
  onLocalSessionCreated,
  onSessionMissing,
  setTurnState,
  setTurnError,
  setLiveText,
  setLocalMessages,
  setPendingUserMessageId,
  invalidateChatState,
  turnState,
  streamHealthy,
  createDefaults,
}: UseChatSendOptions): UseChatSendReturn {
  const sendMutation = useMutation<undefined, Error, SendVars>({
    mutationFn: async ({ body, files, artifactRefs = [] }: SendVars) => {
      if (!body && !files.length && !artifactRefs.length) return;
      pruneBudget();
      if (budgetSnapshot.blocked) {
        throw new Error(
          `Send budget reached — the daemon allows ${SEND_BUDGET_PER_MINUTE} messages per minute per client. Wait a few seconds and try again.`,
        );
      }
      // A send while the stream is down still goes over REST, but the reply
      // comes back over that same stream — say so honestly.
      const sendingWhileReconnecting = !streamHealthy || turnState === "reconnecting";
      setTurnState(sendingWhileReconnecting ? "sending while reconnecting" : "sending");
      setTurnError(
        sendingWhileReconnecting
          ? "Sending — the live stream is reconnecting, so the reply may not appear until it resumes."
          : "",
      );

      let sessionId = activeSessionId;
      if (!sessionId) {
        const createdAt = Date.now();
        const title = body.slice(0, 72) || files[0]?.name?.slice(0, 72) || "Attachment chat";
        const created = await gv.chat.sessions.create({
          title,
          ...(createDefaults?.provider ? { provider: createDefaults.provider } : {}),
          ...(createDefaults?.model ? { model: createDefaults.model } : {}),
        });
        sessionId = extractSessionId(created);
        const createdSession = companionSessionFromDetail(created);
        onLocalSessionCreated(
          bestId(createdSession)
            ? createdSession
            : {
                id: sessionId,
                sessionId,
                kind: "companion-chat",
                title: title || sessionId,
                status: "active",
                createdAt,
                updatedAt: createdAt,
              },
        );
        onActiveSessionChange(sessionId);
      }

      const localMessageId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const localAttachments = [
        ...files.map((file, index) => ({
          artifactId: `local-${localMessageId}-${index}`,
          label: file.name,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        })),
        ...artifactRefs.map((ref) => ({ artifactId: ref.artifactId, label: ref.label })),
      ];
      setLocalMessages((current) => [
        ...current,
        {
          id: localMessageId,
          sessionId,
          role: "user" as const,
          content: body,
          createdAt: Date.now(),
          deliveryState: "local" as const,
          attachments: localAttachments,
        },
      ]);
      setPendingUserMessageId(localMessageId);
      setLiveText("");
      setTurnState(sendingWhileReconnecting ? "sending while reconnecting" : "submitted");

      const markFailed = () =>
        setLocalMessages((current) =>
          current.map((message) =>
            message.id === localMessageId ? { ...message, deliveryState: "failed" as const } : message,
          ),
        );

      // Upload File attachments first; reference by artifactId (wire rule).
      let uploaded: { artifactId: string; label: string }[] = [];
      try {
        uploaded = await Promise.all(
          files.map(async (file) => {
            const dataBase64 = await fileToBase64(file);
            const created = await gv.artifacts.create({
              filename: file.name,
              mimeType: file.type || "application/octet-stream",
              dataBase64,
              metadata: { surface: "app" },
            });
            const artifactId = uploadedArtifactId(created);
            if (!artifactId) throw new Error(`Artifact upload for ${file.name} did not return an artifact id.`);
            return { artifactId, label: file.name };
          }),
        );
      } catch (error) {
        markFailed();
        throw error instanceof Error ? error : new Error(String(error));
      }

      const attachments = [...uploaded, ...artifactRefs.map((ref) => ({ artifactId: ref.artifactId, label: ref.label }))];
      let result: unknown;
      try {
        result = await gv.chat.messages.create(sessionId, {
          content: body,
          ...(attachments.length ? { attachments } : {}),
        });
        recordSend();
      } catch (error) {
        markFailed();
        throw error instanceof Error ? error : new Error(String(error));
      }
      const messageId = extractMessageId(result);
      setLocalMessages((current) =>
        current.map((message) =>
          message.id === localMessageId
            ? { ...message, id: messageId || localMessageId, deliveryState: "sent" as const }
            : message,
        ),
      );
      setPendingUserMessageId(messageId || localMessageId);
      await invalidateChatState(sessionId);
    },
    onError: (error) => {
      if (isSessionNotFoundError(error) && activeSessionId) {
        onSessionMissing(activeSessionId);
        setTurnError("That chat session no longer exists on the daemon. Reloaded the session list.");
        return;
      }
      if (isAuthExpiredError(error)) {
        setTurnState("auth expired");
        setTurnError("The daemon rejected the app token — the pairing store needs repair (Settings → Doctor).");
        return;
      }
      if (isSessionClosedError(error)) {
        setTurnState("idle");
        setTurnError("This chat is closed — start a new chat to keep going.");
        return;
      }
      setTurnState("send failed");
      setTurnError(formatError(error));
    },
  });

  // Shared honest handling for the two lineage-forking verbs.
  const beginLineageTurn = useCallback(() => {
    setLocalMessages((current) => current.filter((message) => message.sessionId !== activeSessionId));
    setLiveText("");
    setPendingUserMessageId("");
    setTurnError("");
    setTurnState("submitted");
  }, [activeSessionId, setLiveText, setLocalMessages, setPendingUserMessageId, setTurnError, setTurnState]);

  const handleLineageError = useCallback(
    (error: unknown) => {
      if (isSessionNotFoundError(error) && activeSessionId) {
        onSessionMissing(activeSessionId);
        setTurnState("idle");
        setTurnError("That chat session no longer exists on the daemon.");
        return;
      }
      if (isSessionClosedError(error)) {
        setTurnState("idle");
        setTurnError("This chat is closed — start a new chat to keep going.");
        return;
      }
      setTurnState("error");
      setTurnError(formatError(error));
    },
    [activeSessionId, onSessionMissing, setTurnError, setTurnState],
  );

  const regenerateMutation = useMutation<void, Error, { sessionId: string; messageId?: string }>({
    mutationFn: async (vars) => {
      beginLineageTurn();
      await gv.chat.messages.retry(vars.sessionId, vars.messageId ? { messageId: vars.messageId } : undefined);
      await invalidateChatState(vars.sessionId);
    },
    onError: handleLineageError,
  });

  const editMutation = useMutation<void, Error, { sessionId: string; messageId: string; content: string }>({
    mutationFn: async (vars) => {
      beginLineageTurn();
      await gv.chat.messages.edit(vars.sessionId, { messageId: vars.messageId, content: vars.content });
      await invalidateChatState(vars.sessionId);
    },
    onError: handleLineageError,
  });

  /** Edit-and-branch (companion.chat.messages.edit): the original and
   * everything after it are SUPERSEDED server-side (retained, viewable) and a
   * fresh turn answers the edit. Un-persisted optimistic messages cannot be
   * branched — those resend honestly as a new message. */
  const editAndResend = useCallback(
    (messageId: string, newText: string) => {
      const content = newText.trim();
      if (!content || !activeSessionId) return;
      if (isServerMessageId(messageId)) {
        editMutation.mutate({ sessionId: activeSessionId, messageId, content });
        return;
      }
      sendMutation.mutate({ body: content, files: [] });
    },
    [activeSessionId, editMutation, sendMutation],
  );

  /** Regenerate (companion.chat.messages.retry): supersedes the prior
   * response server-side and re-runs from the preceding user message. */
  const regenerateFrom = useCallback(
    (messageId: string, _messages: ChatMessage[]) => {
      if (!activeSessionId) return;
      regenerateMutation.mutate({
        sessionId: activeSessionId,
        ...(isServerMessageId(messageId) ? { messageId } : {}),
      });
    },
    [activeSessionId, regenerateMutation],
  );

  return {
    mutate: sendMutation.mutate,
    isPending: sendMutation.isPending,
    error: sendMutation.error,
    editAndResend,
    regenerateFrom,
    isLineagePending: regenerateMutation.isPending || editMutation.isPending,
    lineageError: regenerateMutation.error ?? editMutation.error,
  };
}
