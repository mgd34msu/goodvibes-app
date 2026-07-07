// /app/pty — embedded terminal PTY sessions (Wave D slot; docs/FEATURES.md §15
// "Embedded terminal tabs"). The Wave D terminal agent replaces this stub
// entirely; the route line in app-routes.ts is already wired and must not move.

import type { AppRouteHandler } from "./app-routes.ts";

export function createPtyRoutes(): AppRouteHandler {
  return () =>
    Response.json(
      { error: { code: "APP_NOT_IMPLEMENTED", message: "Terminal PTY lands in Wave D." } },
      { status: 501 },
    );
}
