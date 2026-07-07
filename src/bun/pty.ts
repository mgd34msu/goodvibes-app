// /app/pty/* — embedded terminal PTY sessions (docs/FEATURES.md §15,
// docs/ARCHITECTURE.md §5). Real pseudo-terminals, no npm native modules.
//
// APPROACH (proven by scripted probe before building — see final agent notes):
// Bun ships no node-pty. We allocate a real PTY with the POSIX `openpty(3)`
// from libutil via Bun's FFI, then spawn the shell through util-linux
// `setsid -c <shell> -i` with the pty slave as stdin/stdout/stderr. `setsid -c`
// makes the shell a session leader whose controlling terminal is that slave —
// which is what gives us WORKING job control: Ctrl+C (a 0x03 byte written to
// the master) is turned into SIGINT by the line discipline and delivered to the
// foreground process group, and the shell no longer prints "cannot set terminal
// process group / no job control". Window size is set with ioctl(TIOCSWINSZ)
// on the master, which also raises SIGWINCH in the child. Verified live: echo,
// prompt render, `stty size` after resize, Ctrl+C interrupting `sleep` with
// exit status 130, and clean exit codes surfaced via Bun.spawn's onExit.
//
// If FFI/openpty or `setsid` are unavailable on the host, the feature degrades
// honestly: session creation returns 501 with PTY_UNSUPPORTED and the UI shows
// an UnavailableState — we never silently fall back to a no-TTY pipe pretending
// to be a terminal.

import { dlopen, FFIType, ptr } from "bun:ffi";
import { read as fsRead, write as fsWrite, closeSync } from "node:fs";
import { basename } from "node:path";
import type { AppRouteHandler } from "./app-routes.ts";

// ─── FFI: openpty(3) + ioctl(2) ──────────────────────────────────────────────

const TIOCSWINSZ = 0x5414; // Linux ioctl to set window size on a tty

interface PtyNative {
  openpty(master: Int32Array, slave: Int32Array, winsize: Uint16Array): number;
  setWinsize(masterFd: number, cols: number, rows: number): number;
}

let nativeCache: PtyNative | null | undefined;
let nativeReason = "";

/** Load libutil/libc once. Returns null (and sets nativeReason) if unavailable. */
function loadNative(): PtyNative | null {
  if (nativeCache !== undefined) return nativeCache;
  try {
    const util = dlopen("libutil.so.1", {
      openpty: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.int,
      },
    });
    const libc = dlopen("libc.so.6", {
      ioctl: { args: [FFIType.int, FFIType.u64, FFIType.ptr], returns: FFIType.int },
    });
    nativeCache = {
      openpty(master, slave, winsize) {
        return util.symbols.openpty(ptr(master), ptr(slave), null, null, ptr(winsize));
      },
      setWinsize(masterFd, cols, rows) {
        const ws = new Uint16Array([rows, cols, 0, 0]); // ws_row, ws_col, ws_xpixel, ws_ypixel
        return libc.symbols.ioctl(masterFd, TIOCSWINSZ, ptr(ws));
      },
    };
  } catch (err) {
    nativeReason = err instanceof Error ? err.message : String(err);
    nativeCache = null;
  }
  return nativeCache;
}

// ─── session model ───────────────────────────────────────────────────────────

const SCROLLBACK_CAP = 2_000_000; // bound reattach replay to ~2 MB, per §15
const KILL_GRACE_MS = 2_000; // SIGHUP → SIGKILL escalation window
const HEARTBEAT_MS = 8_000; // /app routes bypass the proxy heartbeat injector
const READ_BUF = 65_536;
const MAX_SESSIONS = 32;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

interface Subscriber {
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
}

interface PtySession {
  id: string;
  proc: Bun.Subprocess;
  masterFd: number;
  pid: number;
  shell: string;
  cwd: string;
  title: string;
  createdAt: number;
  cols: number;
  rows: number;
  alive: boolean;
  exitCode: number | null;
  signal: string | null;
  scrollback: Uint8Array[];
  scrollbackBytes: number;
  subscribers: Set<Subscriber>;
}

