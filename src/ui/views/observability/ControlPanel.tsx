// Daemon control snapshot + connected clients + recent messages —
// control.snapshot / control.clients.list / control.messages.list.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, bestId, bestStatus, bestTitle, compactJson, firstArray } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { obsKeys } from "./keys.ts";
import { formatTimestamp } from "./obs-wire.ts";

export function ControlPanel() {
  const snapshot = useQuery({
    queryKey: obsKeys.controlSnapshot,
    queryFn: () => gv.control.snapshot(),
    refetchInterval: 20_000,
    retry: false,
  });
  const clients = useQuery({
    queryKey: obsKeys.controlClients,
    queryFn: () => gv.control.clients(),
    refetchInterval: 15_000,
    retry: false,
  });
  const messages = useQuery({
    queryKey: obsKeys.controlMessages,
    queryFn: () => gv.invoke("control.messages.list"),
    refetchInterval: 15_000,
    retry: false,
  });

  const clientRows = useMemo(() => firstArray(clients.data, ["items", "clients", "data"]), [clients.data]);
  const messageRows = useMemo(() => firstArray(messages.data, ["items", "messages", "data"]), [messages.data]);

  return (
    <div className="obs-control">
      <section className="obs-subsection">
        <div className="obs-panel-toolbar">
          <span className="obs-panel-toolbar__summary">Control-plane snapshot</span>
          <button type="button" className="obs-btn" aria-label="Refresh control snapshot" onClick={() => void snapshot.refetch()}>
            <RefreshCw size={14} aria-hidden="true" className={snapshot.isFetching ? "spinning" : undefined} />
          </button>
        </div>
        {snapshot.isPending && <SkeletonBlock variant="text" lines={3} />}
        {snapshot.isError && isMethodUnavailableError(snapshot.error) && (
          <UnavailableState capability="control.snapshot" />
        )}
        {snapshot.isError && !isMethodUnavailableError(snapshot.error) && (
          <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} title="Failed to load control snapshot" />
        )}
        {snapshot.isSuccess && (
          <details className="obs-raw-panel" open>
            <summary>Snapshot payload</summary>
            <pre>{compactJson(snapshot.data)}</pre>
          </details>
        )}
      </section>

      <section className="obs-subsection">
        <div className="obs-panel-toolbar">
          <span className="obs-panel-toolbar__summary">Connected clients{clients.isSuccess ? ` · ${clientRows.length}` : ""}</span>
          <button type="button" className="obs-btn" aria-label="Refresh clients" onClick={() => void clients.refetch()}>
            <RefreshCw size={14} aria-hidden="true" className={clients.isFetching ? "spinning" : undefined} />
          </button>
        </div>
        {clients.isPending && <SkeletonBlock variant="text" lines={3} />}
        {clients.isError && isMethodUnavailableError(clients.error) && (
          <UnavailableState capability="control.clients.list" />
        )}
        {clients.isError && !isMethodUnavailableError(clients.error) && (
          <ErrorState error={clients.error} onRetry={() => void clients.refetch()} title="Failed to load connected clients" />
        )}
        {clients.isSuccess && clientRows.length === 0 && <EmptyState title="No connected clients" />}
        {clients.isSuccess && clientRows.length > 0 && (
          <ul className="obs-simple-rows">
            {clientRows.map((row, i) => {
              const record = asRecord(row);
              return (
                <li key={bestId(record) || i} className="obs-simple-row">
                  <span className="badge info">{bestStatus(record)}</span>
                  <span>{bestTitle(record, "client")}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="obs-subsection">
        <div className="obs-panel-toolbar">
          <span className="obs-panel-toolbar__summary">Recent messages{messages.isSuccess ? ` · ${messageRows.length}` : ""}</span>
          <button type="button" className="obs-btn" aria-label="Refresh messages" onClick={() => void messages.refetch()}>
            <RefreshCw size={14} aria-hidden="true" className={messages.isFetching ? "spinning" : undefined} />
          </button>
        </div>
        {messages.isPending && <SkeletonBlock variant="text" lines={3} />}
        {messages.isError && isMethodUnavailableError(messages.error) && (
          <UnavailableState capability="control.messages.list" />
        )}
        {messages.isError && !isMethodUnavailableError(messages.error) && (
          <ErrorState error={messages.error} onRetry={() => void messages.refetch()} title="Failed to load messages" />
        )}
        {messages.isSuccess && messageRows.length === 0 && <EmptyState title="No recent control-plane messages" />}
        {messages.isSuccess && messageRows.length > 0 && (
          <ul className="obs-simple-rows">
            {messageRows.map((row, i) => {
              const record = asRecord(row);
              const timestamp = record["timestamp"] ?? record["ts"] ?? record["time"];
              return (
                <li key={bestId(record) || i} className="obs-simple-row">
                  <span className="obs-simple-row__time">{formatTimestamp(timestamp)}</span>
                  <span>{bestTitle(record, "message")}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
