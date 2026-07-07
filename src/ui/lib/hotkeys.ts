// Global hotkey listener — combos ("mod+k", "Escape") and two-key chords
// ("g c", 1 s window), guarded against firing while typing unless a binding
// opts in. Ported from goodvibes-webui src/hooks/useHotkeys.ts, plus
// useCommandHotkeys() which binds every command with an effective combo from
// the keybinding registry (lib/keybindings.ts) — the registry stays the
// single source of truth for what actually fires.

import { useEffect, useRef, useState } from "react";
import { getAllBindings, subscribeKeybindings, KEYBINDINGS_EVENT } from "./keybindings.ts";
import { runCommand, subscribeCommands } from "./commands.ts";

export type HotkeyHandler = (event: KeyboardEvent) => void;

export interface HotkeyBinding {
  /** Combo string, e.g. "mod+k", "Escape", "g c". */
  combo: string;
  handler: HotkeyHandler;
  /** Fire even while focus is in an input/textarea/contenteditable. */
  allowInInput?: boolean;
}

const SEQUENCE_TIMEOUT_MS = 1000;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  if (target.isContentEditable) return true;
  return false;
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent;
  return /mac/i.test(platform);
}

function normaliseToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === "mod") return isMac() ? "Meta" : "Control";
  if (lower === "ctrl") return "Control";
  if (lower === "cmd" || lower === "meta") return "Meta";
  if (lower === "alt") return "Alt";
  if (lower === "shift") return "Shift";
  if (token.length === 1) return token.toLowerCase();
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

export function normaliseCombo(combo: string): string {
  if (/\s/.test(combo)) {
    return combo
      .trim()
      .split(/\s+/)
      .map((token) =>
        token
          .split("+")
          .map((p) => p.trim())
          .filter(Boolean)
          .map(normaliseToken)
          .join("+"),
      )
      .join(" ");
  }
  return combo
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(normaliseToken)
    .join("+");
}

/** Canonical key string from an event, e.g. Ctrl+K → "Control+k". */
export function eventToCombo(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey) parts.push("Meta");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  // Shift is omitted for bare printable chars — the char already encodes it
  // (Shift+/ arrives as "?"). Kept for named keys and modified combos.
  const isBareShiftedChar =
    event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (event.shiftKey && !isBareShiftedChar) parts.push("Shift");
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  parts.push(key);
  return parts.join("+");
}

export function useHotkeys(bindings: HotkeyBinding[]): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const pendingSeqRef = useRef<{ key: string; ts: number } | null>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const currentBindings = bindingsRef.current;
      const inEditable = isEditableTarget(event.target);
      const currentCombo = eventToCombo(event);

      for (const binding of currentBindings) {
        const { combo, handler: bindingHandler, allowInInput = false } = binding;
        if (inEditable && !allowInInput) continue;

        const normCombo = normaliseCombo(combo);

        if (normCombo.includes(" ")) {
          const [firstKey, secondKey] = normCombo.split(" ");
          const pending = pendingSeqRef.current;

          if (
            pending?.key === firstKey &&
            Date.now() - (pending?.ts ?? Infinity) < SEQUENCE_TIMEOUT_MS &&
            currentCombo === secondKey
          ) {
            pendingSeqRef.current = null;
            event.preventDefault();
            bindingHandler(event);
            return;
          }

          // Arm the chord without preventDefault — the raw first key may
          // matter to other listeners.
          if (currentCombo === firstKey) {
            pendingSeqRef.current = { key: firstKey, ts: Date.now() };
            return;
          }
          continue;
        }

        if (currentCombo === normCombo) {
          pendingSeqRef.current = null;
          event.preventDefault();
          bindingHandler(event);
          return;
        }
      }

      // A non-chord-starting key clears any pending chord.
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key !== pendingSeqRef.current?.key) {
        const startsAChord = currentBindings.some((b) => {
          const norm = normaliseCombo(b.combo);
          return norm.includes(" ") && norm.split(" ")[0] === currentCombo;
        });
        if (!startsAChord) pendingSeqRef.current = null;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}

/**
 * Bind every registered command with an effective combo. Re-resolves on
 * command-registry AND keybinding-registry changes, so remaps apply live.
 */
export function useCommandHotkeys(extra?: HotkeyBinding[]): void {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const bump = () => setRevision((r) => r + 1);
    const unsubCommands = subscribeCommands(bump);
    const unsubBindings = subscribeKeybindings(bump);
    window.addEventListener(KEYBINDINGS_EVENT, bump);
    return () => {
      unsubCommands();
      unsubBindings();
      window.removeEventListener(KEYBINDINGS_EVENT, bump);
    };
  }, []);

  // revision invalidates the memo below via the render pass; getAllBindings is
  // cheap (localStorage read) so recompute per render is acceptable here.
  void revision;
  const bindings: HotkeyBinding[] = Object.entries(getAllBindings()).map(([commandId, combo]) => ({
    combo,
    // Palette toggle must work while its own input is focused.
    allowInInput: commandId === "system.palette",
    handler: () => {
      runCommand(commandId);
    },
  }));

  useHotkeys(extra ? [...bindings, ...extra] : bindings);
}
