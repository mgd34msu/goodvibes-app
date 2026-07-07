// /app/local/* — Bun-side local-machine tools (docs/FEATURES.md Wave F). These
// touch the user's real home directory and localhost, so every handler is
// bounded and self-contained:
//   GET/PUT  /hooks            — read/write ~/.goodvibes/hooks.json verbatim
//   GET      /context          — well-known context files in a directory
//   GET      /context/file     — bounded read, allowlisted basenames only
//   POST     /fetch-preview    — read-only URL preview; refuses private targets
//   GET/PUT/DELETE /providers  — custom TUI provider JSON CRUD
//   POST     /llm-scan         — opt-in localhost LLM server probe
//   GET      /deps             — gtk/webkit/tooling dependency doctor
//
// Security rails are binding, not decorative: fetch-preview refuses
// localhost/private/link-local hosts (checked BEFORE any socket opens) and
// forwards no cookies or auth; context reads are guarded solely by an allowlist
// of well-known basenames (the allowlist IS the traversal guard); provider
// writes reject any filename that carries a path separator or is not *.json.
// Writes are atomic (temp file + rename), mirroring settings-store.ts — this
// module owns different files, so the idiom is duplicated rather than imported.

import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { mkdir, readFile, writeFile, rename, unlink, stat, readdir } from "node:fs/promises";
import type { AppRouteHandler } from "./app-routes.ts";

// ─── shared plumbing ─────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
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

async function statOrNull(path: string): Promise<{ size: number } | null> {
  try {
    const s = await stat(path);
    return { size: s.size };
  } catch {
    return null;
  }
}

// ─── /hooks ──────────────────────────────────────────────────────────────────

async function handleHooksGet(hooksPath: string): Promise<Response> {
  try {
    const content = await readFile(hooksPath, "utf8");
    return json({ path: hooksPath, exists: true, content });
  } catch {
    return json({ path: hooksPath, exists: false, content: "" });
  }
}

async function handleHooksPut(hooksPath: string, req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const content = body["content"];
  if (typeof content !== "string") {
    return json({ error: "Body requires a string `content` field.", code: "LOCAL_HOOKS_BAD_BODY" }, 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const posMatch = /position (\d+)/.exec(detail);
    return json(
      {
        error: "hooks.json content is not valid JSON.",
        code: "LOCAL_HOOKS_INVALID_JSON",
        detail,
        ...(posMatch ? { position: Number(posMatch[1]) } : {}),
      },
      400,
    );
  }
  if (!isRecord(parsed)) {
    return json(
      { error: "hooks.json must be a JSON object at the top level.", code: "LOCAL_HOOKS_NOT_OBJECT" },
      400,
    );
  }
  await writeFileAtomic(hooksPath, content);
  return json({ ok: true, path: hooksPath });
}

// ─── /context ────────────────────────────────────────────────────────────────

// Relative well-known context filenames (some live in subdirectories).
const WELL_KNOWN_CONTEXT = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".goodvibes/GOODVIBES.md",
  ".github/copilot-instructions.md",
] as const;

// The basename allowlist doubles as the traversal guard for /context/file.
const WELL_KNOWN_BASENAMES = new Set(WELL_KNOWN_CONTEXT.map((rel) => basename(rel)));

async function handleContextList(url: URL): Promise<Response> {
  const dir = url.searchParams.get("dir") ?? "";
  if (!dir || !dir.startsWith("/")) {
    return json({ error: "Query requires an absolute `dir`.", code: "LOCAL_CONTEXT_BAD_DIR" }, 400);
  }
  const files = await Promise.all(
    WELL_KNOWN_CONTEXT.map(async (rel) => {
      const path = join(dir, rel);
      const info = await statOrNull(path);
      return { name: rel, path, size: info ? info.size : 0, exists: info !== null };
    }),
  );
  return json({ dir, files });
}

const CONTEXT_READ_CAP = 256 * 1024;

async function handleContextFile(url: URL): Promise<Response> {
  const path = url.searchParams.get("path") ?? "";
  if (!path || !path.startsWith("/")) {
    return json({ error: "Query requires an absolute `path`.", code: "LOCAL_CONTEXT_BAD_PATH" }, 400);
  }
  // The allowlist IS the traversal guard: only files whose basename is a
  // well-known context filename are ever read, so ../ escapes resolve to a
  // basename that is not on the list and are rejected here.
  if (!WELL_KNOWN_BASENAMES.has(basename(path))) {
    return json(
      { error: "Only well-known context files may be read.", code: "LOCAL_CONTEXT_NOT_ALLOWED" },
      403,
    );
  }
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch {
    return json({ error: "File not found.", code: "LOCAL_CONTEXT_NOT_FOUND", path }, 404);
  }
  const truncated = buf.length > CONTEXT_READ_CAP;
  const content = buf.subarray(0, CONTEXT_READ_CAP).toString("utf8");
  return json({ path, content, truncated });
}

