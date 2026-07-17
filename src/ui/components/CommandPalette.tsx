// Command palette (Ctrl+K) + shortcut cheatsheet. Ported from goodvibes-webui
// src/components/command/*. Shortcut hints are resolved live from the
// keybinding registry (lib/keybindings.ts) — never hardcoded strings.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  buildGroups,
  filterCommands,
  getCommands,
  subscribeCommands,
  GROUP_LABELS,
  type CommandDef,
} from "../lib/commands.ts";
import { displayShortcut, subscribeKeybindings } from "../lib/keybindings.ts";
import { useFocusTrap } from "../lib/focus-trap.ts";

function useRegisteredCommands(): CommandDef[] {
  const [allCommands, setAllCommands] = useState<CommandDef[]>(() => getCommands());
  useEffect(() => {
    const refresh = () => setAllCommands(getCommands());
    const unsubCommands = subscribeCommands(refresh);
    const unsubBindings = subscribeKeybindings(refresh);
    return () => {
      unsubCommands();
      unsubBindings();
    };
  }, []);
  return allCommands;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const allCommands = useRegisteredCommands();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filteredCommands = useMemo(() => filterCommands(allCommands, query), [allCommands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filteredCommands.length) {
      setActiveIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, activeIndex]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleOverlayKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const cmd = filteredCommands[activeIndex];
        if (cmd) {
          onClose();
          cmd.run();
        }
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        setActiveIndex((i) =>
          event.shiftKey ? Math.max(i - 1, 0) : Math.min(i + 1, filteredCommands.length - 1),
        );
      }
    },
    [activeIndex, filteredCommands, onClose],
  );

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const grouped = buildGroups(filteredCommands);

  return (
    <div className="cmd-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleOverlayKeyDown}
      >
        <div className="cmd-search-row">
          <input
            ref={inputRef}
            className="cmd-input"
            type="text"
            placeholder="Search commands…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-controls="cmd-listbox"
            aria-activedescendant={
              filteredCommands[activeIndex] ? `cmd-item-${filteredCommands[activeIndex].id}` : undefined
            }
          />
        </div>

        {filteredCommands.length === 0 ? (
          <div className="cmd-empty">No commands match "{query}"</div>
        ) : (
          <ul ref={listRef} id="cmd-listbox" className="cmd-list" role="listbox" aria-label="Commands">
            {grouped.map(({ group, commands }) => (
              <li key={group} className="cmd-group" role="group" aria-labelledby={`cmd-group-label-${group}`}>
                <div id={`cmd-group-label-${group}`} className="cmd-group-label">
                  {GROUP_LABELS[group] ?? group}
                </div>
                {commands.map((cmd) => {
                  const globalIndex = filteredCommands.indexOf(cmd);
                  const isActive = globalIndex === activeIndex;
                  const shortcut = displayShortcut(cmd.id);
                  return (
                    <div
                      key={cmd.id}
                      id={`cmd-item-${cmd.id}`}
                      className={isActive ? "cmd-item cmd-item--active" : "cmd-item"}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        onClose();
                        cmd.run();
                      }}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                    >
                      <span className="cmd-item-title">{cmd.title}</span>
                      {shortcut && <kbd className="cmd-item-kbd">{shortcut}</kbd>}
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ShortcutCheatsheetProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutCheatsheet({ open, onClose }: ShortcutCheatsheetProps) {
  const allCommands = useRegisteredCommands();
  // Tab-cycling focus trap (identical contract to Modal/PeekPanel) — without
  // it, a second Tab press from the lone close button escapes into the
  // sidebar/topbar behind this "modal" overlay.
  const overlayRef = useFocusTrap<HTMLDivElement>(open);

  const withShortcuts = useMemo(
    () => allCommands.filter((cmd) => Boolean(displayShortcut(cmd.id))),
    [allCommands],
  );
  const grouped = useMemo(() => buildGroups(withShortcuts), [withShortcuts]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div className="cheat-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        ref={overlayRef}
        className="cheat-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="cheat-header">
          <h2 className="cheat-title">Keyboard Shortcuts</h2>
          <button className="cheat-close" type="button" aria-label="Close shortcuts" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="cheat-body">
          {grouped.length === 0 ? (
            <p className="cheat-empty">No shortcuts registered.</p>
          ) : (
            grouped.map(({ group, commands }) => (
              <section key={group} className="cheat-group">
                <h3 className="cheat-group-label">{GROUP_LABELS[group] ?? group}</h3>
                <dl className="cheat-list">
                  {commands.map((cmd) => (
                    <div key={cmd.id} className="cheat-row">
                      <dt className="cheat-action">{cmd.title}</dt>
                      <dd className="cheat-keys">
                        <kbd>{displayShortcut(cmd.id)}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
