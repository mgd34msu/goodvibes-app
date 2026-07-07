// Quick switcher (docs/FEATURES.md §23 row 4, docs/GAPS.md top-10 gap #9) —
// a mod+p fuzzy switcher over views + recent chat/operator sessions, in the
// style of an editor's "go to anything". Self-contained: registers its own
// command + seeds its own default keybinding through the EXISTING registry
// APIs (lib/commands.ts, lib/keybindings.ts) rather than editing either
// module, and drives navigation the same way every other cross-view jump in
// this app does — through the shell's registered `nav.<id>` commands
// (lib/commands.ts) plus the router's pure functions (lib/router.ts) — NEVER
// its own `useUrlState()` instance, because only the shell's instance drives
// the mounted view outlet (see lib/approvals.ts / views/code/diff-model.ts
// for the same documented pattern this file follows).
//
// Two honest capability notes, discovered by reading the actual mount code
// (not assumed):
//   - Operator-session selection is reliable: "sessions" is NOT a keep-alive
//     view (views/registry.tsx), so SessionsView remounts on every jump and
//     reads ?session= fresh (its own `useState(() => getCurrentUrlState()
//     .session)`) — writing the URL right after the nav command lands
//     correctly every time.
//   - Chat-session selection is best-effort: ChatView IS keep-alive, and its
//     active session lives in a localStorage cache (companion-chat.ts) with
//     no reactive cross-component "select session" event exposed (chat-events
//     .ts only carries new/focus-composer/search). Writing that cache key
//     seeds a FRESH ChatView mount correctly; if Chat was already visited
//     this session, ChatView stays on its current session (switch to Chat
//     still happens, right session may not auto-select) — the honest limit
//     of what is reachable without editing views/chat/** (out of this file's
//     grant).

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Compass, MessageSquare, ListTodo } from "lucide-react";
import { getBinding, setBinding } from "../lib/keybindings.ts";
import { registerCommand, unregisterCommand, runCommand, fuzzyMatch } from "../lib/commands.ts";
import { getCurrentUrlState, replaceState } from "../lib/router.ts";
import { gv } from "../lib/gv.ts";
import { queryKeys } from "../lib/queries.ts";
import { bestId, bestTitle } from "../lib/wire.ts";
import { ALL_VIEWS } from "../views/registry.tsx";
import { companionSessionsFromListResponse, writeStoredActiveSessionId } from "../views/chat/companion-chat.ts";
import { unionSessionsFromListResponse } from "../views/sessions/sessions-union.ts";
import { useFocusTrap } from "../lib/focus-trap.ts";

const QUICK_SWITCHER_COMMAND_ID = "system.quickSwitcher";
const QUICK_SWITCHER_DEFAULT_COMBO = "mod+p";

// Seed the default combo through the public keybindings API exactly once —
// only if nothing (default or user override) is already bound to this
// command id. Never re-seeds afterward, so a later user remap always wins.
if (typeof window !== "undefined" && getBinding(QUICK_SWITCHER_COMMAND_ID) === undefined) {
  setBinding(QUICK_SWITCHER_COMMAND_ID, QUICK_SWITCHER_DEFAULT_COMBO);
}

type EntryType = "view" | "chat" | "session";

interface SwitcherEntry {
  key: string;
  type: EntryType;
  title: string;
  subtitle?: string;
  action: () => void;
}

const TYPE_LABEL: Record<EntryType, string> = {
  view: "View",
  chat: "Chat",
  session: "Session",
};

function navigateToView(viewId: string): void {
  runCommand(`nav.${viewId}`);
}

/** Jump to the Sessions view with a specific session selected. `sessions` is
 * NOT keep-alive, so this is reliable on every jump (see file header). */
function navigateToOperatorSession(sessionId: string): void {
  runCommand("nav.sessions");
  // Overwrite the URL AFTER the nav command's own pushState — the shell's
  // useUrlState instance drives the outlet but does not read session back
  // out of this write; SessionsView reads it fresh at its own remount.
  replaceState({ ...getCurrentUrlState(), view: "sessions", session: sessionId });
}

/** Jump to Chat with a specific companion session pre-selected. Reliable on
 * a fresh mount; best-effort if Chat is already keep-alive mounted (see
 * file header — no event hook is exposed to force an already-mounted
 * ChatView to re-read the active session). */
function navigateToChatSession(sessionId: string): void {
  writeStoredActiveSessionId(sessionId);
  runCommand("nav.chat");
}

function useRecentChatSessions(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.chatSessions,
    queryFn: () => gv.chat.sessions.list(),
    enabled,
    staleTime: 10_000,
  });
}

