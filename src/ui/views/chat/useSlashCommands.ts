// The three extra composer slash commands (docs/GAPS.md §1 row 31/36):
//  · /note <text>   — save text to the app-local notes registry (chat-local.ts
//    saveChatNote), toast with a jump link into Documents → Packets & notes.
//  · /keep           — promote the last assistant reply to durable memory
//    (memory.records.add), gated by the shared ConfirmSurface ("admin
//    confirm" per the task brief — memory.records.add is not daemon-flagged
//    dangerous, so this is a UI-side confirmation step, same idiom the
//    channels catalog uses for every invoke regardless of its dangerous flag).
//  · /imagine <prompt> — media.generate, then an inline preview appended to
//    the transcript as a LOCAL message (never sent to the daemon as a real
//    chat turn — there is nothing for the model to do with an image prompt
//    in a text turn). Honest limitation: this local message does not survive
//    reload/other clients, same as this app's other client-only affordances
//    (bookmarks, input history).
//
// Kept out of ChatView.tsx/Composer.tsx (both already large) as its own hook;
// wired into ChatView's existing slash-command dispatch in sendText().

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation } from "@tanstack/react-query";
import { gv, invoke } from "../../lib/gv.ts";
import { appFetch, HttpError } from "../../lib/http.ts";
import { formatError } from "../../lib/errors.ts";
import { asRecord, firstString } from "../../lib/wire.ts";
import type { ToastOptions } from "../../lib/toast.ts";
import { saveChatNote } from "./chat-local.ts";
import { messageText, messageTone } from "./message-utils.ts";
import type { LocalCompanionMessage } from "./companion-chat.ts";
import type { ChatMessage } from "./types.ts";

const RECOGNIZED_COMMANDS: ReadonlySet<string> = new Set(["note", "keep", "imagine"]);