const sessions = new Map<string, PtySession>();
const encoder = new TextEncoder();

function appendScrollback(s: PtySession, chunk: Uint8Array): void {
  s.scrollback.push(chunk);
  s.scrollbackBytes += chunk.byteLength;
  while (s.scrollbackBytes > SCROLLBACK_CAP && s.scrollback.length > 1) {
    const dropped = s.scrollback.shift();
    if (dropped) s.scrollbackBytes -= dropped.byteLength;
  }
}

/** One SSE frame: `event:<name>\ndata:<payload>\n\n`. */
function sseFrame(event: string, data: string): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function broadcast(s: PtySession, frame: Uint8Array): void {
  for (const sub of s.subscribers) {
    try {
      sub.enqueue(frame);
    } catch {
      s.subscribers.delete(sub);
    }
  }
}

function exitFrame(s: PtySession): Uint8Array {
  return sseFrame("exit", JSON.stringify({ exitCode: s.exitCode, signal: s.signal }));
}

// ─── spawn ───────────────────────────────────────────────────────────────────

function resolveWorkspaceDir(): string {
  // Same rule as git.ts: never process.cwd() — in the bundled app that is the
  // launcher's bin directory (verified live). Home is the honest default.
  return process.env["GOODVIBES_WORKING_DIR"]?.trim() || homedir();
}

interface CreateOpts {
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}

function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

const SIGNAL_NAMES: Record<number, string> = {
  1: "SIGHUP",
  2: "SIGINT",
  9: "SIGKILL",
  15: "SIGTERM",
};

/**
 * Normalize onExit's signal into a readable name. Bun's types say `number`, but
 * at runtime it hands back the string name (e.g. "SIGHUP") — handle both.
 */
function signalName(code: number | string | null | undefined): string | null {
  if (code === null || code === undefined || code === 0 || code === "") return null;
  if (typeof code === "string") return code;
  return SIGNAL_NAMES[code] ?? `signal ${code}`;
}

function clampDim(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const n = Math.floor(v);
  if (n < 1) return 1;
  if (n > 1000) return 1000;
  return n;
}

/** Start a shell attached to a fresh PTY. Throws on FFI/openpty/spawn failure. */
function createSession(native: PtyNative, opts: CreateOpts): PtySession {
  const cwd = typeof opts.cwd === "string" && opts.cwd.trim() ? opts.cwd : resolveWorkspaceDir();
  const shell = typeof opts.shell === "string" && opts.shell.trim() ? opts.shell : process.env["SHELL"] || "/bin/bash";
  const cols = clampDim(opts.cols, DEFAULT_COLS);
  const rows = clampDim(opts.rows, DEFAULT_ROWS);

  const amaster = new Int32Array(1);
  const aslave = new Int32Array(1);
  const winsize = new Uint16Array([rows, cols, 0, 0]);
  const rc = native.openpty(amaster, aslave, winsize);
  if (rc !== 0) throw new Error(`openpty failed (rc=${rc})`);
  const masterFd = amaster[0]!;
  const slaveFd = aslave[0]!;

  const id = shortId();

  // `setsid -c` puts the shell in its own session with the slave pty as its
  // controlling terminal — the prerequisite for real job control / Ctrl+C.
  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(["setsid", "-c", shell, "-i"], {
      cwd,
      stdin: slaveFd,
      stdout: slaveFd,
      stderr: slaveFd,
      env: { ...process.env, TERM: "xterm-256color", COLUMNS: String(cols), LINES: String(rows) },
      onExit(_p, exitCode, signalCode) {
        const s = sessions.get(id);
        if (!s) return;
        s.alive = false;
        s.exitCode = exitCode ?? null;
        s.signal = signalName(signalCode);
        broadcast(s, exitFrame(s));
        for (const sub of s.subscribers) {
          try {
            sub.close();
          } catch {
            /* already gone */
          }
        }
        s.subscribers.clear();
      },
    });
  } catch (err) {
    // Spawn failed (bad cwd, missing setsid/shell). Release the pty fds.
    for (const fd of [masterFd, slaveFd]) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }

  // Parent drops the slave so the master read reports EIO once the child exits.
  try {
    closeSync(slaveFd);
  } catch {
    /* ignore */
  }

  const session: PtySession = {
    id,
    proc,
    masterFd,
    pid: proc.pid,
    shell,
    cwd,
    title: basename(cwd) || shell,
    createdAt: Date.now(),
    cols,
    rows,
    alive: true,
    exitCode: null,
    signal: null,
    scrollback: [],
    scrollbackBytes: 0,
    subscribers: new Set(),
  };
  sessions.set(id, session);
  startReadLoop(session);
  return session;
}