// ─── /fetch-preview ──────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000;
const FETCH_BYTE_CAP = 1_000_000; // 1 MB
const FETCH_EXCERPT_CAP = 20_000; // 20 KB of text handed to the UI
const FETCH_MAX_REDIRECTS = 3;

/**
 * Refuse loopback / private / link-local hosts BEFORE opening a socket. The
 * contract enumerates the ranges literally; we match the hostname string plus
 * the obvious IPv6 loopback/unique-local/link-local forms.
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "" || h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "::" || h === "0.0.0.0") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  const m172 = /^172\.(\d{1,3})\./.exec(h);
  if (m172) {
    const octet = Number(m172[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;
  return false;
}

async function readCapped(response: Response, cap: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const body = response.body;
  if (!body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.length;
      if (total >= cap) {
        truncated = true;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, cap));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= out.length) break;
    const slice = chunk.subarray(0, out.length - offset);
    out.set(slice, offset);
    offset += slice.length;
  }
  return { bytes: out, truncated };
}

function stripTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function handleFetchPreview(req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const raw = typeof body["url"] === "string" ? body["url"].trim() : "";
  if (!raw) {
    return json({ error: "Body requires a `url` string.", code: "LOCAL_FETCH_BAD_URL" }, 400);
  }
  let current: URL;
  try {
    current = new URL(raw);
  } catch {
    return json({ error: "url is not a valid URL.", code: "LOCAL_FETCH_BAD_URL" }, 400);
  }

  let response: Response;
  let redirects = 0;
  for (;;) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      return json({ error: "Only http(s) URLs are allowed.", code: "LOCAL_FETCH_BAD_SCHEME" }, 400);
    }
    if (isPrivateHost(current.hostname)) {
      return json(
        {
          error: "Refusing to fetch a localhost / private / link-local address.",
          code: "LOCAL_FETCH_PRIVATE",
          host: current.hostname,
        },
        400,
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        // No cookies, no auth, no credentials of any kind are forwarded.
        credentials: "omit",
        headers: { accept: "text/*, application/json", "user-agent": "goodvibes-app/fetch-preview" },
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return json(
        {
          error: aborted ? "Fetch timed out." : "Fetch failed.",
          code: aborted ? "LOCAL_FETCH_TIMEOUT" : "LOCAL_FETCH_FAILED",
          detail: err instanceof Error ? err.message : String(err),
        },
        aborted ? 504 : 502,
      );
    } finally {
      clearTimeout(timer);
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) break;
      redirects++;
      if (redirects > FETCH_MAX_REDIRECTS) {
        return json(
          { error: `Exceeded ${FETCH_MAX_REDIRECTS} redirects.`, code: "LOCAL_FETCH_TOO_MANY_REDIRECTS" },
          400,
        );
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return json({ error: "Redirect target is not a valid URL.", code: "LOCAL_FETCH_BAD_REDIRECT" }, 502);
      }
      await response.body?.cancel().catch(() => undefined);
      current = next;
      continue;
    }
    break;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const lc = contentType.toLowerCase();
  const isText = lc.startsWith("text/");
  const isJson = lc.includes("application/json");
  if (!isText && !isJson) {
    await response.body?.cancel().catch(() => undefined);
    return json(
      { error: `Unsupported content type: ${contentType || "unknown"}.`, code: "LOCAL_FETCH_BAD_TYPE", contentType },
      415,
    );
  }

  const { bytes } = await readCapped(response, FETCH_BYTE_CAP);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const isHtml = lc.includes("html");

  let title: string | undefined;
  if (isHtml) {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
    if (m && m[1]) title = stripTags(m[1]).slice(0, 300);
  }
  const excerptSource = isHtml ? stripTags(text) : text;
  const textExcerpt = excerptSource.slice(0, FETCH_EXCERPT_CAP);

  return json({
    url: raw,
    finalUrl: current.toString(),
    status: response.status,
    contentType,
    ...(title ? { title } : {}),
    textExcerpt,
  });
}

// ─── /providers ──────────────────────────────────────────────────────────────

/** Filename must be a bare *.json leaf: no path separators, no traversal. */
function isSafeProviderFile(file: string): boolean {
  return (
    file.length > 0 &&
    file.endsWith(".json") &&
    !file.includes("/") &&
    !file.includes("\\") &&
    !file.includes("\0") &&
    file !== "." &&
    file !== ".." &&
    basename(file) === file
  );
}

