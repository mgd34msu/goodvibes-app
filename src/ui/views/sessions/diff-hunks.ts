// Unified-diff → file/hunk parser for the session review cockpit (SessionChanges).
// Ported from goodvibes-webui src/lib/unified-diff.ts: the daemon's checkpoint/
// session diffs are opaque unified-diff strings; per-hunk revert needs real
// hunk boundaries (the exact `@@ … @@` text checkpoints.revertHunkPreview /
// checkpoints.revertHunk reverse-apply), not just a per-file split like
// views/code/diff-model.ts does for the whole-repo Diff view. Pure, no
// network — kept local to this view rather than shared, per the file-ownership
// split for this wave.

export type DiffLineType = "context" | "add" | "del" | "meta";

export interface DiffLine {
  readonly type: DiffLineType;
  /** The line WITHOUT its leading +/-/space marker (meta lines keep their text verbatim). */
  readonly text: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

export interface DiffHunk {
  /** Stable within a file: `${fileIndex}:${hunkIndex}`. */
  readonly id: string;
  /** The verbatim `@@ -a,b +c,d @@ section` header. */
  readonly header: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffLine[];
  readonly addCount: number;
  readonly delCount: number;
}

export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFile {
  /** The path shown to the user — the new path unless the file was deleted. */
  readonly path: string;
  readonly oldPath: string;
  readonly newPath: string;
  readonly status: DiffFileStatus;
  readonly binary: boolean;
  readonly hunks: readonly DiffHunk[];
}

const HUNK_HEADER = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function stripPrefix(raw: string): string {
  if (raw === "/dev/null") return "";
  return raw.replace(/^[ab]\//, "");
}

function parseDiffGitPaths(line: string): { oldPath: string; newPath: string } | null {
  const match = /^diff --git (.+) (.+)$/.exec(line);
  if (!match) return null;
  return { oldPath: stripPrefix(match[1] ?? ""), newPath: stripPrefix(match[2] ?? "") };
}

interface MutableFile {
  oldPath: string;
  newPath: string;
  status: DiffFileStatus;
  binary: boolean;
  hunks: DiffHunk[];
}

/**
 * Parse a git unified-diff string into files and hunks. Returns [] for an
 * empty/whitespace-only diff — the honest "no file differences" case.
 */
export function parseUnifiedDiff(unifiedDiff: string): DiffFile[] {
  if (!unifiedDiff.trim()) return [];
  const lines = unifiedDiff.split("\n");
  const files: MutableFile[] = [];
  let current: MutableFile | null = null;
  let hunkIndex = 0;

  let hunkLines: DiffLine[] = [];
  let hunkMeta: { header: string; oldStart: number; oldCount: number; newStart: number; newCount: number } | null =
    null;
  let oldCursor = 0;
  let newCursor = 0;
  let addCount = 0;
  let delCount = 0;

  function flushHunk(): void {
    if (!current || !hunkMeta) return;
    current.hunks.push({
      id: `${files.length - 1}:${hunkIndex}`,
      header: hunkMeta.header,
      oldStart: hunkMeta.oldStart,
      oldCount: hunkMeta.oldCount,
      newStart: hunkMeta.newStart,
      newCount: hunkMeta.newCount,
      lines: hunkLines,
      addCount,
      delCount,
    });
    hunkIndex += 1;
    hunkLines = [];
    hunkMeta = null;
    addCount = 0;
    delCount = 0;
  }

  function startFile(oldPath: string, newPath: string): MutableFile {
    flushHunk();
    const file: MutableFile = { oldPath, newPath, status: "modified", binary: false, hunks: [] };
    files.push(file);
    hunkIndex = 0;
    return file;
  }

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const paths = parseDiffGitPaths(line);
      current = startFile(paths?.oldPath ?? "", paths?.newPath ?? "");
      continue;
    }

    if (line.startsWith("--- ")) {
      const oldPath = stripPrefix(line.slice(4).replace(/\t.*$/, ""));
      if (!current || current.hunks.length > 0 || hunkMeta) {
        current = startFile(oldPath, current?.newPath ?? "");
      } else {
        current.oldPath = oldPath;
      }
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = stripPrefix(line.slice(4).replace(/\t.*$/, ""));
      if (current) current.newPath = newPath;
      continue;
    }

    if (line.startsWith("new file mode")) {
      if (current) current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      if (current) current.status = "deleted";
      continue;
    }
    if (
      line.startsWith("rename from") ||
      line.startsWith("rename to") ||
      line.startsWith("copy from") ||
      line.startsWith("copy to")
    ) {
      if (current) current.status = "renamed";
      continue;
    }
    if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
      if (current) current.binary = true;
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      flushHunk();
      current ??= startFile("", "");
      const oldStart = Number(hunkMatch[1]);
      const oldCount = hunkMatch[2] ? Number(hunkMatch[2]) : 1;
      const newStart = Number(hunkMatch[3]);
      const newCount = hunkMatch[4] ? Number(hunkMatch[4]) : 1;
      hunkMeta = { header: line, oldStart, oldCount, newStart, newCount };
      oldCursor = oldStart;
      newCursor = newStart;
      continue;
    }

