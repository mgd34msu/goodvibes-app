// /app/local — Bun-side local-machine tools (Wave F slot; replaced entirely by
// the Wave F bun agent). Subroutes: /hooks (read/write ~/.goodvibes/hooks.json),
// /context (bounded read of project context files), /fetch-preview (read-only
// URL preview), /providers (custom provider JSON CRUD), /llm-scan (opt-in
// local LLM server probe), /deps (gtk/webkit dependency doctor).

import type { AppRouteHandler } from "./app-routes.ts";

export function createLocalToolsRoutes(): AppRouteHandler {
  return () =>
    Response.json(
      { error: { code: "APP_NOT_IMPLEMENTED", message: "Local tools land in Wave F." } },
      { status: 501 },
    );
}
