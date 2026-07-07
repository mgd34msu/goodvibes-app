// Focus trap for overlays (Modal, PeekPanel, palette). Ported from
// goodvibes-webui src/hooks/useFocusTrap.ts: Tab cycling inside the container
// plus a document-level focusin recovery guard, focus restored on deactivate.

import type React from "react";
import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  "details > summary",
].join(",");

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.closest("[inert]") && !el.closest('[aria-hidden="true"]') && el.offsetParent !== null,
  );
}

export function useFocusTrap<T extends HTMLElement = HTMLElement>(active: boolean): React.RefObject<T | null> {
  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const trapContainer: T = container;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const focusable = getFocusableElements(container);
    (focusable[0] ?? container).focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Tab") return;
      const focusableNow = getFocusableElements(trapContainer);
      if (focusableNow.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusableNow[0];
      const last = focusableNow[focusableNow.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    // Recovery guard: programmatic focus escapes get pulled back.
    function handleFocusIn(event: FocusEvent): void {
      if (trapContainer.contains(event.target as Node | null)) return;
      const focusableNow = getFocusableElements(trapContainer);
      (focusableNow[0] ?? trapContainer).focus();
    }

    container.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn, true);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn, true);
      previousFocusRef.current?.focus();
    };
  }, [active]);

  return containerRef;
}
