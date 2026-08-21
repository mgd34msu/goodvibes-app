// Pure-logic coverage for the mcp.servers.reveal readers in
// src/ui/views/mcp/mcp-data.ts.
//
// The empty-registry payload is a VERBATIM capture from a locally spawned
// daemon (@pellux/goodvibes-daemon 1.28.19 / sdk 2.0.17); the populated ones
// follow the same shape with the `env` map the verb adds on top of config.get's
// `envKeys`.

import { describe, expect, test } from "bun:test";
import { countRevealedValues, readConfiguredServers, readRevealedEnv } from "../src/ui/views/mcp/mcp-data.ts";

// Captured live: a daemon with no MCP servers registered still answers 200.
const LIVE_EMPTY_REVEAL = {
  locations: [
    { scope: "global", kind: "global-xdg", path: "/home/u/.config/mcp/mcp.json", writable: true },
    { scope: "project", kind: "project-goodvibes", path: "/repo/.goodvibes/mcp.json", writable: true },
  ],
  servers: [],
};

const REVEAL_WITH_VALUES = {
  locations: LIVE_EMPTY_REVEAL.locations,
  servers: [
    {
      name: "search",
      command: "bunx",
      args: ["search-mcp", "--stdio"],
      envKeys: ["SEARCH_API_KEY", "SEARCH_REGION"],
      env: { SEARCH_API_KEY: "sk-not-a-real-key", SEARCH_REGION: "eu" },
      role: null,
      trustMode: null,
      allowedPaths: [],
      allowedHosts: [],
      source: LIVE_EMPTY_REVEAL.locations[1],
    },
    {
      name: "files",
      command: "bunx",
      args: ["files-mcp"],
      envKeys: [],
      env: {},
      role: "reader",
      trustMode: "restricted",
      allowedPaths: ["/repo"],
      allowedHosts: [],
      source: LIVE_EMPTY_REVEAL.locations[0],
    },
  ],
};

describe("readRevealedEnv", () => {
  test("an empty registry reveals nothing and does not throw", () => {
    const revealed = readRevealedEnv(LIVE_EMPTY_REVEAL);
    expect(revealed.size).toBe(0);
    expect(countRevealedValues(revealed)).toBe(0);
  });

  test("keys map to their values, per server", () => {
    const revealed = readRevealedEnv(REVEAL_WITH_VALUES);
    expect(revealed.get("search")).toEqual({ SEARCH_API_KEY: "sk-not-a-real-key", SEARCH_REGION: "eu" });
    expect(revealed.get("files")).toEqual({});
    expect(countRevealedValues(revealed)).toBe(2);
  });

  test("a server with no name is skipped rather than keyed on an empty string", () => {
    const revealed = readRevealedEnv({ servers: [{ env: { A: "1" } }] });
    expect(revealed.size).toBe(0);
  });

  test("non-string env values are dropped, never rendered as [object Object]", () => {
    const revealed = readRevealedEnv({
      servers: [{ name: "odd", env: { GOOD: "yes", NESTED: { a: 1 }, NUM: 3, NULLED: null } }],
    });
    expect(revealed.get("odd")).toEqual({ GOOD: "yes" });
  });

  test("an entirely absent payload is an empty reveal", () => {
    expect(readRevealedEnv(undefined).size).toBe(0);
    expect(readRevealedEnv({}).size).toBe(0);
  });
});

describe("reveal and config.get describe the same servers", () => {
  test("the reveal payload is readable by the config reader too, so rows line up by name", () => {
    // The rows in the view are built from mcp.config.get; the reveal only fills
    // in values behind the keys those rows already show, so both readers must
    // agree on the server names.
    const configured = readConfiguredServers(REVEAL_WITH_VALUES);
    const revealed = readRevealedEnv(REVEAL_WITH_VALUES);
    expect(configured.map((server) => server.name)).toEqual(["search", "files"]);
    for (const server of configured) expect(revealed.has(server.name)).toBe(true);
  });

  test("config.get's redacted view carries envKeys and no values", () => {
    const configured = readConfiguredServers(REVEAL_WITH_VALUES);
    expect(configured[0]?.envKeys).toEqual(["SEARCH_API_KEY", "SEARCH_REGION"]);
    expect(Object.keys(configured[0] ?? {})).not.toContain("env");
  });
});
