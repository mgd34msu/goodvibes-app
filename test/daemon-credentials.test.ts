// Pure-logic coverage for src/ui/views/settings/daemon-credentials.ts: the
// secret-free receipt readers, the key-suggestion list, and the refusal triage
// that has to separate "wrong verb for this key" from "no admin" from "this
// daemon has no such verb".
//
// The success and refusal payloads below are VERBATIM captures from a locally
// spawned daemon (@pellux/goodvibes-daemon 1.28.19 / sdk 2.0.17): a real
// credentials.set on surfaces.telegram.botToken, the credentials.delete that
// cleared it, and the refusal a non-credential key (provider.model) produced.

import { describe, expect, test } from "bun:test";
import { HttpError } from "../src/ui/lib/http.ts";
import {
  credentialKeySuggestions,
  daemonCredentialRefusal,
  describeWriteReceipt,
  readCredentialClearReceipt,
  readCredentialWriteReceipt,
} from "../src/ui/views/settings/daemon-credentials.ts";

const LIVE_SET_RECEIPT = {
  success: true,
  key: "surfaces.telegram.botToken",
  secretKey: "GOODVIBES_SURFACES_TELEGRAM_BOT_TOKEN",
  scope: "daemon",
  reference: "goodvibes://secrets/goodvibes/GOODVIBES_SURFACES_TELEGRAM_BOT_TOKEN",
  configScope: "daemon",
  ownership:
    "surfaces.telegram.botToken is daemon-owned: the daemon executes it, so the daemon's config is its only home.",
  credentialScope:
    "GOODVIBES_SURFACES_TELEGRAM_BOT_TOKEN is daemon-owned because surfaces.telegram.botToken is: the daemon executes that setting, so the credential it names lives in the daemon's own store.",
};

const LIVE_DELETE_RECEIPT = {
  success: true,
  key: "surfaces.telegram.botToken",
  secretKey: "GOODVIBES_SURFACES_TELEGRAM_BOT_TOKEN",
  scope: "daemon",
  cleared: true,
};

const LIVE_NOT_A_CREDENTIAL =
  "provider.model is not a credential-bearing setting, so it must not be stored as a secret: this verb replaces the config value with a goodvibes://secrets/ reference, which is not a readable value for an ordinary setting. Use config.set for it.";

function gatewayError(status: number, code: string, message: string): HttpError {
  return new HttpError(status, "ws:credentials.set", JSON.stringify({ error: message, code, status }));
}

describe("readCredentialWriteReceipt", () => {
  test("reads the live receipt field for field", () => {
    const receipt = readCredentialWriteReceipt(LIVE_SET_RECEIPT);
    expect(receipt.success).toBe(true);
    expect(receipt.key).toBe("surfaces.telegram.botToken");
    expect(receipt.secretKey).toBe("GOODVIBES_SURFACES_TELEGRAM_BOT_TOKEN");
    expect(receipt.scope).toBe("daemon");
    expect(receipt.reference).toBe("goodvibes://secrets/goodvibes/GOODVIBES_SURFACES_TELEGRAM_BOT_TOKEN");
    expect(receipt.configScope).toBe("daemon");
    expect(receipt.ownership).toContain("daemon-owned");
  });

  test("carries no field that could hold the value", () => {
    // The verb is secret-free by contract; the reader must not open a path for
    // a value to reach the UI even if some future daemon sent one.
    const receipt = readCredentialWriteReceipt({ ...LIVE_SET_RECEIPT, value: "not-a-real-token" });
    expect(Object.values(receipt)).not.toContain("not-a-real-token");
    expect(Object.keys(receipt).sort()).toEqual(
      ["configScope", "credentialScope", "key", "ownership", "reference", "scope", "secretKey", "success"].sort(),
    );
  });

  test("an older daemon omitting the two sentences still reads cleanly", () => {
    const receipt = readCredentialWriteReceipt({
      success: true,
      key: "surfaces.ntfy.token",
      secretKey: "GOODVIBES_SURFACES_NTFY_TOKEN",
      scope: "daemon",
      reference: "goodvibes://secrets/goodvibes/GOODVIBES_SURFACES_NTFY_TOKEN",
    });
    expect(receipt.ownership).toBe("");
    expect(receipt.configScope).toBe("");
    expect(receipt.success).toBe(true);
  });
});

