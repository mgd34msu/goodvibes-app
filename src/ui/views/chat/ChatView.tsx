// ChatView — the Wave A assembly of the chat modules in this directory:
// session rail (useChatSessions) + transcript (MessageList over honest
// lineage) + live stream (useChatStream) + Composer (useChatSend). Ported
// from goodvibes-webui src/views/ChatView.tsx and re-shaped for this app's
// single-view layout (the webui kept the session rail in its global sidebar;
// here the rail is part of the view). Active session id persists via
// localStorage (companion-chat.ts) — not the URL — so the keep-alive view
// survives shell navigation without cross-hook URL-state races.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, MessageSquare, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { asRecord, bestId, bestTitle, firstString, formatRelative, readPath } from "../../lib/wire.ts";
import { formatError, isMethodUnavailableError, isSessionNotFoundError } from "../../lib/errors.ts";
import { runCommand } from "../../lib/commands.ts";
import { useToast } from "../../lib/toast.ts";
import { announce } from "../../lib/announcer.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { MessageList } from "./MessageList.tsx";
import { Composer, type SlashCommandHint } from "./Composer.tsx";
import { ChatSearch } from "./ChatSearch.tsx";
import { useChatSessions } from "./useChatSessions.ts";
import { useChatStream } from "./useChatStream.ts";
import { useChatSend, useSendBudget, type AttachedArtifactRef } from "./useChatSend.ts";
import {
  companionMessagesFromListResponse,
  mergeCompanionMessages,
  extractSessionId,
  readStoredActiveSessionId,
  writeStoredActiveSessionId,
  type LocalCompanionMessage,
} from "./companion-chat.ts";
import {
  ACTIVE_TURN_STATES,
  deriveChatTitle,
  messageCreatedAt,
  messageText,
  messageTone,
} from "./message-utils.ts";
import { buildLineage } from "./lineage.ts";
import { providerOptionsFromResponse } from "./provider-models.ts";
import {
  buildTranscriptExport,
  downloadContent,
  pushInputHistory,
  readAlwaysSpeakPref,
  readBookmarks,
  readCollapseThreshold,
  readLineNumbersPref,
  toggleBookmark,
  writeAlwaysSpeakPref,
  writeLineNumbersPref,
  type ExportFormat,
} from "./chat-local.ts";
import { speakText, useVoiceStatus } from "./voice.ts";
import { CHAT_FOCUS_COMPOSER_EVENT, CHAT_NEW_EVENT, CHAT_SEARCH_EVENT } from "./chat-events.ts";
import type { ChatMessage } from "./types.ts";

const SLASH_COMMANDS: readonly SlashCommandHint[] = [
  { name: "new", description: "Start a new chat" },
  { name: "clear", description: "Start fresh (new chat; this one stays in the rail)" },
  { name: "help", description: "Show keyboard shortcuts" },
];

/** Enter sends, Shift+Enter newlines, IME composition never submits. */
function shouldSubmitComposerKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
}

function reasoningEffortFrom(config: unknown): string {
  const flat = asRecord(asRecord(config)["config"])["provider.reasoningEffort"];
  if (typeof flat === "string") return flat;
  const nested = readPath(config, ["config", "provider", "reasoningEffort"]);
  if (typeof nested === "string") return nested;
  const bare = readPath(config, ["provider", "reasoningEffort"]);
  return typeof bare === "string" ? bare : "";
}

