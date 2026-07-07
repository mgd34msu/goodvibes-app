// Pure logic for the onboarding permissions-mode pick (docs/GAPS.md §22 row
// 5, docs/FEATURES.md "Permissions posture pick"). No React, no fetch.
//
// Discovery is honest, not assumed: `config.get` frequently omits keys that
// were never explicitly set (the settings config editor has the same problem
// and solves it by merging a pinned client-side copy of the SDK's
// CONFIG_SCHEMA — a file this view does not own and must not import, per the
// per-agent directory boundaries). The one signal available here that is
// actually a live daemon-reported audit — not a guess — is `security.settings`
// (docs/FEATURES.md §20): if it lists a `permissions.mode` row, the daemon
// demonstrably knows about that key right now, so the write path through
// `config.set` is offered. If no such row is reported (or the method itself
// is unavailable), no picker is faked — the informed read-only explanation
// renders instead.

import { asArray, asRecord, firstString } from "../../lib/wire.ts";

export const PERMISSIONS_MODE_KEY = "permissions.mode";

export interface PermissionsModeOption {
  value: string;
  label: string;
  hint: string;
}

/**
 * Mirrors the SDK's platform/config schema enum for `permissions.mode`
 * (prompt / allow-all / custom), the same mirroring precedent as
 * `PROVIDER_ENV_KEYS` in checks.ts — client-side UI code cannot import the
 * Bun-only platform/config subpath (docs/ARCHITECTURE.md §5), so the daemon
 * remains the source of truth and re-validates every write regardless.
 */
export const PERMISSIONS_MODE_OPTIONS: readonly PermissionsModeOption[] = [
  { value: "prompt", label: "Prompt for each action", hint: "Default — every tool call waits for your approval." },
  { value: "allow-all", label: "Allow all", hint: "No prompts. Every tool call runs immediately, unattended." },
  {
    value: "custom",
    label: "Custom",
    hint: "Per-tool rules configured elsewhere (Settings → Config) apply instead of a single posture.",
  },
];

export interface SecuritySettingRow {
  key: string;
  currentState: string;
  defaultState: string;
  summary: string;
  insecureWhen: string;
}

function readSecurityRows(data: unknown): SecuritySettingRow[] {
  return asArray(asRecord(data)["settings"]).map((raw) => {
    const record = asRecord(raw);
    return {
      key: firstString(record, ["key"]),
      currentState: firstString(record, ["currentState"]),
      defaultState: firstString(record, ["defaultState"]),
      summary: firstString(record, ["summary"]),
      insecureWhen: firstString(record, ["insecureWhen"]),
    };
  });
}

/** The `permissions.mode` row off a security.settings payload, if the daemon reports one. */
export function permissionsSecurityRow(security: unknown): SecuritySettingRow | undefined {
  return readSecurityRows(security).find((row) => row.key === PERMISSIONS_MODE_KEY);
}

/** Best-effort current value of `permissions.mode` off a config.get payload, "" if absent. */
export function permissionsModeFromConfig(config: unknown): string {
  const record = asRecord(config);
  const nested = asRecord(record["permissions"]);
  const candidates: unknown[] = [
    record["permissions.mode"],
    nested["mode"],
    asRecord(asRecord(record["config"])["permissions"])["mode"],
    asRecord(asRecord(record["values"])["permissions"])["mode"],
    asRecord(asRecord(record["settings"])["permissions"])["mode"],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

export function labelForPermissionsMode(value: string): string {
  return PERMISSIONS_MODE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
