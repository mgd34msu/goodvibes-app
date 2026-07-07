// App-local "last seen" timestamp store backing the Home view's "While you
// were away" digest (docs/FEATURES.md §8 row: lastSeen store app-local).
// localStorage-backed so it survives restarts; a tiny subscriber list lets
// the palette "Mark caught up" command update the mounted digest.

const LAST_SEEN_KEY = "goodvibes.app.home.lastSeen";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Epoch ms of the last acknowledged visit; null on first ever visit. */
export function readLastSeen(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    // localStorage unavailable (private mode etc.) — behave like first visit.
    return null;
  }
}

export function writeLastSeen(epochMs: number): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, String(epochMs));
  } catch {
    // Non-fatal: the digest just re-shows the same window next launch.
  }
  listeners.forEach((fn) => fn());
}

export function subscribeLastSeen(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