    if (!hunkMeta) continue; // header noise (index …, mode …) between files

    if (line.startsWith("+")) {
      hunkLines.push({ type: "add", text: line.slice(1), oldLine: null, newLine: newCursor });
      newCursor += 1;
      addCount += 1;
    } else if (line.startsWith("-")) {
      hunkLines.push({ type: "del", text: line.slice(1), oldLine: oldCursor, newLine: null });
      oldCursor += 1;
      delCount += 1;
    } else if (line.startsWith("\\")) {
      hunkLines.push({ type: "meta", text: line, oldLine: null, newLine: null });
    } else if (line.startsWith(" ") || line === "") {
      hunkLines.push({ type: "context", text: line.slice(1), oldLine: oldCursor, newLine: newCursor });
      oldCursor += 1;
      newCursor += 1;
    }
  }
  flushHunk();

  return files.map((f) => ({
    path: f.status === "deleted" ? f.oldPath || f.newPath || "unknown" : f.newPath || f.oldPath || "unknown",
    oldPath: f.oldPath,
    newPath: f.newPath,
    status: f.status,
    binary: f.binary,
    hunks: f.hunks,
  }));
}

/** The old-file line span a hunk touches, inclusive (0/0 when the hunk adds only). */
export function hunkOldRange(hunk: Pick<DiffHunk, "oldStart" | "oldCount">): { from: number; to: number } {
  if (hunk.oldCount <= 0) return { from: hunk.oldStart, to: hunk.oldStart };
  return { from: hunk.oldStart, to: hunk.oldStart + hunk.oldCount - 1 };
}

/** The new-file line span a hunk touches, inclusive (0/0 when the hunk deletes only). */
export function hunkNewRange(hunk: Pick<DiffHunk, "newStart" | "newCount">): { from: number; to: number } {
  if (hunk.newCount <= 0) return { from: hunk.newStart, to: hunk.newStart };
  return { from: hunk.newStart, to: hunk.newStart + hunk.newCount - 1 };
}

/** A short human range label like "42–48" (or "42" for a single line). */
export function formatRange(range: { from: number; to: number }): string {
  return range.from === range.to ? String(range.from) : `${range.from}–${range.to}`;
}

function hunkBodyLines(hunk: DiffHunk): string[] {
  return hunk.lines.map((line) => {
    if (line.type === "add") return `+${line.text}`;
    if (line.type === "del") return `-${line.text}`;
    if (line.type === "meta") return line.text;
    return ` ${line.text}`;
  });
}

/**
 * The COMPLETE, exact unified-diff text of one hunk — its `@@` header plus
 * every body line with its verbatim marker, UNCAPPED. This is the string
 * checkpoints.revertHunkPreview / checkpoints.revertHunk parse and
 * reverse-apply: a truncated or annotated patch would fail to apply cleanly
 * (an honest conflict, not the revert), so this is also exactly what the
 * confirm surface shows the operator before they revert it.
 */
export function hunkToPatch(hunk: DiffHunk): string {
  return [hunk.header, ...hunkBodyLines(hunk)].join("\n");
}

export interface DiffFileTotals {
  files: number;
  additions: number;
  deletions: number;
}

export function diffFileTotals(files: readonly DiffFile[]): DiffFileTotals {
  return files.reduce<DiffFileTotals>(
    (acc, f) => ({
      files: acc.files + 1,
      additions: acc.additions + f.hunks.reduce((n, h) => n + h.addCount, 0),
      deletions: acc.deletions + f.hunks.reduce((n, h) => n + h.delCount, 0),
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}
