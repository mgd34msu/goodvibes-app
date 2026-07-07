// /app/notifications — native desktop notifications + routing prefs (Wave D;
// docs/FEATURES.md §24). The route line in app-routes.ts is already wired.
//
// HTTP contract (settings agent codes its prefs UI against this — no cross-imports):
//   GET  /app/notifications/prefs  → { prefs }
//   PUT  /app/notifications/prefs  { prefs } → { prefs }
//   POST /app/notifications/notify { title, body?, viewId? } → { ok, shown, reason? }
//
// Native delivery: `notify-send` via Bun.spawn. electrobun DOES expose
// `Utils.showNotification`, but it returns void with no delivered-signal (so the
// contract's honest `shown` boolean can't be populated) and its Linux FFI backend
// is unverified from static inspection. `notify-send` is guaranteed on Arch
// (verified with `Bun.which`) and Bun.spawn gives a real launch result, so we can
// report `shown` truthfully and fall back to `shown:false` when it is absent.
//
// Prefs persist at ~/.goodvibes/app/settings.json under "notifications" (atomic
// write that preserves other top-level keys, tolerant of a corrupt file). The tray
// "Pause notifications" toggle and this module share the single `enabled` pref, so
// the tray and the settings UI never disagree.

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import type { AppRouteHandler } from "./app-routes.ts";

// ---------------------------------------------------------------------------
// Types + defaults
// ---------------------------------------------------------------------------

export type NotificationBatching = "off" | "30s" | "5m";
export type DomainVerbosity = "all" | "important" | "off";

export interface NotificationPrefs {
  enabled: boolean;
  batching: NotificationBatching;
  quietWhileTyping: boolean;
  perDomain: Record<string, DomainVerbosity>;
}

export interface NotifyRequest {
  title: string;
  body?: string;
  viewId?: string;
}

export interface NotifyResult {
  ok: true;
  shown: boolean;
  reason?: string;
}

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  batching: "off",
  quietWhileTyping: true,
  perDomain: {},
};

const BATCHING_VALUES: ReadonlySet<string> = new Set(["off", "30s", "5m"]);
const VERBOSITY_VALUES: ReadonlySet<string> = new Set(["all", "important", "off"]);

// Only permissions/approval prompts are "important"; everything else is routine
// completion noise. Under a domain set to "important", non-important domains are
// suppressed (see notify()).
const IMPORTANT_DOMAINS: ReadonlySet<string> = new Set(["permissions"]);

// ---------------------------------------------------------------------------
// Storage: ~/.goodvibes/app/settings.json, "notifications" key
// ---------------------------------------------------------------------------

const APP_HOME = process.env["GOODVIBES_APP_HOME"] ?? join(homedir(), ".goodvibes", "app");
const SETTINGS_PATH = join(APP_HOME, "settings.json");

let writeChain: Promise<unknown> = Promise.resolve();
let cachedPrefs: NotificationPrefs = { ...DEFAULT_PREFS, perDomain: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** Read the whole settings.json object. Missing → {}. Corrupt → renamed aside, {}. */
async function readSettings(): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(SETTINGS_PATH, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("settings.json is not a JSON object");
    return parsed;
  } catch (err) {
    const aside = `${SETTINGS_PATH}.corrupt-${Date.now()}`;
    console.warn(
      `[notifications] CORRUPT settings.json at ${SETTINGS_PATH}: ${
        err instanceof Error ? err.message : String(err)
      } — renaming to ${aside} and starting with defaults.`,
    );
    await rename(SETTINGS_PATH, aside).catch(() => undefined);
    return {};
  }
}

function coercePrefs(input: unknown): NotificationPrefs {
  const record = isRecord(input) ? input : {};
  const batching =
    typeof record["batching"] === "string" && BATCHING_VALUES.has(record["batching"])
      ? (record["batching"] as NotificationBatching)
      : DEFAULT_PREFS.batching;
  const perDomainRaw = isRecord(record["perDomain"]) ? record["perDomain"] : {};
  const perDomain: Record<string, DomainVerbosity> = {};
  for (const [key, value] of Object.entries(perDomainRaw)) {
    if (typeof value === "string" && VERBOSITY_VALUES.has(value)) {
      perDomain[key] = value as DomainVerbosity;
    }
  }
  return {
    enabled: typeof record["enabled"] === "boolean" ? record["enabled"] : DEFAULT_PREFS.enabled,
    batching,
    quietWhileTyping:
      typeof record["quietWhileTyping"] === "boolean"
        ? record["quietWhileTyping"]
        : DEFAULT_PREFS.quietWhileTyping,
    perDomain,
  };
}

async function loadPrefs(): Promise<NotificationPrefs> {
  const settings = await readSettings();
  const prefs = coercePrefs(settings["notifications"]);
  cachedPrefs = prefs;
  return prefs;
}

