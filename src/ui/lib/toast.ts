// Toast store — ported from goodvibes-webui src/lib/toast.ts with the
// docs/UX.md §4 rules applied: max 3 visible, older toasts overflow into a
// drawer that is actually fed (autopsy Theme 3 — the "+N more" counter opens
// a real notification list, nothing is silently dropped). Every toast() call
// also announces to the ARIA live region (lib/announcer.ts).

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
} from "react";
import { announce } from "./announcer.ts";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: ToastAction;
  /** 0 = persistent. */
  durationMs?: number;
}

export interface ToastEntry extends ToastOptions {
  id: string;
  durationMs: number;
  tone: ToastTone;
  createdAt: number;
}

const DEFAULT_DURATION_MS = 5000;
/** Max toasts painted as floating cards; the rest wait in the drawer. */
export const MAX_VISIBLE_TOASTS = 3;
/** Exit animation duration — matches --motion-base in tokens.css. */
export const TOAST_EXIT_DURATION_MS = 180;

interface ToastState {
  /** All live toasts, oldest first. Visible = last MAX_VISIBLE_TOASTS. */
  toasts: ToastEntry[];
  /** Ids playing their exit animation — still mounted, present=false. */
  leavingIds: ReadonlySet<string>;
  drawerOpen: boolean;
}

type ToastDispatch =
  | { type: "ADD"; toast: ToastEntry }
  | { type: "DISMISS"; id: string }
  | { type: "PURGE"; id: string }
  | { type: "SET_DRAWER"; open: boolean };

export function toastReducer(state: ToastState, action: ToastDispatch): ToastState {
  switch (action.type) {
    case "ADD":
      return { ...state, toasts: [...state.toasts, action.toast] };
    case "DISMISS": {
      const next = new Set(state.leavingIds);
      next.add(action.id);
      return { ...state, leavingIds: next };
    }
    case "PURGE": {
      const next = new Set(state.leavingIds);
      next.delete(action.id);
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id), leavingIds: next };
    }
    case "SET_DRAWER":
      return { ...state, drawerOpen: action.open };
    default:
      return state;
  }
}

/** Split live toasts into the floating stack vs the overflow drawer feed. */
export function splitVisible(toasts: ToastEntry[]): { visible: ToastEntry[]; overflow: ToastEntry[] } {
  if (toasts.length <= MAX_VISIBLE_TOASTS) return { visible: toasts, overflow: [] };
  return {
    visible: toasts.slice(toasts.length - MAX_VISIBLE_TOASTS),
    overflow: toasts.slice(0, toasts.length - MAX_VISIBLE_TOASTS),
  };
}

interface ToastContextValue {
  toasts: ToastEntry[];
  leavingIds: ReadonlySet<string>;
  drawerOpen: boolean;
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  setDrawerOpen: (open: boolean) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `toast-${Date.now()}-${_idCounter}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, {
    toasts: [],
    leavingIds: new Set<string>(),
    drawerOpen: false,
  });

  const toast = useCallback((options: ToastOptions): string => {
    const id = nextId();
    const entry: ToastEntry = {
      ...options,
      id,
      tone: options.tone ?? "info",
      durationMs: options.durationMs ?? DEFAULT_DURATION_MS,
      createdAt: Date.now(),
    };
    dispatch({ type: "ADD", toast: entry });
    announce(
      entry.description ? `${entry.title}. ${entry.description}` : entry.title,
      entry.tone === "danger" || entry.tone === "warning" ? "assertive" : "polite",
    );
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "DISMISS", id });
    const reducedMotion =
      typeof window !== "undefined" &&
      (window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.getAttribute("data-motion") === "reduced");
    const delay = reducedMotion ? 0 : TOAST_EXIT_DURATION_MS;
    setTimeout(() => dispatch({ type: "PURGE", id }), delay);
  }, []);

  const dismissAll = useCallback(() => {
    const ids = state.toasts.map((t) => t.id);
    ids.forEach((id) => dismiss(id));
  }, [state.toasts, dismiss]);

  const setDrawerOpen = useCallback((open: boolean) => {
    dispatch({ type: "SET_DRAWER", open });
  }, []);

  return createElement(
    ToastContext.Provider,
    {
      value: {
        toasts: state.toasts,
        leavingIds: state.leavingIds,
        drawerOpen: state.drawerOpen,
        toast,
        dismiss,
        dismissAll,
        setDrawerOpen,
      },
    },
    children,
  );
}

export function useToast(): Pick<ToastContextValue, "toast" | "dismiss" | "dismissAll"> {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return { toast: ctx.toast, dismiss: ctx.dismiss, dismissAll: ctx.dismissAll };
}

/** Null outside a provider — for leaf components rendered in isolation. */
export function useOptionalToast(): Pick<ToastContextValue, "toast"> | null {
  const ctx = useContext(ToastContext);
  return ctx ? { toast: ctx.toast } : null;
}

/** Full context — ToastViewport/drawer internals only. */
export function useToastContext(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToastContext must be used within a ToastProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Auto-dismiss with hover + focus pause channels (keyboard users can reach
// the action button without the toast vanishing under them).
// ---------------------------------------------------------------------------

interface UseAutoDismissOptions {
  id: string;
  durationMs: number;
  onDismiss: (id: string) => void;
}

export function useAutoDismiss({ id, durationMs, onDismiss }: UseAutoDismissOptions) {
  const remainingRef = useRef(durationMs);
  const startRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPausedRef = useRef(false);
  const focusPausedRef = useRef(false);

  const pauseCount = () => (hoverPausedRef.current ? 1 : 0) + (focusPausedRef.current ? 1 : 0);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = useCallback(() => {
    if (durationMs <= 0 || pauseCount() > 0) return;
    clearTimer();
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => onDismiss(id), remainingRef.current);
  }, [id, durationMs, onDismiss]);

  useEffect(() => {
    if (durationMs > 0) start();
    return () => clearTimer();
    // start only on mount — pause/resume own the timer afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pauseSource = useCallback(
    (source: "hover" | "focus") => {
      if (durationMs <= 0) return;
      const wasAlreadyPaused = pauseCount() > 0;
      if (source === "hover") hoverPausedRef.current = true;
      else focusPausedRef.current = true;
      if (!wasAlreadyPaused) {
        const elapsed = Date.now() - startRef.current;
        remainingRef.current = Math.max(0, remainingRef.current - elapsed);
        clearTimer();
      }
    },
    [durationMs],
  );

  const resumeSource = useCallback(
    (source: "hover" | "focus") => {
      if (durationMs <= 0) return;
      if (source === "hover") hoverPausedRef.current = false;
      else focusPausedRef.current = false;
      if (pauseCount() === 0) start();
    },
    [durationMs, start],
  );

  const handleMouseEnter = useCallback(() => pauseSource("hover"), [pauseSource]);
  const handleMouseLeave = useCallback(() => resumeSource("hover"), [resumeSource]);
  const handleFocus = useCallback(() => pauseSource("focus"), [pauseSource]);
  const handleBlur = useCallback(
    (e: ReactFocusEvent) => {
      if (durationMs <= 0) return;
      if (e.currentTarget.contains(e.relatedTarget)) return;
      resumeSource("focus");
    },
    [durationMs, resumeSource],
  );

  return { handleMouseEnter, handleMouseLeave, handleFocus, handleBlur };
}
