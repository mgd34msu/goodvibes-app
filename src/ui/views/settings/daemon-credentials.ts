// Pure logic behind the daemon-mediated credential writes (credentials.set /
// credentials.delete): which config keys to offer, how to read the secret-free
// receipts back, and how to triage the refusals.
//
// ── Why this is not the app's secrets flow ─────────────────────────────────
// src/bun/secrets.ts owns this app's handle on the SURFACE secret store
// (~/.goodvibes/tui/secrets.enc), keyed by secret NAME, and it is what the
// Secrets & Services tab drives. The verbs here are the other store: a
// credential the DAEMON executes with, keyed by CONFIG PATH, written into the
// daemon's own tier by the daemon itself. Splitting a daemon-owned credential
// into a local secret write plus a config.set is the exact failure the verb
// exists to prevent: the reference lands in one tree and the value in another,
// the surface reports success, and the daemon resolves the reference to
// nothing. Both stores are real and neither is a fallback for the other.
//
// ── What never comes back ─────────────────────────────────────────────────
// The value. Not on success, not in an error. The receipt names the config key,
// the derived store key, the resolved scope and the reference now in config,
// which is everything needed to verify the write and nothing that repeats the
// credential. Nothing in this module accepts a value; the value goes straight
// from the input element to gv.config.credentialSet and is dropped.

import { errorCode, errorStatus, formatError, isMethodNotInvokableError, isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, firstString } from "../../lib/wire.ts";
import { CONFIG_SCHEMA_SNAPSHOT } from "./config-schema.generated.ts";
import { isSecretConfigKey } from "./config-redaction.ts";

/**
 * Config keys worth OFFERING as credential-bearing, from the pinned schema and
 * the same secret-shaped test the config view masks with.
 *
 * A suggestion list, deliberately not a gate: the daemon owns the real
 * predicate and refuses a key it does not consider credential-bearing with a
 * message naming config.set instead, which this surface renders verbatim. A
 * client-side allowlist would instead hide a key the daemon would have
 * accepted, which is the worse failure of the two.
 */
export function credentialKeySuggestions(): string[] {
  return CONFIG_SCHEMA_SNAPSHOT.map((meta) => meta.key)
    .filter((key) => isSecretConfigKey(key))
    .sort((a, b) => a.localeCompare(b));
}

/** What credentials.set reports back. Never the value. */
export interface CredentialWriteReceipt {
  success: boolean;
  key: string;
  secretKey: string;
  scope: string;
  reference: string;
  /** Which config tier took the reference; absent on older daemons. */
  configScope: string;
  /** The daemon's own sentence about where the SETTING is filed. */
  ownership: string;
  /** The daemon's own sentence about where the CREDENTIAL is filed. */
  credentialScope: string;
}

export function readCredentialWriteReceipt(value: unknown): CredentialWriteReceipt {
  const record = asRecord(value);
  return {
    success: record["success"] === true,
    key: firstString(record, ["key"]),
    secretKey: firstString(record, ["secretKey"]),
    scope: firstString(record, ["scope"]),
    reference: firstString(record, ["reference"]),
    configScope: firstString(record, ["configScope"]),
    ownership: firstString(record, ["ownership"]),
    credentialScope: firstString(record, ["credentialScope"]),
  };
}

export interface CredentialClearReceipt {
  success: boolean;
  key: string;
  secretKey: string;
  scope: string;
  /** False when nothing was stored under that key: a miss, not a failure. */
  cleared: boolean;
}

export function readCredentialClearReceipt(value: unknown): CredentialClearReceipt {
  const record = asRecord(value);
  return {
    success: record["success"] === true,
    key: firstString(record, ["key"]),
    secretKey: firstString(record, ["secretKey"]),
    scope: firstString(record, ["scope"]),
    cleared: record["cleared"] === true,
  };
}

/** One line summarising a completed write, safe to show and to keep on screen. */
export function describeWriteReceipt(receipt: CredentialWriteReceipt): string {
  const parts = [
    `Stored as ${receipt.secretKey || "(unnamed store key)"} in the ${receipt.scope || "resolved"} tier`,
    receipt.reference ? `${receipt.key} now points at ${receipt.reference}` : "",
  ].filter(Boolean);
  return parts.join(". ") + ".";
}

export type DaemonCredentialRefusalKind =
  | "not-a-credential"
  | "value-is-a-reference"
  | "admin-required"
  | "unavailable"
  | "bridge"
  | null;

export interface DaemonCredentialRefusal {
  kind: Exclude<DaemonCredentialRefusalKind, null>;
  title: string;
  /** Verbatim daemon wording wherever the daemon supplied it. */
  description: string;
}

/**
 * Triage a credentials.set / credentials.delete rejection.
 *
 * The two 400s are separated because they need different actions: a key that is
 * not credential-bearing has to be written with config.set instead, while a
 * value that is already a goodvibes:// reference has nothing to store and
 * belongs in the config field directly. Both arrive as INVALID_ARGUMENT, so the
 * message is what distinguishes them, and the daemon's own sentence is carried
 * through rather than replaced.
 */
export function daemonCredentialRefusal(error: unknown): DaemonCredentialRefusal | null {
  if (!error) return null;
  if (errorCode(error) === "APP_WS_BRIDGE_UNAVAILABLE") {
    return {
      kind: "bridge",
      title: "The daemon websocket bridge is not connected",
      description:
        "credentials.set and credentials.delete are ws-only verbs with no REST route, so they need the bridge. Nothing was written.",
    };
  }
  if (isMethodNotInvokableError(error) || isMethodUnavailableError(error)) {
    return {
      kind: "unavailable",
      title: "This daemon does not serve daemon-side credential writes",
      description:
        "credentials.set is absent from the connected daemon. Store the credential with the TUI on the daemon's own machine instead.",
    };
  }
  const status = errorStatus(error);
  if (status === 401 || status === 403) {
    return {
      kind: "admin-required",
      title: "Admin access required",
      description: "Writing a daemon credential needs an admin-scoped principal. Nothing was written.",
    };
  }
  const message = formatError(error);
  if (status === 400 && /is not a credential-bearing setting/i.test(message)) {
    return { kind: "not-a-credential", title: "Not a credential-bearing setting", description: message };
  }
  if (status === 400 && /goodvibes:\/\//.test(message)) {
    return { kind: "value-is-a-reference", title: "That value is already a reference", description: message };
  }
  return null;
}
