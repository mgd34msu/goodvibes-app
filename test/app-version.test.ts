// Coverage for src/bun/app-version.ts: APP_VERSION must always match
// package.json's version, the single source of truth electrobun.config.ts
// also reads from. A hardcoded literal here previously shipped v0.1.1/v0.2.0
// binaries that self-reported 0.1.0 in /app/health (see the ui-server.ts
// `app.version` field and /app/health's response).

import { describe, expect, test } from "bun:test";
import { APP_VERSION } from "../src/bun/app-version.ts";
import pkg from "../package.json";

describe("APP_VERSION", () => {
  test("matches package.json's version exactly", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  test("is a non-empty semver-shaped string, not a stale placeholder", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(APP_VERSION).not.toBe("0.1.0");
  });
});
