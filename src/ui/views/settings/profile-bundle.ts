// Profile bundle: app-local export/import of theme + keybindings + app-own
// settings as one JSON file (docs/FEATURES.md §19 "Profiles + profile-sync
// bundles"). Pure client-side serialize/apply helpers — ProfilesSection.tsx
// owns the download/upload/preview/confirm UI around these.

import { DEFAULT_KEYBINDINGS, getAllBindings, setBinding } from "../../lib/keybindings.ts";
import { DEFAULT_THEME_PREFERENCES, readThemePreferences, writeThemePreferences, type ThemePreferences } from "../../lib/theme.ts";

export const PROFILE_BUNDLE_VERSION = 1;

export interface ProfileBundle {
  version: typeof PROFILE_BUNDLE_VERSION;
  exportedAt: string;
  theme: ThemePreferences;
  /** Only the DIFFS from default — null entries mean "explicitly unbound". */
  keybindingOverrides: Record<string, string | null>;
  appSettings: { stopDaemonOnQuit: boolean };
}

/** Effective bindings that differ from DEFAULT_KEYBINDINGS, in override shape. */
function collectKeybindingOverrides(): Record<string, string | null> {
  const effective = getAllBindings();
  const overrides: Record<string, string | null> = {};
  const ids = new Set([...Object.keys(DEFAULT_KEYBINDINGS), ...Object.keys(effective)]);
  for (const id of ids) {
    const def = DEFAULT_KEYBINDINGS[id];
    const eff = effective[id];
    if (eff === undefined && def !== undefined) overrides[id] = null; // explicitly unbound
    else if (eff !== undefined && eff !== def) overrides[id] = eff;
  }
  return overrides;
}

export function buildProfileBundle(stopDaemonOnQuit: boolean): ProfileBundle {
  return {
    version: PROFILE_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    theme: readThemePreferences(),
    keybindingOverrides: collectKeybindingOverrides(),
    appSettings: { stopDaemonOnQuit },
  };
}

export function serializeProfileBundle(bundle: ProfileBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** Parses + shape-checks; throws a human-readable message on anything else. */
export function parseProfileBundle(raw: string): ProfileBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Not a GoodVibes profile bundle (expected a JSON object).");
  }
  const record = parsed as Record<string, unknown>;
  if (record["version"] !== PROFILE_BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version "${String(record["version"])}" (expected ${PROFILE_BUNDLE_VERSION}).`);
  }
  const themeRaw = record["theme"];
  const theme: ThemePreferences =
    themeRaw && typeof themeRaw === "object"
      ? {
          theme:
            (themeRaw as Record<string, unknown>)["theme"] === "light" ||
            (themeRaw as Record<string, unknown>)["theme"] === "dark" ||
            (themeRaw as Record<string, unknown>)["theme"] === "system"
              ? ((themeRaw as Record<string, unknown>)["theme"] as ThemePreferences["theme"])
              : DEFAULT_THEME_PREFERENCES.theme,
          density: (themeRaw as Record<string, unknown>)["density"] === "compact" ? "compact" : "default",
          motion: (themeRaw as Record<string, unknown>)["motion"] === "reduced" ? "reduced" : "system",
        }
      : DEFAULT_THEME_PREFERENCES;

  const overridesRaw = record["keybindingOverrides"];
  const keybindingOverrides: Record<string, string | null> = {};
  if (overridesRaw && typeof overridesRaw === "object" && !Array.isArray(overridesRaw)) {
    for (const [id, value] of Object.entries(overridesRaw as Record<string, unknown>)) {
      if (typeof value === "string" || value === null) keybindingOverrides[id] = value;
    }
  }

  const appSettingsRaw = record["appSettings"];
  const stopDaemonOnQuit =
    appSettingsRaw && typeof appSettingsRaw === "object"
      ? (appSettingsRaw as Record<string, unknown>)["stopDaemonOnQuit"] === true
      : false;

  return {
    version: PROFILE_BUNDLE_VERSION,
    exportedAt: typeof record["exportedAt"] === "string" ? record["exportedAt"] : new Date().toISOString(),
    theme,
    keybindingOverrides,
    appSettings: { stopDaemonOnQuit },
  };
}

/** Applies a parsed bundle to localStorage (theme + keybindings). Returns the
 *  appSettings patch the caller should PUT to the server separately (kept
 *  explicit here rather than fetching inside a "pure" apply function). */
export function applyProfileBundleLocally(bundle: ProfileBundle): { stopDaemonOnQuit: boolean } {
  writeThemePreferences(bundle.theme);
  for (const [id, combo] of Object.entries(bundle.keybindingOverrides)) {
    setBinding(id, combo);
  }
  return bundle.appSettings;
}
