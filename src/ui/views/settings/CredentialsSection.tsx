// Credentials snapshot (docs/FEATURES.md §19): GET credentials.get returns
// STATUS METADATA ONLY (configured/usable/source/scope/secure flags) — no
// secret material ever crosses the wire, so nothing here needs masking. The
// actual secrets manager (set/link/test) has no wire method on this daemon
// pin; that gap renders honestly below.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError, errorStatus } from "../../lib/errors.ts";
import { asArray, asRecord, firstString } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { settingsKeys, SETTINGS_POLL_MS } from "./settings-queries.ts";

interface CredentialRow {
  key: string;
  configured: boolean;
  usable: boolean;
  source: string;
  scope: string;
  secure: boolean;
  overriddenByEnv: boolean;
  refSource: string;
}

function readRows(data: unknown): CredentialRow[] {
  return asArray(asRecord(data)["credentials"]).map((raw) => {
    const record = asRecord(raw);
    return {
      key: firstString(record, ["key"]),
      configured: record["configured"] === true,
      usable: record["usable"] === true,
      source: firstString(record, ["source"]),
      scope: firstString(record, ["scope"]),
      secure: record["secure"] === true,
      overriddenByEnv: record["overriddenByEnv"] === true,
      refSource: firstString(record, ["refSource"]),
    };
  });
}

export function CredentialsSection() {
  const credentials = useQuery({
    queryKey: settingsKeys.credentials,
    queryFn: () => gv.config.credentials(),
    retry: false,
    // No wire event for credential-store churn — targeted poll.
    refetchInterval: SETTINGS_POLL_MS,
  });

  const rows = useMemo(() => readRows(credentials.data), [credentials.data]);
  const storeAvailable = asRecord(credentials.data)["available"] !== false;

  const refused = credentials.isError && errorStatus(credentials.error) === 403;
  const unavailable = credentials.isError && !refused && isMethodUnavailableError(credentials.error);

  return (
    <section className="settings-credentials" aria-label="Credential status">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <KeyRound size={14} aria-hidden="true" /> Credentials
          {credentials.isSuccess ? ` · ${rows.filter((r) => r.configured).length}/${rows.length} configured` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh credentials"
          onClick={() => void credentials.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={credentials.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      <p className="settings-credentials__note">
        Status only — configured/usable flags and where each credential resolves from. Secret values never leave the
        daemon. Editing secrets has no wire method on this daemon; use the TUI's secrets manager.
      </p>

      {credentials.isPending && <SkeletonBlock variant="text" lines={4} />}

      {refused && (
        <div className="settings-refused" role="status">
          <strong>Admin access required</strong>
          <span>Credential status needs an admin-scoped principal.</span>
        </div>
      )}

      {unavailable && (
        <UnavailableState capability="credentials.get" description="the credential status snapshot is not served." />
      )}

      {credentials.isError && !refused && !unavailable && (
        <ErrorState
          error={credentials.error}
          onRetry={() => void credentials.refetch()}
          title="Failed to load credential status"
        />
      )}

      {credentials.isSuccess && !storeAvailable && (
        <div className="settings-refused" role="status">
          <strong>Credential store unavailable</strong>
          <span>The daemon reports its credential store as unavailable.</span>
        </div>
      )}

      {credentials.isSuccess && storeAvailable && rows.length === 0 && (
        <EmptyState title="No credentials tracked" description="No provider or integration credential slots reported." />
      )}

      {credentials.isSuccess && storeAvailable && rows.length > 0 && (
        <div className="settings-credentials__table-wrap">
          <table className="settings-credentials__table">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Configured</th>
                <th scope="col">Usable</th>
                <th scope="col">Source</th>
                <th scope="col">Scope</th>
                <th scope="col">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    <code>{row.key}</code>
                  </th>
                  <td>
                    <span className={row.configured ? "badge ok" : "badge neutral"}>
                      {row.configured ? "yes" : "no"}
                    </span>
                  </td>
                  <td>
                    <span className={row.usable ? "badge ok" : row.configured ? "badge bad" : "badge neutral"}>
                      {row.usable ? "yes" : "no"}
                    </span>
                  </td>
                  <td>
                    {row.source || "—"}
                    {row.refSource ? ` (${row.refSource})` : ""}
                  </td>
                  <td>{row.scope || "—"}</td>
                  <td className="settings-credentials__flags">
                    {row.secure && <span className="badge ok">secure</span>}
                    {!row.secure && row.configured && <span className="badge warning">plaintext</span>}
                    {row.overriddenByEnv && <span className="badge info">env override</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
