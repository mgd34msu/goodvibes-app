// CredentialStatusPanel — secret-free credential status over the admin-scoped
// credentials.get route (docs/FEATURES.md §14 "Credential status (secret-free)").
// Ported from goodvibes-webui src/components/CredentialStatusPanel.tsx.
//
// Three honest outcomes, never a fourth fabricated one:
//   1. REFUSED — the admin-scoped route 403s a non-admin token (the wire
//      carries no machine code for this, so it is status-checked).
//   2. DEGRADED — deriveCredentialAvailability's `available: false` states
//      (503 CREDENTIAL_STORE_UNAVAILABLE, METHOD_NOT_FOUND, transport failure).
//   3. AVAILABLE — the credential list; entries carry key/configured/usable/
//      source/secure ONLY — no secret value field exists by construction.

import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { errorCode, errorStatus } from "../../lib/errors.ts";
import { EmptyState, SkeletonBlock } from "../../components/feedback.tsx";
import { deriveCredentialAvailability, type CredentialStatusEntry } from "./provider-status.ts";

// 'providers'-prefixed on purpose: the `providers` SSE domain invalidation
// (lib/realtime.ts) invalidates the ["providers"] prefix, which refetches this
// too — credential freshness rides provider auth changes.
const CREDENTIALS_QUERY_KEY = ["providers", "credentials"] as const;

function credentialTone(entry: CredentialStatusEntry): "ok" | "warning" | "neutral" {
  if (!entry.configured) return "neutral";
  return entry.usable ? "ok" : "warning";
}

function credentialLabel(entry: CredentialStatusEntry): string {
  if (!entry.configured) return "not configured";
  return entry.usable ? "usable" : "configured, not usable";
}

export interface CredentialStatusPanelProps {
  /** Currently selected provider id — soft, best-effort highlight only: a
   * credential key containing the id is marked "for this provider"; no match
   * means no highlight, never a fabricated link. */
  selectedProviderId?: string;
}

export function CredentialStatusPanel({ selectedProviderId }: CredentialStatusPanelProps) {
  const query = useQuery({
    queryKey: CREDENTIALS_QUERY_KEY,
    queryFn: () => gv.config.credentials(),
    retry: false,
  });

  const refused = query.isError && errorStatus(query.error) === 403;
  const availability = query.isSuccess
    ? deriveCredentialAvailability({ ok: true, value: query.data })
    : query.isError && !refused
      ? deriveCredentialAvailability({ ok: false, error: { code: errorCode(query.error) } })
      : null;
  const degradedReason = availability?.available === false ? availability.reason : null;
  const credentials = availability?.available === true ? availability.credentials : null;

  return (
    <section className="providers-panel providers-credentials" aria-label="Credential status">
      <div className="providers-panel__title">
        <h3>Credential Status</h3>
        <KeyRound size={16} aria-hidden="true" />
      </div>

      {query.isPending ? (
        <div className="providers-skeleton-list" aria-label="Loading credential status" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonBlock key={i} variant="block" height={36} />
          ))}
        </div>
      ) : refused ? (
        <div className="providers-degraded-note" role="status">
          <strong>Admin access required</strong>
          <span>The paired token is not admin-scoped, so credential status stays hidden.</span>
        </div>
      ) : degradedReason !== null ? (
        <div className="providers-degraded-note" role="status">
          <strong>Credential status unavailable</strong>
          <span>{degradedReason}</span>
        </div>
      ) : credentials !== null && credentials.length === 0 ? (
        <EmptyState
          icon={<KeyRound size={24} aria-hidden="true" />}
          title="No credentials"
          description="No credential status reported by the daemon."
        />
      ) : credentials !== null ? (
        <div className="providers-model-grid" role="list" aria-label="Credentials">
          {credentials.map((entry) => {
            const matched = Boolean(
              selectedProviderId && entry.key.toLowerCase().includes(selectedProviderId.toLowerCase()),
            );
            return (
              <article
                key={entry.key}
                className={matched ? "providers-model-row providers-model-row--current" : "providers-model-row"}
                role="listitem"
                aria-label={`${entry.key}, ${credentialLabel(entry)}${matched ? ", for the selected provider" : ""}`}
              >
                <div className="providers-model-row__copy">
                  <strong>{entry.key}</strong>
                  <span>
                    {entry.source ?? "source unknown"}
                    {entry.secure === false ? " · stored without OS keychain" : ""}
                  </span>
                </div>
                <span className={`badge ${credentialTone(entry)}`}>{credentialLabel(entry)}</span>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
