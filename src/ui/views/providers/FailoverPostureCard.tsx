// Synthetic failover posture display (docs/GAPS.md §14 row 6, MISSING).
// docs/FEATURES.md: "display-only; failover runs daemon-side" — the intended
// backing is `providers.list` + config keys named failover/fallback/synthetic
// on the provider-routing domain. A grep of the pinned config schema snapshot
// (config-schema.generated.ts, generated from @pellux/goodvibes-sdk@1.3.3
// platform/config CONFIG_SCHEMA) for "failover" / "fallback" / "synthetic"
// finds exactly ONE match — `batch.fallback`, which governs Batch-API job
// eligibility ("live" vs "fail" when a batch-requested job isn't eligible),
// not provider routing/failover. No provider.*/routing.* key of that shape
// exists on this daemon pin. Rather than fake a picker over an absent key,
// this card names the search and what it found so the gap reads as PROVEN
// absent, not merely unimplemented.

import { ShieldOff } from "lucide-react";
import { CONFIG_SCHEMA_SNAPSHOT } from "../settings/config-schema.generated.ts";

const SEARCH_TERMS = ["failover", "fallback", "synthetic"];

function matchingKeys(): ReadonlyArray<{ key: string; description: string }> {
  return CONFIG_SCHEMA_SNAPSHOT.filter((meta) =>
    SEARCH_TERMS.some((term) => meta.key.toLowerCase().includes(term) || meta.description.toLowerCase().includes(term)),
  ).map((meta) => ({ key: meta.key, description: meta.description }));
}

export function FailoverPostureCard() {
  const matches = matchingKeys();
  const providerRoutingMatch = matches.find((m) => m.key.startsWith("provider.") || m.key.startsWith("routing."));

  return (
    <section className="providers-panel providers-failover" aria-label="Synthetic failover posture">
      <div className="providers-panel__title">
        <h3>Failover Posture</h3>
        <ShieldOff size={16} aria-hidden="true" />
      </div>

      {providerRoutingMatch ? (
        <p className="providers-custom__note">
          Config key <code>{providerRoutingMatch.key}</code>: {providerRoutingMatch.description}
        </p>
      ) : (
        <div className="providers-degraded-note" role="status">
          <strong>No provider-failover config key on this daemon</strong>
          <span>
            Searched the pinned daemon config schema for keys or descriptions matching{" "}
            {SEARCH_TERMS.map((t, i) => (
              <span key={t}>
                {i > 0 ? ", " : ""}
                <code>{t}</code>
              </span>
            ))}
            .{" "}
            {matches.length === 0
              ? "No matches at all."
              : `Found ${matches.length} match${matches.length === 1 ? "" : "es"}, none on a provider.*/routing.* key — only ${matches
                  .map((m) => m.key)
                  .join(", ")}, which governs Batch API job eligibility, not model/provider routing.`}{" "}
            Synthetic failover — if the daemon runs it — is daemon-side and reports nothing to this client to
            display.
          </span>
        </div>
      )}
    </section>
  );
}
