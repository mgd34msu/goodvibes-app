// Settings & Config workspace (docs/FEATURES.md §19 — forefront requirement).
// Six sections behind a local tab rail, each URL-addressable via
// ?filter[section]=…: the schema-driven daemon config editor, app-shell
// preferences (theme/density/motion + the live keybinding registry editor),
// local-auth administration, the security-flag audit, the secret-free
// credential status snapshot, and the settings-sync/storage posture. The
// Doctor (onboarding checks, re-runnable) is one click away in the header —
// it is owned by AppShell and reached through its registered command.

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { registerCommand, unregisterCommand, runCommand } from "../../lib/commands.ts";
import { useUrlState } from "../../lib/router.ts";
import { settingsKeys } from "./settings-queries.ts";
import { ConfigSettingsSection } from "./ConfigSettingsSection.tsx";
import { ShellPrefsSection } from "./ShellPrefsSection.tsx";
import { LocalAuthSection } from "./LocalAuthSection.tsx";
import { SecuritySection } from "./SecuritySection.tsx";
import { CredentialsSection } from "./CredentialsSection.tsx";
import { SyncSection } from "./SyncSection.tsx";

type SettingsSection = "config" | "app" | "auth" | "security" | "credentials" | "sync";

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string }> = [
  { id: "config", label: "Daemon config" },
  { id: "app", label: "App shell" },
  { id: "auth", label: "Local auth" },
  { id: "security", label: "Security" },
  { id: "credentials", label: "Credentials" },
  { id: "sync", label: "Sync & storage" },
];

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

export function SettingsView(): React.ReactElement {
  const queryClient = useQueryClient();
  const { filters, setFilters } = useUrlState();

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
        <button
          type="button"
          className="settings-view__doctor"
          onClick={() => runCommand("system.doctor")}
          title="Re-run the onboarding checks (daemon, auth, provider)"
        >
          <Stethoscope size={14} aria-hidden="true" /> Run Doctor
        </button>
      </div>

      {section === "config" && <ConfigSettingsSection />}
      {section === "app" && <ShellPrefsSection />}
      {section === "auth" && <LocalAuthSection />}
      {section === "security" && <SecuritySection />}
      {section === "credentials" && <CredentialsSection />}
      {section === "sync" && <SyncSection />}
    </div>
  );
}
