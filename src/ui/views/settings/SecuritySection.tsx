// Security settings read (docs/FEATURES.md §20 "Security settings snapshot"):
// GET security.settings — the daemon's own audit of security-relevant flags
// (default vs current state, what enabling each one does, when it is
// insecure). Read-only here; edits go through the config editor's key rows.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RefreshCw, ShieldAlert } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { asArray, asRecord, firstString } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { settingsKeys, SETTINGS_POLL_MS } from "./settings-queries.ts";

interface SecurityRow {
  key: string;
  type: string;
  defaultState: string;
  currentState: string;
  securityRelevant: boolean;
  summary: string;
  insecureWhen: string;
  enablementEffect: string;
  enablementRequirements: string[];
  operationalNotes: string[];
}

function readRows(data: unknown): SecurityRow[] {
  return asArray(asRecord(data)["settings"]).map((raw) => {
    const record = asRecord(raw);
    return {
      key: firstString(record, ["key"]),
      type: firstString(record, ["type"]),
      defaultState: firstString(record, ["defaultState"]),
      currentState: firstString(record, ["currentState"]),
      securityRelevant: record["securityRelevant"] === true,
      summary: firstString(record, ["summary"]),
      insecureWhen: firstString(record, ["insecureWhen"]),
      enablementEffect: firstString(record, ["enablementEffect"]),
      enablementRequirements: asArray(record["enablementRequirements"]).filter(
        (v): v is string => typeof v === "string",
      ),
      operationalNotes: asArray(record["operationalNotes"]).filter((v): v is string => typeof v === "string"),
    };
  });
}

export function SecuritySection() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const security = useQuery({
    queryKey: settingsKeys.security,
    queryFn: () => gv.invoke("security.settings"),
    retry: false,
    // No wire event for security-settings churn — targeted poll.
    refetchInterval: SETTINGS_POLL_MS,
  });

  const rows = useMemo(() => readRows(security.data), [security.data]);
  const changedCount = rows.filter((r) => r.currentState !== r.defaultState).length;

  const unavailable = security.isError && isMethodUnavailableError(security.error);

  return (
    <section className="settings-security" aria-label="Security settings">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <ShieldAlert size={14} aria-hidden="true" /> Security posture
          {security.isSuccess ? ` · ${rows.length} flags · ${changedCount} changed from default` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh security settings"
          onClick={() => void security.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={security.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {security.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState
          capability="security.settings"
          description="the daemon's security-flag audit cannot be shown."
        />
      )}

      {security.isError && !unavailable && (
        <ErrorState error={security.error} onRetry={() => void security.refetch()} title="Failed to load security settings" />
      )}

      {security.isSuccess && rows.length === 0 && (
        <EmptyState title="No security settings reported" description="The daemon returned an empty security audit." />
      )}

      {security.isSuccess && rows.length > 0 && (
        <ul className="settings-security__rows">
          {rows.map((row) => {
            const changed = row.currentState !== row.defaultState;
            const open = expanded === row.key;
            return (
              <li key={row.key} className="settings-security__row">
                <button
                  type="button"
                  className="settings-security__head"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : row.key)}
                >
                  {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  <code className="settings-security__key">{row.key}</code>
                  <span className="settings-security__badges">
                    {row.securityRelevant && <span className="badge warning">security-relevant</span>}
                    <StatusBadge value={row.currentState || "unknown"} />
                    {changed && <span className="badge info">default: {row.defaultState}</span>}
                  </span>
                </button>
                {row.summary && <p className="settings-security__summary">{row.summary}</p>}
                {open && (
                  <dl className="settings-security__detail">
                    {row.insecureWhen && (
                      <>
                        <dt>Insecure when</dt>
                        <dd>{row.insecureWhen}</dd>
                      </>
                    )}
                    {row.enablementEffect && (
                      <>
                        <dt>Enabling it</dt>
                        <dd>{row.enablementEffect}</dd>
                      </>
                    )}
                    {row.enablementRequirements.length > 0 && (
                      <>
                        <dt>Requires</dt>
                        <dd>{row.enablementRequirements.join("; ")}</dd>
                      </>
                    )}
                    {row.operationalNotes.length > 0 && (
                      <>
                        <dt>Notes</dt>
                        <dd>{row.operationalNotes.join(" ")}</dd>
                      </>
                    )}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
