// App-local chat stores + transcript export. FEATURES.md §1 marks these rows
// app-local; the parity matrix names ~/.goodvibes/app/*.json files for
// bookmarks/input-history, but no /app registry route exists for them yet, so
// they persist to localStorage behind the same read/write API — the store can
// be re-pointed at /app routes later without touching callers. Honest
// deviation, noted in the view header.
//
// /note (below) is the one exception: it writes through the REAL
// /app/registries/notes collection (the same one docs/views/documents/
// documents-data.ts uses for blind-compare judgments), tagged "chat-note",
// so a saved note is a real superset-tolerant registry record — not another
// localStorage-only store — and shows up in Documents → Packets & notes.

import { appJson } from "../../lib/http.ts";
import { asRecord } from "../../lib/wire.ts";
import { messageAttachments, messageText, messageTimestamp, messageTone, bestId } from "./message-utils.ts";
import { attachmentLabel } from "./message-utils.ts";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort local store.
  }
}

// ─── Input history (ArrowUp/Down recall + Ctrl+R reverse search) ─────────────

const INPUT_HISTORY_KEY = "goodvibes.app.chat.inputHistory";
const MAX_INPUT_HISTORY = 200;

export function readInputHistory(): string[] {
  const parsed = readJson<unknown>(INPUT_HISTORY_KEY, []);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
}

export function pushInputHistory(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const history = readInputHistory().filter((entry) => entry !== trimmed);
  history.push(trimmed);
  writeJson(INPUT_HISTORY_KEY, history.slice(-MAX_INPUT_HISTORY));
}

// ─── Prompt templates ────────────────────────────────────────────────────────

const TEMPLATES_KEY = "goodvibes.app.chat.templates";

export interface PromptTemplate {
  name: string;
  text: string;
  updatedAt: number;
}

export function readTemplates(): PromptTemplate[] {
  const parsed = readJson<unknown>(TEMPLATES_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => {
      const record = asRecord(entry);
      return typeof record["name"] === "string" && typeof record["text"] === "string"
        ? { name: record["name"], text: record["text"], updatedAt: Number(record["updatedAt"]) || 0 }
        : null;
    })
    .filter((entry): entry is PromptTemplate => entry !== null);
}

export function saveTemplate(name: string, text: string): void {
  const templates = readTemplates().filter((t) => t.name !== name);
  templates.push({ name, text, updatedAt: Date.now() });
  writeJson(TEMPLATES_KEY, templates);
}

export function deleteTemplate(name: string): void {
  writeJson(TEMPLATES_KEY, readTemplates().filter((t) => t.name !== name));
}

// ─── Bookmarks (per-session add/list/jump) ───────────────────────────────────

const BOOKMARKS_KEY = "goodvibes.app.chat.bookmarks";

export interface ChatBookmark {
  sessionId: string;
  messageId: string;
  snippet: string;
  createdAt: number;
}

export function readBookmarks(sessionId?: string): ChatBookmark[] {
  const parsed = readJson<unknown>(BOOKMARKS_KEY, []);
  if (!Array.isArray(parsed)) return [];
  const bookmarks = parsed
    .map((entry) => {
      const record = asRecord(entry);
      return typeof record["sessionId"] === "string" && typeof record["messageId"] === "string"
        ? {
            sessionId: record["sessionId"],
            messageId: record["messageId"],
            snippet: typeof record["snippet"] === "string" ? record["snippet"] : "",
            createdAt: Number(record["createdAt"]) || 0,
          }
        : null;
    })
    .filter((entry): entry is ChatBookmark => entry !== null);
  return sessionId ? bookmarks.filter((b) => b.sessionId === sessionId) : bookmarks;
}

export function toggleBookmark(sessionId: string, messageId: string, snippet: string): boolean {
  const all = readBookmarks();
  const existing = all.findIndex((b) => b.sessionId === sessionId && b.messageId === messageId);
  if (existing >= 0) {
    all.splice(existing, 1);
    writeJson(BOOKMARKS_KEY, all);
    return false;
  }
  all.push({ sessionId, messageId, snippet: snippet.slice(0, 120), createdAt: Date.now() });
  writeJson(BOOKMARKS_KEY, all);
  return true;
}