function splitSlashCommand(body: string): { command: string; rest: string } {
  const spaceIdx = body.indexOf(" ");
  const command = (spaceIdx === -1 ? body.slice(1) : body.slice(1, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? "" : body.slice(spaceIdx + 1).trim();
  return { command, rest };
}

/** True when `body` (already known to start with "/") is one of this hook's
 * three commands — callers should check this BEFORE their own new/clear/help
 * handling so an unrecognized "/foo" still falls through to a normal send. */
export function isExtraSlashCommand(body: string): boolean {
  return RECOGNIZED_COMMANDS.has(splitSlashCommand(body).command);
}

function artifactIdFromGenerateResult(value: unknown): string {
  const record = asRecord(value);
  return (
    firstString(record, ["artifactId"]) ||
    firstString(asRecord(record["artifact"]), ["id", "artifactId"]) ||
    firstString(asRecord(record["result"]), ["artifactId"])
  );
}

function localMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseSlashCommandsOptions {
  activeSessionId: string;
  activeSessionTitle: string;
  renderedMessageItems: readonly ChatMessage[];
  setLocalMessages: Dispatch<SetStateAction<LocalCompanionMessage[]>>;
  /** Navigates to Documents → Packets & notes, ideally scrolled to noteId. */
  onJumpToNote: (noteId: string) => void;
  toast: (options: ToastOptions) => string;
}

export interface UseSlashCommandsResult {
  /** Handles /note, /keep, /imagine; returns true when `body` matched one of
   * them (the caller should stop — nothing more to send as a chat message). */
  tryHandle: (body: string) => boolean;
  keepConfirmOpen: boolean;
  keepPreview: string;
  keepPending: boolean;
  confirmKeep: () => void;
  cancelKeep: () => void;
  imaginePending: boolean;
}

export function useSlashCommands({
  activeSessionId,
  activeSessionTitle,
  renderedMessageItems,
  setLocalMessages,
  onJumpToNote,
  toast,
}: UseSlashCommandsOptions): UseSlashCommandsResult {
  const [keepTarget, setKeepTarget] = useState<{ content: string } | null>(null);

  const noteMutation = useMutation({
    mutationFn: (text: string) => saveChatNote(text, { sessionId: activeSessionId, sessionTitle: activeSessionTitle }),
    onSuccess: (saved) => {
      toast({
        title: "Saved note",
        tone: "success",
        ...(saved.id
          ? { action: { label: "Open in Documents", onClick: () => onJumpToNote(saved.id) } }
          : {}),
      });
    },
    onError: (error: unknown) => toast({ title: "Save note failed", description: formatError(error), tone: "danger" }),
  });

  const keepMutation = useMutation({
    mutationFn: (content: string) =>
      gv.memory.records.add({
        cls: "fact",
        scope: "session",
        summary: content.length > 140 ? `${content.slice(0, 140)}…` : content,
        detail: content,
        tags: ["chat-keep"],
      }),
    onSuccess: () => {
      setKeepTarget(null);
      toast({ title: "Kept to memory", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Keep failed", description: formatError(error), tone: "danger" });
    },
  });

  const imagineMutation = useMutation({
    mutationFn: async (vars: { prompt: string; userMessageId: string }) => {
      const result = await invoke("media.generate", { body: { prompt: vars.prompt } });
      const artifactId = artifactIdFromGenerateResult(result);
      if (!artifactId) {
        throw new Error("media.generate did not return an artifact id — nothing to preview.");
      }
      const path = gv.artifacts.contentPath(artifactId);
      const res = await appFetch(path);
      if (!res.ok) throw new HttpError(res.status, path, await res.text().catch(() => ""));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      return { artifactId, url };
    },
    onSuccess: ({ artifactId, url }, vars) => {
      setLocalMessages((current) => [
        ...current,
        {
          id: localMessageId("assistant"),
          sessionId: activeSessionId,
          role: "assistant",
          content: `![${vars.prompt.replace(/[[\]]/g, "")}](${url})\n\n_Generated via \`/imagine\` — local preview only, not sent to this chat's daemon session. Artifact id \`${artifactId}\`; open Artifacts to keep it._`,
          createdAt: Date.now(),
          deliveryState: "sent",
        },
      ]);
    },
    onError: (error: unknown, vars) => {
      setLocalMessages((current) => [
        ...current,
        {
          id: localMessageId("assistant"),
          sessionId: activeSessionId,
          role: "assistant",
          content: `_/imagine failed for "${vars.prompt}": ${formatError(error)}_`,
          createdAt: Date.now(),
          deliveryState: "sent",
        },
      ]);
      toast({ title: "Image generation failed", description: formatError(error), tone: "danger" });
    },
  });

  const tryHandle = useCallback(
    (body: string): boolean => {
      const { command, rest } = splitSlashCommand(body);
      if (!RECOGNIZED_COMMANDS.has(command)) return false;

      if (command === "note") {
        if (!rest) {
          toast({ title: "Nothing to save", description: "Usage: /note <text>", tone: "warning" });
          return true;
        }
        noteMutation.mutate(rest);
        return true;
      }

      if (command === "keep") {
        const lastAssistant = [...renderedMessageItems].reverse().find((m) => messageTone(m) === "assistant");
        const content = lastAssistant ? messageText(lastAssistant) : "";
        if (!content) {
          toast({ title: "Nothing to keep yet", description: "No assistant reply in this chat.", tone: "warning" });
          return true;
        }
        setKeepTarget({ content });
        return true;
      }

      // command === "imagine"
      if (!rest) {
        toast({ title: "Nothing to imagine", description: "Usage: /imagine <prompt>", tone: "warning" });
        return true;
      }
      if (!activeSessionId) {
        toast({ title: "Open a chat first", description: "/imagine needs an active chat to post its preview into.", tone: "warning" });
        return true;
      }
      setLocalMessages((current) => [
        ...current,
        {
          id: localMessageId("user"),
          sessionId: activeSessionId,
          role: "user",
          content: `/imagine ${rest}`,
          createdAt: Date.now(),
          deliveryState: "sent",
        },
      ]);
      imagineMutation.mutate({ prompt: rest, userMessageId: activeSessionId });
      return true;
    },
    [activeSessionId, imagineMutation, noteMutation, renderedMessageItems, setLocalMessages, toast],
  );

  return {
    tryHandle,
    keepConfirmOpen: keepTarget !== null,
    keepPreview: keepTarget?.content ?? "",
    keepPending: keepMutation.isPending,
    confirmKeep: () => {
      if (keepTarget) keepMutation.mutate(keepTarget.content);
    },
    cancelKeep: () => setKeepTarget(null),
    imaginePending: imagineMutation.isPending,
  };
}
