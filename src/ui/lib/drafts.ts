// Durable form drafts — owner friction rule #1: a draft survives view
// switches, window close, and app restart. useDraftState is a drop-in
// useState replacement for form fields whose views are keepAlive:false
// (top-level view switches unmount them).
//
// Storage: localStorage under "gv-draft:<key>". Only non-empty values are
// stored (an empty/default draft removes the entry), and every write also
// stamps "gv-draft-index" so stale drafts can be pruned; entries older than
// DRAFT_TTL_MS are dropped at module load — bounded growth (friction rule
// #14), no draft graveyard.
//
// Commit/discard: call clearDraft(key) on successful submit AND on an
// explicit user discard — a draft outliving its submit is a lie about
// pending work. A cancel that keeps the draft is the default (rule #2:
// decline is feedback, not destruction).

import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "gv-draft:";
const INDEX_KEY = "gv-draft-index";
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

type DraftIndex = Record<string, number>;

function readIndex(): DraftIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as DraftIndex) : {};
  } catch {
    return {};
  }
}

function writeIndex(index: DraftIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Storage full/denied — drafts degrade to in-memory only; never throw.
  }
}

/** Drop expired drafts once per app load. */
function pruneExpired(): void {
  const index = readIndex();
  const now = Date.now();
  let changed = false;
  for (const [key, stamp] of Object.entries(index)) {
    if (typeof stamp !== "number" || now - stamp > DRAFT_TTL_MS) {
      try {
        localStorage.removeItem(PREFIX + key);
      } catch {
        // ignore
      }
      delete index[key];
      changed = true;
    }
  }
  if (changed) writeIndex(index);
}
let pruned = false;

export function readDraft(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: string): void {
  try {
    if (value === "") {
      clearDraft(key);
      return;
    }
    localStorage.setItem(PREFIX + key, value);
    const index = readIndex();
    index[key] = Date.now();
    writeIndex(index);
  } catch {
    // Storage full/denied — degrade silently to in-memory.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
    const index = readIndex();
    if (key in index) {
      delete index[key];
      writeIndex(index);
    }
  } catch {
    // ignore
  }
}

/**
 * useState for a string form field, persisted as a draft under `key`.
 * Initial value: the stored draft if one exists, else `initial`.
 * Writes are debounced (400ms) so keystrokes don't hammer storage.
 * Call the returned `clear` on successful submit or explicit discard.
 *
 * `key` must be stable and unique per logical form field, e.g.
 * "automation.hooks-json" or `channels.policy.${policyId}`.
 */
export function useDraftState(
  key: string,
  initial: string,
): [string, (next: string) => void, { clear: () => void; hadDraft: boolean }] {
  if (!pruned) {
    pruned = true;
    pruneExpired();
  }
  const stored = readDraft(key);
  const hadDraft = useRef(stored !== null && stored !== initial).current;
  const [value, setValue] = useState<string>(stored ?? initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);

  const set = useCallback(
    (next: string) => {
      latest.current = next;
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => writeDraft(key, latest.current), 400);
    },
    [key],
  );

  // Flush the pending debounce on unmount so a fast view-switch never loses
  // the last keystrokes — the whole point of the hook.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        writeDraft(key, latest.current);
      }
    };
  }, [key]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    latest.current = "";
    clearDraft(key);
  }, [key]);

  return [value, set, { clear, hadDraft }];
}