// ─── Composer draft (per session; survives an app restart, not just a view
// switch inside the keep-alive chat tree — friction checklist item 1) ────────

const DRAFTS_KEY = "goodvibes.app.chat.drafts";
const MAX_DRAFTS = 50;
const NEW_CHAT_DRAFT_KEY = "__new__";

function readDraftMap(): Record<string, string> {
  const parsed = readJson<unknown>(DRAFTS_KEY, {});
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
}

/** Read the composer draft saved for a session ("" reads the not-yet-created
 * new-chat draft). */
export function readDraft(sessionId: string): string {
  return readDraftMap()[sessionId || NEW_CHAT_DRAFT_KEY] ?? "";
}

/** Save (or, for empty text, clear) the composer draft for a session.
 * Bounded to MAX_DRAFTS entries (checklist item 14: no unbounded growth) —
 * the oldest-touched entry is evicted first once the cap is exceeded. */
export function writeDraft(sessionId: string, text: string): void {
  const key = sessionId || NEW_CHAT_DRAFT_KEY;
  const map = readDraftMap();
  delete map[key]; // drop-then-reinsert so this key counts as most-recently-touched
  if (text) map[key] = text;
  const bounded = Object.fromEntries(Object.entries(map).slice(-MAX_DRAFTS));
  writeJson(DRAFTS_KEY, bounded);
}

// ─── Display prefs ───────────────────────────────────────────────────────────

const LINE_NUMBERS_KEY = "goodvibes.app.chat.lineNumbers";
const COLLAPSE_THRESHOLD_KEY = "goodvibes.app.chat.collapseThreshold";
const ALWAYS_SPEAK_KEY = "goodvibes.app.chat.alwaysSpeak";

export function readLineNumbersPref(): boolean {
  return storage()?.getItem(LINE_NUMBERS_KEY) === "on";
}

export function writeLineNumbersPref(on: boolean): void {
  storage()?.setItem(LINE_NUMBERS_KEY, on ? "on" : "off");
}

/** Auto-collapse threshold in transcript lines (display.collapseThreshold). */
export function readCollapseThreshold(): number {
  const value = Number(storage()?.getItem(COLLAPSE_THRESHOLD_KEY));
  return Number.isFinite(value) && value > 0 ? value : 60;
}

export function readAlwaysSpeakPref(): boolean {
  return storage()?.getItem(ALWAYS_SPEAK_KEY) === "on";
}

export function writeAlwaysSpeakPref(on: boolean): void {
  storage()?.setItem(ALWAYS_SPEAK_KEY, on ? "on" : "off");
}

// ─── Redaction (share with --redact) ─────────────────────────────────────────

