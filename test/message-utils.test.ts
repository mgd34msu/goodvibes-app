// src/ui/views/chat/message-utils.ts, turn-state vocabulary coverage. Pure
// functions/data, no DOM, safe to import directly under bun:test. Guards the
// discriminated-union fix: turnState used to be inferred `string` (ChatView.tsx
// useState("idle")), so a typo'd literal like "stoping" compiled cleanly and
// silently dropped out of ACTIVE_TURN_STATES.includes() checks. TURN_STATES is
// now the single source of truth `TurnState` is derived from.

import { describe, expect, test } from "bun:test";
import { ACTIVE_TURN_STATES, TURN_STATES, type TurnState } from "../src/ui/views/chat/message-utils.ts";

// Every literal actually assigned via setTurnState across useChatSend.ts,
// useChatStream.ts, and ChatView.tsx (grepped for every call site).
const EXPECTED_STATES = [
  "idle",
  "sending",
  "sending while reconnecting",
  "submitted",
  "running",
  "streaming",
  "tooling",
  "syncing",
  "stopping",
  "stopped locally",
  "reconnecting",
  "completed",
  "cancelled",
  "error",
  "send failed",
  "auth expired",
].sort();

describe("TURN_STATES", () => {
  test("matches every literal turnState value assigned across the chat hooks, no more, no fewer", () => {
    expect([...(TURN_STATES as readonly string[])].sort()).toEqual(EXPECTED_STATES);
  });

  test("has no duplicate entries", () => {
    expect(new Set(TURN_STATES).size).toBe(TURN_STATES.length);
  });
});

describe("ACTIVE_TURN_STATES", () => {
  test("is a subset of TURN_STATES (every active state is a real turn state)", () => {
    const known = new Set<string>(TURN_STATES);
    for (const state of ACTIVE_TURN_STATES) expect(known.has(state)).toBe(true);
  });

  test("flags the states that drive the streaming indicator / Stop control / poll fallback", () => {
    for (const state of ["sending", "submitted", "running", "streaming", "tooling", "reconnecting", "sending while reconnecting", "stopping"] as const) {
      expect(ACTIVE_TURN_STATES.includes(state)).toBe(true);
    }
  });

  test("does not flag terminal or idle states as active", () => {
    for (const state of ["idle", "completed", "cancelled", "error", "send failed", "auth expired", "stopped locally", "syncing"] as const) {
      expect(ACTIVE_TURN_STATES.includes(state)).toBe(false);
    }
  });
});

describe("TurnState type", () => {
  test("rejects a misspelled literal at compile time (enforced by `bun run typecheck`, not this runtime assertion)", () => {
    function accepts(_state: TurnState): void {
      /* type-only check below */
    }
    // @ts-expect-error "stoping" is a typo, not a member of TURN_STATES, this
    // line must fail to typecheck. If TurnState is ever widened back to
    // `string` (the original bug), tsc reports an unused @ts-expect-error and
    // `bun run typecheck` fails.
    accepts("stoping");
    expect(true).toBe(true);
  });
});
