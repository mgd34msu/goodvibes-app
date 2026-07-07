// Compact ANSI/VT terminal emulator — a deliberately REDUCED implementation
// (docs/FEATURES.md §15). It is not a full vt100: it covers the sequences an
// interactive shell and common tools actually emit — printable text with
// auto-wrap, CR/LF/BS/TAB, SGR colors (16 / 256 / truecolor, bold/dim/underline/
// inverse), cursor addressing (CUP/CUU/CUD/CUF/CUB/CHA/VPA), erase display/line,
// insert/delete lines & chars, scroll region, save/restore cursor, alt-screen
// (?1049/?47), and OSC 0/2 window titles. Full-screen curses apps (vim, htop)
// render approximately. The UI captions this honestly.
//
// Model: a `screen` of exactly `rows` lines plus a bounded `scrollback` of lines
// that scrolled off the top of the MAIN buffer. The alt buffer never feeds
// scrollback. Rendering = scrollback ++ screen (or just the alt screen).

export interface Cell {
  ch: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  underline: boolean;
  inverse: boolean;
}

export interface Run {
  text: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  underline: boolean;
  inverse: boolean;
  cursor: boolean;
}

export interface Snapshot {
  /** Lines to render top-to-bottom, each already coalesced into style runs. */
  lines: Run[][];
  title: string;
  /** True while the cursor should blink (visible + on main/alt screen bottom). */
  cursorVisible: boolean;
}

const SCROLLBACK_MAX = 5000;

// 16 base ANSI colors (xterm defaults).
const ANSI_16 = [
  "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
  "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
];