function useRecentOperatorSessions(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => gv.sessions.list(),
    enabled,
    staleTime: 10_000,
  });
}

export function QuickSwitcher() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    registerCommand({
      id: QUICK_SWITCHER_COMMAND_ID,
      title: "Quick Switcher",
      group: "system",
      keywords: ["switcher", "jump", "go to", "sessions", "chats", "views"],
      run: () => setOpen((o) => !o),
    });
    return () => unregisterCommand(QUICK_SWITCHER_COMMAND_ID);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const chatSessions = useRecentChatSessions(open);
  const operatorSessions = useRecentOperatorSessions(open);

  const close = useCallback(() => setOpen(false), []);

  const entries = useMemo<SwitcherEntry[]>(() => {
    const viewEntries: SwitcherEntry[] = ALL_VIEWS.map((def) => ({
      key: `view:${def.id}`,
      type: "view",
      title: def.title,
      subtitle: def.group,
      action: () => navigateToView(def.id),
    }));

    const chatEntries: SwitcherEntry[] = companionSessionsFromListResponse(chatSessions.data)
      .slice(0, 20)
      .map((session) => {
        const id = bestId(session);
        return {
          key: `chat:${id}`,
          type: "chat" as const,
          title: bestTitle(session, "Untitled chat"),
          subtitle: id,
          action: () => navigateToChatSession(id),
        };
      })
      .filter((entry) => entry.subtitle);

    const sessionEntries: SwitcherEntry[] = unionSessionsFromListResponse(operatorSessions.data)
      .slice(0, 20)
      .map((session) => ({
        key: `session:${session.id}`,
        type: "session" as const,
        title: session.title || session.id,
        subtitle: `${session.kind}${session.project && session.project !== "unknown" ? ` · ${session.project}` : ""}`,
        action: () => navigateToOperatorSession(session.id),
      }))
      .filter((entry) => entry.key !== "session:");

    return [...viewEntries, ...chatEntries, ...sessionEntries];
  }, [chatSessions.data, operatorSessions.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries
      .map((entry) => {
        const haystack = `${entry.title} ${entry.subtitle ?? ""}`.toLowerCase();
        if (haystack.startsWith(q)) return { entry, score: 0 };
        if (haystack.includes(q)) return { entry, score: 1 };
        if (fuzzyMatch(haystack, q)) return { entry, score: 2 };
        return null;
      })
      .filter((x): x is { entry: SwitcherEntry; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.entry);
  }, [entries, query]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIndex]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const activate = useCallback(
    (entry: SwitcherEntry | undefined) => {
      if (!entry) return;
      close();
      entry.action();
    },
    [close],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        activate(filtered[activeIndex]);
      }
    },
    [activate, activeIndex, filtered],
  );

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) close();
    },
    [close],
  );

  if (!open) return null;

  return (
    <div className="cmd-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        ref={containerRef}
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        onKeyDown={handleKeyDown}
      >
        <div className="cmd-search-row">
          <input
            ref={inputRef}
            className="cmd-input"
            type="text"
            placeholder="Jump to a view, chat, or session…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            aria-label="Quick switcher search"
            aria-autocomplete="list"
            aria-controls="quick-switcher-listbox"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="cmd-empty">No matches for "{query}"</div>
        ) : (
          <ul ref={listRef} id="quick-switcher-listbox" className="cmd-list" role="listbox" aria-label="Jump targets">
            {filtered.map((entry, index) => {
              const isActive = index === activeIndex;
              return (
                <div
                  key={entry.key}
                  className={isActive ? "cmd-item cmd-item--active" : "cmd-item"}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => activate(entry)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
                    <EntryIcon type={entry.type} />
                    <span className="cmd-item-title">
                      {entry.title}
                      {entry.subtitle && (
                        <span style={{ opacity: 0.65, fontWeight: "normal" }}> — {entry.subtitle}</span>
                      )}
                    </span>
                  </span>
                  <kbd className="cmd-item-kbd">{TYPE_LABEL[entry.type]}</kbd>
                </div>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const ICON_STYLE = { flex: "0 0 auto", opacity: 0.75 } as const;

function EntryIcon({ type }: { type: EntryType }) {
  if (type === "chat") return <MessageSquare size={14} aria-hidden="true" style={ICON_STYLE} />;
  if (type === "session") return <ListTodo size={14} aria-hidden="true" style={ICON_STYLE} />;
  return <Compass size={14} aria-hidden="true" style={ICON_STYLE} />;
}
