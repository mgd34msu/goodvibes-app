// Semantic bridge from this app's status vocabulary onto the SDK presentation
// contract's glyphs — the same glyph vocabulary the TUI/agent/webui render
// through. Ported from goodvibes-webui src/lib/presentation-bridge.ts. The
// mappings are RULINGS: a state with no honest contract analogue maps to the
// contract's own "not a fault" bucket (info), never force-fit to bad.

import { CONTRACT_GLYPHS, CONTRACT_STATE_GLYPHS, type ContractStatusState } from "./generated/presentation-tokens.ts";
import type { AuthState, ConnectionState, SseState, WorkingState } from "./daemon-health.ts";

export type { ContractStatusState };

/** The richer 16-key glyph vocabulary (GLYPHS.status). */
export type ContractGlyphKey = keyof typeof CONTRACT_GLYPHS.status;

export function contractGlyph(key: ContractGlyphKey): string {
  return CONTRACT_GLYPHS.status[key];
}

// ---------------------------------------------------------------------------
// StatusBadge tone ↔ contract severity bucket
// ---------------------------------------------------------------------------

export type BadgeTone = "ok" | "warning" | "bad" | "neutral";

const BADGE_TONE_TO_CONTRACT_STATE: Record<BadgeTone, ContractStatusState> = {
  ok: "good",
  warning: "warn",
  bad: "bad",
  // Neutral states (unconfigured, unavailable, idle, closed) are honestly
  // absent-health, not a severity.
  neutral: "info",
};

/** Classify an arbitrary status string into a BadgeTone. 'unconfigured' and
 * 'status unavailable' intentionally fall through to neutral — neither is a
 * fault. */
export function classifyBadgeTone(value: string): BadgeTone {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized.includes("denied") ||
    normalized.includes("expired")
  ) {
    return "bad";
  }
  if (
    normalized.includes("warn") ||
    normalized.includes("pending") ||
    normalized.includes("blocked") ||
    normalized.includes("expiring")
  ) {
    return "warning";
  }
  if (
    normalized.includes("healthy") ||
    normalized.includes("ok") ||
    normalized.includes("ready") ||
    normalized.includes("active")
  ) {
    return "ok";
  }
  return "neutral";
}

export function contractGlyphForBadgeTone(tone: BadgeTone): string {
  return CONTRACT_STATE_GLYPHS[BADGE_TONE_TO_CONTRACT_STATE[tone]];
}

export function contractStateForBadgeTone(tone: BadgeTone): ContractStatusState {
  return BADGE_TONE_TO_CONTRACT_STATE[tone];
}

// ---------------------------------------------------------------------------
// Daemon-health axes (StatusStrip) ↔ contract severity bucket
// ---------------------------------------------------------------------------

const CONNECTION_TO_CONTRACT_STATE: Record<ConnectionState, ContractStatusState> = {
  connected: "good",
  reconnecting: "warn",
  down: "bad",
};

export function contractGlyphForConnection(state: ConnectionState): string {
  return CONTRACT_STATE_GLYPHS[CONNECTION_TO_CONTRACT_STATE[state]];
}

export function contractStateForConnection(state: ConnectionState): ContractStatusState {
  return CONNECTION_TO_CONTRACT_STATE[state];
}

const AUTH_TO_CONTRACT_STATE: Record<AuthState, ContractStatusState> = {
  "signed-in": "good",
  // Signed-out is an absent-state, not a fault.
  "signed-out": "info",
  unknown: "info",
};

export function contractStateForAuth(state: AuthState): ContractStatusState {
  return AUTH_TO_CONTRACT_STATE[state];
}

export function contractGlyphForAuth(state: AuthState): string {
  return CONTRACT_STATE_GLYPHS[AUTH_TO_CONTRACT_STATE[state]];
}

const WORKING_TO_CONTRACT_STATE: Record<WorkingState, ContractStatusState> = {
  working: "good",
  // Reachable + signed-in but blocked (scope-less token) IS a genuine fault.
  blocked: "bad",
  unknown: "info",
};

export function contractStateForWorking(state: WorkingState): ContractStatusState {
  return WORKING_TO_CONTRACT_STATE[state];
}

export function contractGlyphForWorking(state: WorkingState): string {
  return CONTRACT_STATE_GLYPHS[WORKING_TO_CONTRACT_STATE[state]];
}

const SSE_TO_CONTRACT_STATE: Record<SseState, ContractStatusState> = {
  active: "good",
  connecting: "info",
  error: "bad",
  // Deliberately-off is not a fault.
  disabled: "info",
};

export function contractStateForSse(state: SseState): ContractStatusState {
  return SSE_TO_CONTRACT_STATE[state];
}

export function contractGlyphForSse(state: SseState): string {
  return CONTRACT_STATE_GLYPHS[SSE_TO_CONTRACT_STATE[state]];
}
