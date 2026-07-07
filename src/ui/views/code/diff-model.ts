// Unified-diff parsing for the Diff view: splits raw `git diff` output into
// per-file sections with add/del counts, entirely client-side (the Bun route
// returns raw unified text so the wire stays a plain git artifact).

export interface DiffFileSection {
  /** Post-image path (b/ side), or the a/ side for deletions. */
  path: string;
  oldPath: string;
  /** Raw unified diff text for this file, including its diff --git header. */
  text: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
}

const FILE_HEADER = /^diff --git a\/(.*) b\/(.*)$/;

/** Strip surrounding quotes git adds for paths with special characters. */
function unquote(path: string): string {
  if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
    try {
      return JSON.parse(path) as string;
    } catch {
      return path.slice(1, -1);
    }
  }
  return path;
}

export function parseUnifiedDiff(raw: string): DiffFileSection[] {
  if (!raw.trim()) return [];
  const sections: DiffFileSection[] = [];
  let current: DiffFileSection | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      current.text = buffer.join("\n");
      sections.push(current);
    }
    buffer = [];
  };

  for (const line of raw.split("\n")) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      flush();
      const oldPath = unquote(header[1] ?? "");
      const newPath = unquote(header[2] ?? "");
      current = {
        path: newPath || oldPath,
        oldPath,
        text: "",
        additions: 0,
        deletions: 0,
        isBinary: false,
        isNew: false,
        isDeleted: false,
        isRename: false,
      };
      buffer.push(line);
      continue;
    }
    if (!current) continue; // preamble before the first file header (shouldn't happen)
    buffer.push(line);

    if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
    else if (line.startsWith("Binary files ") || line === "GIT binary patch") current.isBinary = true;
    else if (line.startsWith("new file mode")) current.isNew = true;
    else if (line.startsWith("deleted file mode")) current.isDeleted = true;
    else if (line.startsWith("rename from")) current.isRename = true;
  }
  flush();
  return sections;
}

export interface DiffTotals {
  files: number;
  additions: number;
  deletions: number;
}

export function diffTotals(sections: readonly DiffFileSection[]): DiffTotals {
  return sections.reduce<DiffTotals>(
    (acc, s) => ({
      files: acc.files + 1,
      additions: acc.additions + s.additions,
      deletions: acc.deletions + s.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}

// ─── Cross-view jump plumbing (Git log → Diff view) ──────────────────────────
// Same pattern as lib/approvals.ts jumpToApprovals: navigation goes through
// the shell's nav command (only the shell's useUrlState instance drives the
// outlet), the request rides a module store so DiffView honors it whether it
// is already mounted or mounts right after, and the URL filters are ALSO
// written so the jump stays deep-linkable.

import { runCommand } from "../../lib/commands.ts";
import { getCurrentUrlState, replaceState } from "../../lib/router.ts";

export interface DiffRequest {
  mode: "working" | "staged" | "ref";
  ref?: string;
}

let _diffRequest: DiffRequest | null = null;
const _diffListeners = new Set<() => void>();

export function consumeDiffRequest(): DiffRequest | null {
  const request = _diffRequest;
  _diffRequest = null;
  return request;
}

export function subscribeDiffRequest(listener: () => void): () => void {
  _diffListeners.add(listener);
  return () => {
    _diffListeners.delete(listener);
  };
}

/** Jump to the Diff view showing the given comparison. */
export function jumpToDiff(request: DiffRequest): void {
  runCommand("nav.diff");
  const current = getCurrentUrlState();
  replaceState({
    ...current,
    filters: {
      ...current.filters,
      mode: request.mode,
      ...(request.ref ? { ref: request.ref } : {}),
    },
  });
  _diffRequest = request;
  _diffListeners.forEach((fn) => fn());
}

/** Case-insensitive substring match count within one section's text. */
export function countMatches(text: string, query: string): number {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
