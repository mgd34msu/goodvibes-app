// Chat search: in-transcript mode (Ctrl+F semantics — Enter next, Shift+Enter
// previous, wrap marker, match counter, error-jump buttons) and an all-chats
// mode that tries the WS-only sessions.search and degrades honestly to a
// client-side scan of recent companion sessions when the bridge or method is
// unavailable (FEATURES §1 "Chat search").

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { gv, listFrom } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { firstString } from "../../lib/wire.ts";
import { companionMessagesFromListResponse, extractSessionId } from "./companion-chat.ts";
import { bestId, messageText } from "./message-utils.ts";
import type { ChatMessage } from "./types.ts";

export interface TranscriptMatch {
  messageId: string;
  snippet: string;
}

interface CrossSessionHit {
  sessionId: string;
  title: string;
  snippet: string;
}

interface ChatSearchProps {
  open: boolean;
  messages: ChatMessage[];
  sessionItems: unknown[];
  activeSessionId: string;
  onJumpToMessage: (messageId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onClose: () => void;
}

/** True when a message looks like an error row (next/prev error jump). */
export function isErrorMessage(message: ChatMessage): boolean {
  const record = message as Record<string, unknown>;
  const metadata = record["metadata"];
  if (metadata && typeof metadata === "object" && (metadata as Record<string, unknown>)["error"]) return true;
  const text = messageText(message);
  return /^(error|✖|failed):/im.test(text) || /companion chat turn failed/i.test(text);
}

export function ChatSearch({
  open,
  messages,
  sessionItems,
  activeSessionId,
  onJumpToMessage,
  onSelectSession,
  onClose,
}: ChatSearchProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"chat" | "all">("chat");
  const [cursor, setCursor] = useState(0);
  const [wrapped, setWrapped] = useState(false);
  const [allState, setAllState] = useState<{
    status: "idle" | "loading" | "done" | "error";
    hits: CrossSessionHit[];
    note: string;
    error?: unknown;
  }>({ status: "idle", hits: [], note: "" });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const matches: TranscriptMatch[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || mode !== "chat") return [];
    return messages
      .map((message) => ({ messageId: bestId(message), text: messageText(message) }))
      .filter((entry) => entry.messageId && entry.text.toLowerCase().includes(q))
      .map((entry) => {
        const at = entry.text.toLowerCase().indexOf(q);
        return {
          messageId: entry.messageId,
          snippet: entry.text.slice(Math.max(0, at - 30), at + 50).replace(/\s+/g, " "),
        };
      });
  }, [messages, mode, query]);

  useEffect(() => {
    setCursor(0);
    setWrapped(false);
  }, [query, mode]);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!matches.length) return;
      let next = cursor + direction;
      let didWrap = false;
      if (next >= matches.length) {
        next = 0;
        didWrap = true;
      } else if (next < 0) {
        next = matches.length - 1;
        didWrap = true;
      }
      setCursor(next);
      setWrapped(didWrap);
      const match = matches[next];
      if (match) onJumpToMessage(match.messageId);
    },
    [cursor, matches, onJumpToMessage],
  );

  const errorIds = useMemo(
    () => messages.filter(isErrorMessage).map((message) => bestId(message)).filter(Boolean),
    [messages],
  );
  const errorCursorRef = useRef(-1);
  const jumpError = useCallback(
    (direction: 1 | -1) => {
      if (!errorIds.length) return;
      errorCursorRef.current =
        (errorCursorRef.current + direction + errorIds.length) % errorIds.length;
      const id = errorIds[errorCursorRef.current];
      if (id) onJumpToMessage(id);
    },
    [errorIds, onJumpToMessage],
  );

  // Cross-session search: sessions.search [ws] first, client-side scan fallback.
  const runAllSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setAllState({ status: "loading", hits: [], note: "" });
    try {
      const result = await gv.sessions.search({ query: q, limit: 20 });
      const hits = listFrom(result, ["results", "hits", "items", "sessions", "matches"])
        .map((hit) => ({
          sessionId: firstString(hit, ["sessionId", "id"]),
          title: firstString(hit, ["title", "name", "summary"]) || firstString(hit, ["sessionId", "id"]),
          snippet: firstString(hit, ["snippet", "excerpt", "text", "content", "match"]),
        }))
        .filter((hit) => hit.sessionId);
      setAllState({ status: "done", hits, note: "via sessions.search" });
      return;
    } catch (error) {
      if (!isWsBridgeUnavailableError(error) && !isMethodUnavailableError(error)) {
        setAllState({ status: "error", hits: [], note: "", error });
        return;
      }
      // Honest degrade: scan the most recent companion sessions client-side.
    }
    try {
      const recent = sessionItems.slice(0, 12);
      const lowered = q.toLowerCase();
      const hits: CrossSessionHit[] = [];
      for (const session of recent) {
        const sessionId = extractSessionId(session);
        if (!sessionId) continue;
        const title = firstString(session, ["title", "name"]) || sessionId;
        const response =
          sessionId === activeSessionId ? null : await gv.chat.messages.list(sessionId).catch(() => null);
        const sessionMessages =
          sessionId === activeSessionId ? messages : companionMessagesFromListResponse(response);
        for (const message of sessionMessages) {
          const text = messageText(message);
          const at = text.toLowerCase().indexOf(lowered);
          if (at === -1) continue;
          hits.push({
            sessionId,
            title,
            snippet: text.slice(Math.max(0, at - 30), at + 60).replace(/\s+/g, " "),
          });
          break;
        }
      }
      setAllState({
        status: "done",
        hits,
        note: "sessions.search is unavailable on this daemon transport — scanned the 12 most recent chats client-side",
      });
    } catch (error) {
      setAllState({ status: "error", hits: [], note: "", error });
    }
  }, [activeSessionId, messages, query, sessionItems]);

  if (!open) return null;

  return (
    <div className="chat-search" role="search" aria-label="Search chat">
      <div className="chat-search__row">
        <input
          ref={inputRef}
          value={query}
          placeholder={mode === "chat" ? "Search this conversation…" : "Search all chats…"}
          aria-label={mode === "chat" ? "Search this conversation" : "Search all chats"}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (mode === "chat") step(event.shiftKey ? -1 : 1);
              else void runAllSearch();
            }
          }}
        />
        <div className="chat-search__modes" role="tablist" aria-label="Search scope">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "chat"}
            className={mode === "chat" ? "is-active" : ""}
            onClick={() => setMode("chat")}
          >
            This chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "all"}
            className={mode === "all" ? "is-active" : ""}
            onClick={() => setMode("all")}
          >
            All chats
          </button>
        </div>
        {mode === "chat" && (
          <>
            <span className="chat-search__count" role="status">
              {query.trim() ? (matches.length ? `${cursor + 1}/${matches.length}` : "0 matches") : ""}
              {wrapped && <em className="chat-search__wrap"> · wrapped</em>}
            </span>
            <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" onClick={() => step(-1)}>
              <ChevronUp size={14} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Next match" title="Next match (Enter)" onClick={() => step(1)}>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Jump to next error"
              title={errorIds.length ? `Jump between ${errorIds.length} error message${errorIds.length === 1 ? "" : "s"}` : "No error messages in this chat"}
              disabled={!errorIds.length}
              onClick={() => jumpError(1)}
            >
              <AlertTriangle size={14} aria-hidden="true" />
            </button>
          </>
        )}
        {mode === "all" && (
          <button type="button" className="chat-search__run" onClick={() => void runAllSearch()} disabled={!query.trim()}>
            Search
          </button>
        )}
        <button type="button" aria-label="Close search" title="Close search (Esc)" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {mode === "all" && (
        <div className="chat-search__results">
          {allState.status === "loading" && <span className="chat-search__note">Searching…</span>}
          {allState.status === "error" && (
            <span className="chat-search__note chat-search__note--error">{formatError(allState.error)}</span>
          )}
          {allState.status === "done" && allState.note && <span className="chat-search__note">{allState.note}</span>}
          {allState.status === "done" && !allState.hits.length && (
            <span className="chat-search__note">No chats mention “{query.trim()}”.</span>
          )}
          {allState.hits.map((hit, index) => (
            <button
              key={`${hit.sessionId}-${index}`}
              type="button"
              className="chat-search__hit"
              onClick={() => {
                onSelectSession(hit.sessionId);
                onClose();
              }}
            >
              <strong>{hit.title}</strong>
              <span>{hit.snippet}</span>
            </button>
          ))}
        </div>
      )}

      {mode === "chat" && query.trim() && matches.length > 0 && (
        <div className="chat-search__results">
          {matches.slice(0, 8).map((match, index) => (
            <button
              key={`${match.messageId}-${index}`}
              type="button"
              className={`chat-search__hit${index === cursor ? " is-current" : ""}`}
              onClick={() => {
                setCursor(index);
                onJumpToMessage(match.messageId);
              }}
            >
              <span>…{match.snippet}…</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
