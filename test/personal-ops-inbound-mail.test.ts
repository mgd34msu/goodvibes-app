// Pure-logic coverage for the inbound-mail half of the Personal Ops mail
// surface (src/ui/views/personal-ops/personal-ops-data.ts): the
// email.inbound.status and email.expectation.list readers, the chip label/tone
// derivation, the remaining-window formatter, and the refusal triage that has
// to tell "no mailbox is being watched" (501 NOT_INVOKABLE) apart from "this
// daemon build has no inbound-mail verbs" (404).
//
// Every payload below is a VERBATIM capture from a locally spawned daemon
// (@pellux/goodvibes-daemon 1.28.19 / sdk 2.0.17) driven over the generic
// gateway route, not a hand-written guess at the shape.

import { describe, expect, test } from "bun:test";
import { HttpError } from "../src/ui/lib/http.ts";
import {
  formatRemaining,
  inboundMailRefusal,
  inboundStatusLabel,
  inboundStatusTone,
  parseExpectationTotal,
  parseExpectations,
  parseInboundStatus,
} from "../src/ui/views/personal-ops/personal-ops-data.ts";

// Captured live from email.inbound.status with
// surfaces.email.inbound.accounts = ["probe@example.test"] and no source started.
const LIVE_STATUS = {
  enabled: false,
  running: false,
  mode: "inactive",
  reason: "not started",
  account: "probe@example.test",
  mailbox: "INBOX",
  source: { basis: "not-started", detail: "not started", latency: "" },
  cursors: [],
  expectations: [],
  stores: [
    { store: "cursors", state: "ok", detail: "" },
    { store: "records", state: "ok", detail: "" },
    { store: "expectations", state: "ok", detail: "" },
  ],
  noticeDelivery: { state: "ok" },
  health: {
    kind: "email-inbound",
    id: "email-inbound:probe@example.test:INBOX",
    label: "Email (inbound) — probe@example.test",
    state: "disabled",
    enabled: false,
    account: "probe@example.test",
    mailbox: "INBOX",
    mode: "inactive",
    reason: "not started",
  },
  retention: {
    cursors: { kept: 0, maxCursors: 256 },
    records: { kept: 0, stored: 0, retentionDays: 30, maxRecords: 5000, maxBodyExcerptChars: 20000, reapedOnWrite: 0 },
    expectations: { open: 0, maxOpen: 32 },
  },
};

// Captured live from email.expectation.list with one open expectation.
const LIVE_EXPECTATIONS = {
  expectations: [
    {
      id: "5c947bf8-11bb-4019-b230-d8caac9a2fc0",
      serviceDomain: "example.test",
      recipientAddress: "probe@example.test",
      purpose: "verification probe",
      openedAt: "2026-08-21T00:12:09.359Z",
      expiresAt: "2026-08-21T00:27:09.359Z",
      kind: "signup",
      authority: "evidence-only",
      remainingMs: 899997,
    },
  ],
  total: 1,
};

function gatewayError(status: number, code: string, message: string): HttpError {
  return new HttpError(status, "ws:probe", JSON.stringify({ error: message, code, status }));
}

describe("parseInboundStatus", () => {
  test("reads the live disclosure payload field for field", () => {
    const status = parseInboundStatus(LIVE_STATUS);
    expect(status.enabled).toBe(false);
    expect(status.running).toBe(false);
    expect(status.mode).toBe("inactive");
    expect(status.reason).toBe("not started");
    expect(status.account).toBe("probe@example.test");
    expect(status.mailbox).toBe("INBOX");
    expect(status.sourceBasis).toBe("not-started");
    expect(status.cursorCount).toBe(0);
    expect(status.expectationsOpen).toBe(0);
    expect(status.expectationsMaxOpen).toBe(32);
    expect(status.noticeState).toBe("ok");
    expect(status.stores.map((s) => s.store)).toEqual(["cursors", "records", "expectations"]);
  });

  test("leaves an absent capability verdict absent rather than inventing a state", () => {
    // The daemon omits `capability` before the first probe; rendering "state:
    // null" as though it were a state is exactly what the wire shape avoids.
    expect(parseInboundStatus(LIVE_STATUS).capabilityState).toBe("");
  });

  test("carries the source latency sentence verbatim", () => {
    const status = parseInboundStatus({
      ...LIVE_STATUS,
      source: { basis: "poll", detail: "IMAP poll", latency: "up to 2 minutes behind" },
    });
    expect(status.sourceLatency).toBe("up to 2 minutes behind");
  });

  test("survives an empty payload without throwing", () => {
    const status = parseInboundStatus({});
    expect(status.mode).toBe("unknown");
    expect(status.expectations).toEqual([]);
    expect(status.stores).toEqual([]);
  });

  test("reads the expectations the status embeds", () => {
    const status = parseInboundStatus({ ...LIVE_STATUS, expectations: LIVE_EXPECTATIONS.expectations });
    expect(status.expectations).toHaveLength(1);
    expect(status.expectations[0]?.recipientAddress).toBe("probe@example.test");
  });
});