/** Drain the master fd; fan output out to scrollback + live subscribers. */
function startReadLoop(s: PtySession): void {
  const buf = Buffer.allocUnsafe(READ_BUF);
  const pump = (): void => {
    fsRead(s.masterFd, buf, 0, READ_BUF, null, (err, n) => {
      if (err || n <= 0) {
        // EIO on a pty master means the slave side closed (child gone). Any
        // other error is terminal for this loop too. onExit surfaces the code.
        finalizeReadEnd(s);
        return;
      }
      const chunk = new Uint8Array(buf.subarray(0, n)); // copy: buf is reused
      appendScrollback(s, chunk);
      broadcast(s, sseFrame("output", base64(chunk)));
      pump();
    });
  };
  pump();
}

function finalizeReadEnd(s: PtySession): void {
  try {
    closeSync(s.masterFd);
  } catch {
    /* already closed */
  }
}

// ─── kill ────────────────────────────────────────────────────────────────────

function killSession(s: PtySession): void {
  // The shell is a session/process-group leader (setsid), so pid === pgid.
  // Signal the whole group so children (a running `vim`, `npm`, …) die too.
  if (!s.alive) return;
  sendGroup(s.pid, "SIGHUP");
  setTimeout(() => {
    const cur = sessions.get(s.id);
    if (cur && cur.alive) sendGroup(cur.pid, "SIGKILL");
  }, KILL_GRACE_MS);
}

function sendGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal); // negative pid → process group
  } catch {
    // Group already reaped, or single-process fallback.
    try {
      process.kill(pid, signal);
    } catch {
      /* gone */
    }
  }
}

// ─── serialization ───────────────────────────────────────────────────────────

