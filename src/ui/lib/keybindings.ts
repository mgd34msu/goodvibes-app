// Keybinding registry — the SINGLE source of truth for every shortcut the UI
// displays or listens for. Commands (lib/commands.ts) carry no combo of their
// own; this module maps commandId → combo, with user remaps persisted to
// localStorage (a shared ~/.goodvibes/app/keybindings.json store comes with
// the Settings surface later — the read API here stays the same).
// Combo grammar (lib/hotkeys.ts parses it): "mod+k", "Escape", "g c" chords.

export const KEYBINDINGS_STORAGE_KEY = "goodvibes.app.keybindings";
export const KEYBINDINGS_EVENT = "goodvibes:app-keybindings";

/** Default bindings. `mod` = Ctrl (Meta on macOS). */
export const DEFAULT_KEYBINDINGS: Readonly<Record<string, string>> = {
  "system.palette": "mod+k",
  "system.shortcuts": "?",
  "system.toggleTheme": "mod+shift+t",
  "chat.new": "mod+shift+n",
  // g-chords: one per sidebar view (docs/UX.md §1.3).
  "nav.chat": "g c",
  "nav.sessions": "g s",
  "nav.fleet": "g f",
  "nav.approvals": "g a",
  "nav.automation": "g u",
  "nav.watchers": "g w",
  "nav.channels": "g n",
  "nav.knowledge": "g k",
  "nav.memory": "g m",
  "nav.artifacts": "g r",
  "nav.research": "g e",
  "nav.documents": "g d",
  "nav.home": "g h",
  "nav.routines": "g o",
  "nav.personas": "g p",
  "nav.skills": "g l",
  "nav.personal-ops": "g i",
  "nav.git": "g g",
  "nav.diff": "g x",
  "nav.worktrees": "g y",
  "nav.checkpoints": "g z",
  "nav.terminal": "g t",
  "nav.observability": "g b",
  "nav.providers": "g v",
  "nav.mcp": "g q",
  "nav.settings": "g ,",
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(KEYBINDINGS_EVENT));
  listeners.forEach((fn) => fn());
}

function readOverrides(): Record<string, string | null> {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(KEYBINDINGS_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" || value === null) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeOverrides(overrides: Record<string, string | null>): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  window.localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(overrides));
  notify();
}

/** The effective combo for a command, or undefined when unbound. */
export function getBinding(commandId: string): string | undefined {
  const overrides = readOverrides();
  if (commandId in overrides) {
    const value = overrides[commandId];
    return value === null ? undefined : value;
  }
  return DEFAULT_KEYBINDINGS[commandId];
}

/** All effective bindings (defaults merged with user overrides; nulls unbind). */
export function getAllBindings(): Record<string, string> {
  const merged: Record<string, string> = { ...DEFAULT_KEYBINDINGS };
  for (const [id, combo] of Object.entries(readOverrides())) {
    if (combo === null) delete merged[id];
    else merged[id] = combo;
  }
  return merged;
}

/** Remap a command. Pass null to unbind, undefined to reset to default. */
export function setBinding(commandId: string, combo: string | null | undefined): void {
  const overrides = readOverrides();
  if (combo === undefined) delete overrides[commandId];
  else overrides[commandId] = combo;
  writeOverrides(overrides);
}

export function resetAllBindings(): void {
  writeOverrides({});
}

/** Command ids whose effective combo collides with `combo` (excluding one id). */
export function findConflicts(combo: string, excludeCommandId?: string): string[] {
  const normalized = combo.trim().toLowerCase();
  return Object.entries(getAllBindings())
    .filter(([id, bound]) => id !== excludeCommandId && bound.trim().toLowerCase() === normalized)
    .map(([id]) => id);
}

export function subscribeKeybindings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Display formatting — every rendered hint goes through this.
// ---------------------------------------------------------------------------

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent;
  return /mac/i.test(platform);
}

function formatToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === "mod") return isMac() ? "⌘" : "Ctrl";
  if (lower === "ctrl" || lower === "control") return isMac() ? "⌃" : "Ctrl";
  if (lower === "meta" || lower === "cmd") return "⌘";
  if (lower === "shift") return isMac() ? "⇧" : "Shift";
  if (lower === "alt") return isMac() ? "⌥" : "Alt";
  if (token.length === 1) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/** Human-readable combo: "mod+k" → "Ctrl+K" / "⌘K", "g c" → "g c" (chord). */
export function formatCombo(combo: string): string {
  if (/\s/.test(combo)) {
    // Chords display as lowercase key sequences.
    return combo.trim().split(/\s+/).join(" ");
  }
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean).map(formatToken);
  return isMac() ? parts.join("") : parts.join("+");
}

/** The display hint for a command, or empty string when unbound. */
export function displayShortcut(commandId: string): string {
  const combo = getBinding(commandId);
  return combo ? formatCombo(combo) : "";
}
