// /app/secrets — SecretsManager + ServiceRegistry surface via the SDK's
// platform/config (Bun-side ONLY; no wire method exists for either — see
// docs/FEATURES.md §19 "gap" rows). Also hosts, under the same module (this
// agent's only Bun-side grant), the app-own settings persistence and the
// read-only tui/agent settings-import preview.
//
// Shared store: SecretsManager is constructed with surfaceRoot 'tui' so it
// reads/writes the EXACT same ~/.goodvibes/tui/secrets.enc the TUI/agent use
// (verified against goodvibes-tui src/runtime/services.ts — every surface
// passes surfaceRoot:'tui' to its own SecretsManager). Values NEVER cross
// into a JSON response — every route below returns metadata/booleans only.
//
// Literal-safety wrapping: a plain secret value that happens to look like a
// secret-ref string (e.g. "op://…", "secretref:…") would otherwise be
// mis-resolved by the SDK's own get() as a reference. goodvibes-tui's own
// SecretsManager wrapper (src/config/secrets.ts, not exported for reuse —
// no `exports` map on the npm package) guards this with a literal envelope.
// The exact same prefix + base64url(JSON) shape is reproduced here so a
// secret written by this app round-trips correctly when read by the TUI (and
// vice versa) — this is NOT reinvented encoding, it is the documented shape.
//
// Routes:
//   GET    /app/secrets                       → list (names/providers only)
//   GET    /app/secrets/inspect                → storage policy + counts
//   POST   /app/secrets/set                    → {name, value?|link?, scope?, medium?}
//   POST   /app/secrets/test/<name>             → resolves without returning the value
//   DELETE /app/secrets/<name>                  → delete from all matching stores
//   GET    /app/secrets/services                → ServiceRegistry configs (no secrets)
//   GET    /app/secrets/services/<name>         → ServiceInspection (has*Credential flags)
//   POST   /app/secrets/services/<name>/test    → ServiceConnectionTestResult
//   GET    /app/secrets/doctor                  → combined non-network health summary
//   GET    /app/secrets/app-settings            → read ~/.goodvibes/app/settings.json["app"]
//   PUT    /app/secrets/app-settings            → merge-write (other top-level keys untouched)
//   POST   /app/secrets/app-settings/autostart  → enable/disable the Linux autostart entry
//   GET    /app/secrets/import-preview?source=tui|agent → read-only mapped suggestions

import { homedir } from "node:os";
import { join } from "node:path";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import {
  SecretsManager,
  ServiceRegistry,
  SubscriptionManager,
  isSecretRefInput,
  normalizeSecretRef,
  type SecretScope,
  type SecretStorageMedium,
} from "@pellux/goodvibes-sdk/platform/config";
import type { AppRouteHandler } from "./app-routes.ts";
import { writeFileAtomic } from "./registries/store.ts";

const HOME = homedir();
const TUI_SURFACE_ROOT = "tui"; // shared store — matches every other GoodVibes surface

const secretsManager = new SecretsManager({
  projectRoot: HOME,
  globalHome: HOME,
  surfaceRoot: TUI_SURFACE_ROOT,
});

const servicesFilePath = join(HOME, ".goodvibes", TUI_SURFACE_ROOT, "services.json");
const subscriptionManager = new SubscriptionManager(join(HOME, ".goodvibes", TUI_SURFACE_ROOT, "subscriptions.json"));
const serviceRegistry = new ServiceRegistry(servicesFilePath, { secretsManager, subscriptionManager });

const APP_SETTINGS_PATH = join(HOME, ".goodvibes", "app", "settings.json");

// ─── literal-safety envelope (byte-for-byte the TUI's scheme) ───────────────

const RAW_SECRET_LITERAL_PREFIX = "__GOODVIBES_LITERAL_V1__";

function isGoodVibesSecretRefInput(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith("goodvibes://secrets/") && isSecretRefInput(normalized);
}