describe("describeWriteReceipt", () => {
  test("names the store key, the tier, and what the config now points at", () => {
    const line = describeWriteReceipt(readCredentialWriteReceipt(LIVE_SET_RECEIPT));
    expect(line).toContain("GOODVIBES_SURFACES_TELEGRAM_BOT_TOKEN");
    expect(line).toContain("daemon tier");
    expect(line).toContain("goodvibes://secrets/goodvibes/GOODVIBES_SURFACES_TELEGRAM_BOT_TOKEN");
  });
});

describe("readCredentialClearReceipt", () => {
  test("reads a real clear", () => {
    const receipt = readCredentialClearReceipt(LIVE_DELETE_RECEIPT);
    expect(receipt.cleared).toBe(true);
    expect(receipt.secretKey).toBe("GOODVIBES_SURFACES_TELEGRAM_BOT_TOKEN");
  });

  test("cleared:false is a miss, and success stays true", () => {
    const receipt = readCredentialClearReceipt({ ...LIVE_DELETE_RECEIPT, cleared: false });
    expect(receipt.success).toBe(true);
    expect(receipt.cleared).toBe(false);
  });
});

describe("credentialKeySuggestions", () => {
  const suggestions = credentialKeySuggestions();

  test("offers the daemon-owned surface credentials", () => {
    expect(suggestions).toContain("surfaces.telegram.botToken");
    expect(suggestions).toContain("surfaces.email.password");
  });

  test("does not offer an ordinary setting the verb refuses", () => {
    expect(suggestions).not.toContain("provider.model");
  });

  test("is sorted and free of duplicates", () => {
    expect(suggestions).toEqual([...suggestions].sort((a, b) => a.localeCompare(b)));
    expect(new Set(suggestions).size).toBe(suggestions.length);
  });
});

describe("daemonCredentialRefusal", () => {
  test("a non-credential key is reported with the daemon's own sentence", () => {
    const refusal = daemonCredentialRefusal(gatewayError(400, "INVALID_ARGUMENT", LIVE_NOT_A_CREDENTIAL));
    expect(refusal?.kind).toBe("not-a-credential");
    expect(refusal?.description).toContain("Use config.set for it.");
  });

  test("a value that is already a reference is its own refusal", () => {
    const refusal = daemonCredentialRefusal(
      gatewayError(400, "INVALID_ARGUMENT", "the value is itself a goodvibes:// reference; there is nothing to store"),
    );
    expect(refusal?.kind).toBe("value-is-a-reference");
  });

  test("403 is an admin gap, not a bad key", () => {
    expect(daemonCredentialRefusal(gatewayError(403, "FORBIDDEN", "admin required"))?.kind).toBe("admin-required");
  });

  test("501 NOT_INVOKABLE is the capability missing on this daemon", () => {
    const refusal = daemonCredentialRefusal(
      gatewayError(501, "NOT_INVOKABLE", "Gateway method is not invokable: credentials.set"),
    );
    expect(refusal?.kind).toBe("unavailable");
  });

  test("404 METHOD_NOT_FOUND lands in the same unavailable bucket", () => {
    expect(daemonCredentialRefusal(gatewayError(404, "METHOD_NOT_FOUND", "Unknown gateway method"))?.kind).toBe(
      "unavailable",
    );
  });

  test("a dead ws bridge says so, because these verbs have no REST route", () => {
    const refusal = daemonCredentialRefusal(
      new HttpError(503, "/app/ws", JSON.stringify({ error: "WS bridge unavailable", code: "APP_WS_BRIDGE_UNAVAILABLE" })),
    );
    expect(refusal?.kind).toBe("bridge");
    expect(refusal?.description).toContain("Nothing was written.");
  });

  test("an unclassified failure falls through to the generic error path", () => {
    expect(daemonCredentialRefusal(gatewayError(500, "INTERNAL", "boom"))).toBeNull();
    expect(daemonCredentialRefusal(null)).toBeNull();
  });
});
