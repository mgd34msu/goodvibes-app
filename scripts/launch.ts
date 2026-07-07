// Launch the built app with the Linux WebKitGTK fix in place.
// Usage: bun scripts/launch.ts [--log <path>]

import { join } from "node:path";
import { existsSync } from "node:fs";

const buildRoot = join(import.meta.dir, "..", "build");
const candidates = [
  join(buildRoot, "dev-linux-x64", "GoodVibes-dev", "bin", "launcher"),
  join(buildRoot, "canary-linux-x64", "GoodVibes-canary", "bin", "launcher"),
  join(buildRoot, "stable-linux-x64", "GoodVibes", "bin", "launcher"),
];

const launcher = candidates.find((c) => existsSync(c));
if (!launcher) {
  console.error("No built launcher found. Run `bun run build` first. Looked in:");
  for (const c of candidates) console.error(`  ${c}`);
  process.exit(1);
}

const logIdx = process.argv.indexOf("--log");
const logPath = logIdx > -1 ? process.argv[logIdx + 1] : null;

const proc = Bun.spawn([launcher], {
  env: {
    ...process.env,
    // WebKitGTK paints a blank window without this on this hardware
    // (verified 2026-07-07; docs/ARCHITECTURE.md §1).
    WEBKIT_DISABLE_DMABUF_RENDERER: "1",
    // scripts/launch.ts is the dev launcher — enable the webview eval driver.
    GOODVIBES_APP_DEV: "1",
  },
  stdin: "ignore",
  stdout: logPath ? Bun.file(logPath) : "inherit",
  stderr: logPath ? Bun.file(logPath) : "inherit",
});

const code = await proc.exited;
process.exit(code);
