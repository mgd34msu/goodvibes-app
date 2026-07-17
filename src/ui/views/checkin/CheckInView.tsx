// Check-in — the proactive contact loop: config (enabled/cadence/channel/
// quiet hours), manual run-now, and the receipts every run leaves (contact
// or not). Crib: goodvibes-webui src/views/checkin/CheckInView.tsx.
//
// checkin.* emits no wire event (a standing gap shared with fleet.*,
// checkpoints.*, ci.*), so freshness comes from mutation-driven invalidation
// and a manual refresh, not realtime invalidation.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw, Settings2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { CheckInConfigForm } from "./CheckInConfigForm.tsx";
import { CheckInReceiptRow } from "./CheckInReceiptRow.tsx";
import {
  outcomeTone,
  parseCheckinConfig,
  parseCheckinReceipts,
  parseCheckinRunResult,
  runOutcomeLabel,
  type CheckinRunResult,
} from "./checkin-wire.ts";

const checkinKeys = {
  config: ["checkin", "config"] as const,
  receipts: ["checkin", "receipts"] as const,
};

export function CheckInView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [runResult, setRunResult] = useState<CheckinRunResult | null>(null);

  const config = useQuery({
    queryKey: checkinKeys.config,
    queryFn: async () => parseCheckinConfig(await gv.checkin.config.get()),
    retry: false,
  });

  const receipts = useQuery({
    queryKey: checkinKeys.receipts,
    queryFn: async () => parseCheckinReceipts(await gv.checkin.receipts()),
    retry: false,
  });

  const run = useMutation({
    mutationFn: async () => parseCheckinRunResult(await gv.checkin.run()),
    onSuccess: async (result) => {
      setRunResult(result);
      await queryClient.invalidateQueries({ queryKey: checkinKeys.receipts });
    },
    onError: (error: unknown) => {
      toast({
        title: isMethodUnavailableError(error) ? "Check-in unavailable on this daemon" : "Check-in run failed",
        description: isMethodUnavailableError(error) ? undefined : formatError(error),
        tone: "danger",
      });
    },
  });

  useEffect(() => {
    registerCommand({
      id: "checkin.run-now",
      title: "Check-in: Run Now",
      group: "automate",
      keywords: ["checkin", "check-in", "proactive", "run"],
      run: () => run.mutate(),
    });
    return () => unregisterCommand("checkin.run-now");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configUnavailable = config.isError && isMethodUnavailableError(config.error);
  const receiptsUnavailable = receipts.isError && isMethodUnavailableError(receipts.error);
  const list = receipts.data ?? [];

  return (
    <div className="checkin-view">
      <section className="checkin-section">
        <div className="checkin-section__header">
          <h2>Configuration</h2>
          <div className="checkin-section__actions">
            <button
              className="checkin-icon-button"
              type="button"
              title="Refresh"
              aria-label="Refresh check-in configuration"
              onClick={() => void config.refetch()}
            >
              <RefreshCw size={15} aria-hidden="true" className={config.isFetching ? "spinning" : undefined} />
            </button>
          </div>
        </div>

        {config.isPending && <SkeletonBlock variant="text" lines={4} />}
        {configUnavailable && (
          <UnavailableState
            capability="checkin.config.get"
            description="proactive check-in configuration cannot be read or edited on this daemon."
          />
        )}
        {config.isError && !configUnavailable && (
          <ErrorState error={config.error} onRetry={() => void config.refetch()} title="Failed to load check-in config" />
        )}
        {config.isSuccess && !editing && (
          <div className="checkin-config-display">
            <div className="checkin-config-display__row">
              <span className={`badge ${config.data.enabled ? "ok" : "neutral"}`}>
                {config.data.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <dl className="checkin-config-display__fields">
              <dt>Cadence</dt>
              <dd>{config.data.cadence || "—"}</dd>
              <dt>Delivery channel</dt>
              <dd>{config.data.deliveryChannel || "—"}</dd>
              <dt>Quiet hours</dt>
              <dd>{config.data.quietHours || "—"}</dd>
            </dl>
            <button type="button" className="checkin-config-display__edit" onClick={() => setEditing(true)}>
              <Settings2 size={14} aria-hidden="true" /> Edit
            </button>
          </div>
        )}
        {config.isSuccess && editing && (
          <CheckInConfigForm
            config={config.data}
            onSaved={() => {
              setEditing(false);
              void config.refetch();
            }}
            onCancel={() => setEditing(false)}
          />
        )}
      </section>

      <section className="checkin-section">
        <div className="checkin-section__header">
          <h2>Run now</h2>
        </div>
        <button
          type="button"
          className="checkin-run-button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          aria-busy={run.isPending}
        >
          <Play size={14} aria-hidden="true" /> {run.isPending ? "Running…" : "Run check-in now"}
        </button>
        {runResult && (
          <div className="checkin-run-result" role="status">
            <span className={`badge ${outcomeTone(runResult.outcome)}`}>{runOutcomeLabel(runResult.outcome)}</span>
            <p className="checkin-receipt__summary">{runResult.summary}</p>
          </div>
        )}
      </section>

      <section className="checkin-section">
        <div className="checkin-section__header">
          <h2>Recent receipts</h2>
          <div className="checkin-section__actions">
            <button
              className="checkin-icon-button"
              type="button"
              title="Refresh"
              aria-label="Refresh check-in receipts"
              onClick={() => void receipts.refetch()}
            >
              <RefreshCw size={15} aria-hidden="true" className={receipts.isFetching ? "spinning" : undefined} />
            </button>
          </div>
        </div>
        {receipts.isPending && <SkeletonBlock variant="text" lines={4} />}
        {receiptsUnavailable && (
          <UnavailableState
            capability="checkin.receipts.list"
            description="check-in run receipts are not available on this daemon."
          />
        )}
        {receipts.isError && !receiptsUnavailable && (
          <ErrorState error={receipts.error} onRetry={() => void receipts.refetch()} title="Failed to load receipts" />
        )}
        {receipts.isSuccess && list.length === 0 && (
          <EmptyState
            title="No check-in runs yet"
            description="Receipts appear here after the first scheduled or manual run."
          />
        )}
        {list.length > 0 && (
          <ul className="checkin-receipts">
            {list.map((receipt) => (
              <CheckInReceiptRow key={receipt.id} receipt={receipt} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
