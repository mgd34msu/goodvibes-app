// AccountsPanel — structured provider accounts/subscription health over
// accounts.snapshot (docs/FEATURES.md §14 "Accounts snapshot (route posture,
// fallback risk)" + "Subscriptions status"). Ported from goodvibes-webui
// src/components/AccountsPanel.tsx, owning its query here: accounts.snapshot
// has NO wire event on this pin (not in DOMAIN_INVALIDATIONS), so the panel
// polls on a 30s refetchInterval while mounted.

import { useQuery } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, firstArrayAtPath, firstString } from "../../lib/wire.ts";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";

interface AccountRow {
  readonly providerId: string;
  readonly configured: boolean;
  readonly activeRoute: string;
  readonly authFreshness: string;
  readonly modelCount: number;
  readonly usageWindows: readonly { label: string; detail: string }[];
  readonly issues: readonly string[];
  readonly recommendedActions: readonly string[];
}

function toAccountRow(raw: unknown): AccountRow | null {
  const record = asRecord(raw);
  const providerId = firstString(record, ["providerId", "id"]);
  if (!providerId) return null;
  return {
    providerId,
    configured: record["configured"] === true,
    activeRoute: firstString(record, ["activeRoute"]) || "unconfigured",
    authFreshness: firstString(record, ["authFreshness"]) || "status unavailable",
    modelCount: typeof record["modelCount"] === "number" ? record["modelCount"] : 0,
    usageWindows: firstArrayAtPath(record, [["usageWindows"]]).map((w) => ({
      label: firstString(w, ["label"]) || "window",
      detail: firstString(w, ["detail"]),
    })),
    issues: firstArrayAtPath(record, [["issues"]]).filter((i): i is string => typeof i === "string"),
    recommendedActions: firstArrayAtPath(record, [["recommendedActions"]]).filter(
      (i): i is string => typeof i === "string",
    ),
  };
}

export function AccountsPanel() {
  const accounts = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => gv.accounts.snapshot(),
    // No `accounts` wire event exists on this pin — poll while visible.
    refetchInterval: 30_000,
  });

  const rows = firstArrayAtPath(accounts.data, [["providers"], ["accounts"], ["items"]])
    .map(toAccountRow)
    .filter((row): row is AccountRow => row !== null);
  const top = asRecord(accounts.data);
  const configuredCount =
    typeof top["configuredCount"] === "number" ? top["configuredCount"] : rows.filter((r) => r.configured).length;
  const issueCount =
    typeof top["issueCount"] === "number" ? top["issueCount"] : rows.reduce((sum, r) => sum + r.issues.length, 0);

  const unavailable = accounts.isError && isMethodUnavailableError(accounts.error);

  return (
    <section className="providers-panel providers-accounts" aria-label="Accounts and subscriptions">
      <div className="providers-panel__title">
        <h3>Accounts &amp; Subscriptions</h3>
        <Landmark size={16} aria-hidden="true" />
      </div>

      {accounts.isPending ? (
        <div className="providers-skeleton-list" aria-label="Loading accounts" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonBlock key={i} variant="block" height={44} />
          ))}
        </div>
      ) : unavailable ? (
        <UnavailableState
          capability="accounts.snapshot"
          description="provider account posture, usage windows, and subscription issues cannot be shown."
        />
      ) : accounts.isError ? (
        <ErrorState
          error={accounts.error}
          title="Account snapshot unavailable"
          onRetry={() => void accounts.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Landmark size={24} aria-hidden="true" />}
          title="No account data"
          description="No provider account snapshot reported by the daemon."
        />
      ) : (
        <>
          <p className="providers-accounts__summary">
            {configuredCount} of {rows.length} providers configured
            {issueCount > 0 ? ` · ${issueCount} issue${issueCount === 1 ? "" : "s"}` : ""}
          </p>
          <div className="providers-model-grid" role="list" aria-label="Provider accounts">
            {rows.map((row) => (
              <article key={row.providerId} className="providers-model-row" role="listitem">
                <div className="providers-model-row__copy">
                  <strong>{row.providerId}</strong>
                  <span>
                    {row.activeRoute} · {row.modelCount} model{row.modelCount === 1 ? "" : "s"}
                  </span>
                  {row.usageWindows.length > 0 && (
                    <ul className="providers-accounts__windows">
                      {row.usageWindows.map((w) => (
                        <li key={w.label}>
                          {w.label}
                          {w.detail ? `: ${w.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.issues.length > 0 && (
                    <ul className="providers-accounts__issues">
                      {row.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  {row.recommendedActions.length > 0 && (
                    <ul className="providers-accounts__actions">
                      {row.recommendedActions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <StatusBadge value={row.authFreshness} />
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
