// Typed client for the /app/notifications/* contract (implemented Bun-side by
// the notifications agent; this settings agent codes only against the HTTP
// contract — no cross-imports of src/bun/notifications.ts). Local query keys
// use a unique prefix, per project convention.

import { appJson } from "../../lib/http.ts";
import { errorStatus } from "../../lib/errors.ts";

export type NotificationBatching = "off" | "30s" | "5m";
export type DomainVerbosity = "all" | "important" | "off";

/** The app's real realtime-domain taxonomy (lib/realtime.ts DOMAIN_INVALIDATIONS
 *  keys) — the per-domain grid rides the same vocabulary as everywhere else. */
export const NOTIFICATION_DOMAINS: readonly string[] = [
  "tasks",
  "permissions",
  "providers",
  "knowledge",
  "control-plane",
  "agents",
  "workflows",
  "deliveries",
  "communication",
  "mcp",
];

export interface NotificationPrefs {
  enabled: boolean;
  batching: NotificationBatching;
  quietWhileTyping: boolean;
  perDomain: Record<string, DomainVerbosity>;
}

export const notificationsKeys = {
  prefs: ["settings-notifications", "prefs"] as const,
};

export function isNotificationsRouteUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 501;
}

export const notificationsApi = {
  getPrefs: () => appJson<{ prefs: NotificationPrefs }>("/app/notifications/prefs"),
  putPrefs: (prefs: NotificationPrefs) =>
    appJson<{ prefs: NotificationPrefs }>("/app/notifications/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefs }),
    }),
  notify: (title: string, body?: string, viewId?: string) =>
    appJson<{ ok: true; shown: boolean; reason?: string }>("/app/notifications/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body, viewId }),
    }),
} as const;
