// Composition point for same-origin /app/* route handlers served by
// src/bun/ui-server.ts. Each Bun-side service module registers under its own
// prefix here; ONE agent owns each imported module, and additions to this map
// must be one line so parallel waves never conflict.
//
// Handler contract: (req, url) => Response|Promise<Response>. Prefix match is
// exact-or-slash (ui-server); handlers own everything below their prefix.

import type { DaemonHandle } from "./daemon-manager.ts";
import { createRegistriesRoutes } from "./registries/index.ts";
import { createGitRoutes } from "./git.ts";
import { createPairingRoutes } from "./pairing.ts";
import { createPtyRoutes } from "./pty.ts";
import { createNotificationsRoutes } from "./notifications.ts";
import { createSecretsRoutes } from "./secrets.ts";
import { createLocalToolsRoutes } from "./local-tools.ts";
import { createGithubRoutes } from "./github.ts";

export type AppRouteHandler = (req: Request, url: URL) => Response | Promise<Response>;

export interface AppServices {
  daemon: DaemonHandle;
}

/** Build the /app route map. Wave agents add their `"/app/<area>": handler` line here. */
export function buildAppRoutes(services: AppServices): Record<string, AppRouteHandler> {
  return {
    "/app/registries": createRegistriesRoutes(),
    "/app/git": createGitRoutes(),
    "/app/pairing": createPairingRoutes(services),
    "/app/pty": createPtyRoutes(),
    "/app/notifications": createNotificationsRoutes(),
    "/app/secrets": createSecretsRoutes(),
    "/app/local": createLocalToolsRoutes(),
    "/app/github": createGithubRoutes(),
  };
}