describe("inboundStatusLabel / inboundStatusTone", () => {
  test("a stopped watcher reads as its mode, not as an error", () => {
    const status = parseInboundStatus(LIVE_STATUS);
    expect(inboundStatusLabel(status)).toBe("Inbound: inactive");
    expect(inboundStatusTone(status)).toBe("warning");
  });

  test("enabled but not running says so explicitly", () => {
    const status = parseInboundStatus({ ...LIVE_STATUS, enabled: true });
    expect(inboundStatusLabel(status)).toBe("Inbound: inactive (not running)");
  });

  test("a running watcher is ok", () => {
    const status = parseInboundStatus({ ...LIVE_STATUS, enabled: true, running: true, mode: "idle" });
    expect(inboundStatusLabel(status)).toBe("Inbound: idle");
    expect(inboundStatusTone(status)).toBe("ok");
  });

  test("a lost capability outranks a running watcher", () => {
    const status = parseInboundStatus({
      ...LIVE_STATUS,
      running: true,
      capability: { state: "insufficient", reason: "no IDLE", detail: "", fix: "" },
    });
    expect(inboundStatusTone(status)).toBe("bad");
  });

  test("a healthy watcher is ok, the daemon's actual success state", () => {
    const status = parseInboundStatus({
      ...LIVE_STATUS,
      running: true,
      capability: { state: "healthy", reason: "idle-push", detail: "", fix: "" },
    });
    expect(inboundStatusTone(status)).toBe("ok");
  });

  test("a degraded watcher (polling without IDLE) warns instead of failing red", () => {
    const status = parseInboundStatus({
      ...LIVE_STATUS,
      running: true,
      capability: { state: "degraded", reason: "poll-only", detail: "", fix: "" },
    });
    expect(inboundStatusTone(status)).toBe("warning");
  });

  test("an unrecognized future capability state warns", () => {
    const status = parseInboundStatus({
      ...LIVE_STATUS,
      running: true,
      capability: { state: "quantum", reason: "", detail: "", fix: "" },
    });
    expect(inboundStatusTone(status)).toBe("warning");
  });

  test("mail arriving with nowhere to announce it is a warning", () => {
    const status = parseInboundStatus({
      ...LIVE_STATUS,
      running: true,
      noticeDelivery: { state: "unroutable", reason: "no channel connected" },
    });
    expect(inboundStatusTone(status)).toBe("warning");
  });
});

describe("parseExpectations", () => {
  test("reads the live list payload", () => {
    const rows = parseExpectations(LIVE_EXPECTATIONS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "5c947bf8-11bb-4019-b230-d8caac9a2fc0",
      serviceDomain: "example.test",
      recipientAddress: "probe@example.test",
      purpose: "verification probe",
      kind: "signup",
      authority: "evidence-only",
      remainingMs: 899997,
    });
  });

  test("total comes off the wire, not the array length", () => {
    expect(parseExpectationTotal({ expectations: [], total: 3 })).toBe(3);
  });

  test("total falls back to the array length when the daemon omits it", () => {
    expect(parseExpectationTotal({ expectations: LIVE_EXPECTATIONS.expectations })).toBe(1);
  });

  test("an empty list is an empty list", () => {
    expect(parseExpectations({ expectations: [], total: 0 })).toEqual([]);
  });
});

describe("formatRemaining", () => {
  test("formats the live remainingMs", () => {
    expect(formatRemaining(899997)).toBe("14m 59s");
  });

  test("uses hours past sixty minutes", () => {
    expect(formatRemaining(3 * 3600_000 + 25 * 60_000)).toBe("3h 25m");
  });

  test("sub-minute windows read in seconds", () => {
    expect(formatRemaining(42_000)).toBe("42s");
  });

  test("a closed window says expired, never a negative countdown", () => {
    expect(formatRemaining(0)).toBe("expired");
    expect(formatRemaining(-5000)).toBe("expired");
  });

  test("an absent window renders nothing rather than a zero", () => {
    expect(formatRemaining(undefined)).toBe("");
  });
});

describe("inboundMailRefusal", () => {
  test("501 NOT_INVOKABLE names the config key that starts the watcher", () => {
    // The exact response a live daemon gives for all four inbound verbs while
    // surfaces.email.inbound.accounts is unset.
    const refusal = inboundMailRefusal(
      gatewayError(501, "NOT_INVOKABLE", "Gateway method is not invokable: email.inbound.status"),
      "email.inbound.status",
    );
    expect(refusal?.kind).toBe("unconfigured");
    expect(refusal?.kind === "unconfigured" && refusal.description).toContain("surfaces.email.inbound.accounts");
  });

  test("a 404 unknown method is the capability being absent, not a config gap", () => {
    const refusal = inboundMailRefusal(
      gatewayError(404, "METHOD_NOT_FOUND", "Unknown gateway method"),
      "email.expectation.list",
    );
    expect(refusal?.kind).toBe("unavailable");
    expect(refusal?.kind === "unavailable" && refusal.capability).toBe("email.expectation.list");
  });

  test("a genuine failure is left for ErrorState to render", () => {
    expect(inboundMailRefusal(gatewayError(500, "INTERNAL", "boom"), "email.inbound.status")).toBeNull();
  });

  test("no error is no refusal", () => {
    expect(inboundMailRefusal(null, "email.inbound.status")).toBeNull();
  });
});