export function ChatView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveTextRef = useRef("");
  const autoTitledSessionsRef = useRef<Set<string>>(new Set());
  const manuallyTitledSessionsRef = useRef<Set<string>>(new Set());

  const [activeSessionId, setActiveSessionIdState] = useState<string>(() => readStoredActiveSessionId());
  const [draft, setDraft] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [artifactRefs, setArtifactRefs] = useState<AttachedArtifactRef[]>([]);
  const [liveText, setLiveText] = useState("");
  const [turnState, setTurnState] = useState("idle");
  const [turnError, setTurnError] = useState("");
  const [localMessages, setLocalMessages] = useState<LocalCompanionMessage[]>([]);
  const [pendingUserMessageId, setPendingUserMessageId] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [createDefaults, setCreateDefaults] = useState<{ provider?: string; model?: string }>({});
  const [lineNumbers, setLineNumbers] = useState(() => readLineNumbersPref());
  const [alwaysSpeak, setAlwaysSpeak] = useState(() => readAlwaysSpeakPref());
  const [bookmarkNonce, setBookmarkNonce] = useState(0);
  const collapseThreshold = useMemo(() => readCollapseThreshold(), []);

  const setActiveSessionId = useCallback((sessionId: string) => {
    setActiveSessionIdState(sessionId);
    writeStoredActiveSessionId(sessionId);
  }, []);

  const sessionsState = useChatSessions();
  const { sessionItems, addLocalSession, updateLocalSession, dropLocalSession } = sessionsState;
  const { availability: voiceAvailability } = useVoiceStatus();
  const sendBudget = useSendBudget();

  const activeSession = useMemo(
    () => sessionItems.find((session) => extractSessionId(session) === activeSessionId),
    [activeSessionId, sessionItems],
  );
  const activeSessionTitle = activeSessionId ? bestTitle(activeSession, activeSessionId) : "New Chat";

  // --- session-missing reconcile ------------------------------------------
  const onSessionMissing = useCallback(
    (sessionId: string) => {
      dropLocalSession(sessionId);
      setActiveSessionId("");
      setTurnState("idle");
      setTurnError("");
      toast({ title: "That chat no longer exists on the daemon.", tone: "warning" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatSessions });
    },
    [dropLocalSession, queryClient, setActiveSessionId, toast],
  );

  const invalidateChatState = useCallback(
    async (sessionId: string) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(sessionId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.chatSessions }),
      ]);
    },
    [queryClient],
  );

  // --- messages (server truth) + optimistic merge --------------------------
  const messages = useQuery({
    queryKey: queryKeys.chatMessages(activeSessionId),
    enabled: Boolean(activeSessionId),
    queryFn: () => gv.chat.messages.list(activeSessionId),
    retry: (failureCount, error) => !isSessionNotFoundError(error) && failureCount < 2,
    // An active or syncing turn polls as the fallback for anything the live
    // stream misses (this port's stream reconnects forever — no paused state).
    refetchInterval:
      ACTIVE_TURN_STATES.includes(turnState) || turnState === "syncing" ? 1000 : false,
  });

  useEffect(() => {
    if (!activeSessionId || !messages.isError || !isSessionNotFoundError(messages.error)) return;
    onSessionMissing(activeSessionId);
  }, [activeSessionId, messages.error, messages.isError, onSessionMissing]);

  const renderedMessageItems = useMemo(
    () =>
      mergeCompanionMessages(
        companionMessagesFromListResponse(messages.data),
        localMessages,
        activeSessionId,
      ) as ChatMessage[],
    [activeSessionId, localMessages, messages.data],
  );
  const lineageNodes = useMemo(() => buildLineage(renderedMessageItems), [renderedMessageItems]);

  // --- voice: always-speak on completed turns ------------------------------
  const alwaysSpeakRef = useRef(alwaysSpeak);
  alwaysSpeakRef.current = alwaysSpeak;
  const ttsAvailableRef = useRef(voiceAvailability.ttsAvailable);
  ttsAvailableRef.current = voiceAvailability.ttsAvailable;
  const onTurnCompleted = useCallback((content: string, _elapsedMs: number) => {
    if (alwaysSpeakRef.current && ttsAvailableRef.current && content) {
      speakText(`turn-${Date.now()}`, content);
    }
  }, []);

  // --- live stream ----------------------------------------------------------
  const { isStreaming, streamHealth, toolCalls, turnMetrics, stop, retryStream } = useChatStream({
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
  });

  // --- send ----------------------------------------------------------------
  const send = useChatSend({
    activeSessionId,
    onActiveSessionChange: setActiveSessionId,
    onLocalSessionCreated: addLocalSession,
    onSessionMissing,
    setTurnState,
    setTurnError,
    setLiveText,
    setLocalMessages,
    setPendingUserMessageId,
    invalidateChatState,
    turnState,
    // 'idle'/'connecting' are not drops — only a lost stream demotes the send.
    streamHealthy: streamHealth !== "reconnecting",
    createDefaults,
  });

  // --- provider/model picker (daemon-owned per session) ---------------------
  const providers = useQuery({ queryKey: queryKeys.providers, queryFn: () => gv.providers.list() });
  const providerOptions = useMemo(() => providerOptionsFromResponse(providers.data), [providers.data]);
  const sessionProvider = activeSessionId
    ? firstString(activeSession, ["provider", "providerId"])
    : (createDefaults.provider ?? "");
  const sessionModel = activeSessionId
    ? firstString(activeSession, ["model", "modelId"])
    : (createDefaults.model ?? "");

  const selectModel = useMutation({
    mutationFn: ({ provider, model }: { provider: string; model: string }) =>
      gv.chat.sessions.update(activeSessionId, { provider, model }),
    onSuccess: async (result, variables) => {
      updateLocalSession(activeSessionId, {
        ...asRecord(activeSession),
        sessionId: activeSessionId,
        provider: variables.provider,
        model: variables.model,
        ...asRecord(readPath(result, ["session"])),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatSessions });
    },
  });

  const onSelectModel = useCallback(
    (providerId: string, modelId: string) => {
      if (activeSessionId) selectModel.mutate({ provider: providerId, model: modelId });
      else setCreateDefaults({ provider: providerId, model: modelId });
    },
    [activeSessionId, selectModel],
  );

  // --- reasoning effort (provider.reasoningEffort, shared config) -----------
  const config = useQuery({ queryKey: queryKeys.configAll, queryFn: () => gv.config.get() });
  const setReasoning = useMutation({
    mutationFn: (value: string) => gv.config.set({ key: "provider.reasoningEffort", value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.configAll }),
  });
  const reasoning = config.isSuccess
    ? {
        value: setReasoning.isPending ? (setReasoning.variables ?? "") : reasoningEffortFrom(config.data),
        pending: setReasoning.isPending,
        onChange: (value: string) => setReasoning.mutate(value),
      }
    : null;

  // --- turn-state resolution effects (webui port) ---------------------------
  useEffect(() => {
    if ((!ACTIVE_TURN_STATES.includes(turnState) && turnState !== "syncing") || liveText) return;
    const lastMessage = renderedMessageItems.at(-1);
    if (lastMessage && messageTone(lastMessage) === "assistant") {
      setPendingUserMessageId("");
      setTurnState("completed");
    }
  }, [liveText, renderedMessageItems, turnState]);

  useEffect(() => {
    if (!pendingUserMessageId || turnError) return;
    const pendingUser = renderedMessageItems.find((message) => bestId(message) === pendingUserMessageId);
    const pendingCreatedAt = messageCreatedAt(pendingUser);
    const hasAssistantReply = renderedMessageItems.some(
      (message) => messageTone(message) === "assistant" && messageCreatedAt(message) >= pendingCreatedAt,
    );
    if (hasAssistantReply) {
      setPendingUserMessageId("");
      setTurnState("completed");
    }
  }, [pendingUserMessageId, renderedMessageItems, turnError]);

  // Client-side auto-title after the first exchange; never overwrites a
  // hand-set title, fires at most once per session (webui pattern).
  useEffect(() => {
    if (!activeSessionId || renamingId) return;
    if (autoTitledSessionsRef.current.has(activeSessionId)) return;
    if (manuallyTitledSessionsRef.current.has(activeSessionId)) return;
    const firstUser = renderedMessageItems.find((message) => messageTone(message) === "user");
    const hasAssistantReply = renderedMessageItems.some((message) => messageTone(message) === "assistant");
    if (!firstUser || !hasAssistantReply) return;
    const firstUserText = messageText(firstUser);
    const derived = deriveChatTitle(firstUserText);
    if (!derived) return;
    const current = activeSessionTitle;
    const looksAutoGenerated =
      current === "" ||
      current === activeSessionId ||
      current === "New Chat" ||
      current === firstUserText.slice(0, 72) ||
      current === derived;
    autoTitledSessionsRef.current.add(activeSessionId);
    if (!looksAutoGenerated || current === derived) return;
    sessionsState.renameSession(activeSessionId, derived);
  }, [activeSessionId, activeSessionTitle, renamingId, renderedMessageItems, sessionsState]);

  // --- scroll behavior -------------------------------------------------------
  useEffect(() => {
    setShowJumpToBottom(false);
  }, [activeSessionId]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || showJumpToBottom) return;
    window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [activeSessionId, liveText, renderedMessageItems.length, showJumpToBottom]);

  const handleMessagesScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    setShowJumpToBottom(container.scrollHeight - container.scrollTop - container.clientHeight > 180);
  }, []);

  const scrollMessagesToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setShowJumpToBottom(false);
  }, []);

  // --- draft / send ----------------------------------------------------------
  const startDraft = useCallback(() => {
    stop();
    setActiveSessionId("");
    setTurnState("idle");
    setTurnError("");
    setLiveText("");
    setLocalMessages([]);
    setShowSearch(false);
    announce("New chat");
    composerRef.current?.focus();
  }, [setActiveSessionId, stop]);

  const sendText = useCallback(
    (text: string, files: File[] = [], refs: AttachedArtifactRef[] = []) => {
      const body = text.trim();
      if (send.isPending || (!body && !files.length && !refs.length)) return;
      if (body.startsWith("/")) {
        const slash = body.slice(1).toLowerCase();
        if (slash === "new" || slash === "clear") {
          setDraft("");
          startDraft();
          return;
        }
        if (slash === "help") {
          setDraft("");
          runCommand("system.shortcuts");
          return;
        }
      }
      if (body) pushInputHistory(body);
      setDraft("");
      setAttachedFiles([]);
      setArtifactRefs([]);
      composerRef.current?.focus();
      send.mutate({ body, files: [...files], artifactRefs: refs });
    },
    [send, startDraft],
  );

  const submitDraft = useCallback(() => {
    sendText(draft, attachedFiles, artifactRefs);
  }, [artifactRefs, attachedFiles, draft, sendText]);

  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      submitDraft();
    },
    [submitDraft],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!shouldSubmitComposerKey(event)) return;
      event.preventDefault();
      submitDraft();
    },
    [submitDraft],
  );

  // --- message actions --------------------------------------------------------
  const copyMessage = useCallback(async (message: ChatMessage) => {
    const id = bestId(message);
    const text = messageText(message);
    if (!text) return;
    await navigator.clipboard?.writeText(text);
    setCopiedMessageId(id);
    window.setTimeout(() => setCopiedMessageId((current) => (current === id ? "" : current)), 1300);
  }, []);

  const bookmarkedIds = useMemo(() => {
    void bookmarkNonce;
    return new Set(readBookmarks(activeSessionId).map((b) => b.messageId));
  }, [activeSessionId, bookmarkNonce]);

  const onToggleBookmark = useCallback(
    (messageId: string, snippet: string) => {
      if (!activeSessionId) return;
      const added = toggleBookmark(activeSessionId, messageId, snippet);
      setBookmarkNonce((n) => n + 1);
      announce(added ? "Bookmarked" : "Bookmark removed");
    },
    [activeSessionId],
  );

  // --- shell events (palette / keybindings reach into the keep-alive view) ---
  useEffect(() => {
    const onNew = () => startDraft();
    const onFocus = () => composerRef.current?.focus();
    const onSearch = () => setShowSearch(true);
    window.addEventListener(CHAT_NEW_EVENT, onNew);
    window.addEventListener(CHAT_FOCUS_COMPOSER_EVENT, onFocus);
    window.addEventListener(CHAT_SEARCH_EVENT, onSearch);
    return () => {
      window.removeEventListener(CHAT_NEW_EVENT, onNew);
      window.removeEventListener(CHAT_FOCUS_COMPOSER_EVENT, onFocus);
      window.removeEventListener(CHAT_SEARCH_EVENT, onSearch);
    };
  }, [startDraft]);

  // --- rail rename/delete -----------------------------------------------------
  const finishRename = useCallback(() => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId("");
    if (!id || !title) return;
    manuallyTitledSessionsRef.current.add(id);
    sessionsState.renameSession(id, title);
  }, [renameDraft, renamingId, sessionsState]);

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      const gone = await sessionsState.deleteSession(target.id);
      if (gone) {
        if (activeSessionId === target.id) startDraft();
        toast({ title: `Deleted "${target.title}"`, tone: "success" });
      } else {
        toast({
          title: "Delete did not stick",
          description: "The daemon still lists this chat after the delete call.",
          tone: "danger",
        });
      }
    } catch (error) {
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    }
  }, [activeSessionId, deleteTarget, sessionsState, startDraft, toast]);

  // --- export -------------------------------------------------------------------
  const exportTranscript = useCallback(
    (format: ExportFormat) => {
      const { filename, mimeType, content } = buildTranscriptExport(
        activeSessionTitle,
        renderedMessageItems,
        format,
        true,
      );
      downloadContent(filename, mimeType, content);
      toast({ title: `Exported ${filename}`, tone: "success", durationMs: 2000 });
    },
    [activeSessionTitle, renderedMessageItems, toast],
  );

  const jumpToMessage = useCallback((messageId: string) => {
    setShowSearch(false);
    window.requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
        ?.scrollIntoView({ block: "center" });
    });
  }, []);

  const errorRows = useMemo(() => {
    const rows: (string | { error: unknown })[] = [];
    if (send.error) rows.push({ error: send.error });
    if (send.lineageError) rows.push({ error: send.lineageError });
    if (turnError) rows.push(turnError);
    if (sessionsState.renameError) rows.push({ error: sessionsState.renameError });
    if (selectModel.error) rows.push({ error: selectModel.error });
    if (setReasoning.error) rows.push({ error: setReasoning.error });
    return rows;
  }, [selectModel.error, send.error, send.lineageError, sessionsState.renameError, setReasoning.error, turnError]);

  const visibleTurnState = turnState !== "idle" && turnState !== "completed";

  // --- rail list (four states) --------------------------------------------------
  let railBody;
  if (sessionsState.isLoading) {
    railBody = (
      <div className="chat-rail-skeleton">
        <SkeletonBlock height={40} />
        <SkeletonBlock height={40} />
        <SkeletonBlock height={40} />
      </div>
    );
  } else if (sessionsState.isError && isMethodUnavailableError(sessionsState.error)) {
    railBody = (
      <UnavailableState
        capability="companion.chat.sessions.list"
        description="This daemon build does not expose companion chat."
      />
    );
  } else if (sessionsState.isError && sessionItems.length === 0) {
    railBody = <ErrorState error={sessionsState.error} onRetry={sessionsState.refetch} title="Chats failed to load" />;
  } else if (sessionItems.length === 0) {
    railBody = (
      <EmptyState
        icon={<MessageSquare size={20} />}
        title="No chats yet"
        description="Send a message to start your first chat."
        action={{ label: "New chat", onClick: startDraft }}
      />
    );
  } else {
    railBody = (
      <ul className="chat-rail-list" role="list">
        {sessionItems.map((session) => {
          const id = extractSessionId(session);
          if (!id) return null;
          const title = bestTitle(session, id);
          const updated = formatRelative(asRecord(session)["updatedAt"] ?? asRecord(session)["createdAt"]);
          const isActive = id === activeSessionId;
          return (
            <li key={id}>
              {renamingId === id ? (
                <input
                  className="chat-rail-rename"
                  value={renameDraft}
                  autoFocus
                  aria-label={`Rename ${title}`}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={finishRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") finishRename();
                    if (event.key === "Escape") setRenamingId("");
                  }}
                />
              ) : (
                <div className={isActive ? "chat-rail-item active" : "chat-rail-item"}>
                  <button
                    type="button"
                    className="chat-rail-item-main"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => {
                      setActiveSessionId(id);
                      setShowSearch(false);
                    }}
                  >
                    <span className="chat-rail-item-title">{title}</span>
                    {updated && <span className="chat-rail-item-time">{updated}</span>}
                  </button>
                  <span className="chat-rail-item-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Rename ${title}`}
                      title="Rename"
                      onClick={() => {
                        setRenamingId(id);
                        setRenameDraft(title === id ? "" : title);
                      }}
                    >
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`Delete ${title}`}
                      title="Delete permanently"
                      disabled={sessionsState.deletePending}
                      onClick={() => setDeleteTarget({ id, title })}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="chat-view">
      <aside className="chat-rail" aria-label="Chat sessions">
        <div className="chat-rail-header">
          <span className="chat-rail-title">Chats</span>
          <button type="button" className="icon-button" aria-label="New chat" title="New chat" onClick={startDraft}>
            <Plus size={15} aria-hidden="true" />
          </button>
        </div>
        {railBody}
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <div className="chat-header-title">
            <h2 title={activeSessionTitle}>{activeSessionTitle}</h2>
            {(visibleTurnState || streamHealth === "reconnecting") && (
              <span className="chat-turn-state" role="status">
                {streamHealth === "reconnecting" && !visibleTurnState ? "stream reconnecting" : turnState}
                {streamHealth === "reconnecting" && (
                  <button type="button" className="chat-turn-retry" onClick={retryStream}>
                    Retry stream
                  </button>
                )}
              </span>
            )}
          </div>
          <div className="chat-header-actions">
            <button
              type="button"
              className="icon-button"
              aria-pressed={showSearch}
              aria-label={showSearch ? "Close search" : "Search messages"}
              title="Search messages"
              onClick={() => setShowSearch((open) => !open)}
            >
              <Search size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-pressed={lineNumbers}
              aria-label="Toggle code line numbers"
              title="Toggle code line numbers"
              onClick={() =>
                setLineNumbers((on) => {
                  writeLineNumbersPref(!on);
                  return !on;
                })
              }
            >
              #
            </button>
            <span className="chat-export" role="group" aria-label="Export transcript">
              <Download size={13} aria-hidden="true" />
              {(["md", "json", "html"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  className="chat-export-btn"
                  disabled={renderedMessageItems.length === 0}
                  onClick={() => exportTranscript(format)}
                >
                  {format}
                </button>
              ))}
            </span>
          </div>
        </header>

        <ChatSearch
          open={showSearch}
          messages={renderedMessageItems}
          sessionItems={sessionItems}
          activeSessionId={activeSessionId}
          onJumpToMessage={jumpToMessage}
          onSelectSession={(sessionId) => {
            setActiveSessionId(sessionId);
            setShowSearch(false);
          }}
          onClose={() => setShowSearch(false)}
        />

        {activeSessionId && messages.isLoading ? (
          <div className="chat-conversation chat-conversation--loading">
            <SkeletonBlock height={72} />
            <SkeletonBlock height={72} />
            <SkeletonBlock height={72} />
          </div>
        ) : activeSessionId && messages.isError && !isSessionNotFoundError(messages.error) ? (
          <div className="chat-conversation">
            <ErrorState
              error={messages.error}
              onRetry={() => void messages.refetch()}
              title="Messages failed to load"
            />
          </div>
        ) : !activeSessionId && lineageNodes.length === 0 && !liveText ? (
          <div className="chat-conversation chat-conversation--empty">
            <EmptyState
              icon={<MessageSquare size={22} />}
              title="Start a conversation"
              description="Messages stream back live. Attach files, dictate, or pick a model below."
            />
          </div>
        ) : (
          <MessageList
            nodes={lineageNodes}
            liveText={liveText}
            turnState={turnState}
            toolCalls={toolCalls}
            turnMetrics={turnMetrics}
            showJumpToBottom={showJumpToBottom}
            isSendPending={send.isPending}
            isStreaming={isStreaming}
            copiedMessageId={copiedMessageId}
            lineNumbers={lineNumbers}
            collapseThreshold={collapseThreshold}
            bookmarkedIds={bookmarkedIds}
            scrollRef={scrollRef}
            onScroll={handleMessagesScroll}
            onJumpToBottom={scrollMessagesToBottom}
            onCopyMessage={(message) => void copyMessage(message)}
            onResendMessage={(message) => sendText(messageText(message))}
            onRegenerateFrom={(messageId) => send.regenerateFrom(messageId, renderedMessageItems)}
            onEditMessage={send.editAndResend}
            onToggleBookmark={onToggleBookmark}
            onStop={stop}
          />
        )}

        <Composer
          draft={draft}
          attachedFiles={attachedFiles}
          artifactRefs={artifactRefs}
          isSendPending={send.isPending}
          sendBudget={sendBudget}
          errorRows={errorRows}
          providerOptions={providerOptions}
          sessionProvider={sessionProvider}
          sessionModel={sessionModel}
          modelPickerPending={selectModel.isPending}
          onSelectModel={onSelectModel}
          composerRef={composerRef}
          fileInputRef={fileInputRef}
          slashCommands={SLASH_COMMANDS}
          reasoning={reasoning}
          alwaysSpeak={alwaysSpeak}
          onToggleAlwaysSpeak={() =>
            setAlwaysSpeak((on) => {
              writeAlwaysSpeakPref(!on);
              return !on;
            })
          }
          onDraftChange={setDraft}
          onSubmit={handleSubmit}
          onComposerKeyDown={handleComposerKeyDown}
          onFilesAdded={(files) => setAttachedFiles((current) => [...current, ...files])}
          onRemoveAttachedFile={(index) =>
            setAttachedFiles((current) => current.filter((_file, i) => i !== index))
          }
          onAddArtifactRef={(ref) =>
            setArtifactRefs((current) =>
              current.some((existing) => existing.artifactId === ref.artifactId) ? current : [...current, ref],
            )
          }
          onRemoveArtifactRef={(index) => setArtifactRefs((current) => current.filter((_ref, i) => i !== index))}
        />
      </section>

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete chat"
        target={deleteTarget?.title ?? ""}
        blastRadius="Removes the chat record and its messages from the daemon. It cannot be reopened."
        danger
        confirmLabel="Delete permanently"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