function shouldStoreAsLiteral(value: string): boolean {
  return value.startsWith(RAW_SECRET_LITERAL_PREFIX) || (isSecretRefInput(value) && !isGoodVibesSecretRefInput(value));
}

function encodeLiteralSecret(value: string): string {
  return `${RAW_SECRET_LITERAL_PREFIX}${Buffer.from(JSON.stringify({ value }), "utf-8").toString("base64url")}`;
}

/** Value actually persisted for a plain (non-link) secret write. */
function encodeSecretValue(value: string): string {
  return shouldStoreAsLiteral(value) ? encodeLiteralSecret(value) : value;
}

// ─── response helpers ────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function notFound(code: string, message: string): Response {
  return json({ error: { code, message } }, 404);
}

function badRequest(code: string, message: string): Response {
  return json({ error: { code, message } }, 400);
}

function serverError(code: string, err: unknown): Response {
  return json({ error: { code, message: err instanceof Error ? err.message : String(err) } }, 500);
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── secrets: list / inspect / set / test / delete ──────────────────────────

async function handleListSecrets(): Promise<Response> {
  const records = await secretsManager.listDetailed();
  return json({
    secrets: records.map((r) => ({
      key: r.key,
      source: r.source,
      scope: r.scope,
      secure: r.secure,
      overriddenByEnv: r.overriddenByEnv,
      refSource: r.refSource ?? null,
    })),
  });
}

async function handleInspect(): Promise<Response> {
  const review = await secretsManager.inspect();
  return json({ inspect: review });
}

function parseScope(value: unknown): SecretScope | undefined {
  return value === "project" || value === "user" ? value : undefined;
}

function parseMedium(value: unknown): SecretStorageMedium | undefined {
  return value === "secure" || value === "plaintext" ? value : undefined;
}

async function handleSetSecret(req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  if (!name) return badRequest("SECRETS_NAME_REQUIRED", "A secret name is required.");

  const options = { scope: parseScope(body["scope"]), medium: parseMedium(body["medium"]) };

  // "link" wins when present: a structured SecretRef (env/file/exec/1Password/
  // Bitwarden/Vaultwarden/BWS) or a provider URI string — stored verbatim so
  // SecretsManager.get() resolves through the referenced provider.
  if (body["link"] !== undefined) {
    const link = body["link"] as unknown;
    const normalized = normalizeSecretRef(link);
    if (!normalized) return badRequest("SECRETS_BAD_LINK", "That link is not a recognized secret reference shape.");
    // The runtime store is plain JSON — an object ref serializes fine even
    // though the SDK's own .set() type is declared as `string` (it forwards
    // whatever is given straight into the JSON store untouched).
    await secretsManager.set(name, normalized as unknown as string, options);
    return json({ ok: true, name, kind: "link", provider: normalized.source });
  }

  if (typeof body["value"] !== "string" || body["value"] === "") {
    return badRequest("SECRETS_VALUE_REQUIRED", "A value or link is required.");
  }
  await secretsManager.set(name, encodeSecretValue(body["value"]), options);
  return json({ ok: true, name, kind: "value" });
}

async function handleTestSecret(name: string): Promise<Response> {
  if (!name) return badRequest("SECRETS_NAME_REQUIRED", "A secret name is required.");
  try {
    const raw = await secretsManager.get(name);
    if (raw === null) return json({ ok: false, name, reason: "not configured" });
    return json({ ok: true, name });
  } catch (err) {
    return json({ ok: false, name, reason: err instanceof Error ? err.message : String(err) });
  }
}

async function handleDeleteSecret(name: string): Promise<Response> {
  if (!name) return badRequest("SECRETS_NAME_REQUIRED", "A secret name is required.");
  await secretsManager.delete(name);
  return json({ ok: true, name });
}

// ─── services: list / inspect / test ────────────────────────────────────────

function redactServiceConfig(config: {
  name: string;
  baseUrl?: string | undefined;
  authType: string;
  providerId?: string | undefined;
}): Record<string, unknown> {
  return { name: config.name, baseUrl: config.baseUrl ?? null, authType: config.authType, providerId: config.providerId ?? null };
}

async function handleListServices(): Promise<Response> {
  const all = serviceRegistry.getAll();
  const names = Object.keys(all).sort((a, b) => a.localeCompare(b));
  const services = await Promise.all(
    names.map(async (name) => {
      const config = all[name];
      if (!config) return null;
      const inspection = await serviceRegistry.inspect(name);
      return {
        ...redactServiceConfig(config),
        hasPrimaryCredential: inspection?.hasPrimaryCredential ?? false,
        hasPasswordCredential: inspection?.hasPasswordCredential ?? false,
        hasAuthTokenCredential: inspection?.hasAuthTokenCredential ?? false,
        hasWebhookUrl: inspection?.hasWebhookUrl ?? false,
        hasSigningSecret: inspection?.hasSigningSecret ?? false,
        hasPublicKey: inspection?.hasPublicKey ?? false,
        hasAppToken: inspection?.hasAppToken ?? false,
      };
    }),
  );
  return json({ services: services.filter((s): s is NonNullable<typeof s> => s !== null), servicesFilePath });
}

async function handleInspectService(name: string): Promise<Response> {
  const inspection = await serviceRegistry.inspect(name);
  if (!inspection) return notFound("SECRETS_SERVICE_NOT_FOUND", `No service named "${name}" is registered.`);
  return json({
    service: {
      ...redactServiceConfig(inspection.config),
      hasPrimaryCredential: inspection.hasPrimaryCredential,
      hasPasswordCredential: inspection.hasPasswordCredential,
      hasAuthTokenCredential: inspection.hasAuthTokenCredential,
      hasWebhookUrl: inspection.hasWebhookUrl,
      hasSigningSecret: inspection.hasSigningSecret,
      hasPublicKey: inspection.hasPublicKey,
      hasAppToken: inspection.hasAppToken,
    },
  });
}

async function handleTestService(name: string): Promise<Response> {
  if (!serviceRegistry.get(name)) {
    return notFound("SECRETS_SERVICE_NOT_FOUND", `No service named "${name}" is registered.`);
  }
  const result = await serviceRegistry.testConnection(name);
  return json({ test: result });
}

async function handleDoctor(): Promise<Response> {
  const [inspect, all] = await Promise.all([secretsManager.inspect(), Promise.resolve(serviceRegistry.getAll())]);
  const serviceNames = Object.keys(all).sort((a, b) => a.localeCompare(b));
  const services = await Promise.all(
    serviceNames.map(async (name) => {
      const inspection = await serviceRegistry.inspect(name);
      return {
        name,
        configured: inspection?.hasPrimaryCredential || inspection?.hasPasswordCredential || inspection?.hasAppToken || false,
      };
    }),
  );
  return json({
    secrets: inspect,
    services,
    note: "Non-network summary — use the per-service test button for a live connection check.",
  });
}

// ─── app-own settings (~/.goodvibes/app/settings.json, "app" key only) ─────

interface AppOwnSettings {
  stopDaemonOnQuit: boolean;
}

const DEFAULT_APP_SETTINGS: AppOwnSettings = { stopDaemonOnQuit: false };

async function readSettingsFile(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(APP_SETTINGS_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSettingsFile(next: Record<string, unknown>): Promise<void> {
  await mkdir(join(HOME, ".goodvibes", "app"), { recursive: true });
  await writeFileAtomic(APP_SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

function readAppOwnSettings(fileContents: Record<string, unknown>): AppOwnSettings {
  const raw = isRecord(fileContents["app"]) ? fileContents["app"] : {};
  return { stopDaemonOnQuit: raw["stopDaemonOnQuit"] === true };
}

async function handleGetAppSettings(): Promise<Response> {
  const file = await readSettingsFile();
  const app = readAppOwnSettings(file);
  const autostart = await autostartStatus();
  return json({ app: { ...DEFAULT_APP_SETTINGS, ...app }, autostart });
}

async function handlePutAppSettings(req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const patch = isRecord(body["app"]) ? body["app"] : {};
  const file = await readSettingsFile();
  const current = readAppOwnSettings(file);
  const next: AppOwnSettings = {
    stopDaemonOnQuit: typeof patch["stopDaemonOnQuit"] === "boolean" ? patch["stopDaemonOnQuit"] : current.stopDaemonOnQuit,
  };
  // Merge non-destructively: every OTHER top-level key (e.g. "notifications",
  // owned by the notifications agent) passes through untouched.
  await writeSettingsFile({ ...file, app: next });
  const autostart = await autostartStatus();
  return json({ app: next, autostart });
}

// ─── launch-at-login posture (real when a built launcher exists, honest
// "not implemented yet" otherwise — never a silent no-op toggle) ────────────

const REPO_ROOT = join(import.meta.dir, "..", "..");
const LAUNCHER_CANDIDATES = [
  join(REPO_ROOT, "build", "dev-linux-x64", "GoodVibes-dev", "bin", "launcher"),
  join(REPO_ROOT, "build", "canary-linux-x64", "GoodVibes-canary", "bin", "launcher"),
  join(REPO_ROOT, "build", "stable-linux-x64", "GoodVibes", "bin", "launcher"),
];
const AUTOSTART_DIR = join(HOME, ".config", "autostart");
const AUTOSTART_DESKTOP_PATH = join(AUTOSTART_DIR, "goodvibes-app.desktop");

async function findLauncher(): Promise<string | null> {
  for (const candidate of LAUNCHER_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

interface AutostartStatus {
  supported: boolean;
  enabled: boolean;
  reason: string;
  launcherPath: string | null;
}

async function autostartStatus(): Promise<AutostartStatus> {
  const launcherPath = await findLauncher();
  let enabled = false;
  try {
    await readFile(AUTOSTART_DESKTOP_PATH, "utf8");
    enabled = true;
  } catch {
    enabled = false;
  }
  if (!launcherPath) {
    return {
      supported: false,
      enabled: false,
      reason: "Not implemented on this machine yet — no built launcher was found under build/*-linux-x64. Run `bun run build` first.",
      launcherPath: null,
    };
  }
  return { supported: true, enabled, reason: "", launcherPath };
}

function desktopEntry(launcherPath: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=GoodVibes",
    `Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 ${launcherPath}`,
    "X-GNOME-Autostart-enabled=true",
    "Comment=GoodVibes desktop — unified GoodVibes ecosystem GUI",
    "",
  ].join("\n");
}

async function handleSetAutostart(req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const wantEnabled = body["enabled"] === true;
  const status = await autostartStatus();
  if (!status.supported || !status.launcherPath) {
    return json({ ok: false, autostart: status }, 409);
  }
  try {
    if (wantEnabled) {
      await mkdir(AUTOSTART_DIR, { recursive: true });
      await writeFileAtomic(AUTOSTART_DESKTOP_PATH, desktopEntry(status.launcherPath));
    } else {
      await rm(AUTOSTART_DESKTOP_PATH, { force: true });
    }
  } catch (err) {
    return serverError("SECRETS_AUTOSTART_WRITE_FAILED", err);
  }
  return json({ ok: true, autostart: await autostartStatus() });
}

// ─── read-only settings import preview (tui/agent, redacted) ───────────────

interface ImportSuggestion {
  key: string;
  label: string;
  value: string;
  applicable: boolean;
}

/** Same last-segment secret-shape heuristic as config-redaction.ts, applied
 *  Bun-side to the raw settings.json before ANY of it leaves this process. */
const SECRET_KEY_SUFFIX = /(token|secret|password|apikey|api_key)$/i;

function redactSettingsSnapshot(value: unknown, keyPath: string[] = []): unknown {
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactSettingsSnapshot(v, [...keyPath, k]);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redactSettingsSnapshot(v, keyPath));
  if (typeof value === "string" && value !== "") {
    const lastSegment = keyPath[keyPath.length - 1] ?? "";
    if (SECRET_KEY_SUFFIX.test(lastSegment)) return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
  }
  return value;
}

async function handleImportPreview(url: URL): Promise<Response> {
  const source = url.searchParams.get("source") === "agent" ? "agent" : "tui";
  const settingsPath = join(HOME, ".goodvibes", source, "settings.json");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    if (!isRecord(raw)) raw = {};
  } catch {
    return json({ source, found: false, path: settingsPath, redacted: null, suggestions: [] });
  }

  const display = isRecord(raw["display"]) ? raw["display"] : {};
  const controlPlane = isRecord(raw["controlPlane"]) ? raw["controlPlane"] : {};

  const suggestions: ImportSuggestion[] = [];
  if (display["themeMode"] === "dark" || display["themeMode"] === "light") {
    suggestions.push({
      key: "themeMode",
      label: "Theme (dark/light)",
      value: String(display["themeMode"]),
      applicable: true,
    });
  }
  if (typeof controlPlane["host"] === "string" && typeof controlPlane["port"] === "number") {
    suggestions.push({
      key: "daemonEndpoint",
      label: "Daemon endpoint (controlPlane.host/port)",
      value: `${controlPlane["host"]}:${controlPlane["port"]}`,
      applicable: true,
    });
  }

  return json({
    source,
    found: true,
    path: settingsPath,
    redacted: redactSettingsSnapshot(raw),
    suggestions,
  });
}

// ─── route dispatch ──────────────────────────────────────────────────────────

/** Single-segment literal routes handled above by method GET/POST/PUT — never
 *  a valid secret name for the bare-name DELETE route below. */
const RESERVED_TOP_LEVEL_NAMES = new Set(["inspect", "set", "services", "doctor", "app-settings", "import-preview"]);

export function createSecretsRoutes(): AppRouteHandler {
  return async (req, url) => {
    const sub = url.pathname.slice("/app/secrets".length); // "", "/set", "/test/foo", …
    const method = req.method;

    try {
      if ((sub === "" || sub === "/") && method === "GET") return handleListSecrets();
      if (sub === "/inspect" && method === "GET") return handleInspect();
      if (sub === "/set" && method === "POST") return handleSetSecret(req);
      if (sub.startsWith("/test/") && method === "POST") {
        return handleTestSecret(decodeURIComponent(sub.slice("/test/".length)));
      }

      if (sub === "/services" && method === "GET") return handleListServices();
      if (sub === "/doctor" && method === "GET") return handleDoctor();
      if (sub.startsWith("/services/") && sub.endsWith("/test") && method === "POST") {
        return handleTestService(decodeURIComponent(sub.slice("/services/".length, -"/test".length)));
      }
      if (sub.startsWith("/services/") && method === "GET") {
        return handleInspectService(decodeURIComponent(sub.slice("/services/".length)));
      }

      if (sub === "/app-settings" && method === "GET") return handleGetAppSettings();
      if (sub === "/app-settings" && method === "PUT") return handlePutAppSettings(req);
      if (sub === "/app-settings/autostart" && method === "POST") return handleSetAutostart(req);

      if (sub === "/import-preview" && method === "GET") return handleImportPreview(url);

      // Bare "/<name>" is the delete route — the only DELETE this module
      // serves. Reserved literal names (routed above by other methods) are
      // excluded so a stray DELETE never tries to delete a "secret" that is
      // actually one of this module's own sub-routes.
      if (
        method === "DELETE" &&
        sub.startsWith("/") &&
        sub.length > 1 &&
        !sub.slice(1).includes("/") &&
        !RESERVED_TOP_LEVEL_NAMES.has(sub.slice(1))
      ) {
        return handleDeleteSecret(decodeURIComponent(sub.slice(1)));
      }

      return notFound("SECRETS_ROUTE_NOT_FOUND", `No secrets route for ${method} ${url.pathname}.`);
    } catch (err) {
      return serverError("SECRETS_INTERNAL_ERROR", err);
    }
  };
}
