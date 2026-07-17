// Devices & pairing — data layer for pairing.tokens.*, pairing.handoff.create,
// pairing.posture.get, and tailscale.* (contract 1.11 — none of these emit a
// realtime event; each section below fetches only while it actually needs
// freshness, never a background poll for its own sake, per docs/UX.md §4's
// poll-only-while-relevant rule).
//
// pairing.handoff.complete (the RECEIVING device's WebAuthn/push/relay
// ceremony) has no surface here on purpose: this desktop app is always the
// pairing INITIATOR, minting a link for some other device to scan — it never
// completes one itself. See DevicesPairingSection.tsx for the full rationale.

import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";

export const pairingKeys = {
  all: ["peers", "pairing-devices"] as const,
  tokens: ["peers", "pairing-devices", "tokens"] as const,
  posture: ["peers", "pairing-devices", "posture"] as const,
  tailscale: ["peers", "pairing-devices", "tailscale"] as const,
} as const;

function firstBoolean(value: unknown, keys: string[], fallback = false): boolean {
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "boolean") return item;
  }
  return fallback;
}

// ─── pairing.tokens.* ────────────────────────────────────────────────────────

export interface PairingTokenRow {
  id: string;
  name: string;
  createdAt: number | undefined;
  lastSeenAt: number | undefined;
}

export function readPairingTokens(data: unknown): { tokens: PairingTokenRow[]; legacySharedRevoked: boolean } {
  const record = asRecord(data);
  const tokens = firstArray(record, ["tokens"]).map((row) => {
    const r = asRecord(row);
    return {
      id: firstString(r, ["id"]),
      name: firstString(r, ["name"]) || "unnamed device",
      createdAt: firstNumber(r, ["createdAt"]),
      lastSeenAt: firstNumber(r, ["lastSeenAt"]),
    };
  });
  return { tokens, legacySharedRevoked: firstBoolean(record, ["legacySharedRevoked"]) };
}

// ─── pairing.handoff.create ──────────────────────────────────────────────────

export interface HandoffOffer {
  kind: string;
  available: boolean;
}

export interface HandoffResult {
  tokenName: string;
  deepLink: string;
  offers: HandoffOffer[];
}

/** deepLink is optional on the wire (older daemons may omit it, leaving only
 * `fragment`) — fall back to the fragment itself so the QR still has SOMETHING
 * scannable rather than rendering an empty code silently. */
export function readHandoffResult(data: unknown): HandoffResult {
  const record = asRecord(data);
  const token = asRecord(record["token"]);
  return {
    tokenName: firstString(token, ["name"]),
    deepLink: firstString(record, ["deepLink"]) || firstString(record, ["fragment"]),
    offers: firstArray(record, ["offers"]).map((row) => {
      const r = asRecord(row);
      return { kind: firstString(r, ["kind"]), available: firstBoolean(r, ["available"]) };
    }),
  };
}

// ─── pairing.posture.get ─────────────────────────────────────────────────────

export interface PairingPosture {
  origin: string;
  scheme: string;
  notice: string;
}

export function readPosture(data: unknown): PairingPosture {
  const posture = asRecord(asRecord(data)["posture"]);
  return {
    origin: firstString(posture, ["origin"]),
    scheme: firstString(posture, ["scheme"]),
    notice: firstString(posture, ["notice"]),
  };
}

// ─── tailscale.* ─────────────────────────────────────────────────────────────

export interface TailscaleServeReceipt {
  at: number | undefined;
  command: string;
  ok: boolean;
  url: string;
  detail: string;
}

export interface TailscaleStatus {
  available: boolean;
  loggedIn: boolean;
  magicDnsName: string;
  detail: string;
  lastServe: TailscaleServeReceipt | null;
}

function readServeReceipt(value: unknown): TailscaleServeReceipt | null {
  if (value === undefined || value === null) return null;
  const r = asRecord(value);
  return {
    at: firstNumber(r, ["at"]),
    command: firstString(r, ["command"]),
    ok: firstBoolean(r, ["ok"]),
    url: firstString(r, ["url"]),
    detail: firstString(r, ["detail"]),
  };
}

export function readTailscale(data: unknown): TailscaleStatus {
  const record = asRecord(data);
  return {
    available: firstBoolean(record, ["available"]),
    loggedIn: firstBoolean(record, ["loggedIn"]),
    magicDnsName: firstString(record, ["magicDnsName"]),
    detail: firstString(record, ["detail"]),
    lastServe: readServeReceipt(record["lastServe"]),
  };
}

export function readServeRunResult(data: unknown): { receipt: TailscaleServeReceipt | null } {
  return { receipt: readServeReceipt(asRecord(data)["receipt"]) };
}
