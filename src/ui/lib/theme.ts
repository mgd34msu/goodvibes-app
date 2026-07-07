// Theme (dark default / light / system), density, and motion preferences —
// persisted to localStorage, applied via data-theme / data-density /
// data-motion attributes on :root (styles/tokens.css). Instant apply, no
// restart. Cross-component sync via a custom window event.

import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePref = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";
export type Density = "default" | "compact";
export type MotionPref = "system" | "reduced";

export interface ThemePreferences {
  theme: ThemePref;
  density: Density;
  motion: MotionPref;
}

export const THEME_PREFERENCES_KEY = "goodvibes.app.theme";
export const THEME_PREFERENCES_EVENT = "goodvibes:app-theme";

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  theme: "dark",
  density: "default",
  motion: "system",
};

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readThemePreferences(): ThemePreferences {
  if (!storageAvailable()) return DEFAULT_THEME_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(THEME_PREFERENCES_KEY);
    if (!stored) return DEFAULT_THEME_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<ThemePreferences>;
    return {
      theme: parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system" ? parsed.theme : "dark",
      density: parsed.density === "compact" ? "compact" : "default",
      motion: parsed.motion === "reduced" ? "reduced" : "system",
    };
  } catch {
    return DEFAULT_THEME_PREFERENCES;
  }
}

export function writeThemePreferences(next: ThemePreferences): ThemePreferences {
  if (storageAvailable()) {
    window.localStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(THEME_PREFERENCES_EVENT, { detail: next }));
  }
  return next;
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref !== "system") return pref;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function applyThemeToRoot(prefs: ThemePreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(prefs.theme));
  if (prefs.density === "compact") root.setAttribute("data-density", "compact");
  else root.removeAttribute("data-density");
  if (prefs.motion === "reduced") root.setAttribute("data-motion", "reduced");
  else root.removeAttribute("data-motion");
}

// ---------------------------------------------------------------------------
// Provider / hook
// ---------------------------------------------------------------------------

export interface UseThemeResult extends ThemePreferences {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePref) => void;
  setDensity: (density: Density) => void;
  setMotion: (motion: MotionPref) => void;
  toggleTheme: () => void;
  toggleDensity: () => void;
}

const ThemeContext = createContext<UseThemeResult | null>(null);

export function useTheme(): UseThemeResult {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<ThemePreferences>(readThemePreferences);

  useEffect(() => {
    applyThemeToRoot(prefs);
  }, [prefs]);

  // OS theme changes matter while pref is 'system'.
  useEffect(() => {
    if (prefs.theme !== "system" || typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => applyThemeToRoot(prefs);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [prefs]);

  // Cross-component / cross-window sync.
  useEffect(() => {
    const handleChange = () => setPrefs(readThemePreferences());
    window.addEventListener("storage", handleChange);
    window.addEventListener(THEME_PREFERENCES_EVENT, handleChange);
    return () => {
      window.removeEventListener("storage", handleChange);
      window.removeEventListener(THEME_PREFERENCES_EVENT, handleChange);
    };
  }, []);

  const update = useCallback((partial: Partial<ThemePreferences>) => {
    setPrefs((prev) => writeThemePreferences({ ...prev, ...partial }));
  }, []);

  const setTheme = useCallback((theme: ThemePref) => update({ theme }), [update]);
  const setDensity = useCallback((density: Density) => update({ density }), [update]);
  const setMotion = useCallback((motion: MotionPref) => update({ motion }), [update]);
  const toggleTheme = useCallback(() => {
    setPrefs((prev) =>
      writeThemePreferences({ ...prev, theme: resolveTheme(prev.theme) === "dark" ? "light" : "dark" }),
    );
  }, []);
  const toggleDensity = useCallback(() => {
    setPrefs((prev) =>
      writeThemePreferences({ ...prev, density: prev.density === "compact" ? "default" : "compact" }),
    );
  }, []);

  const value: UseThemeResult = {
    ...prefs,
    resolvedTheme: resolveTheme(prefs.theme),
    setTheme,
    setDensity,
    setMotion,
    toggleTheme,
    toggleDensity,
  };

  return createElement(ThemeContext.Provider, { value }, children);
}
