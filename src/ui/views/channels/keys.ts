// Local query keys for the Channels view. Every key is PREFIXED with
// "channels" so the `communication` realtime domain invalidation
// (lib/realtime.ts DOMAIN_INVALIDATIONS → queryKeys.channels = ["channels"])
// fans out to every query this view owns — list, detail, and per-surface
// drill-ins alike. Defined locally (not in lib/queries.ts) per the wave
// ownership rules; the shared prefix is the alignment contract.

export const channelsKeys = {
  all: ["channels"] as const,
  status: ["channels", "status"] as const,
  inbox: (provider: string, limit: number) => ["channels", "inbox", provider, limit] as const,
  accounts: ["channels", "accounts"] as const,
  actions: ["channels", "actions"] as const,
  tools: ["channels", "tools"] as const,
  agentTools: ["channels", "agent-tools"] as const,
  capabilities: ["channels", "capabilities"] as const,
  directory: (surface: string, q: string, live: boolean) =>
    ["channels", "directory", surface, q, live] as const,
  surfaceSection: (surface: string, section: "doctor" | "setup" | "lifecycle" | "repairs") =>
    ["channels", "surface", surface, section] as const,
  policies: ["channels", "policies"] as const,
  policiesAudit: ["channels", "policies-audit"] as const,
  drafts: ["channels", "drafts"] as const,
  routing: ["channels", "routing"] as const,
  /** /app/pairing is app-local (no daemon event) — fetched only while the modal is open. */
  pairing: ["channels", "pairing"] as const,
} as const;
