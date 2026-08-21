// Durable device capability grants, their ledger, and the housekeeping sweep
// (devices.grants.list / devices.grants.revoke / devices.housekeeping.run).
//
// Every capability asks before it runs. Choosing "always allow" on that prompt
// writes ONE durable grant, for that one capability, on that one device. This is
// where those grants are visible and revocable, which is the whole reason the
// offer can be made safely in the first place.
//
// The rows come from the daemon's own record rather than anything this app
// remembers, so what is listed is what is actually honoured. Revoking deletes
// the grant rather than flagging it, so the next request asks again; a revoke
// that removed nothing is reported as such rather than as a success, because
// telling the owner a revocation happened that did not would be the one
// failure that matters here.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import {
  formatWhen,
  housekeepingLine,
  readDeviceGrants,
  readDeviceHousekeepingReport,
  readDeviceNodesSnapshot,
  readDeviceRevokeReceipt,
  revokeReportLine,
  type DeviceGrant,
  type DeviceHousekeepingReport,
} from "./devices.ts";

export function DeviceGrantsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [sweep, setSweep] = useState<DeviceHousekeepingReport | null>(null);
  const [sweepMalformed, setSweepMalformed] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<DeviceGrant | null>(null);

  const grants = useQuery({
    queryKey: queryKeys.deviceGrants,
    queryFn: () => gv.devices.grants.list(),
    retry: false,
  });

  // Only for turning a nodeId into the label the owner recognises. A missing
  // node list degrades to showing the id, never to hiding the grant.
  const nodes = useQuery({
    queryKey: queryKeys.deviceNodes,
    queryFn: () => gv.devices.nodes.list(),
    retry: false,
  });

  const parsed = useMemo(() => readDeviceGrants(grants.data), [grants.data]);
  const nodeLabels = useMemo(() => {
    const snapshot = readDeviceNodesSnapshot(nodes.data);
    return new Map((snapshot?.nodes ?? []).map((node) => [node.nodeId, node.label]));
  }, [nodes.data]);

  const revoke = useMutation({
    mutationFn: (grant: DeviceGrant) =>
      gv.devices.grants.revoke({
        grantId: grant.grantId,
        note: "revoked from the GoodVibes desktop app settings",
      }),
    onSuccess: (result, grant) => {
      const report = revokeReportLine(readDeviceRevokeReceipt(result), grant.capabilityTitle);
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      toast({
        title: report.tone === "ok" ? "Grant revoked" : "Nothing was revoked",
        description: report.text,
        tone: report.tone === "ok" ? "success" : report.tone === "warning" ? "warning" : "info",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Revoke failed", description: formatError(error), tone: "danger" });
    },
  });

  const housekeeping = useMutation({
    mutationFn: () => gv.devices.housekeepingRun(),
    onSuccess: (result) => {
      const report = readDeviceHousekeepingReport(result);
      setSweep(report);
      setSweepMalformed(report === null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
    },
    onError: (error: unknown) => {
      toast({ title: "Housekeeping failed", description: formatError(error), tone: "danger" });
    },
  });

  const unavailable = grants.isError && isMethodUnavailableError(grants.error);

  return (
    <section className="settings-device-grants" aria-label="Device capability grants">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <KeyRound size={14} aria-hidden="true" /> Device capability grants
        </span>
        <span className="settings-device-grants__actions">
          <button type="button" onClick={() => void grants.refetch()} disabled={grants.isFetching}>
            <RefreshCw size={14} aria-hidden="true" className={grants.isFetching ? "spinning" : undefined} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => housekeeping.mutate()}
            disabled={housekeeping.isPending || unavailable}
            title="Sweep expired grants and captures past their retention window now"
          >
            {housekeeping.isPending ? "Sweeping…" : "Run housekeeping"}
          </button>
        </span>
      </div>

      <p className="settings-device-grants__description">
        Every capability asks before it runs. Choosing &ldquo;always allow&rdquo; on that prompt writes one
        durable grant, for that one capability, on that one device. Revoking deletes it, so the next request
        asks again.
      </p>

      {grants.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState
          capability="devices.grants.list"
          description="this daemon does not serve the paired-device verbs, so there are no device grants to manage here."
        />
      )}

      {grants.isError && !unavailable && (
        <ErrorState error={grants.error} onRetry={() => void grants.refetch()} title="Failed to read device grants" />
      )}

      {sweepMalformed && (
        <p className="settings-device-grants__sweep settings-device-grants__sweep--warning" role="status">
          Housekeeping ran but the daemon did not return its disclosure, so what it removed is unknown.
        </p>
      )}

      {sweep && (
        <div className="settings-device-grants__sweep" role="status">
          <strong>{housekeepingLine(sweep)}</strong>
          {sweep.grantsRemoved.length > 0 && (
            <ul>
              {sweep.grantsRemoved.map((removal) => (
                <li key={removal.grantId}>
                  Grant {removal.capabilityId} on {nodeLabels.get(removal.nodeId) ?? removal.nodeId}: {removal.reason}
                </li>
              ))}
            </ul>
          )}
          {sweep.capturesRemoved.length > 0 && (
            <ul>
              {sweep.capturesRemoved.map((removal) => (
                <li key={removal.artifactId}>
                  Capture {removal.capabilityId} on {nodeLabels.get(removal.nodeId) ?? removal.nodeId}:{" "}
                  {removal.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {grants.isSuccess && parsed === null && (
        <div className="settings-devices__malformed" role="status">
          <strong>The daemon answered without a grants list</strong>
          <span>
            devices.grants.list returned a body with no `grants` array. Nothing is shown rather than reporting
            no grants, which would be a different claim.
          </span>
        </div>
      )}

      {parsed !== null && parsed.grants.length === 0 && (
        <EmptyState
          title="No durable grants"
          description="Nothing has been granted &ldquo;always allow&rdquo; yet, so every device capability is asking each time."
        />
      )}

      {parsed !== null && parsed.grants.length > 0 && (
        <ul className="settings-device-grants__list">
          {parsed.grants.map((grant) => (
            <li key={grant.grantId} className="settings-device-grants__row">
              <div>
                <strong>{grant.capabilityTitle}</strong>
                <div className="settings-device-grants__detail">
                  {nodeLabels.get(grant.nodeId) ?? grant.nodeId} · {grant.nodeKind || "unreported kind"} ·{" "}
                  {grant.scope || "no scope reported"}
                </div>
                <div className="settings-device-grants__detail">
                  Granted {formatWhen(grant.grantedAt)}
                  {grant.grantedBy ? ` by ${grant.grantedBy}` : ""} · expires {formatWhen(grant.expiresAt)} · used{" "}
                  {grant.useCount} time{grant.useCount === 1 ? "" : "s"} · last used {formatWhen(grant.lastUsedAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingRevoke(grant)}
                disabled={revoke.isPending}
                aria-label={`Revoke ${grant.capabilityTitle}`}
              >
                <Trash2 size={14} aria-hidden="true" /> Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {parsed !== null && parsed.audit.length > 0 && (
        <details className="settings-device-grants__audit">
          <summary>Recent grant activity ({parsed.audit.length})</summary>
          <ul>
            {parsed.audit
              .slice(-25)
              .reverse()
              .map((entry) => (
                <li key={entry.id}>
                  <span>
                    {entry.action} · {entry.capabilityId} · {nodeLabels.get(entry.nodeId) ?? entry.nodeId}
                    {entry.actor ? ` · by ${entry.actor}` : ""}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                  </span>
                  <span>{formatWhen(entry.at)}</span>
                </li>
              ))}
          </ul>
        </details>
      )}

      <ConfirmSurface
        open={pendingRevoke !== null}
        action="Revoke grant"
        target={
          pendingRevoke
            ? `${pendingRevoke.capabilityTitle} on ${nodeLabels.get(pendingRevoke.nodeId) ?? pendingRevoke.nodeId}`
            : ""
        }
        blastRadius="The grant is deleted, not paused. The next request for this capability asks the person holding the device again."
        confirmLabel="Revoke"
        onConfirm={() => {
          const grant = pendingRevoke;
          setPendingRevoke(null);
          if (grant) revoke.mutate(grant);
        }}
        onCancel={() => setPendingRevoke(null)}
      />
    </section>
  );
}
