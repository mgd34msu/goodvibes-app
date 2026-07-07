// Renders one TerminalController: the emulator grid as styled DOM lines, plus
// keyboard capture (incl. Ctrl+C passthrough), paste, click-to-focus, and
// size measurement that drives PTY resize. Reduced emulation — see emulator.ts.

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { TerminalController } from "./terminal-controller.ts";
import type { Run } from "./emulator.ts";

// Cap the DOM at a generous tail of the scrollback so heavy output never
// balloons the node count. The server keeps ~2 MB of scrollback for reattach;
// this only bounds what is mounted at once.
const MAX_RENDER_LINES = 2000;

interface TerminalScreenProps {
  controller: TerminalController;
  /** Whether this tab is the visible one (drives focus + measurement). */
  active: boolean;
}

export function TerminalScreen({ controller, active }: TerminalScreenProps): React.ReactElement {
  const version = useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  const scrollRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const cellRef = useRef<{ w: number; h: number }>({ w: 8, h: 16 });
  const stickBottomRef = useRef(true);

  // ── size measurement → resize ────────────────────────────────────────────────
  const remeasure = useCallback(() => {
    const scroller = scrollRef.current;
    const probe = measureRef.current;
    if (!scroller || !probe) return;
    const rect = probe.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      cellRef.current = { w: rect.width / 10, h: rect.height };
    }
    const { w, h } = cellRef.current;
    const cols = Math.max(2, Math.floor(scroller.clientWidth / w));
    const rows = Math.max(1, Math.floor(scroller.clientHeight / h));
    if (scroller.clientWidth > 0 && scroller.clientHeight > 0) {
      controller.resize(cols, rows);
    }
  }, [controller]);

  useLayoutEffect(() => {
    if (!active) return;
    remeasure();
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => remeasure());
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [active, remeasure]);

  // Focus the surface when this tab becomes active.
  useEffect(() => {
    if (active) scrollRef.current?.focus();
  }, [active]);

  // ── autoscroll: stick to the bottom unless the user scrolled up ──────────────
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (stickBottomRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [version]);

  const onScroll = useCallback(() => {
    const s = scrollRef.current;
    if (!s) return;
    stickBottomRef.current = s.scrollHeight - s.scrollTop - s.clientHeight < 24;
  }, []);

  // ── keyboard ─────────────────────────────────────────────────────────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Let the global command palette (Ctrl/Cmd+K) win even while the terminal
      // is focused — it is the one app shortcut we deliberately do NOT capture.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) return;
      // Allow copy/paste of a real selection; never swallow those.
      if (e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c")) return;
      if (e.ctrlKey && e.shiftKey && (e.key === "V" || e.key === "v")) return; // paste via onPaste
      const bytes = keyToBytes(e);
      if (bytes === null) return; // unmapped: let it bubble to global hotkeys
      e.preventDefault();
      // The terminal owns this key: stop it reaching the document-level hotkey
      // handler so navigation chords (g c) and other shortcuts don't fire while
      // typing. React's stopPropagation halts the native bubble at the root.
      e.stopPropagation();
      stickBottomRef.current = true;
      controller.write(bytes);
    },
    [controller],
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData("text");
      if (text) {
        e.preventDefault();
        stickBottomRef.current = true;
        // Bracketed-paste-safe: send raw; the shell brackets it if it enabled ?2004.
        controller.write(text);
      }
    },
    [controller],
  );

  const snap = controller.emulator.snapshot();
  const lines = snap.lines.length > MAX_RENDER_LINES ? snap.lines.slice(-MAX_RENDER_LINES) : snap.lines;
  const focusedClass = active ? "terminal-screen terminal-screen--focusable" : "terminal-screen";

  return (
    <div
      ref={scrollRef}
      className={focusedClass}
      tabIndex={0}
      role="textbox"
      aria-label={`Terminal ${controller.summary.title}`}
      aria-multiline="true"
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onScroll={onScroll}
    >
      {/* hidden probe: 10 chars of the mono font for cell metrics */}
      <span ref={measureRef} className="terminal-measure" aria-hidden="true">
        WWWWWWWWWW
      </span>
      <div className="terminal-grid">
        {lines.map((line, idx) => (
          <TerminalLine key={idx} runs={line} />
        ))}
      </div>
    </div>
  );
}

function TerminalLine({ runs }: { runs: Run[] }): React.ReactElement {
  if (runs.length === 0) return <div className="terminal-line">{" "}</div>;
  return (
    <div className="terminal-line">
      {runs.map((run, i) => {
        let color = run.fg;
        let background = run.bg;
        if (run.inverse) {
          const f = color ?? "var(--term-fg, currentColor)";
          const b = background ?? "var(--term-bg, transparent)";
          color = b;
          background = f;
        }
        const style: React.CSSProperties = {};
        if (color) style.color = color;
        if (background) style.background = background;
        if (run.bold) style.fontWeight = 700;
        if (run.dim) style.opacity = 0.6;
        if (run.underline) style.textDecoration = "underline";
        const cls = run.cursor ? "terminal-cell terminal-cursor" : "terminal-cell";
        return (
          <span key={i} className={cls} style={style}>
            {run.text}
          </span>
        );
      })}
    </div>
  );
}

/** Translate a keydown into the bytes a PTY expects, or null to let the browser handle it. */
function keyToBytes(e: React.KeyboardEvent): string | null {
  const { key } = e;

  // Control combinations first.
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    if (key.length === 1) {
      const lower = key.toLowerCase();
      const cc = lower.charCodeAt(0);
      if (cc >= 97 && cc <= 122) return String.fromCharCode(cc - 96); // Ctrl+A..Z → 0x01..0x1a
      if (key === " ") return "\x00";
      if (key === "[") return "\x1b";
      if (key === "\\") return "\x1c";
      if (key === "]") return "\x1d";
    }
    // fall through for non-letter ctrl combos we don't map
  }

  switch (key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return e.ctrlKey ? "\x17" : "\x7f"; // Ctrl+Backspace → delete word
    case "Tab":
      return "\t";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    case "Insert":
      return "\x1b[2~";
    case "Delete":
      return "\x1b[3~";
    default:
      break;
  }

  // Alt+<char> → ESC prefix (meta).
  if (e.altKey && !e.ctrlKey && !e.metaKey && key.length === 1) return "\x1b" + key;

  // Plain printable character.
  if (!e.ctrlKey && !e.metaKey && !e.altKey && key.length === 1) return key;

  return null;
}
