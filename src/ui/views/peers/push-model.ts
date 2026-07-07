// Web-push subscriptions for PWA companions (docs/FEATURES.md §21 row 6,
// docs/GAPS.md top-10 gap #5). Five ws-only methods with zero prior UI:
// push.vapid.get, push.subscriptions.list/.verify/.delete (push.subscriptions
// .create is the PWA's own registration call, not an operator action — the
// app itself uses native desktop notifications per the FEATURES note, so no
// "add subscription" affordance belongs here).
//
// Wire shapes verified against the generated operator contract
// (operator-contract.json, methods push.*) — every field below is read
// straight off that schema, parsed defensively per the wire.ts convention
// (additionalProperties may still grow on daemon builds).

import { asRecord, firstNumber, firstString } from "../../lib/wire.ts";

export interface PushSubscription {
  id: string;
  principalId: string;
  endpointOrigin: string;
  endpointHash: string;
  createdAt?: number;
  lastDeliveryAt?: number;
  lastOutcome: string;
  raw: unknown;
}

export function normalizePushSubscription(value: unknown): PushSubscription {
  const r = asRecord(value);
  return {
    id: firstString(r, ["id"]),
    principalId: firstString(r, ["principalId"]),
    endpointOrigin: firstString(r, ["endpointOrigin"]),
    endpointHash: firstString(r, ["endpointHash"]),
    createdAt: firstNumber(r, ["createdAt"]),
    lastDeliveryAt: firstNumber(r, ["lastDeliveryAt"]),
    lastOutcome: firstString(r, ["lastOutcome"]),
    raw: value,
  };
}

export function pushSubscriptionsFromResponse(value: unknown): PushSubscription[] {
  const r = asRecord(value);
  const list = r["subscriptions"];
  return Array.isArray(list) ? list.map(normalizePushSubscription) : [];
}

export interface PushVerifyReceipt {
  subscriptionId: string;
  endpointOrigin: string;
  outcome: string;
  httpStatus?: number;
  detail: string;
}

export function normalizeVerifyReceipt(value: unknown): PushVerifyReceipt {
  const outer = asRecord(value);
  const r = asRecord(outer["receipt"] ?? outer);
  return {
    subscriptionId: firstString(r, ["subscriptionId"]),
    endpointOrigin: firstString(r, ["endpointOrigin"]),
    outcome: firstString(r, ["outcome"]) || "unknown",
    httpStatus: firstNumber(r, ["httpStatus"]),
    detail: firstString(r, ["detail"]),
  };
}

export function vapidPublicKeyFromResponse(value: unknown): string {
  return firstString(asRecord(value), ["publicKey"]);
}

/** Delivery outcomes that mean "this endpoint is dead" per web-push convention. */
export function isDeadOutcome(outcome: string): boolean {
  return outcome === "gone" || outcome === "expired" || outcome === "unsubscribed" || outcome === "invalid";
}
