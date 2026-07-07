// Enforce process-boundary import rules (docs/ARCHITECTURE.md §5):
//  - src/ui must never import Bun-only SDK platform subpaths or electrobun/bun.
//  - src/shared must import from neither runtime.
// Exits non-zero with a file:line list on violation.

import { Glob } from "bun";

interface Rule {
  dir: string;
  forbidden: RegExp[];
  label: string;
}

const RULES: Rule[] = [
  {
    dir: "src/ui",
    label: "webview UI",
    forbidden: [
      /@pellux\/goodvibes-sdk\/platform/,
      /@pellux\/goodvibes-sdk\/daemon/,
      /from\s+["']electrobun\/bun["']/,
      /from\s+["']node:/,
    ],
  },
  {
    dir: "src/shared",
    label: "shared contract",
    forbidden: [/@pellux\//, /electrobun/, /from\s+["']node:/, /from\s+["']react["']/],
  },
];

let failures = 0;
for (const rule of RULES) {
  const glob = new Glob(`${rule.dir}/**/*.{ts,tsx}`);
  for await (const file of glob.scan(".")) {
    const text = await Bun.file(file).text();
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const pattern of rule.forbidden) {
        if (pattern.test(line)) {
          console.error(`${file}:${i + 1} — forbidden in ${rule.label}: ${line.trim()}`);
          failures++;
        }
      }
    });
  }
}

if (failures > 0) {
  console.error(`\n${failures} boundary violation(s).`);
  process.exit(1);
}
console.log("boundaries ok");
