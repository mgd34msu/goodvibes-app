// Settings & Config workspace (docs/FEATURES.md §19 — forefront requirement).
// Ten sections behind a local tab rail, each URL-addressable via
// ?filter[section]=…: the schema-driven daemon config editor, app-shell
// preferences (theme/density/motion + the live keybinding registry editor),
// local-auth administration, the security-flag audit, the secret-free
// credential status snapshot, the settings-sync/storage posture, the
// secrets manager + service registry, notification prefs, app-own
// window/launch settings, and profile bundles + the tui/agent import bridge.
// The Doctor (onboarding checks, re-runnable) is one click away in the
// header — it is owned by AppShell and reached through its registered
// command. A cross-section fuzzy search (settings-search.ts) sits next to
// it: jump-to-section + a brief highlight flash, <2s to find any key.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Stethoscope } from "lucide-react";
import { registerCommand, unregisterCommand, runCommand } from "../../lib/commands.ts";
import { useUrlState } from "../../lib/router.ts";
import { settingsKeys } from "./settings-queries.ts";
import { ConfigSettingsSection } from "./ConfigSettingsSection.tsx";
import { ShellPrefsSection } from "./ShellPrefsSection.tsx";
import { LocalAuthSection } from "./LocalAuthSection.tsx";
import { SecuritySection } from "./SecuritySection.tsx";
import { OsServiceSection } from "./OsServiceSection.tsx";
import { CredentialsSection } from "./CredentialsSection.tsx";
import { SyncSection } from "./SyncSection.tsx";
import { SecretsSection } from "./SecretsSection.tsx";
import { ServicesSection } from "./ServicesSection.tsx";
import { NotificationsSection } from "./NotificationsSection.tsx";
import { NotificationTargetsSection } from "./NotificationTargetsSection.tsx";
import { AppLaunchSection } from "./AppLaunchSection.tsx";
import { ProfilesSection } from "./ProfilesSection.tsx";
import { flashSection, searchSettings, type SettingsSectionId } from "./settings-search.ts";

type SettingsSection = SettingsSectionId;

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string }> = [
  { id: "config", label: "Daemon config" },
  { id: "app", label: "App shell" },
  { id: "auth", label: "Local auth" },
  { id: "security", label: "Security" },
  { id: "credentials", label: "Credentials" },
  { id: "sync", label: "Sync & storage" },
  { id: "secrets", label: "Secrets & Services" },
  { id: "notifications", label: "Notifications" },
  { id: "launch", label: "App & Launch" },
  { id: "profiles", label: "Profiles & Import" },
];

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

export function SettingsView(): React.ReactElement {
  const queryClient = useQueryClient();
  const { filters, setFilters } = useUrlState();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const rawSection = filters["section"] ?? "";
  const section: SettingsSection = SECTION_IDS.has(rawSection) ? (rawSection as SettingsSection) : "config";

  // Palette commands — view-scoped, live only while the view is mounted.
  useEffect(() => {
    registerCommand({
      id: "settings.refreshConfig",
      title: "Refresh Daemon Config",
      group: "system",
      keywords: ["settings", "config", "reload"],
      run: () => void queryClient.invalidateQueries({ queryKey: settingsKeys.config }),
    });
    return () => {
      unregisterCommand("settings.refreshConfig");
    };
  }, [queryClient]);

  const searchResults = searchSettings(searchQuery);

  function jumpTo(sectionId: SettingsSection, anchorSelector: string): void {
    setFilters({ section: sectionId }, { replace: true });
    flashSection(anchorSelector);
    setSearchQuery("");
    setSearchOpen(false);
  }

  return (
    <div className="settings-view">
      <div className="settings-view__header">
        <nav className="settings-view__tabs" role="tablist" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              className={section === s.id ? "settings-view__tab settings-view__tab--active" : "settings-view__tab"}
              onClick={() => setFilters({ section: s.id }, { replace: true })}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-view__header-actions">
          <div className="settings-view__search">
            <label className="settings-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
                placeholder="Search all settings…"
                aria-label="Search all settings sections"
              />
            </label>
            {searchOpen && searchResults.length > 0 && (
              <ul className="settings-view__search-results" role="listbox">
                {searchResults.map((result, index) => (
                  <li key={`${result.sectionId}-${result.label}-${index}`}>
                    <button type="button" onClick={() => jumpTo(result.sectionId, result.anchorSelector)}>
                      <span className="settings-view__search-label">{result.label}</span>
                      <span className="settings-view__search-section">{result.sectionLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="settings-view__doctor"
            onClick={() => runCommand("system.doctor")}
            title="Re-run the onboarding checks (daemon, auth, provider)"
          >
            <Stethoscope size={14} aria-hidden="true" /> Run Doctor
          </button>
        </div>
      </div>

      {section === "config" && <ConfigSettingsSection />}
      {section === "app" && <ShellPrefsSection />}
      {section === "auth" && <LocalAuthSection />}
      {section === "security" && (
        <>
          <SecuritySection />
          <OsServiceSection />
        </>
      )}
      {section === "credentials" && <CredentialsSection />}
      {section === "sync" && <SyncSection />}
      {section === "secrets" && (
        <>
          <SecretsSection />
          <ServicesSection />
        </>
      )}
      {section === "notifications" && (
        <>
          <NotificationsSection />
          <NotificationTargetsSection />
        </>
      )}
      {section === "launch" && <AppLaunchSection />}
      {section === "profiles" && <ProfilesSection />}
    </div>
  );
}
