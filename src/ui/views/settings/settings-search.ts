// Cross-section fuzzy search index (docs/FEATURES.md §19 zero-friction row:
// "find any key in <2s"). Reuses the palette's own fuzzy matcher (lib/
// commands.ts) rather than reinventing scoring. The daemon config tab is
// indexed key-by-key from the static CONFIG_SCHEMA_SNAPSHOT (no query
// needed — it's already a bundled generated file); every other section gets
// a hand-curated set of entries naming its prominent controls. Selecting a
// result switches tabs and flashes the target section's root element by
// class name — deep per-row anchors only exist for sections this agent
// wrote; sections from earlier waves get a whole-section flash, which is
// still "find it" in under 2s without editing files outside this grant.

import { fuzzyMatch } from "../../lib/commands.ts";
import { CONFIG_SCHEMA_SNAPSHOT } from "./config-schema.generated.ts";

export type SettingsSectionId =
  | "config"
  | "app"
  | "auth"
  | "security"
  | "credentials"
  | "sync"
  | "secrets"
  | "notifications"
  | "launch"
  | "profiles";

export interface SettingsSearchEntry {
  sectionId: SettingsSectionId;
  sectionLabel: string;
  label: string;
  keywords: string;
  anchorSelector: string;
}

const CURATED: ReadonlyArray<Omit<SettingsSearchEntry, "keywords">> = [
  { sectionId: "app", sectionLabel: "App shell", label: "Theme (dark/light/system)", anchorSelector: ".settings-shell" },
  { sectionId: "app", sectionLabel: "App shell", label: "Density (comfortable/compact)", anchorSelector: ".settings-shell" },
  { sectionId: "app", sectionLabel: "App shell", label: "Motion / reduced motion", anchorSelector: ".settings-shell" },
  { sectionId: "app", sectionLabel: "App shell", label: "Keybindings editor", anchorSelector: ".settings-keys" },
  { sectionId: "auth", sectionLabel: "Local auth", label: "Users, roles, sessions", anchorSelector: ".settings-auth" },
  { sectionId: "auth", sectionLabel: "Local auth", label: "Password rotate", anchorSelector: ".settings-auth" },
  { sectionId: "auth", sectionLabel: "Local auth", label: "Bootstrap credential clear", anchorSelector: ".settings-auth" },
  { sectionId: "security", sectionLabel: "Security", label: "Permission mode + per-tool rules", anchorSelector: ".settings-security" },
  { sectionId: "security", sectionLabel: "Security", label: "Security settings snapshot", anchorSelector: ".settings-security" },
  { sectionId: "security", sectionLabel: "Security", label: "OS service install/start/stop/restart/uninstall", anchorSelector: ".settings-os-service" },
  { sectionId: "security", sectionLabel: "Security", label: "OS service status (systemd/launchd)", anchorSelector: ".settings-os-service" },
  { sectionId: "credentials", sectionLabel: "Credentials", label: "Credential configured/usable status", anchorSelector: ".settings-credentials" },
  { sectionId: "sync", sectionLabel: "Sync & storage", label: "Settings sync snapshot", anchorSelector: ".settings-sync" },
  { sectionId: "sync", sectionLabel: "Sync & storage", label: "Storage posture", anchorSelector: ".settings-sync" },
  { sectionId: "secrets", sectionLabel: "Secrets & Services", label: "Add / link a secret", anchorSelector: ".settings-secrets" },
  { sectionId: "secrets", sectionLabel: "Secrets & Services", label: "Test a secret", anchorSelector: ".settings-secrets" },
  { sectionId: "secrets", sectionLabel: "Secrets & Services", label: "Delete a secret", anchorSelector: ".settings-secrets" },
  { sectionId: "secrets", sectionLabel: "Secrets & Services", label: "Service registry inspect/test/doctor", anchorSelector: ".settings-services" },
  { sectionId: "notifications", sectionLabel: "Notifications", label: "Enabled master switch", anchorSelector: ".settings-notify" },
  { sectionId: "notifications", sectionLabel: "Notifications", label: "Batching cadence", anchorSelector: ".settings-notify" },
  { sectionId: "notifications", sectionLabel: "Notifications", label: "Quiet while typing", anchorSelector: ".settings-notify" },
  { sectionId: "notifications", sectionLabel: "Notifications", label: "Per-domain verbosity", anchorSelector: ".settings-notify" },
  { sectionId: "launch", sectionLabel: "App & Launch", label: "Stop daemon on quit", anchorSelector: ".settings-launch" },
  { sectionId: "launch", sectionLabel: "App & Launch", label: "Launch at login", anchorSelector: ".settings-launch" },
  { sectionId: "profiles", sectionLabel: "Profiles & Import", label: "Export / import profile bundle", anchorSelector: ".settings-profiles" },
  { sectionId: "profiles", sectionLabel: "Profiles & Import", label: "Import settings from TUI or Agent", anchorSelector: ".settings-profiles" },
];

function buildIndex(): SettingsSearchEntry[] {
  const configEntries: SettingsSearchEntry[] = CONFIG_SCHEMA_SNAPSHOT.map((meta) => ({
    sectionId: "config",
    sectionLabel: "Daemon config",
    label: meta.key,
    keywords: `${meta.key} ${meta.description}`,
    anchorSelector: ".settings-config",
  }));
  const curatedEntries: SettingsSearchEntry[] = CURATED.map((entry) => ({ ...entry, keywords: `${entry.label} ${entry.sectionLabel}` }));
  return [...configEntries, ...curatedEntries];
}

const INDEX = buildIndex();

export function searchSettings(query: string, limit = 8): SettingsSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = INDEX.filter((e) => e.label.toLowerCase().includes(q));
  const fuzzy = exact.length >= limit ? [] : INDEX.filter((e) => !exact.includes(e) && fuzzyMatch(e.keywords, q));
  return [...exact, ...fuzzy].slice(0, limit);
}

/** Switch to the entry's tab, then briefly flash its section root so the
 *  user's eye lands on the right place — best-effort, never throws if the
 *  selector isn't mounted yet (the caller flips tabs first). */
export function flashSection(selector: string): void {
  window.setTimeout(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.add("settings-search-flash");
    window.setTimeout(() => el.classList.remove("settings-search-flash"), 1600);
  }, 60);
}