async function handleProvidersGet(providersDir: string): Promise<Response> {
  let entries: string[];
  try {
    entries = await readdir(providersDir);
  } catch {
    return json({ dir: providersDir, providers: [] });
  }
  const providers: Array<{ file: string; json: unknown; error?: string }> = [];
  for (const file of entries.sort()) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(providersDir, file), "utf8");
      providers.push({ file, json: JSON.parse(raw) as unknown });
    } catch (err) {
      providers.push({ file, json: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return json({ dir: providersDir, providers });
}

async function handleProvidersPut(providersDir: string, file: string, req: Request): Promise<Response> {
  if (!isSafeProviderFile(file)) {
    return json(
      { error: "Provider filename must be a bare *.json name with no path separators.", code: "LOCAL_PROVIDERS_BAD_NAME" },
      400,
    );
  }
  const body = await readJsonBody(req);
  const value = body["json"];
  if (!isRecord(value)) {
    return json({ error: "Body requires a `json` object.", code: "LOCAL_PROVIDERS_BAD_BODY" }, 400);
  }
  await writeFileAtomic(join(providersDir, file), `${JSON.stringify(value, null, 2)}\n`);
  return json({ ok: true, file });
}

async function handleProvidersDelete(providersDir: string, file: string): Promise<Response> {
  if (!isSafeProviderFile(file)) {
    return json(
      { error: "Provider filename must be a bare *.json name with no path separators.", code: "LOCAL_PROVIDERS_BAD_NAME" },
      400,
    );
  }
  try {
    await unlink(join(providersDir, file));
  } catch {
    return json({ error: "Provider file not found.", code: "LOCAL_PROVIDERS_NOT_FOUND", file }, 404);
  }
  return json({ ok: true, file });
}

// ─── /llm-scan ───────────────────────────────────────────────────────────────

interface LlmTarget {
  port: number;
  kind: string;
  path: string;
}

const LLM_TARGETS: LlmTarget[] = [
  { port: 11434, kind: "ollama", path: "/api/tags" },
  { port: 1234, kind: "lmstudio", path: "/v1/models" },
  { port: 8080, kind: "llamacpp", path: "/v1/models" },
  { port: 8000, kind: "vllm", path: "/v1/models" },
];

const LLM_PROBE_TIMEOUT_MS = 1_500;

function extractModelIds(kind: string, payload: unknown): string[] {
  const ids: string[] = [];
  if (kind === "ollama") {
    const models = isRecord(payload) ? payload["models"] : undefined;
    if (Array.isArray(models)) {
      for (const m of models) {
        if (isRecord(m) && typeof m["name"] === "string") ids.push(m["name"]);
      }
    }
  } else {
    const data = isRecord(payload) ? payload["data"] : undefined;
    if (Array.isArray(data)) {
      for (const m of data) {
        if (isRecord(m) && typeof m["id"] === "string") ids.push(m["id"]);
      }
    }
  }
  return ids.slice(0, 20);
}

async function probeLlm(target: LlmTarget): Promise<{ port: number; kind: string; alive: boolean; models: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${target.port}${target.path}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { port: target.port, kind: target.kind, alive: false, models: [] };
    }
    const payload = (await res.json()) as unknown;
    return { port: target.port, kind: target.kind, alive: true, models: extractModelIds(target.kind, payload) };
  } catch {
    return { port: target.port, kind: target.kind, alive: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function handleLlmScan(): Promise<Response> {
  const servers = await Promise.all(LLM_TARGETS.map((t) => probeLlm(t)));
  return json({ servers });
}

// ─── /deps ───────────────────────────────────────────────────────────────────

interface DepSpec {
  id: string;
  label: string;
  linuxOnly: boolean;
  /** "bin" → Bun.which; "lib" → ldconfig -p contains. */
  kind: "bin" | "lib";
  probe: string;
}

const DEP_SPECS: DepSpec[] = [
  { id: "webkit2gtk", label: "WebKit2GTK", linuxOnly: true, kind: "lib", probe: "libwebkit2gtk" },
  { id: "gtk3", label: "GTK 3", linuxOnly: true, kind: "lib", probe: "libgtk-3" },
  { id: "notify-send", label: "notify-send (desktop notifications)", linuxOnly: true, kind: "bin", probe: "notify-send" },
  { id: "git", label: "git", linuxOnly: false, kind: "bin", probe: "git" },
  { id: "setsid", label: "setsid (session leader)", linuxOnly: true, kind: "bin", probe: "setsid" },
  { id: "script", label: "script(1) (PTY capture)", linuxOnly: false, kind: "bin", probe: "script" },
];

let ldconfigCache: string | null | undefined;

async function ldconfigOutput(): Promise<string | null> {
  if (ldconfigCache !== undefined) return ldconfigCache;
  try {
    const proc = Bun.spawn(["ldconfig", "-p"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    ldconfigCache = out;
  } catch {
    ldconfigCache = null;
  }
  return ldconfigCache;
}

async function handleDeps(): Promise<Response> {
  const platform = process.platform;
  const isLinux = platform === "linux";
  const checks = await Promise.all(
    DEP_SPECS.map(async (spec) => {
      if (spec.linuxOnly && !isLinux) {
        return { id: spec.id, label: spec.label, ok: null, detail: `not applicable on ${platform}` };
      }
      if (spec.kind === "bin") {
        const found = Bun.which(spec.probe);
        return {
          id: spec.id,
          label: spec.label,
          ok: found !== null,
          detail: found ?? `${spec.probe} not found on PATH`,
        };
      }
      // lib check via ldconfig -p
      const ld = await ldconfigOutput();
      if (ld === null) {
        return { id: spec.id, label: spec.label, ok: null, detail: "ldconfig unavailable" };
      }
      const present = ld.includes(spec.probe);
      return {
        id: spec.id,
        label: spec.label,
        ok: present,
        detail: present ? `${spec.probe} present in ldconfig cache` : `${spec.probe} not in ldconfig cache`,
      };
    }),
  );
  return json({ checks });
}

// ─── router ──────────────────────────────────────────────────────────────────

export interface LocalToolsOptions {
  /** Base ~/.goodvibes directory; override for tests. */
  home?: string;
}

export function createLocalToolsRoutes(opts: LocalToolsOptions = {}): AppRouteHandler {
  const gvHome = opts.home ?? process.env["GOODVIBES_HOME"] ?? join(homedir(), ".goodvibes");
  const hooksPath = join(gvHome, "hooks.json");
  const providersDir = join(gvHome, "tui", "providers");

  return async (req: Request, url: URL): Promise<Response> => {
    const sub = url.pathname.slice("/app/local".length) || "/";
    const method = req.method;

    try {
      if (method === "GET") {
        switch (sub) {
          case "/hooks":
            return await handleHooksGet(hooksPath);
          case "/context":
            return await handleContextList(url);
          case "/context/file":
            return await handleContextFile(url);
          case "/providers":
            return await handleProvidersGet(providersDir);
          case "/deps":
            return await handleDeps();
          default:
            return json({ error: `Unknown local route: ${sub}`, code: "LOCAL_ROUTE_NOT_FOUND" }, 404);
        }
      }

      if (method === "PUT") {
        if (sub === "/hooks") return await handleHooksPut(hooksPath, req);
        if (sub.startsWith("/providers/")) {
          return await handleProvidersPut(providersDir, decodeURIComponent(sub.slice("/providers/".length)), req);
        }
        return json({ error: `Unknown local route: ${sub}`, code: "LOCAL_ROUTE_NOT_FOUND" }, 404);
      }

      if (method === "POST") {
        switch (sub) {
          case "/fetch-preview":
            return await handleFetchPreview(req);
          case "/llm-scan":
            return await handleLlmScan();
          default:
            return json({ error: `Unknown local route: ${sub}`, code: "LOCAL_ROUTE_NOT_FOUND" }, 404);
        }
      }

      if (method === "DELETE") {
        if (sub.startsWith("/providers/")) {
          return await handleProvidersDelete(providersDir, decodeURIComponent(sub.slice("/providers/".length)));
        }
        return json({ error: `Unknown local route: ${sub}`, code: "LOCAL_ROUTE_NOT_FOUND" }, 404);
      }

      return json({ error: `Method ${method} not allowed`, code: "LOCAL_METHOD_NOT_ALLOWED" }, 405);
    } catch (err) {
      return json(
        {
          error: "local tools route failed",
          code: "LOCAL_INTERNAL",
          detail: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  };
}
