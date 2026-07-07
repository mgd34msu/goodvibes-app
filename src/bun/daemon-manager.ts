// Daemon lifecycle: adopt an existing GoodVibes daemon or spawn a detached one,
// following the same topology the TUI uses (docs/ARCHITECTURE.md §3,
// docs/research/tui-daemon-architecture.md §1). The daemon always outlives the
// app unless the user opts into stop-on-quit.

import { getOrCreateCompanionToken } from "@pellux/goodvibes-sdk/platform/pairing";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import type { DaemonInfo } from "../shared/app-contract.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3421;
const SPAWN_READY_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 3_000;

export interface DaemonHandle {
  info: DaemonInfo;
  token: string;
  /** Pid of the daemon if this app spawned it (detached). */
  spawnedPid?: number;
}

interface ProbeResult {
  kind: "goodvibes" | "unauthorized" | "unknown" | "unreachable";
  version?: string;
  ms: number;
}

export function daemonHomeDir(): string {
  return join(homedir(), ".goodvibes", "daemon");
}

/** Prefer the TUI's configured control-plane endpoint so all surfaces share one daemon. */
export function resolveEndpoint(): { host: string; port: number } {
  try {
    const settingsPath = join(homedir(), ".goodvibes", "tui", "settings.json");
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
        controlPlane?: { host?: string; port?: number };
      };
      return {
        host: settings.controlPlane?.host ?? DEFAULT_HOST,
        port: settings.controlPlane?.port ?? DEFAULT_PORT,
      };
    }
  } catch {
    // fall through to defaults — a broken settings file must not block launch
  }
  return { host: DEFAULT_HOST, port: DEFAULT_PORT };
}

export function resolveToken(): string {
  const envToken = process.env["GOODVIBES_DAEMON_TOKEN"];
  if (envToken) return envToken;
  const result = getOrCreateCompanionToken("app", { daemonHomeDir: daemonHomeDir() });
  return result.token;
}

async function probe(baseUrl: string, token: string): Promise<ProbeResult> {
  const started = performance.now();
  try {
    const res = await fetch(`${baseUrl}/status`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const ms = Math.round(performance.now() - started);
    if (res.status === 401 || res.status === 403) return { kind: "unauthorized", ms };
    if (!res.ok) return { kind: "unknown", ms };
    const body = (await res.json().catch(() => null)) as { status?: string; version?: string } | null;
    if (body && typeof body.status === "string") {
      return { kind: "goodvibes", version: body.version, ms };
    }
    return { kind: "unknown", ms };
  } catch {
    return { kind: "unreachable", ms: Math.round(performance.now() - started) };
  }
}

/**
 * The daemon major version this app speaks. A daemon must report the SAME major
 * to be driven: a major bump means a breaking control-plane change, so both 0.x
 * (pre-1.0) and >=2.0 daemons are treated as `incompatible` and surfaced to the
 * user rather than proxied blindly. Bump this constant when the app adopts a new
 * daemon major.
 */
export const SUPPORTED_DAEMON_MAJOR = 1;

/**
 * Compatible iff the remote reports the supported major (see SUPPORTED_DAEMON_MAJOR).
 * Unparseable or off-major versions are incompatible — we refuse to drive a
 * daemon whose protocol we cannot reason about.
 */
export function versionCompatible(remote: string | undefined): boolean {
  if (!remote) return false;
  const m = /^(\d+)\.(\d+)\./.exec(remote.trim()) ?? /^(\d+)\.(\d+)$/.exec(remote.trim());
  if (!m) return false;
  const major = Number(m[1]);
  return major === SUPPORTED_DAEMON_MAJOR;
}

function daemonBinPath(): string | null {
  // Dev/installed-from-npm layout. Packaging for dist will copy this tree —
  // tracked in FEATURES.md exclusions until the dist wave.
  const candidates = [
    join(import.meta.dir, "..", "..", "node_modules", ".bin", "goodvibes-daemon"),
    join(process.cwd(), "node_modules", ".bin", "goodvibes-daemon"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  const which = Bun.which("goodvibes-daemon");
  return which ?? null;
}

async function spawnDetached(port: number): Promise<number | null> {
  const bin = daemonBinPath();
  if (!bin) return null;
  const logPath = join(daemonHomeDir(), "app-spawned-daemon.log");
  const logFile = Bun.file(logPath);
  const proc = Bun.spawn([bin, "--port", String(port)], {
    stdin: "ignore",
    stdout: logFile,
    stderr: logFile,
    env: { ...process.env },
  });
  proc.unref();
  return proc.pid;
}

/** Adopt-or-spawn. Never starts a competing daemon on an occupied port. */
export async function ensureDaemon(): Promise<DaemonHandle> {
  const { host, port } = resolveEndpoint();
  const baseUrl = `http://${host}:${port}`;
  const token = resolveToken();

  const first = await probe(baseUrl, token);
  if (first.kind === "goodvibes") {
    if (!versionCompatible(first.version)) {
      return {
        info: {
          mode: "incompatible",
          baseUrl,
          version: first.version,
          probeMs: first.ms,
          detail: `A GoodVibes daemon is running at ${baseUrl} but reports version ${first.version ?? "unknown"}, outside this app's supported major (${SUPPORTED_DAEMON_MAJOR}.x). Update the daemon (or this app) and relaunch.`,
        },
        token,
      };
    }
    return { info: { mode: "external", baseUrl, version: first.version, probeMs: first.ms }, token };
  }

  if (first.kind === "unauthorized" || first.kind === "unknown") {
    // Something answers on the port but we cannot drive it. Do not spawn on top.
    return {
      info: {
        mode: "unreachable",
        baseUrl,
        probeMs: first.ms,
        detail:
          first.kind === "unauthorized"
            ? `A daemon at ${baseUrl} rejected our token. Repair the shared token (Settings → Doctor) or set GOODVIBES_DAEMON_TOKEN.`
            : `Port ${port} is occupied by something that is not a GoodVibes daemon. Free the port or change controlPlane.port.`,
      },
      token,
    };
  }

  // Nothing listening: spawn detached and adopt.
  const pid = await spawnDetached(port);
  if (pid == null) {
    return {
      info: {
        mode: "unreachable",
        baseUrl,
        detail:
          "No daemon is running and the goodvibes-daemon binary could not be found. Reinstall dependencies (bun install) or start a daemon manually.",
      },
      token,
    };
  }

  const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const p = await probe(baseUrl, token);
    if (p.kind === "goodvibes") {
      return {
        info: { mode: "spawned", baseUrl, version: p.version, probeMs: p.ms },
        token,
        spawnedPid: pid,
      };
    }
    await Bun.sleep(400);
  }
  return {
    info: {
      mode: "unreachable",
      baseUrl,
      detail: `Spawned goodvibes-daemon (pid ${pid}) but it did not become ready within ${SPAWN_READY_TIMEOUT_MS / 1000}s. See ${join(daemonHomeDir(), "app-spawned-daemon.log")}.`,
    },
    token,
    spawnedPid: pid,
  };
}
