// Right-side slide-over peek panel (look-something-up surface; Modal is the
// configuration surface). Ported from goodvibes-webui
// src/components/peek/PeekPanel.tsx: PeekProvider + usePeek() + focus trap,
// Escape / backdrop close, focus restore, reduced-motion via CSS.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getFocusableElements } from "../lib/focus-trap.ts";

export interface PeekContent {
  title: string;
  content: ReactNode;
}

interface PeekContextValue {
  open: (payload: PeekContent) => void;
  close: () => void;
  isOpen: boolean;
}

const PeekContext = createContext<PeekContextValue | null>(null);

export function usePeek(): PeekContextValue {
  const ctx = useContext(PeekContext);
  if (!ctx) throw new Error("usePeek must be used within a PeekProvider");
  return ctx;
}

interface PeekPanelProps {
  payload: PeekContent | null;
  isOpen: boolean;
  onClose: () => void;
}

function PeekPanelInner({ payload, isOpen, onClose }: PeekPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (isOpen) triggerRef.current = document.activeElement;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !panelRef.current) return;
    const focusable = getFocusableElements(panelRef.current);
    (focusable[0] ?? panelRef.current).focus();
  }, [isOpen, payload]);

  useEffect(() => {
    if (!isOpen && triggerRef.current instanceof HTMLElement) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !panelRef.current) return undefined;
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
  }, [isOpen]);

  return (
    <>
      <div
        className={`peek-backdrop${isOpen ? " peek-backdrop--open" : ""}`}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={payload?.title ?? "Details"}
        tabIndex={-1}
        className={`peek-panel${isOpen ? " peek-panel--open" : ""}`}
      >
        <div className="peek-header">
          <h2 className="peek-title" title={payload?.title}>
            {payload?.title}
          </h2>
          <button type="button" className="peek-close" aria-label="Close panel" onClick={onClose}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="peek-body">{payload?.content}</div>
      </div>
    </>
  );
}

/** Keep the payload mounted through the exit slide (matches --motion-base + buffer). */
const PEEK_EXIT_DELAY_MS = 320;

export function PeekProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<PeekContent | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback((next: PeekContent): void => {
    setPayload(next);
    setIsOpen(true);
  }, []);

  const close = useCallback((): void => {
    setIsOpen(false);
    setTimeout(() => setPayload(null), PEEK_EXIT_DELAY_MS);
  }, []);

  const value: PeekContextValue = { open, close, isOpen };

  return (
    <PeekContext.Provider value={value}>
      {children}
      <PeekPanelInner payload={payload} isOpen={isOpen} onClose={close} />
    </PeekContext.Provider>
  );
}

export { PeekPanelInner as PeekPanel };