/** Secret-shaped masking applied before export — same spirit as the webui
 * config-redaction patterns: named key prefixes, bearer headers, long
 * hex/base64 runs. Conservative on purpose: better to over-mask an export. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, "[redacted-key]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted-token]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted-token]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-aws-key]")
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})\b/g, "[redacted-jwt]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[redacted]")
    .replace(/\b[0-9a-f]{40,}\b/gi, "[redacted-hex]")
    .replace(/((?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*)\S+/gi, "$1[redacted]");
}

// ─── Transcript export (md / json / html) ────────────────────────────────────

export type ExportFormat = "md" | "json" | "html";

function escapeHtmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildTranscriptExport(
  title: string,
  messages: unknown[],
  format: ExportFormat,
  redact: boolean,
): { filename: string; mimeType: string; content: string } {
  const mask = (text: string) => (redact ? redactSecrets(text) : text);
  const safeName = (title || "chat").replace(/[^\w.-]+/g, "-").slice(0, 60) || "chat";

  if (format === "json") {
    const payload = messages.map((message) => ({
      id: bestId(message),
      role: messageTone(message),
      content: mask(messageText(message)),
      attachments: messageAttachments(message).map((a) => attachmentLabel(a)),
      timestamp: messageTimestamp(message),
    }));
    return {
      filename: `${safeName}.json`,
      mimeType: "application/json",
      content: JSON.stringify({ title, exportedAt: new Date().toISOString(), redacted: redact, messages: payload }, null, 2),
    };
  }

  if (format === "html") {
    const body = messages
      .map((message) => {
        const tone = messageTone(message);
        const text = escapeHtmlText(mask(messageText(message)));
        return `<section class="${tone}"><h4>${tone}</h4><pre>${text}</pre></section>`;
      })
      .join("\n");
    return {
      filename: `${safeName}.html`,
      mimeType: "text/html",
      content: `<!doctype html><meta charset="utf-8"><title>${escapeHtmlText(title)}</title><style>body{font:14px/1.5 sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem}section{margin:1rem 0;padding:.75rem;border:1px solid #ccc;border-radius:8px}section.user{background:#eef}h4{margin:0 0 .5rem;text-transform:capitalize}pre{white-space:pre-wrap;margin:0}</style><h1>${escapeHtmlText(title)}</h1>\n${body}`,
    };
  }

  const md = messages
    .map((message) => {
      const tone = messageTone(message);
      const speaker = tone === "user" ? "You" : tone === "assistant" ? "Assistant" : tone;
      const attachments = messageAttachments(message).map((a) => `- 📎 ${attachmentLabel(a)}`).join("\n");
      return `## ${speaker}\n\n${mask(messageText(message))}${attachments ? `\n\n${attachments}` : ""}`;
    })
    .join("\n\n---\n\n");
  return {
    filename: `${safeName}.md`,
    mimeType: "text/markdown",
    content: `# ${title}\n\n${md}\n`,
  };
}

/** Trigger a browser download of generated content (no native dialog needed). */
export function downloadContent(filename: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

// ─── /note: save to the app-local notes registry ─────────────────────────────

const NOTES_BASE = "/app/registries/notes";
export const CHAT_NOTE_TAG = "chat-note";

export interface SavedChatNote {
  id: string;
}

/** Saves free text (the /note argument, or a selection/draft the caller
 * already extracted) as a "chat-note"-tagged item in the same /app/registries
 * "notes" collection Documents reads (Documents → Packets & notes lists
 * every tag). Returns the new item's id so the caller can offer a jump link. */
export async function saveChatNote(
  text: string,
  meta: { sessionId?: string; sessionTitle?: string },
): Promise<SavedChatNote> {
  const res = await appJson<unknown>(NOTES_BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      item: {
        tag: CHAT_NOTE_TAG,
        text,
        ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
        ...(meta.sessionTitle ? { sessionTitle: meta.sessionTitle } : {}),
        createdAt: Date.now(),
      },
    }),
  });
  const item = asRecord(asRecord(res)["item"]);
  return { id: typeof item["id"] === "string" ? item["id"] : "" };
}

// ─── Long-turn desktop notification (docs/UX.md §4) ──────────────────────────
//
// lib/notify-bridge.ts only watches the "approvals" and "tasks" query-cache
// keys (verified: src/ui/lib/notify-bridge.ts has no chat/companion-chat
// handling) — companion-chat turns are invisible to it, so this is NOT a
// duplicate of an existing feature. useChatStream.ts's onTurnCompleted hook
// is the documented seam for this ("long-turn notification ... hooks live in
// the view"); this helper decides whether the moment qualifies, and the view
// does the metadata-only POST, matching the bridge's own privacy rule (title
// + viewId, never message content).

export const LONG_TURN_NOTIFY_MS = 60_000;

export function shouldNotifyLongTurn(elapsedMs: number): boolean {
  return elapsedMs >= LONG_TURN_NOTIFY_MS && typeof document !== "undefined" && document.hidden;
}
