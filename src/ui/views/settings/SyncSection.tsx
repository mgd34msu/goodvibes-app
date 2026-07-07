// Settings-sync / storage posture (docs/FEATURES.md §19): GET settings.snapshot
// returns the settings INTEGRATION snapshot — live key counts, profiles,
// managed locks, sync conflicts, recent apply failures — not a config schema
// (the schema ships pinned in config-schema.generated.ts). When the
// integration is off the daemon says so with {available:false, reason}.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderSync, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { settingsKeys, SETTINGS_POLL_MS } from "./settings-queries.ts";

export function SyncSection() {
  const snapshot = useQuery({
    queryKey: settingsKeys.syncSnapshot,
    queryFn: () => gv.invoke("settings.snapshot"),
    retry: false,
    // No wire event for the settings integration — targeted poll.
    refetchInterval: SETTINGS_POLL_MS,
  });

  const record = asRecord(snapshot.data);
  const available = record["available"] === true;
  const conflicts = useMemo(() => asArray(record["conflicts"]), [record]);
  const failures = useMemo(() => asArray(record["recentFailures"]), [record]);

  const unavailable = snapshot.isError && isMethodUnavailableError(snapshot.error);

  return (
    <section className="settings-sync" aria-label="Settings sync">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <FolderSync size={14} aria-hidden="true" /> Settings sync &amp; storage
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh settings snapshot"
          onClick={() => void snapshot.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={snapshot.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {snapshot.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState capability="settings.snapshot" description="the settings-sync integration snapshot is not served." />
      )}

      {snapshot.isError && !unavailable && (
        <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} title="Failed to load settings snapshot" />
      )}

      {snapshot.isSuccess && !available && (
        <div className="settings-refused" role="status">
          <strong>Settings integration off</strong>
          <span>{firstString(record, ["reason"]) || "The daemon reports the settings integration as unavailable."}</span>
        </div>
      )}

      {snapshot.isSuccess && available && (
        <>
          <div className="settings-sync__stats">
            <Stat label="Live keys" value={firstNumber(record, ["liveKeyCount"])} />
            <Stat label="Profiles" value={firstNumber(record, ["profileCount"])} />
            <Stat label="Managed locks" value={firstNumber(record, ["managedLockCount"])} />
            <Stat label="Sync conflicts" value={conflicts.length} warn={conflicts.length > 0} />
          </div>

          {conflicts.length > 0 && (
            <div className="settings-sync__conflicts">
              <h3>Conflicts</h3>
              <ul>
                {conflicts.map((raw, i) => {
                  const conflict = asRecord(raw);
                  return (
                    <li key={`${firstString(conflict, ["key"])}-${i}`}>
                      <code>{firstString(conflict, ["key"])}</code> — local{" "}
                      <code>{JSON.stringify(conflict["localValue"])}</code> vs incoming{" "}
                      <code>{JSON.stringify(conflict["incomingValue"])}</code>{" "}
                      <span className="settings-sync__meta">({firstString(conflict, ["path"]) || "unknown path"})</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {failures.length > 0 && (
            <div className="settings-sync__failures">
              <h3>Recent failures</h3>
              <ul>
                {failures.map((raw, i) => {
                  const failure = asRecord(raw);
                  const ts = firstNumber(failure, ["timestamp"]);
                  return (
                    <li key={i}>
                      <span className="badge bad">{firstString(failure, ["surface"]) || "unknown surface"}</span>{" "}
                      {firstString(failure, ["message"])}
                      {ts !== undefined && <span className="settings-sync__meta"> — {new Date(ts).toLocaleString()}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: number | undefined; warn?: boolean }) {
  return (
    <div className={warn ? "settings-sync__stat settings-sync__stat--warn" : "settings-sync__stat"}>
      <span className="settings-sync__stat-value">{value ?? "—"}</span>
      <span className="settings-sync__stat-label">{label}</span>
    </div>
  );
}
