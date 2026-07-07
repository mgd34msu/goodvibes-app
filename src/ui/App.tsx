// Walking-skeleton shell: proves webview → proxy → daemon end to end.
// Replaced by the full AppShell in Wave A.

import { useQuery } from "@tanstack/react-query";
import { appJson } from "./lib/http.ts";
import type { AppHealth } from "../shared/app-contract.ts";

interface ControlSnapshot {
  [key: string]: unknown;
}

export function App(): React.ReactElement {
  const health = useQuery({
    queryKey: ["app", "health"],
    queryFn: () => appJson<AppHealth>("/app/health"),
    refetchInterval: 3_000,
  });

  const daemonReady = health.data?.daemon.mode === "external" || health.data?.daemon.mode === "spawned";

  const snapshot = useQuery({
    queryKey: ["control", "snapshot"],
    queryFn: () => appJson<ControlSnapshot>("/api/control-plane"),
    enabled: daemonReady,
  });

  return (
    <main className="skeleton">
      <h1>GoodVibes</h1>
      <section className="card">
        <h2>App</h2>
        {health.isPending && <p className="muted">Loading…</p>}
        {health.isError && <p className="bad">App server unreachable: {String(health.error)}</p>}
        {health.data && (
          <dl>
            <dt>Version</dt>
            <dd>{health.data.app.version}</dd>
            <dt>Daemon</dt>
            <dd className={daemonReady ? "ok" : "warn"}>
              {health.data.daemon.mode} at {health.data.daemon.baseUrl}
              {health.data.daemon.version ? ` (v${health.data.daemon.version})` : ""}
              {health.data.daemon.probeMs != null ? ` · ${health.data.daemon.probeMs}ms` : ""}
            </dd>
            {health.data.daemon.detail && <dd className="warn">{health.data.daemon.detail}</dd>}
          </dl>
        )}
      </section>
      <section className="card">
        <h2>Control plane snapshot</h2>
        {!daemonReady && <p className="muted">Waiting for daemon…</p>}
        {snapshot.isError && <p className="bad">{String(snapshot.error)}</p>}
        {snapshot.data && (
          <pre className="snapshot">{JSON.stringify(snapshot.data, null, 2).slice(0, 4000)}</pre>
        )}
      </section>
    </main>
  );
}