function color256(n: number): string {
  if (n < 16) return ANSI_16[n] ?? "#ffffff";
  if (n < 232) {
    const i = n - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const conv = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${conv(r)},${conv(g)},${conv(b)})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

function blankCell(): Cell {
  return { ch: " ", fg: null, bg: null, bold: false, dim: false, underline: false, inverse: false };
}

function blankRow(cols: number): Cell[] {
  const row: Cell[] = new Array(cols);
  for (let i = 0; i < cols; i++) row[i] = blankCell();
  return row;
}

interface Attrs {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  underline: boolean;
  inverse: boolean;
}

export class TerminalEmulator {
  cols: number;
  rows: number;
  private screen: Cell[][];
  private scrollback: Cell[][] = [];
  private cursorX = 0;
  private cursorY = 0;
  private attrs: Attrs = { fg: null, bg: null, bold: false, dim: false, underline: false, inverse: false };
  private savedCursor: { x: number; y: number; attrs: Attrs } | null = null;

  // Scroll region (0-based inclusive), defaults to full screen.
  private scrollTop = 0;
  private scrollBottom: number;

  // Alt screen bookkeeping.
  private altActive = false;
  private savedMain: { screen: Cell[][]; x: number; y: number } | null = null;

  private cursorShown = true;
  title = "";

  // Parser state.
  private decoder = new TextDecoder("utf-8", { fatal: false });
  private pending = ""; // partial escape sequence carried across writes
  private wrapPending = false; // deferred auto-wrap (vt behavior)

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.scrollBottom = this.rows - 1;
    this.screen = Array.from({ length: this.rows }, () => blankRow(this.cols));
  }

  // ── public API ─────────────────────────────────────────────────────────────

  write(bytes: Uint8Array): void {
    const text = this.pending + this.decoder.decode(bytes, { stream: true });
    this.pending = "";
    let i = 0;
    while (i < text.length) {
      const ch = text[i]!;
      const code = ch.charCodeAt(0);
      if (code === 0x1b) {
        const consumed = this.parseEscape(text, i);
        if (consumed === -1) {
          // Incomplete sequence — stash the tail for the next write.
          this.pending = text.slice(i);
          return;
        }
        i = consumed;
        continue;
      }
      if (code < 0x20) {
        this.control(code);
        i++;
        continue;
      }
      this.putChar(ch);
      i++;
    }
  }

  resize(cols: number, rows: number): void {
    cols = Math.max(1, cols);
    rows = Math.max(1, rows);
    if (cols === this.cols && rows === this.rows) return;
    const resizeGrid = (grid: Cell[][]): Cell[][] => {
      const next = grid.slice(-rows).map((row) => {
        const r = row.slice(0, cols);
        while (r.length < cols) r.push(blankCell());
        return r;
      });
      while (next.length < rows) next.push(blankRow(cols));
      return next;
    };
    this.screen = resizeGrid(this.screen);
    if (this.savedMain) this.savedMain.screen = resizeGrid(this.savedMain.screen);
    this.cols = cols;
    this.rows = rows;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this.cursorX = Math.min(this.cursorX, cols - 1);
    this.cursorY = Math.min(this.cursorY, rows - 1);
    this.wrapPending = false;
  }

  snapshot(): Snapshot {
    const lines: Run[][] = [];
    if (!this.altActive) {
      for (const row of this.scrollback) lines.push(coalesce(row, -1, false));
    }
    const cursorRowInScreen = this.cursorY;
    for (let y = 0; y < this.screen.length; y++) {
      const showCursor = this.cursorShown && y === cursorRowInScreen;
      lines.push(coalesce(this.screen[y]!, showCursor ? this.cursorX : -1, showCursor));
    }
    return { lines, title: this.title, cursorVisible: this.cursorShown };
  }

  // ── control characters ──────────────────────────────────────────────────────

  private control(code: number): void {
    switch (code) {
      case 0x0d: // CR
        this.cursorX = 0;
        this.wrapPending = false;
        break;
      case 0x0a: // LF
      case 0x0b: // VT
      case 0x0c: // FF
        this.lineFeed();
        break;
      case 0x08: // BS
        if (this.wrapPending) this.wrapPending = false;
        else if (this.cursorX > 0) this.cursorX--;
        break;
      case 0x09: { // TAB → next multiple of 8
        const next = Math.min(this.cols - 1, (Math.floor(this.cursorX / 8) + 1) * 8);
        this.cursorX = next;
        break;
      }
      // 0x07 BEL and others: ignore.
      default:
        break;
    }
  }

  private lineFeed(): void {
    this.wrapPending = false;
    if (this.cursorY === this.scrollBottom) {
      this.scrollUp(1);
    } else if (this.cursorY < this.rows - 1) {
      this.cursorY++;
    }
  }

  private putChar(ch: string): void {
    if (this.wrapPending) {
      this.cursorX = 0;
      this.lineFeed();
      this.wrapPending = false;
    }
    const row = this.screen[this.cursorY]!;
    row[this.cursorX] = {
      ch,
      fg: this.attrs.fg,
      bg: this.attrs.bg,
      bold: this.attrs.bold,
      dim: this.attrs.dim,
      underline: this.attrs.underline,
      inverse: this.attrs.inverse,
    };
    if (this.cursorX === this.cols - 1) {
      this.wrapPending = true; // defer wrap until the next printable char
    } else {
      this.cursorX++;
    }
  }

  // ── escape sequences ─────────────────────────────────────────────────────────

  /** Returns the index just past the sequence, or -1 if more input is needed. */
  private parseEscape(text: string, start: number): number {
    if (start + 1 >= text.length) return -1;
    const kind = text[start + 1]!;
    if (kind === "[") return this.parseCsi(text, start);
    if (kind === "]") return this.parseOsc(text, start);
    if (kind === "(" || kind === ")" || kind === "*" || kind === "+") {
      // Charset designation — consume selector byte, ignore.
      if (start + 2 >= text.length) return -1;
      return start + 3;
    }
    switch (kind) {
      case "M": // Reverse Index — scroll down if at top
        if (this.cursorY === this.scrollTop) this.scrollDown(1);
        else if (this.cursorY > 0) this.cursorY--;
        return start + 2;
      case "7":
        this.savedCursor = { x: this.cursorX, y: this.cursorY, attrs: { ...this.attrs } };
        return start + 2;
      case "8":
        if (this.savedCursor) {
          this.cursorX = this.savedCursor.x;
          this.cursorY = this.savedCursor.y;
          this.attrs = { ...this.savedCursor.attrs };
        }
        return start + 2;
      case "=":
      case ">":
      case "c": // reset — treat leniently
        return start + 2;
      default:
        return start + 2; // unknown 2-byte escape: skip
    }
  }

  private parseCsi(text: string, start: number): number {
    // ESC [ <params> <intermediate> <final 0x40-0x7e>
    let i = start + 2;
    let raw = "";
    while (i < text.length) {
      const c = text[i]!;
      const code = c.charCodeAt(0);
      if (code >= 0x40 && code <= 0x7e) {
        this.dispatchCsi(raw, c);
        return i + 1;
      }
      raw += c;
      i++;
    }
    return -1; // incomplete
  }

  private parseOsc(text: string, start: number): number {
    // ESC ] <text> (BEL | ESC \)
    let i = start + 2;
    let body = "";
    while (i < text.length) {
      const c = text[i]!;
      if (c === "\x07") {
        this.handleOsc(body);
        return i + 1;
      }
      if (c === "\x1b" && text[i + 1] === "\\") {
        this.handleOsc(body);
        return i + 2;
      }
      if (c === "\x1b" && i + 1 >= text.length) return -1;
      body += c;
      i++;
    }
    return -1;
  }

  private handleOsc(body: string): void {
    // 0 = icon+title, 2 = title.
    const sep = body.indexOf(";");
    if (sep === -1) return;
    const code = body.slice(0, sep);
    if (code === "0" || code === "2") this.title = body.slice(sep + 1);
  }

  private dispatchCsi(raw: string, final: string): void {
    const priv = raw.startsWith("?");
    const body = priv ? raw.slice(1) : raw;
    const params = body.split(";").map((p) => (p === "" ? NaN : parseInt(p, 10)));
    const p = (idx: number, def: number): number => {
      const v = params[idx];
      return v === undefined || Number.isNaN(v) ? def : v;
    };

    if (priv && (final === "h" || final === "l")) {
      this.privateMode(params, final === "h");
      return;
    }

    switch (final) {
      case "A": this.moveCursor(0, -p(0, 1)); break;
      case "B": this.moveCursor(0, p(0, 1)); break;
      case "C": this.moveCursor(p(0, 1), 0); break;
      case "D": this.moveCursor(-p(0, 1), 0); break;
      case "E": this.cursorX = 0; this.moveCursor(0, p(0, 1)); break;
      case "F": this.cursorX = 0; this.moveCursor(0, -p(0, 1)); break;
      case "G": this.cursorX = clamp(p(0, 1) - 1, 0, this.cols - 1); this.wrapPending = false; break;
      case "d": this.cursorY = clamp(p(0, 1) - 1, 0, this.rows - 1); break;
      case "H":
      case "f":
        this.cursorY = clamp(p(0, 1) - 1, 0, this.rows - 1);
        this.cursorX = clamp(p(1, 1) - 1, 0, this.cols - 1);
        this.wrapPending = false;
        break;
      case "J": this.eraseDisplay(p(0, 0)); break;
      case "K": this.eraseLine(p(0, 0)); break;
      case "m": this.sgr(params); break;
      case "L": this.insertLines(p(0, 1)); break;
      case "M": this.deleteLines(p(0, 1)); break;
      case "P": this.deleteChars(p(0, 1)); break;
      case "@": this.insertChars(p(0, 1)); break;
      case "X": this.eraseChars(p(0, 1)); break;
      case "S": this.scrollUp(p(0, 1)); break;
      case "T": this.scrollDown(p(0, 1)); break;
      case "r":
        this.scrollTop = clamp(p(0, 1) - 1, 0, this.rows - 1);
        this.scrollBottom = clamp(p(1, this.rows) - 1, 0, this.rows - 1);
        if (this.scrollBottom < this.scrollTop) this.scrollBottom = this.scrollTop;
        this.cursorX = 0;
        this.cursorY = this.scrollTop;
        break;
      case "s": this.savedCursor = { x: this.cursorX, y: this.cursorY, attrs: { ...this.attrs } }; break;
      case "u":
        if (this.savedCursor) { this.cursorX = this.savedCursor.x; this.cursorY = this.savedCursor.y; this.attrs = { ...this.savedCursor.attrs }; }
        break;
      // h/l without ? (ANSI modes) and others: ignore.
      default: break;
    }
  }

  private privateMode(params: number[], set: boolean): void {
    for (const code of params) {
      switch (code) {
        case 25: this.cursorShown = set; break;
        case 47:
        case 1047:
        case 1049:
          this.setAltScreen(set);
          break;
        // 2004 bracketed paste, 1000-1006 mouse, 1 app-cursor: no-ops here.
        default: break;
      }
    }
  }

  private setAltScreen(enter: boolean): void {
    if (enter && !this.altActive) {
      this.savedMain = { screen: this.screen, x: this.cursorX, y: this.cursorY };
      this.screen = Array.from({ length: this.rows }, () => blankRow(this.cols));
      this.altActive = true;
      this.cursorX = 0;
      this.cursorY = 0;
      this.scrollTop = 0;
      this.scrollBottom = this.rows - 1;
    } else if (!enter && this.altActive && this.savedMain) {
      this.screen = this.savedMain.screen;
      this.cursorX = this.savedMain.x;
      this.cursorY = this.savedMain.y;
      this.savedMain = null;
      this.altActive = false;
      this.scrollTop = 0;
      this.scrollBottom = this.rows - 1;
    }
  }

  // ── movement + scrolling ──────────────────────────────────────────────────────

  private moveCursor(dx: number, dy: number): void {
    this.cursorX = clamp(this.cursorX + dx, 0, this.cols - 1);
    this.cursorY = clamp(this.cursorY + dy, 0, this.rows - 1);
    this.wrapPending = false;
  }

  private scrollUp(n: number): void {
    for (let k = 0; k < n; k++) {
      const line = this.screen[this.scrollTop]!;
      // Only the main buffer, scrolling from the very top, feeds scrollback.
      if (!this.altActive && this.scrollTop === 0) {
        this.scrollback.push(line);
        if (this.scrollback.length > SCROLLBACK_MAX) this.scrollback.shift();
      }
      this.screen.splice(this.scrollTop, 1);
      this.screen.splice(this.scrollBottom, 0, blankRow(this.cols));
    }
  }

  private scrollDown(n: number): void {
    for (let k = 0; k < n; k++) {
      this.screen.splice(this.scrollBottom, 1);
      this.screen.splice(this.scrollTop, 0, blankRow(this.cols));
    }
  }

  private insertLines(n: number): void {
    if (this.cursorY < this.scrollTop || this.cursorY > this.scrollBottom) return;
    for (let k = 0; k < n; k++) {
      this.screen.splice(this.scrollBottom, 1);
      this.screen.splice(this.cursorY, 0, blankRow(this.cols));
    }
  }

  private deleteLines(n: number): void {
    if (this.cursorY < this.scrollTop || this.cursorY > this.scrollBottom) return;
    for (let k = 0; k < n; k++) {
      this.screen.splice(this.cursorY, 1);
      this.screen.splice(this.scrollBottom, 0, blankRow(this.cols));
    }
  }

  private insertChars(n: number): void {
    const row = this.screen[this.cursorY]!;
    for (let k = 0; k < n; k++) {
      row.splice(this.cols - 1, 1);
      row.splice(this.cursorX, 0, blankCell());
    }
  }

  private deleteChars(n: number): void {
    const row = this.screen[this.cursorY]!;
    for (let k = 0; k < n; k++) {
      row.splice(this.cursorX, 1);
      row.push(blankCell());
    }
  }

  private eraseChars(n: number): void {
    const row = this.screen[this.cursorY]!;
    for (let k = 0; k < n && this.cursorX + k < this.cols; k++) row[this.cursorX + k] = blankCell();
  }

  private eraseDisplay(mode: number): void {
    if (mode === 0) {
      this.eraseLine(0);
      for (let y = this.cursorY + 1; y < this.rows; y++) this.screen[y] = blankRow(this.cols);
    } else if (mode === 1) {
      this.eraseLine(1);
      for (let y = 0; y < this.cursorY; y++) this.screen[y] = blankRow(this.cols);
    } else {
      for (let y = 0; y < this.rows; y++) this.screen[y] = blankRow(this.cols);
      if (mode === 3) this.scrollback = [];
    }
  }

  private eraseLine(mode: number): void {
    const row = this.screen[this.cursorY]!;
    if (mode === 0) for (let x = this.cursorX; x < this.cols; x++) row[x] = blankCell();
    else if (mode === 1) for (let x = 0; x <= this.cursorX && x < this.cols; x++) row[x] = blankCell();
    else for (let x = 0; x < this.cols; x++) row[x] = blankCell();
  }

  private sgr(params: number[]): void {
    if (params.length === 0 || (params.length === 1 && Number.isNaN(params[0]))) {
      this.attrs = { fg: null, bg: null, bold: false, dim: false, underline: false, inverse: false };
      return;
    }
    for (let i = 0; i < params.length; i++) {
      const code = Number.isNaN(params[i]) ? 0 : params[i]!;
      if (code === 0) this.attrs = { fg: null, bg: null, bold: false, dim: false, underline: false, inverse: false };
      else if (code === 1) this.attrs.bold = true;
      else if (code === 2) this.attrs.dim = true;
      else if (code === 4) this.attrs.underline = true;
      else if (code === 7) this.attrs.inverse = true;
      else if (code === 22) { this.attrs.bold = false; this.attrs.dim = false; }
      else if (code === 24) this.attrs.underline = false;
      else if (code === 27) this.attrs.inverse = false;
      else if (code === 39) this.attrs.fg = null;
      else if (code === 49) this.attrs.bg = null;
      else if (code >= 30 && code <= 37) this.attrs.fg = ANSI_16[code - 30] ?? null;
      else if (code >= 90 && code <= 97) this.attrs.fg = ANSI_16[code - 90 + 8] ?? null;
      else if (code >= 40 && code <= 47) this.attrs.bg = ANSI_16[code - 40] ?? null;
      else if (code >= 100 && code <= 107) this.attrs.bg = ANSI_16[code - 100 + 8] ?? null;
      else if (code === 38 || code === 48) {
        const mode = params[i + 1];
        if (mode === 5) {
          const n = params[i + 2] ?? 0;
          const col = color256(Number.isNaN(n) ? 0 : n);
          if (code === 38) this.attrs.fg = col; else this.attrs.bg = col;
          i += 2;
        } else if (mode === 2) {
          const r = params[i + 2] ?? 0, g = params[i + 3] ?? 0, b = params[i + 4] ?? 0;
          const col = `rgb(${r || 0},${g || 0},${b || 0})`;
          if (code === 38) this.attrs.fg = col; else this.attrs.bg = col;
          i += 4;
        }
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Coalesce a cell row into styled runs, marking the cursor cell if cursorX >= 0. */
function coalesce(row: Cell[], cursorX: number, _cursor: boolean): Run[] {
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let x = 0; x < row.length; x++) {
    const cell = row[x]!;
    const isCursor = x === cursorX;
    if (
      cur &&
      !isCursor &&
      !cur.cursor &&
      cur.fg === cell.fg &&
      cur.bg === cell.bg &&
      cur.bold === cell.bold &&
      cur.dim === cell.dim &&
      cur.underline === cell.underline &&
      cur.inverse === cell.inverse
    ) {
      cur.text += cell.ch;
    } else {
      cur = {
        text: cell.ch,
        fg: cell.fg,
        bg: cell.bg,
        bold: cell.bold,
        dim: cell.dim,
        underline: cell.underline,
        inverse: cell.inverse,
        cursor: isCursor,
      };
      runs.push(cur);
    }
  }
  // Trim trailing blank default run for compactness (keeps DOM small).
  while (runs.length > 1) {
    const last = runs[runs.length - 1]!;
    if (!last.cursor && last.fg === null && last.bg === null && !last.underline && !last.inverse && last.text.trim() === "") {
      runs.pop();
    } else break;
  }
  return runs;
}