/** Persist prefs under the "notifications" key, preserving every other key. */
async function savePrefs(next: NotificationPrefs): Promise<NotificationPrefs> {
  const prefs = coercePrefs(next);
  const run = writeChain.then(async () => {
    const settings = await readSettings();
    settings["notifications"] = prefs;
    await writeFileAtomic(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
    cachedPrefs = prefs;
    return prefs;
  });
  // Keep the chain alive even if this write rejects, so later writes still run.
  writeChain = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Native delivery via notify-send
// ---------------------------------------------------------------------------

const NOTIFY_SEND: string | null = Bun.which("notify-send");

/** Fire a native notification. Returns false if notify-send is absent or failed to launch. */
function showNative(title: string, body?: string): boolean {
  if (!NOTIFY_SEND) return false;
  try {
    Bun.spawn([NOTIFY_SEND, "--app-name=GoodVibes", "--icon=dialog-information", title, body ?? ""], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return true;
  } catch (err) {
    console.warn(`[notifications] notify-send failed to launch: ${String(err)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Domain routing: derive a domain key from the deep-link viewId
// ---------------------------------------------------------------------------

function domainForViewId(viewId: string | undefined): string {
  switch (viewId) {
    case "approvals":
      return "permissions";
    case "chat":
    case "sessions":
    case "fleet":
      return "turn";
    case "automation":
      return "tasks";
    default:
      return viewId && viewId.length > 0 ? viewId : "general";
  }
}

// ---------------------------------------------------------------------------
// Batching: coalesce notifies inside a window into one summary
// ---------------------------------------------------------------------------

interface PendingNotice {
  title: string;
}

let batchQueue: PendingNotice[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function batchWindowMs(batching: NotificationBatching): number {
  return batching === "5m" ? 5 * 60_000 : 30_000;
}

function enqueueBatched(batching: NotificationBatching, notice: PendingNotice): void {
  batchQueue.push(notice);
  if (batchTimer) return;
  batchTimer = setTimeout(() => {
    const items = batchQueue;
    batchQueue = [];
    batchTimer = null;
    if (items.length === 0) return;
    if (items.length === 1) {
      showNative(items[0]!.title);
    } else {
      showNative("GoodVibes", `${items.length} new updates`);
    }
  }, batchWindowMs(batching));
}

// ---------------------------------------------------------------------------
// notify(): the single decision point (prefs → routing → batching → native)
// ---------------------------------------------------------------------------

export async function notify(req: NotifyRequest): Promise<NotifyResult> {
  const prefs = await loadPrefs();
  if (!prefs.enabled) return { ok: true, shown: false, reason: "notifications paused" };

  const domain = domainForViewId(req.viewId);
  const verbosity = prefs.perDomain[domain] ?? "all";
  if (verbosity === "off") return { ok: true, shown: false, reason: `domain "${domain}" muted` };
  if (verbosity === "important" && !IMPORTANT_DOMAINS.has(domain)) {
    return { ok: true, shown: false, reason: `below "important" threshold for "${domain}"` };
  }

  if (!NOTIFY_SEND) {
    return { ok: true, shown: false, reason: "no desktop notification mechanism (notify-send not found)" };
  }

  if (prefs.batching === "off") {
    const shown = showNative(req.title, req.body);
    return { ok: true, shown, reason: shown ? undefined : "notify-send failed to launch" };
  }

  enqueueBatched(prefs.batching, { title: req.title });
  return { ok: true, shown: true, reason: `queued for ${prefs.batching} batch window` };
}

// ---------------------------------------------------------------------------
// Controller surface for src/bun/index.ts (tray). No electrobun import here;
// the tray owns electrobun and only reads/toggles pause state through this.
// ---------------------------------------------------------------------------

export const notifications = {
  /** Last-known paused state (defaults enabled=true before the first load). */
  isPausedSync(): boolean {
    return !cachedPrefs.enabled;
  },
  /** Prime the cache from disk (call once at boot so the tray menu label is right). */
  async prime(): Promise<void> {
    await loadPrefs();
  },
  /** Flip enabled↔paused, persist, return the new paused state. */
  async togglePaused(): Promise<boolean> {
    const prefs = await loadPrefs();
    const saved = await savePrefs({ ...prefs, enabled: !prefs.enabled });
    return !saved.enabled;
  },
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const PREFIX = "/app/notifications";

function methodNotAllowed(): Response {
  return Response.json(
    { error: { code: "APP_METHOD_NOT_ALLOWED", message: "method not allowed" } },
    { status: 405 },
  );
}

function strOrUndef(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function createNotificationsRoutes(): AppRouteHandler {
  return async (req, url) => {
    const sub = url.pathname.slice(PREFIX.length).replace(/\/$/, "");

    if (sub === "/prefs") {
      if (req.method === "GET") return Response.json({ prefs: await loadPrefs() });
      if (req.method === "PUT") {
        const body: unknown = await req.json().catch(() => null);
        const incoming = coercePrefs(isRecord(body) ? body["prefs"] : undefined);
        return Response.json({ prefs: await savePrefs(incoming) });
      }
      return methodNotAllowed();
    }

    if (sub === "/notify") {
      if (req.method !== "POST") return methodNotAllowed();
      const body: unknown = await req.json().catch(() => null);
      const title = isRecord(body) && typeof body["title"] === "string" ? body["title"] : "";
      if (!title.trim()) {
        return Response.json(
          { error: { code: "APP_BAD_REQUEST", message: "title is required" } },
          { status: 400 },
        );
      }
      const result = await notify({
        title,
        body: isRecord(body) ? strOrUndef(body["body"]) : undefined,
        viewId: isRecord(body) ? strOrUndef(body["viewId"]) : undefined,
      });
      return Response.json(result);
    }

    return Response.json(
      { error: { code: "APP_NOT_FOUND", message: `no notifications route for ${url.pathname}` } },
      { status: 404 },
    );
  };
}
