// provider-status.ts — honest per-provider health, derived from the real
// per-route freshness the wire returns (ProviderAuthRouteDescriptor.freshness),
// never a decorative fallback. Ported from goodvibes-webui
// src/lib/provider-status.ts onto this app's lib/wire.ts readers.
//
// The wire exposes routes in two shapes depending on which query populated
// the record:
//   - flat catalog records: top-level `routes`, `configured`, `configuredVia`
//   - ProviderRuntimeSnapshot (providers.list / providers.get): nested at
//     `runtime.auth.routes` / `runtime.auth.configured`.
// This module reads all candidate paths so the deriver works regardless of
// which query populated which field.

import { asRecord, firstString, readPath } from "../../lib/wire.ts";

/** The honest set of provider-pill states. Never "unknown". */
export type ProviderFreshness =
  | "healthy"
  | "expiring"
  | "expired"
  | "pending"
  | "unconfigured"
  | "status unavailable";

export interface ProviderRouteStatus {
  readonly route: string;
  readonly label: string;
  readonly freshness: ProviderFreshness;
  readonly configured: boolean;
  readonly usable?: boolean;
  readonly detail?: string;
  readonly repairHints: readonly string[];
}

export interface ProviderStatus {
  readonly freshness: ProviderFreshness;
  readonly configured: boolean;
  readonly configuredVia: string;
  readonly routes: readonly ProviderRouteStatus[];
}

// Worst-wins ranking among *meaningful* (i.e. actually-configured) routes.
// Forward-compat ruling (webui F7f): a freshness value this build does not
// recognize maps to 'status unavailable' when the route IS configured (never
// silently to 'healthy'), and participates in worst-wins ABOVE healthy/pending
// but BELOW the known-degraded expiring/expired.
const FRESHNESS_RANK: Record<string, number> = {
  healthy: 1,
  pending: 2,
  "status unavailable": 3,
  expiring: 4,
  expired: 5,
};

const ROUTE_PATHS: readonly (readonly string[])[] = [
  ["routes"],
  ["auth", "routes"],
  ["runtime", "auth", "routes"],
];

function extractRoutes(record: unknown): unknown[] {
  for (const path of ROUTE_PATHS) {
    const value = readPath(record, [...path]);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function extractConfigured(record: unknown): { configured: boolean; configuredVia: string } {
  const top = asRecord(record);
  const configuredVia = firstString(record, ["configuredVia"]);
  const nestedConfigured =
    readPath(record, ["runtime", "auth", "configured"]) === true ||
    readPath(record, ["auth", "configured"]) === true;
  const configured = top["configured"] === true || nestedConfigured || configuredVia.length > 0;
  return { configured, configuredVia };
}

function normalizeRoute(raw: unknown): ProviderRouteStatus {
  const record = asRecord(raw);
  const configured = record["configured"] === true;
  const freshnessRaw = firstString(record, ["freshness"]);
  const freshness: ProviderFreshness =
    freshnessRaw === "healthy" ||
    freshnessRaw === "expiring" ||
    freshnessRaw === "expired" ||
    freshnessRaw === "pending" ||
    freshnessRaw === "unconfigured"
      ? freshnessRaw
      : configured
        ? "status unavailable"
        : "unconfigured";
  return {
    route: firstString(record, ["route"]) || "route",
    label: firstString(record, ["label", "route"]) || "Route",
    freshness,
    configured,
    usable: typeof record["usable"] === "boolean" ? record["usable"] : undefined,
    detail: firstString(record, ["detail"]) || undefined,
    repairHints: Array.isArray(record["repairHints"])
      ? record["repairHints"].filter((hint): hint is string => typeof hint === "string")
      : [],
  };
}

/**
 * Roll every route's freshness into one honest provider pill.
 *   - Any meaningful (non-"unconfigured") freshness present -> worst wins.
 *   - Routes exist but ALL report 'unconfigured' -> the whole provider is
 *     'unconfigured' (a real, known state).
 *   - No route data at all -> 'status unavailable' (health genuinely absent).
 */
export function deriveProviderStatus(record: unknown): ProviderStatus {
  const { configured, configuredVia } = extractConfigured(record);
  const routes = extractRoutes(record).map(normalizeRoute);

  const meaningful = routes.filter((route) => route.freshness in FRESHNESS_RANK);
  if (meaningful.length > 0) {
    const worst = meaningful.reduce((worstSoFar, route) =>
      (FRESHNESS_RANK[route.freshness] ?? 0) > (FRESHNESS_RANK[worstSoFar.freshness] ?? 0) ? route : worstSoFar,
    );
    return { freshness: worst.freshness, configured, configuredVia, routes };
  }

  const allExplicitlyUnconfigured =
    routes.length > 0 && routes.every((route) => route.freshness === "unconfigured");
  return {
    freshness: allExplicitlyUnconfigured ? "unconfigured" : "status unavailable",
    configured,
    configuredVia,
    routes,
  };
}

/** Header text — matched to the real `configured` flag. */
export function providerHeaderLabel(status: ProviderStatus): string {
  if (!status.configured) return "not configured";
  return status.configuredVia ? `configured via ${status.configuredVia}` : "configured";
}

// ---------------------------------------------------------------------------
// Shared credential-status consumption (secret-free, honest-degrade)
// ---------------------------------------------------------------------------

/** One credential's status metadata from the daemon's shared store — never bytes. */
export interface CredentialStatusEntry {
  readonly key: string;
  readonly configured: boolean;
  readonly usable: boolean;
  readonly source?: string;
  readonly secure?: boolean;
}

export type CredentialAvailability =
  | { readonly available: true; readonly credentials: readonly CredentialStatusEntry[] }
  | { readonly available: false; readonly reason: string };

/**
 * Fold a `credentials.get` outcome into an honest availability value: a 503
 * CREDENTIAL_STORE_UNAVAILABLE, a METHOD_NOT_FOUND from an older daemon, or
 * any transport failure yields `available: false` with a plain reason —
 * NEVER a fabricated "configured".
 */
export function deriveCredentialAvailability(
  outcome: { ok: true; value: unknown } | { ok: false; error: unknown },
): CredentialAvailability {
  if (!outcome.ok) {
    const code = firstString(asRecord(outcome.error), ["code"]);
    if (code === "CREDENTIAL_STORE_UNAVAILABLE") {
      return { available: false, reason: "The daemon has no shared credential store wired." };
    }
    if (code === "METHOD_NOT_FOUND" || code === "NOT_INVOKABLE") {
      return { available: false, reason: "This daemon does not serve credential status yet." };
    }
    return { available: false, reason: "Credential status unavailable right now." };
  }
  const value = asRecord(outcome.value);
  const raw = value["credentials"];
  if (!Array.isArray(raw)) return { available: false, reason: "Credential status unavailable right now." };
  const credentials: CredentialStatusEntry[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    const key = firstString(rec, ["key"]);
    if (!key) continue;
    credentials.push({
      key,
      configured: rec["configured"] === true,
      usable: rec["usable"] === true,
      source: firstString(rec, ["source"]) || undefined,
      secure: rec["secure"] === true ? true : rec["secure"] === false ? false : undefined,
    });
  }
  return { available: true, credentials };
}
