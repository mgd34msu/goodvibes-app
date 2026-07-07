// ARIA live announcer — a module-level store so ANY code (hooks, toast(),
// mutation callbacks) can announce without being under a provider, and one
// stable <AnnouncerRegion /> near the root renders the live regions.
// Ported from goodvibes-webui src/hooks/useAnnouncer.ts. Unlike the desktop
// prior art (useAnnounce with zero callers — autopsy), kit actions here DO
// call announce(): toast() announces every toast title (lib/toast.ts) and
// ConfirmSurface announces confirmation outcomes.

import { createElement, useCallback, useSyncExternalStore, type FC, type ReactElement } from "react";

export type AnnouncePoliteness = "polite" | "assertive";

interface AnnouncerState {
  polite: string;
  assertive: string;
}

let _state: AnnouncerState = { polite: "", assertive: "" };
let _politeTimer: ReturnType<typeof setTimeout> | null = null;
let _assertiveTimer: ReturnType<typeof setTimeout> | null = null;
const _listeners = new Set<() => void>();

function _notify(): void {
  _listeners.forEach((fn) => fn());
}

function _subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function _getSnapshot(): AnnouncerState {
  return _state;
}

/**
 * Announce a message to screen readers. Clear→set cycling makes the live
 * region see a DOM mutation even for repeated identical strings; pending
 * timers per channel are cleared so rapid calls cannot leak.
 */
export function announce(message: string, politeness: AnnouncePoliteness = "polite"): void {
  if (politeness === "assertive") {
    if (_assertiveTimer !== null) clearTimeout(_assertiveTimer);
    _state = { ..._state, assertive: "" };
    _notify();
    _assertiveTimer = setTimeout(() => {
      _assertiveTimer = null;
      _state = { ..._state, assertive: message };
      _notify();
    }, 50);
  } else {
    if (_politeTimer !== null) clearTimeout(_politeTimer);
    _state = { ..._state, polite: "" };
    _notify();
    _politeTimer = setTimeout(() => {
      _politeTimer = null;
      _state = { ..._state, polite: message };
      _notify();
    }, 50);
  }
}

/** Two sibling live regions (polite + assertive). Mount ONCE near the root.
 * Stable module-level identity — never unmounted between announcements. */
export const AnnouncerRegion: FC = function AnnouncerRegion(): ReactElement {
  const state = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
  return createElement(
    "div",
    { className: "sr-only" },
    createElement("div", { "aria-live": "polite", "aria-atomic": "true" }, state.polite),
    createElement("div", { "aria-live": "assertive", "aria-atomic": "true" }, state.assertive),
  );
};

/** Hook form for components — same store, stable callback identity. */
export function useAnnounce(): (message: string, politeness?: AnnouncePoliteness) => void {
  return useCallback((message: string, politeness: AnnouncePoliteness = "polite") => {
    announce(message, politeness);
  }, []);
}
