// Per-session controller: owns the emulator, the reconnecting output stream,
// and resize plumbing for ONE terminal tab. Framework-agnostic and mutable — a
// React component subscribes via useSyncExternalStore and re-reads
// emulator.snapshot() on each bumped version. Controllers outlive view switches
// (the Terminal view is keepAlive), so scrollback survives navigation.

import { TerminalEmulator } from "./emulator.ts";
import {
  connectStream,
  resizeSession,
  sendInput,
  killSession,
  type PtySessionSummary,
  type StreamDispose,
} from "./pty-client.ts";

type Listener = () => void;

export class TerminalController {
  readonly id: string;
  summary: PtySessionSummary;
  emulator: TerminalEmulator;
  alive: boolean;
  exitCode: number | null = null;
  signal: string | null = null;
  /** True once the reconnecting stream is temporarily down. */
  disconnected = false;

  private version = 0;
  private listeners = new Set<Listener>();
  private rafHandle: number | null = null;
  private disposeStream: StreamDispose | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSentCols: number;
  private lastSentRows: number;

  constructor(summary: PtySessionSummary) {
    this.id = summary.id;
    this.summary = summary;
    this.alive = summary.alive;
    this.exitCode = summary.exitCode;
    this.signal = summary.signal;
    this.emulator = new TerminalEmulator(summary.cols || 80, summary.rows || 24);
    this.lastSentCols = summary.cols || 80;
    this.lastSentRows = summary.rows || 24;
    this.connect();
  }

  private connect(): void {
    this.disposeStream = connectStream(this.id, {
      onReset: () => {
        // Fresh connection → server replays full scrollback. Rebuild the
        // emulator so replay is not stacked on top of stale content.
        this.emulator = new TerminalEmulator(this.emulator.cols, this.emulator.rows);
        this.disconnected = false;
        this.scheduleNotify();
      },
      onOutput: (bytes) => {
        this.emulator.write(bytes);
        this.scheduleNotify();
      },
      onReady: (summary) => {
        this.summary = summary;
        this.alive = summary.alive;
        this.scheduleNotify();
      },
      onExit: (code, sig) => {
        this.alive = false;
        this.exitCode = code;
        this.signal = sig;
        this.disconnected = false;
        this.scheduleNotify();
      },
      onDisconnect: () => {
        this.disconnected = true;
        this.scheduleNotify();
      },
    });
  }

  // ── React store interface ────────────────────────────────────────────────────

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private scheduleNotify(): void {
    if (this.rafHandle !== null) return;
    const flush = () => {
      this.rafHandle = null;
      this.version++;
      for (const l of this.listeners) l();
    };
    if (typeof requestAnimationFrame === "function") this.rafHandle = requestAnimationFrame(flush);
    else this.rafHandle = setTimeout(flush, 16) as unknown as number;
  }

  // ── input / resize ───────────────────────────────────────────────────────────

  write(data: string): void {
    if (!this.alive) return;
    void sendInput(this.id, data).catch(() => {
      /* a dead pty surfaces via the exit frame; nothing to do here */
    });
  }

  resize(cols: number, rows: number): void {
    if (cols < 1 || rows < 1) return;
    this.emulator.resize(cols, rows);
    this.scheduleNotify();
    if (cols === this.lastSentCols && rows === this.lastSentRows) return;
    this.lastSentCols = cols;
    this.lastSentRows = rows;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      if (this.alive) void resizeSession(this.id, cols, rows).catch(() => {});
    }, 80);
  }

  /** Terminate the server-side child (SIGHUP → SIGKILL). */
  async kill(): Promise<void> {
    await killSession(this.id);
  }

  /** Detach the stream (does NOT kill the child). Called when the tab/view unmounts. */
  dispose(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    if (this.rafHandle !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.rafHandle);
      else clearTimeout(this.rafHandle);
    }
    this.disposeStream?.();
    this.disposeStream = null;
  }
}
