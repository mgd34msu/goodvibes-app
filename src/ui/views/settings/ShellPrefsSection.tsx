// App-shell preferences (docs/FEATURES.md §19): theme / density / motion via
// lib/theme.ts (persisted, instant apply), plus the keybinding editor — it
// lists the LIVE keybinding registry (lib/keybindings.ts is the single source
// of truth for every displayed hint) and rebinding writes back through
// setBinding(), with conflict detection via findConflicts().

import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Keyboard, Monitor, RotateCcw } from "lucide-react";
import {
  useTheme,
  type Density,
  type MotionPref,
  type ThemePref,
} from "../../lib/theme.ts";
import {
  DEFAULT_KEYBINDINGS,
  findConflicts,
  formatCombo,
  getAllBindings,
  resetAllBindings,
  setBinding,
  subscribeKeybindings,
} from "../../lib/keybindings.ts";
import { getCommand } from "../../lib/commands.ts";
import { eventToCombo } from "../../lib/hotkeys.ts";
import { useToast } from "../../lib/toast.ts";

// ─── Theme / density / motion ────────────────────────────────────────────────

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

const DENSITY_OPTIONS: ReadonlyArray<{ value: Density; label: string }> = [
  { value: "default", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

const MOTION_OPTIONS: ReadonlyArray<{ value: MotionPref; label: string }> = [
  { value: "system", label: "Follow system" },
  { value: "reduced", label: "Reduced" },
];

export function ShellPrefsSection() {
  const theme = useTheme();

  return (
    <section className="settings-shell" aria-label="App preferences">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Monitor size={14} aria-hidden="true" /> App shell
        </span>
      </div>

      <div className="settings-pref-grid">
        <PrefRadioGroup
          label="Theme"
          options={THEME_OPTIONS}
          value={theme.theme}
          onChange={theme.setTheme}
          note={`Resolved: ${theme.resolvedTheme}`}
        />
        <PrefRadioGroup label="Density" options={DENSITY_OPTIONS} value={theme.density} onChange={theme.setDensity} />
        <PrefRadioGroup
          label="Motion"
          options={MOTION_OPTIONS}
          value={theme.motion}
          onChange={theme.setMotion}
          note="Reduced collapses all animation durations to 0."
        />
      </div>

      <KeybindingEditor />
    </section>
  );
}

function PrefRadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  note,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  note?: string;
}) {
  return (
    <fieldset className="settings-pref">
      <legend>{label}</legend>
      <div className="settings-pref__options" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? "settings-pref__option settings-pref__option--active" : "settings-pref__option"}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {note && <span className="settings-pref__note">{note}</span>}
    </fieldset>
  );
}

// ─── Keybinding editor ───────────────────────────────────────────────────────

/** Human labels for command ids whose owning view is not currently mounted
 *  (the command registry only holds live commands). Falls back to the live
 *  registry title when available, then to the raw id — never invented. */
const COMMAND_LABELS: Record<string, string> = {
  "system.palette": "Command palette",
  "system.shortcuts": "Shortcut cheatsheet",
  "system.toggleTheme": "Toggle theme",
  "system.doctor": "Doctor",
  "chat.new": "New chat",
  "nav.chat": "Go to Chat",
  "nav.sessions": "Go to Sessions",
  "nav.fleet": "Go to Fleet",
  "nav.approvals": "Go to Approvals",
  "nav.automation": "Go to Automation",
  "nav.watchers": "Go to Watchers",
  "nav.channels": "Go to Channels",
  "nav.knowledge": "Go to Knowledge",
  "nav.memory": "Go to Memory",
  "nav.artifacts": "Go to Artifacts",
  "nav.research": "Go to Research",
  "nav.documents": "Go to Documents",
  "nav.home": "Go to Home",
  "nav.routines": "Go to Routines",
  "nav.personas": "Go to Personas",
  "nav.skills": "Go to Skills",
  "nav.personal-ops": "Go to Personal Ops",
  "nav.git": "Go to Git",
  "nav.diff": "Go to Diff",
  "nav.worktrees": "Go to Worktrees",
  "nav.checkpoints": "Go to Checkpoints",
  "nav.terminal": "Go to Terminal",
  "nav.observability": "Go to Observability",
  "nav.providers": "Go to Providers & Models",
  "nav.mcp": "Go to MCP",
  "nav.settings": "Go to Settings",
};

