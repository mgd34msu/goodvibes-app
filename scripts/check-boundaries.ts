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
    // Two anchored exemptions for the wake-word port (src/ui/lib/wake/):
    // platform/voice/capture and platform/voice/wake/runtime are both
    // verified browser-safe (26 transitive modules, zero node: imports) and
    // each has its own dedicated exports-map entry in @pellux/goodvibes-sdk.
    // The negative lookahead only excuses those two exact subpaths, quoted
    // either way, and only when the specifier ends there (no /foo after it),
    // so a NEW subpath under platform/ (or a longer path built on top of
    // these two) still trips the general platform ban below it.
    forbidden: [
      /@pellux\/goodvibes-sdk\/platform(?!\/voice\/capture["']|\/voice\/wake\/runtime["'])/,
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
          console.error(`${file}:${i + 1}: forbidden in ${rule.label}: ${line.trim()}`);
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
