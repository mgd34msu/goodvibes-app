// Typed client for the app-local /app/local/hooks route (src/bun/local-tools.ts
// §/hooks — docs/GAPS.md §5 row 10). No wire method backs this — it reads and
// writes ~/.goodvibes/hooks.json verbatim on the machine this app runs on, so
// freshness is mutation-driven invalidation only (no wire event, no poll).
//
// PUT validates JSON.parse + top-level object shape before an atomic write and
// 400s with { error, code, detail, position? } when the content isn't valid
// JSON — parseHooksSaveError surfaces that verbatim, never re-deriving a
// position client-side.

import { appJson } from "../../lib/http.ts";
import { errorStatus, serializeError } from "../../lib/errors.ts";
import { asRecord } from "../../lib/wire.ts";

export const hooksLocalKeys = {
  file: ["automation", "hooksFile"] as const,
};

/** 404/501 shape this app-local module returns before it exists in a build. */
export function isHooksRouteUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 501;
}

export interface HooksFile {
  path: string;
  exists: boolean;
  content: string;
}

export interface HooksSaveError {
  message: string;
  code?: string;
  detail?: string;
  position?: number;
}

/** Extracts the Bun-side 400 body verbatim (via the shared serializeError/parseBody plumbing); falls back to the bare error message when the body isn't the expected shape. */
export function parseHooksSaveError(error: unknown): HooksSaveError {
  const serialized = serializeError(error);
  const body = asRecord(serialized["body"]);
  const fallbackMessage = typeof serialized["message"] === "string" ? serialized["message"] : String(error);
  return {
    message: typeof body["error"] === "string" ? body["error"] : fallbackMessage,
    ...(typeof body["code"] === "string" ? { code: body["code"] } : {}),
    ...(typeof body["detail"] === "string" ? { detail: body["detail"] } : {}),
    ...(typeof body["position"] === "number" ? { position: body["position"] } : {}),
  };
}

export const hooksApi = {
  get: () => appJson<HooksFile>("/app/local/hooks"),
  put: (content: string) =>
    appJson<{ ok: true; path: string }>("/app/local/hooks", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
} as const;

// ─── Reference sidebar content (docs/research/tui-features.md — honest,
// documented-only; no fabricated event names) ───────────────────────────────
//
// Source line (docs/research/tui-features.md, "Automation" section):
// "hooks (`.goodvibes/hooks.json`): event paths `Phase:Category:Specific`
// (Pre/Post/Fail/Change/Lifecycle × tool/file/git/agent/compact/llm/mcp/
// config/budget/session/workflow, wildcards), hook types
// command/prompt/agent/http/ts, hook chains with time windows/conditions,
// managed hook scaffold/simulate/import/export."
// The research notes document the Phase/Category axes and hook types, but
// never enumerate every "Specific" leaf or the wildcard syntax itself — this
// reference stops exactly where the source does, rather than guessing the rest.

export const HOOK_EVENT_PHASES = ["Pre", "Post", "Fail", "Change", "Lifecycle"] as const;

export const HOOK_EVENT_CATEGORIES = [
  "tool",
  "file",
  "git",
  "agent",
  "compact",
  "llm",
  "mcp",
  "config",
  "budget",
  "session",
  "workflow",
] as const;

export const HOOK_TYPES = ["command", "prompt", "agent", "http", "ts"] as const;
