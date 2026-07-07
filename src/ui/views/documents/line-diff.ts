// Client-side line diff for the version timeline (docs/FEATURES.md §11).
// LCS on lines with common prefix/suffix trimming; when the middle is still
// too large for the DP table the diff degrades honestly to a whole-block
// replace instead of freezing the UI.

export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
  /** 1-based line number in the "from" text (del/same). */
  aLine?: number;
  /** 1-based line number in the "to" text (add/same). */
  bLine?: number;
}

const MAX_DP_CELLS = 4_000_000;

export function diffLines(fromText: string, toText: string): DiffLine[] {
  const a = fromText.split("\n");
  const b = toText.split("\n");

  // Trim common prefix.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  // Trim common suffix (not overlapping the prefix).
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) {
    out.push({ type: "same", text: a[i] ?? "", aLine: i + 1, bLine: i + 1 });
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > MAX_DP_CELLS) {
    // Too large for LCS — honest whole-block replace.
    midA.forEach((text, i) => out.push({ type: "del", text, aLine: start + i + 1 }));
    midB.forEach((text, i) => out.push({ type: "add", text, bLine: start + i + 1 }));
  } else {
    out.push(...lcsDiff(midA, midB, start));
  }

  const suffixLen = a.length - endA;
  for (let i = 0; i < suffixLen; i++) {
    out.push({ type: "same", text: a[endA + i] ?? "", aLine: endA + i + 1, bLine: endB + i + 1 });
  }
  return out;
}

function lcsDiff(a: string[], b: string[], offset: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:], b[j:]
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? (dp[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(dp[(i + 1) * width + j] ?? 0, dp[i * width + j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] ?? "", aLine: offset + i + 1, bLine: offset + j + 1 });
      i++;
      j++;
    } else if ((dp[(i + 1) * width + j] ?? 0) >= (dp[i * width + j + 1] ?? 0)) {
      out.push({ type: "del", text: a[i] ?? "", aLine: offset + i + 1 });
      i++;
    } else {
      out.push({ type: "add", text: b[j] ?? "", bLine: offset + j + 1 });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: a[i] ?? "", aLine: offset + i + 1 });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j] ?? "", bLine: offset + j + 1 });
    j++;
  }
  return out;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "add") added++;
    else if (line.type === "del") removed++;
  }
  return { added, removed };
}