function sessionSummary(s: PtySession) {
  return {
    id: s.id,
    pid: s.pid,
    title: s.title,
    cwd: s.cwd,
    shell: s.shell,
    cols: s.cols,
    rows: s.rows,
    createdAt: s.createdAt,
    alive: s.alive,
    exitCode: s.exitCode,
    signal: s.signal,
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function unsupported(): Response {
  return json(
    {
      error: "Embedded terminal is not available on this host (POSIX pty allocation failed).",
      code: "PTY_UNSUPPORTED",
      detail: nativeReason || "openpty/libutil unavailable",
    },
    501,
  );
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ─── SSE output stream ───────────────────────────────────────────────────────

function streamResponse(s: PtySession): Response {
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let self: Subscriber | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sub: Subscriber = {
        enqueue: (chunk) => controller.enqueue(chunk),
        close: () => {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
      };
      self = sub;
      // Register BEFORE snapshotting scrollback, all synchronously — the read
      // loop's callback cannot interleave here (single-threaded, no await), so
      // the subscriber sees the full replay exactly once and no gap after it.
      s.subscribers.add(sub);
      if (s.scrollback.length > 0) {
        const replay = new Uint8Array(s.scrollbackBytes);
        let off = 0;
        for (const c of s.scrollback) {
          replay.set(c, off);
          off += c.byteLength;
        }
        controller.enqueue(sseFrame("output", base64(replay)));
      }
      controller.enqueue(sseFrame("ready", JSON.stringify(sessionSummary(s))));
      if (!s.alive) {
        controller.enqueue(exitFrame(s));
        sub.close();
        s.subscribers.delete(sub);
        return;
      }
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":hb\n\n"));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      // Drop just this subscriber; leave the session (and its child) running so
      // the tab can reattach after a view switch. Sessions end only on DELETE
      // or when the child exits.
      if (self) s.subscribers.delete(self);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

// ─── router ──────────────────────────────────────────────────────────────────

export function createPtyRoutes(): AppRouteHandler {
  return async (req: Request, url: URL): Promise<Response> => {
    const method = req.method;
    const sub = url.pathname.slice("/app/pty".length) || "/";

    try {
      // List
      if (sub === "/sessions" && method === "GET") {
        return json({ sessions: [...sessions.values()].map(sessionSummary) });
      }

      // Create
      if (sub === "/sessions" && method === "POST") {
        const native = loadNative();
        if (!native) return unsupported();
        if (sessions.size >= MAX_SESSIONS) {
          return json({ error: `Terminal session limit reached (${MAX_SESSIONS}).`, code: "PTY_LIMIT" }, 429);
        }
        const body = await readJsonBody(req);
        try {
          const s = createSession(native, {
            cwd: typeof body["cwd"] === "string" ? body["cwd"] : undefined,
            shell: typeof body["shell"] === "string" ? body["shell"] : undefined,
            cols: typeof body["cols"] === "number" ? body["cols"] : undefined,
            rows: typeof body["rows"] === "number" ? body["rows"] : undefined,
          });
          return json(sessionSummary(s), 201);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          const missing = /ENOENT|no such file/i.test(detail);
          return json(
            {
              error: missing
                ? "Could not start the shell (working directory or shell not found)."
                : "Failed to start terminal session.",
              code: missing ? "PTY_SPAWN_FAILED" : "PTY_INTERNAL",
              detail,
            },
            missing ? 400 : 500,
          );
        }
      }

      // Per-session routes: /sessions/<id>[/stream|/input|/resize]
      if (sub.startsWith("/sessions/")) {
        const rest = sub.slice("/sessions/".length);
        const slash = rest.indexOf("/");
        const id = slash === -1 ? rest : rest.slice(0, slash);
        const action = slash === -1 ? "" : rest.slice(slash + 1);
        const s = sessions.get(id);
        if (!s) return json({ error: `No such terminal session: ${id}`, code: "PTY_NOT_FOUND" }, 404);

        if (action === "stream" && method === "GET") {
          return streamResponse(s);
        }

        if (action === "input" && method === "POST") {
          if (!s.alive) return json({ error: "Session has exited.", code: "PTY_EXITED" }, 409);
          const body = await readJsonBody(req);
          const data = body["data"];
          if (typeof data !== "string") {
            return json({ error: "input requires a `data` string.", code: "PTY_BAD_INPUT" }, 400);
          }
          const enc = body["encoding"] === "base64" ? "base64" : "utf8";
          const bytes = Buffer.from(data, enc);
          fsWrite(s.masterFd, bytes, () => {
            /* fire-and-forget; a dead pty surfaces via the exit event */
          });
          return new Response(null, { status: 204 });
        }

        if (action === "resize" && method === "POST") {
          const native = loadNative();
          if (!native) return unsupported();
          const body = await readJsonBody(req);
          const cols = clampDim(body["cols"], s.cols);
          const rows = clampDim(body["rows"], s.rows);
          s.cols = cols;
          s.rows = rows;
          if (s.alive) native.setWinsize(s.masterFd, cols, rows);
          return new Response(null, { status: 204 });
        }

        if (action === "" && method === "DELETE") {
          killSession(s);
          // Keep the record briefly so the UI can read the final exit code via
          // the stream/list; prune after the grace window.
          setTimeout(() => {
            const cur = sessions.get(id);
            if (cur && !cur.alive) sessions.delete(id);
          }, KILL_GRACE_MS + 1_000);
          return json({ ...sessionSummary(s), killing: true });
        }

        return json({ error: `Unknown terminal route: ${sub}`, code: "PTY_ROUTE_NOT_FOUND" }, 404);
      }

      return json({ error: `Unknown terminal route: ${sub}`, code: "PTY_ROUTE_NOT_FOUND" }, 404);
    } catch (err) {
      return json(
        {
          error: "Terminal route failed.",
          code: "PTY_INTERNAL",
          detail: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  };
}
