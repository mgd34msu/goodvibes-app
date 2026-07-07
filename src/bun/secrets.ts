// /app/secrets — SecretsManager + ServiceRegistry surface via the SDK's
// platform/config (Bun-side ONLY; no wire method exists — docs/FEATURES.md §19
// "gap" rows). The Wave D settings agent replaces this stub entirely; the
// route line in app-routes.ts is already wired and must not move.

import type { AppRouteHandler } from "./app-routes.ts";

export function createSecretsRoutes(): AppRouteHandler {
  return () =>
    Response.json(
      { error: { code: "APP_NOT_IMPLEMENTED", message: "Secrets manager lands in Wave D." } },
      { status: 501 },
    );
}
