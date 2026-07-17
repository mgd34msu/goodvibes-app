// Turn-anchor derivation for the Rewind section — ported from
// goodvibes-webui src/lib/rewind.ts. Anchors come from a session's OWN
// already-loaded message list (the same sessions.messages.list SessionDetail
// already fetches for the transcript), so rewind targets a real turn
// boundary the operator can recognize rather than an opaque id, and this
// view never opens a second query just to populate the picker.
//
// Pure, no network.

import { firstString } from "../../lib/wire.ts";

export interface TurnAnchor {
  readonly turnId: string;
  /** A short, human label for the turn — the first non-empty message body in it. */
  readonly label: string;
}

const MAX_LABEL = 80;

function truncate(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_LABEL ? `${clean.slice(0, MAX_LABEL - 1)}…` : clean;
}

/**
 * Distinct turn anchors from a session's raw message records, NEWEST FIRST
 * (the most recent turn an operator would rewind to leads the list), capped
 * to `limit`. A message with no turnId is skipped (it cannot anchor a
 * rewind); a turn's label is the first non-empty message body seen for it.
 * Reversing to newest-first assumes the daemon returns messages oldest-first
 * (the shape sessions.messages.list uses).
 */
export function turnAnchorsFromMessages(rawItems: readonly unknown[], limit = 12): TurnAnchor[] {
  const seen = new Map<string, string>();
  for (const item of rawItems) {
    const turnId = firstString(item, ["turnId", "turn_id"]);
    if (!turnId) continue;
    const body = firstString(item, ["body", "content", "text", "message"]);
    if (!seen.has(turnId)) {
      seen.set(turnId, body ? truncate(body) : "");
    } else if (!seen.get(turnId) && body) {
      seen.set(turnId, truncate(body));
    }
  }
  const anchors = Array.from(seen, ([turnId, label]) => ({ turnId, label }));
  anchors.reverse();
  return anchors.slice(0, limit);
}
