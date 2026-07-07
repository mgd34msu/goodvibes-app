// Generic centered dialog — the configuration surface ("modals are
// configuration, pages are observability"). Ported from goodvibes-webui
// src/components/modal/Modal.tsx. Unmounts entirely when closed so consumer
// queries never fire while hidden. Backdrop and panel are SIBLINGS —
// aria-hidden on the backdrop must never be an ancestor of the dialog.

import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { getFocusableElements } from "../lib/focus-trap.ts";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Trailing header content before the close button. */
  headerExtra?: ReactNode;
  size?: "md" | "lg";
}

export function Modal({ open, onClose, title, children, headerExtra, size = "md" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = document.activeElement;
    return () => {
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
      triggerRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const focusable = getFocusableElements(panelRef.current);
    (focusable[0] ?? panelRef.current).focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !panelRef.current) return undefined;
    const panel = panelRef.current;

    function handleTab(event: KeyboardEvent): void {
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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

    function handleFocusIn(event: FocusEvent): void {
      if (panel.contains(event.target as Node | null)) return;
      const focusable = getFocusableElements(panel);
      (focusable[0] ?? panel).focus();
    }

    window.addEventListener("keydown", handleTab);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      window.removeEventListener("keydown", handleTab);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [open]);

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div className="modal-root">
      <div className="modal-backdrop" aria-hidden="true" onClick={handleBackdropClick} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`modal-panel modal-panel--${size}`}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <div className="modal-header-actions">
            {headerExtra}
            <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
