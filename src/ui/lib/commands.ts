// Command registry — the single inventory of every user-invokable action.
// Palette, hotkeys, and every displayed shortcut hint read from here (plus
// lib/keybindings.ts for the combo — no hardcoded hint strings anywhere).
// Ported from goodvibes-webui src/lib/commands.ts + command-groups.ts, with a
// `when` guard and keybinding-registry-resolved shortcuts instead of a
// per-command `shortcut` string.

export type CommandGroup =
  | "navigation"
  | "work"
  | "automate"
  | "know"
  | "assistant"
  | "code"
  | "system"
  | "view";

export interface CommandDef {
  /** Stable unique identifier, e.g. "nav.chat". Keybindings key off this. */
  id: string;
  title: string;
  group: CommandGroup;
  keywords?: readonly string[];
  /** Availability guard — hidden from palette/hotkeys when it returns false. */
  when?: () => boolean;
  run: () => void;
}

type Listener = () => void;

const commands = new Map<string, CommandDef>();
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

/** Register (or replace by id) a command. */
export function registerCommand(def: CommandDef): void {
  commands.set(def.id, def);
  notify();
}

export function unregisterCommand(id: string): void {
  if (commands.delete(id)) notify();
}

export function getCommand(id: string): CommandDef | undefined {
  return commands.get(id);
}

/** Snapshot of all AVAILABLE commands (when-guard applied), group/title order. */
export function getCommands(): CommandDef[] {
  return Array.from(commands.values())
    .filter((cmd) => (cmd.when ? cmd.when() : true))
    .sort((a, b) => {
      const gCmp = a.group.localeCompare(b.group);
      return gCmp !== 0 ? gCmp : a.title.localeCompare(b.title);
    });
}

export function subscribeCommands(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Grouping (palette section headers, shortcut cheatsheet)
// ---------------------------------------------------------------------------

export interface GroupedCommands {
  group: string;
  commands: CommandDef[];
}

export const GROUP_LABELS: Record<string, string> = {
  navigation: "Navigation",
  work: "Work",
  automate: "Automate",
  know: "Know",
  assistant: "Assistant",
  code: "Code",
  system: "System",
  view: "View",
};

export function buildGroups(list: CommandDef[]): GroupedCommands[] {
  const groupMap = new Map<string, CommandDef[]>();
  for (const cmd of list) {
    const existing = groupMap.get(cmd.group);
    if (existing) existing.push(cmd);
    else groupMap.set(cmd.group, [cmd]);
  }
  return Array.from(groupMap.entries()).map(([group, cmds]) => ({ group, commands: cmds }));
}

// ---------------------------------------------------------------------------
// Fuzzy matching (no deps — tiered score + subsequence fallback)
// ---------------------------------------------------------------------------

export function filterCommands(list: CommandDef[], query: string): CommandDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;

  return list
    .map((cmd) => ({ cmd, score: scoreCommand(cmd, q) }))
    .filter(({ score }) => score < Infinity)
    .sort((a, b) => a.score - b.score)
    .map(({ cmd }) => cmd);
}

function scoreCommand(cmd: CommandDef, q: string): number {
  const title = cmd.title.toLowerCase();
  const group = cmd.group.toLowerCase();
  const keywords = (cmd.keywords ?? []).map((k) => k.toLowerCase()).join(" ");

  if (title.startsWith(q)) return 0;
  if (keywords.split(" ").some((k) => k.startsWith(q))) return 1;
  if (title.includes(q)) return 2;
  if (group.includes(q)) return 3;
  if (keywords.includes(q)) return 4;
  if (fuzzyMatch(title, q)) return 5;
  if (fuzzyMatch(keywords, q)) return 6;
  return Infinity;
}

/** Subsequence match: every char of needle appears in order in haystack. */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  let hi = 0;
  for (const ch of needle) {
    while (hi < haystack.length && haystack[hi] !== ch) hi++;
    if (hi >= haystack.length) return false;
    hi++;
  }
  return true;
}

export function runCommand(id: string): boolean {
  const cmd = commands.get(id);
  if (!cmd) return false;
  if (cmd.when && !cmd.when()) return false;
  cmd.run();
  return true;
}
