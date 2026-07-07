// Local query keys for the Observability view. Every key is PREFIXED with
// "observability" (or reuses the already-shared "telemetry"/"health"/
// "control" prefixes from lib/queries.ts where this view legitimately reads
// the same data those prefixes already cover) so a targeted invalidation
// fans out correctly. Defined locally per the wave ownership rules — do NOT
// edit lib/queries.ts.
//
// None of telemetry/control-plane/health/routes/surfaces/continuity/
// scheduler/panels carry a realtime wire event (lib/realtime.ts
// DOMAIN_INVALIDATIONS has no entry for any of them) — every read here is a
// poll-or-refetch-on-demand query, never SSE-invalidated. Live freshness for
// telemetry specifically comes from the dedicated pausable tail
// (telemetry.stream via lib/sse.ts), not from this polling.

export const obsKeys = {
  all: ["observability"] as const,

  telemetrySnapshot: ["observability", "telemetry", "snapshot"] as const,
  telemetryEvents: (filters: Record<string, string | undefined>) =>
    ["observability", "telemetry", "events", filters] as const,
  telemetryErrors: (filters: Record<string, string | undefined>) =>
    ["observability", "telemetry", "errors", filters] as const,
  telemetryTraces: (filters: Record<string, string | undefined>) =>
    ["observability", "telemetry", "traces", filters] as const,
  telemetryMetrics: ["observability", "telemetry", "metrics"] as const,
  telemetryOtlp: ["observability", "telemetry", "otlp"] as const,

  costUsage: (providerId: string) => ["observability", "cost", "usage", providerId] as const,
  costBudgetConfig: ["observability", "cost", "budget-config"] as const,

  health: ["observability", "health"] as const,

  controlSnapshot: ["observability", "control", "snapshot"] as const,
  controlClients: ["observability", "control", "clients"] as const,
  controlMessages: ["observability", "control", "messages"] as const,
  controlContract: ["observability", "control", "contract"] as const,
  controlMethods: ["observability", "control", "methods"] as const,
  controlMethodDetail: (methodId: string) => ["observability", "control", "methods", methodId] as const,
  controlEventsCatalog: ["observability", "control", "events-catalog"] as const,

  routesSnapshot: ["observability", "routes", "snapshot"] as const,
  routesBindings: ["observability", "routes", "bindings"] as const,

  surfaces: ["observability", "surfaces"] as const,
  continuity: ["observability", "continuity"] as const,
  scheduler: ["observability", "scheduler"] as const,

  panels: ["observability", "panels"] as const,
} as const;
