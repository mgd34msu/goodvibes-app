// Per-session steer/follow-up composer draft — mirrors the chat composer's
// draft persistence (views/chat/chat-local.ts's readDraft/writeDraft): an
// unsent steer/follow-up must survive a Sessions view switch (SessionsView
// is NOT keep-alive — it fully unmounts, see registry.tsx) and must never
// leak into a different session's box when the same SteerComposer instance
// is reused across a session pick in the master/detail list (SteerComposer
// isn't remounted on selection change — no `key` on it — so its local state
// otherwise carries over verbatim). Friction checklist item 1.

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const DRAFTS_KEY = "goodvibes.app.sessions.steerDrafts";
const MAX_DRAFTS = 50;

function readDraftMap(): Record<string, string> {
  try {
    const raw = storage()?.getItem(DRAFTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function readSteerDraft(sessionId: string): string {
  return sessionId ? readDraftMap()[sessionId] ?? "" : "";
}

/** Save (or, for empty text, clear) the steer/follow-up draft for a session.
 * Bounded to MAX_DRAFTS entries (checklist item 14) — the oldest-touched
 * entry is evicted first once the cap is exceeded. */
export function writeSteerDraft(sessionId: string, text: string): void {
  if (!sessionId) return;
  const map = readDraftMap();
  delete map[sessionId]; // drop-then-reinsert so this key counts as most-recently-touched
  if (text) map[sessionId] = text;
  const bounded = Object.fromEntries(Object.entries(map).slice(-MAX_DRAFTS));
  try {
    storage()?.setItem(DRAFTS_KEY, JSON.stringify(bounded));
  } catch {
    // Best-effort local store.
  }
}
