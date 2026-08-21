// Wire readers and display helpers for the conversation-rewind HOST registry
// (rewind.conversation.hosts.list, and the register / release / requests.take /
// requests.answer verbs that go with it).
//
// WHAT THE REGISTRY IS FOR. Files rewind works from anywhere, because the
// workspace checkpoint store is the daemon's. The conversation half is
// answerable only by the process actually running the loop. So a surface OFFERS
// the conversation it is holding, the daemon asks that surface when a rewind
// touches it, and this list is what makes "conversation rewind is unavailable
// for that session" checkable instead of something a person takes on trust.
//
// ── WHY THIS APP LISTS HOSTS AND DOES NOT BECOME ONE ────────────────────────
//
// This app has no conversation of its own. Every conversation it shows is held
// somewhere else: companion chat and daemon-hosted sessions live inside the
// daemon, and a tui session lives inside that terminal. There is no message
// store in this process, so there is nothing here to count and nothing here to
// drop.
//
// That makes registering worse than useless, and the difference is measurable.
// Against a scratch daemon on 2026-08-20, rewind.plan at conversation scope for
// a session with NO host answered in 4ms:
//
//   conversation: { available: false, messagesToDrop: 0, messagesRemaining: 0 }
//   warnings: ["conversation rewind unavailable: this daemon holds no live
//              conversation for that session, so it cannot count or drop its
//              messages"]
//
// After registering a host that then never answered, the identical call took
// 20001ms and reached the same unavailable answer, with the warning changed to
// name the surface that failed to reply. A registration this app cannot serve
// therefore buys nothing and costs twenty seconds on every rewind preview for
// that session; and because registering without a hostId CLAIMS the session and
// replaces whoever held it, doing so would also evict a tui that genuinely is
// holding those messages and answer its outstanding questions as unavailable.
//
// So the app reads this registry and never writes to it. If a future surface in
// this process does come to hold a conversation, the register/release/take/
// answer half is wired in lib/gv.ts and the SDK ships the polling loop
// (platform/runtime/client/conversation-rewind-host.ts) for the Bun side to
// drive; the missing piece is a message store, not plumbing.

import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

/** One surface's live claim on one session's conversation. */
export interface ConversationRewindHost {
  hostId: string;
  sessionId: string;
  /** How the surface names itself, in the refusals a person reads. */
  label: string;
  registeredAt: number;
  /** When the claim lapses unless the surface keeps taking its requests. */
  leaseExpiresAt: number;
}

// ---------------------------------------------------------------------------
// Wire readers
// ---------------------------------------------------------------------------

export function readConversationRewindHost(value: unknown): ConversationRewindHost | null {
  const record = asRecord(value);
  const hostId = firstString(record, ["hostId"]);
  const sessionId = firstString(record, ["sessionId"]);
  if (!hostId || !sessionId) return null;
  return {
    hostId,
    sessionId,
    label: firstString(record, ["label"]) || "an unnamed surface",
    registeredAt: firstNumber(record, ["registeredAt"]) ?? 0,
    leaseExpiresAt: firstNumber(record, ["leaseExpiresAt"]) ?? 0,
  };
}

/**
 * rewind.conversation.hosts.list, or null when the body carried no list.
 *
 * Null and "no hosts" are different answers and are rendered differently: no
 * hosts means every session's conversation is answered by the daemon's own
 * store or not at all, while a null means this app does not know, and guessing
 * the first from the second would turn "I could not ask" into a fact about the
 * world.
 */
export function readConversationRewindHosts(value: unknown): ConversationRewindHost[] | null {
  const record = asRecord(value);
  const hosts = Array.isArray(value) ? value : record["hosts"];
  if (!Array.isArray(hosts)) return null;
  return asArray(hosts)
    .map(readConversationRewindHost)
    .filter((host): host is ConversationRewindHost => host !== null);
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** The surface offering a session's conversation, or null when nobody is. */
export function hostForSession(
  hosts: readonly ConversationRewindHost[],
  sessionId: string,
): ConversationRewindHost | null {
  return hosts.find((host) => host.sessionId === sessionId) ?? null;
}

/**
 * Whether a lease has already lapsed at the moment of reading.
 *
 * A lapsed entry can still be in a list this app fetched a moment ago, and it is
 * shown as lapsed rather than filtered out: "a surface claimed this and stopped
 * polling" is a more useful thing to see than a row silently missing.
 */
export function leaseLapsed(host: ConversationRewindHost, nowMs = Date.now()): boolean {
  return host.leaseExpiresAt > 0 && host.leaseExpiresAt <= nowMs;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function formatLease(host: ConversationRewindHost, nowMs = Date.now()): string {
  if (host.leaseExpiresAt <= 0) return "no lease recorded";
  const remaining = host.leaseExpiresAt - nowMs;
  if (remaining <= 0) return "lease lapsed";
  const seconds = Math.round(remaining / 1000);
  if (seconds < 60) return `lease renews within ${seconds}s`;
  return `lease renews within ${Math.round(seconds / 60)} min`;
}

/**
 * What conversation rewind for one session will actually do, before it is run.
 *
 * Three different sentences, because they have three different fixes: a session
 * a live surface is holding will be asked and answered; a session whose host has
 * stopped polling will cost the daemon its answer timeout and come back
 * unavailable; and a session nobody has offered falls through to the daemon's
 * own store, which may well hold it.
 */
export function conversationRewindPosture(
  hosts: readonly ConversationRewindHost[] | null,
  sessionId: string,
  nowMs = Date.now(),
): { tone: "ok" | "info" | "warning"; text: string } {
  if (hosts === null) {
    return {
      tone: "info",
      text: "This daemon did not report which surfaces are offering their conversations, so whether a conversation rewind can be served here is not something this app can check.",
    };
  }
  const host = hostForSession(hosts, sessionId);
  if (!host) {
    return {
      tone: "info",
      text: "No surface is offering this session's conversation, so a conversation rewind falls through to the daemon's own store. If the daemon is not running this session either, the preview says so rather than reporting zero messages.",
    };
  }
  if (leaseLapsed(host, nowMs)) {
    return {
      tone: "warning",
      text: `${host.label} claimed this session's conversation and has stopped renewing its lease. A conversation rewind will wait for it and then report unavailable.`,
    };
  }
  return {
    tone: "ok",
    text: `${host.label} is holding this session's conversation and will be asked to count or drop the messages.`,
  };
}

/**
 * The one-line answer to "is this app a rewind host?".
 *
 * It is a fixed sentence rather than a computed one because the answer does not
 * depend on the daemon: this process has no message store, so it is never the
 * host of anything, whatever the registry says.
 */
export const APP_HOSTING_POSTURE =
  "This app does not offer any conversation for rewind. Every conversation it shows is held by the daemon or by another surface, so only that process can count or drop its messages.";
