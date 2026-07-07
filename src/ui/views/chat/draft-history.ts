// Composer draft undo/redo (docs/GAPS.md §1 row 29): a bounded (50-entry)
// history of composer draft *checkpoints* — NOT a reimplementation of
// character-level native textarea undo (the browser already gives every
// <textarea> that for free via Ctrl+Z while it's focused, and fighting the
// native stack with a controlled-value React textarea is a known source of
// cursor-jump bugs). This hook instead tracks the draft's lifecycle at the
// granularity ChatView already cares about: checkpoint() is called right
// before a send/clear/slash-replace overwrites the draft, and on a 2s-idle
// timer while the user is typing, so "undo" can always recover the text that
// was in the box before the app itself changed or discarded it — the one
// case native undo cannot help with, since the app's own setDraft() calls
// don't go through the textarea's edit history at all.
//
// Classic past/future stacks, `present` tracked externally (ChatView owns
// the draft state) so this hook stays a pure add-on with no state
// duplication risk.

import { useCallback, useEffect, useReducer, useRef } from "react";

const MAX_HISTORY = 50;
const IDLE_SNAPSHOT_MS = 2000;

export interface DraftHistory {
  /** Record `value` as a restorable checkpoint (no-op if unchanged since the
   * last checkpoint). Call this immediately before send/clear/slash-replace
   * overwrite the draft. */
  checkpoint: (value: string) => void;
  /** Returns the value to restore, or null when there is nothing to undo. */
  undo: (present: string) => string | null;
  /** Returns the value to restore, or null when there is nothing to redo. */
  redo: (present: string) => string | null;
  canUndo: boolean;
  canRedo: boolean;
}

export function useDraftHistory(present: string): DraftHistory {
  const pastRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const lastCheckpointRef = useRef(present);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const checkpoint = useCallback((value: string) => {
    if (value === lastCheckpointRef.current) return;
    pastRef.current = [...pastRef.current, lastCheckpointRef.current].slice(-MAX_HISTORY);
    futureRef.current = [];
    lastCheckpointRef.current = value;
    bump();
  }, []);

  // 2s-idle snapshot: while the user keeps typing without triggering an
  // explicit checkpoint, capture the in-progress text so undo has something
  // recent to fall back to (not just "back to the last send/clear").
  useEffect(() => {
    if (present === lastCheckpointRef.current) return undefined;
    const timer = window.setTimeout(() => checkpoint(present), IDLE_SNAPSHOT_MS);
    return () => window.clearTimeout(timer);
  }, [present, checkpoint]);

  const undo = useCallback((current: string): string | null => {
    const past = pastRef.current;
    if (past.length === 0) return null;
    const previous = past[past.length - 1] as string;
    pastRef.current = past.slice(0, -1);
    futureRef.current = [current, ...futureRef.current].slice(0, MAX_HISTORY);
    lastCheckpointRef.current = previous;
    bump();
    return previous;
  }, []);

  const redo = useCallback((current: string): string | null => {
    const future = futureRef.current;
    if (future.length === 0) return null;
    const next = future[0] as string;
    futureRef.current = future.slice(1);
    pastRef.current = [...pastRef.current, current].slice(-MAX_HISTORY);
    lastCheckpointRef.current = next;
    bump();
    return next;
  }, []);

  return {
    checkpoint,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}
