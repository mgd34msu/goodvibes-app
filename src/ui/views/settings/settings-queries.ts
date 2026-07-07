// Local query keys for the Settings view. Rules:
//  - configAll reuses lib/queries.ts's ["config"] prefix (already registered
//    there) so any future config invalidation fans out here too.
//  - The rest use unique local prefixes — none of these domains have wire
//    events (settings/local_auth/security/credentials are absent from
//    DOMAIN_INVALIDATIONS), so views poll with a targeted refetchInterval and
//    refetch on their own mutations.

import { queryKeys } from "../../lib/queries.ts";

export const settingsKeys = {
  /** Full admin config read — same key the onboarding doctor primes. */
  config: queryKeys.configAll,
  /** settings.snapshot — the settings-sync integration snapshot. */
  syncSnapshot: ["settings-sync", "snapshot"] as const,
  /** local_auth.status. */
  localAuth: ["local-auth", "status"] as const,
  /** security.settings. */
  security: ["security-settings"] as const,
  /** credentials.get — configured/usable flags only, never secret material. */
  credentials: ["credentials-status"] as const,
  /** Capability probes (settings surface). */
  capability: (methodId: string) => ["capability", methodId] as const,
} as const;

/** No wire events exist for these domains — targeted poll cadence (ms). */
export const SETTINGS_POLL_MS = 30_000;
