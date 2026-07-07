// /app/notifications — native desktop notifications + prefs (Wave D slot;
// docs/FEATURES.md §24). The Wave D notifications agent replaces this stub
// entirely; the route line in app-routes.ts is already wired and must not move.

import type { AppRouteHandler } from "./app-routes.ts";

export function createNotificationsRoutes(): AppRouteHandler {
  return () =>
    Response.json(
      { error: { code: "APP_NOT_IMPLEMENTED", message: "Notifications land in Wave D." } },
      { status: 501 },
    );
}