function labelForCommand(id: string): string {
  return getCommand(id)?.title ?? COMMAND_LABELS[id] ?? id;
}

function KeybindingEditor() {
  const { toast } = useToast();
  const [revision, setRevision] = useState(0);
  const [capturingId, setCapturingId] = useState<string | null>(null);

  useEffect(() => subscribeKeybindings(() => setRevision((r) => r + 1)), []);

  // Every id the registry knows: effective bindings ∪ defaults (so an unbound
  // default still shows a row with a "rebind" affordance).
  const rows = useMemo(() => {
    void revision;
    const effective = getAllBindings();
    const ids = [...new Set([...Object.keys(DEFAULT_KEYBINDINGS), ...Object.keys(effective)])].sort();
    return ids.map((id) => {
      const combo = effective[id];
      return {
        id,
        label: labelForCommand(id),
        combo,
        isDefault: combo !== undefined && DEFAULT_KEYBINDINGS[id] === combo,
        conflicts: combo ? findConflicts(combo, id) : [],
      };
    });
  }, [revision]);

  function handleCaptureKey(id: string, event: ReactKeyboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setCapturingId(null);
      return;
    }
    // Ignore bare modifier presses — wait for the full combo.
    if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
    const combo = eventToCombo(event.nativeEvent).replace(/^Control\+|^Meta\+/, "mod+");
    const conflicts = findConflicts(combo, id);
    setBinding(id, combo);
    setCapturingId(null);
    if (conflicts.length > 0) {
      toast({
        title: "Binding conflict",
        description: `"${formatCombo(combo)}" is also bound to ${conflicts.map(labelForCommand).join(", ")}.`,
        tone: "warning",
      });
    } else {
      toast({ title: "Rebound", description: `${labelForCommand(id)} → ${formatCombo(combo)}`, tone: "success" });
    }
  }

  return (
    <div className="settings-keys">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Keyboard size={14} aria-hidden="true" /> Keybindings · {rows.length}
        </span>
        <button
          type="button"
          className="settings-keys__reset-all"
          onClick={() => {
            resetAllBindings();
            toast({ title: "Keybindings reset", description: "All bindings restored to defaults.", tone: "info" });
          }}
        >
          <RotateCcw size={13} aria-hidden="true" /> Reset all
        </button>
      </div>
      <p className="settings-keys__note">
        Every shortcut hint in the app reads this registry. Chords ("g" then a key) can be typed manually; single
        combos can be captured by pressing them.
      </p>
      <ul className="settings-keys__rows">
        {rows.map((row) => (
          <li key={row.id} className="settings-keys__row">
            <span className="settings-keys__label" title={row.id}>
              {row.label}
            </span>
            {capturingId === row.id ? (
              <input
                className="settings-keys__capture"
                autoFocus
                readOnly
                value="Press keys… (Esc cancels)"
                aria-label={`Press the new shortcut for ${row.label}`}
                onKeyDown={(e) => handleCaptureKey(row.id, e)}
                onBlur={() => setCapturingId(null)}
              />
            ) : (
              <button
                type="button"
                className="settings-keys__combo"
                onClick={() => setCapturingId(row.id)}
                aria-label={`Rebind ${row.label}, currently ${row.combo ? formatCombo(row.combo) : "unbound"}`}
              >
                {row.combo ? <kbd>{formatCombo(row.combo)}</kbd> : <span className="settings-keys__unbound">unbound</span>}
              </button>
            )}
            {row.conflicts.length > 0 && (
              <span className="settings-keys__conflict" role="alert">
                conflicts with {row.conflicts.map(labelForCommand).join(", ")}
              </span>
            )}
            <span className="settings-keys__row-actions">
              {!row.isDefault && row.id in DEFAULT_KEYBINDINGS && (
                <button
                  type="button"
                  className="settings-keys__row-btn"
                  onClick={() => setBinding(row.id, undefined)}
                  title={`Reset to default (${formatCombo(DEFAULT_KEYBINDINGS[row.id] ?? "")})`}
                >
                  Reset
                </button>
              )}
              {row.combo && (
                <button
                  type="button"
                  className="settings-keys__row-btn"
                  onClick={() => setBinding(row.id, null)}
                  title="Remove this binding"
                >
                  Unbind
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
