// Connection diagnostics (docs/FEATURES.md §17): the shared SSE connector
// state from lib/realtime.ts (read-only — that connector is mounted once by
// the app shell, so this view surfaces its state rather than owning it) plus
// an app-local rolling latency prober against /app/health that this view
// DOES own, with its own pause/resume and a reconnect (failure) counter.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { appFetch } from "../../lib/http.ts";
import { formatLatency, sseDetailLabel } from "../../lib/daemon-health.ts";
import { useSseRetryAt, useSseState } from "../../lib/realtime.ts";

const PROBE_INTERVAL_MS = 5_000;
const SAMPLE_CAP = 30;

interface LatencySample {
  atMs: number;
  latencyMs: number | null;
}

export function DiagnosticsSection() {
  const sse = useSseState();
  const sseRetryAt = useSseRetryAt();
  const [now, setNow] = useState(() => Date.now());
  const [samples, setSamples] = useState<LatencySample[]>([]);
  const [probing, setProbing] = useState(true);
  const [reconnectCount, setReconnectCount] = useState(0);
  const wasDownRef = useRef(false);

  useEffect(() => {
    if (sse !== "error") return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [sse]);

  useEffect(() => {
    if (!probing) return undefined;
    let cancelled = false;

    async function probeOnce(): Promise<void> {
      const start = performance.now();
      let latencyMs: number | null = null;
      try {
        const res = await appFetch("/app/health");
        latencyMs = res.ok ? Math.round(performance.now() - start) : null;
      } catch {
        latencyMs = null;
      }
      if (cancelled) return;
      if (latencyMs === null && wasDownRef.current === false) {
        setReconnectCount((n) => n + 1);
      }
      wasDownRef.current = latencyMs === null;
      setSamples((prev) => [...prev, { atMs: Date.now(), latencyMs }].slice(-SAMPLE_CAP));
    }

    void probeOnce();
    const interval = setInterval(() => void probeOnce(), PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [probing]);

  const ok = samples.filter((s) => s.latencyMs !== null).map((s) => s.latencyMs as number);
  const avg = ok.length > 0 ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null;
  const min = ok.length > 0 ? Math.min(...ok) : null;
  const max = ok.length > 0 ? Math.max(...ok) : null;
  const failureCount = samples.filter((s) => s.latencyMs === null).length;
  const latest = samples[samples.length - 1];

  return (
    <div className="obs-diagnostics">
      <section className="obs-subsection">
        <h3>Live updates (shared connector)</h3>
        <p className="obs-diagnostics__row">
          <span className={sse === "active" ? "badge ok" : sse === "connecting" ? "badge info" : sse === "error" ? "badge bad" : "badge neutral"}>
            {sseDetailLabel(sse, sseRetryAt, now)}
          </span>
          <span>
            This is the app-wide invalidation stream every view relies on for realtime updates — it is owned by the
            shell and reconnects on its own with exponential backoff; nothing here can force it, but the state is
            reported honestly.
          </span>
        </p>
        {sse === "error" && (
          <div className="obs-diagnostics__banner" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Live updates paused — views are falling back to periodic refresh until the stream reconnects.</span>
          </div>
        )}
      </section>

      <section className="obs-subsection">
        <div className="obs-panel-toolbar">
          <h3 className="obs-panel-toolbar__summary">Local health-probe latency (rolling, this view's own probe)</h3>
          <button type="button" className="obs-btn" onClick={() => setProbing((p) => !p)}>
            {probing ? "Pause probing" : "Resume probing"}
          </button>
        </div>

        {samples.length === 0 ? (
          <p className="obs-diagnostics__note">{probing ? "Probing /app/health…" : "Probing paused — no samples yet."}</p>
        ) : (
          <>
            <div className="obs-stat-row" role="list" aria-label="Latency stats">
              <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                <span className="obs-stat-tile__value">{latest ? formatLatency(latest.latencyMs) : "—"}</span>
                <span className="obs-stat-tile__label">Latest</span>
              </div>
              <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                <span className="obs-stat-tile__value">{formatLatency(avg)}</span>
                <span className="obs-stat-tile__label">Average ({ok.length} samples)</span>
              </div>
              <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                <span className="obs-stat-tile__value">{formatLatency(min)} – {formatLatency(max)}</span>
                <span className="obs-stat-tile__label">Range</span>
              </div>
              <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                <span className="obs-stat-tile__value">{reconnectCount}</span>
                <span className="obs-stat-tile__label">Reconnects (down → up transitions)</span>
              </div>
              <div className="obs-stat-tile obs-stat-tile--compact" role="listitem">
                <span className="obs-stat-tile__value">{failureCount}</span>
                <span className="obs-stat-tile__label">Failed probes (of last {samples.length})</span>
              </div>
            </div>

            <ul className="obs-diagnostics__sparkline" aria-label="Recent latency samples, oldest to newest">
              {samples.map((sample) => (
                <li
                  key={sample.atMs}
                  className={sample.latencyMs === null ? "obs-diagnostics__bar obs-diagnostics__bar--down" : "obs-diagnostics__bar"}
                  style={sample.latencyMs !== null ? { height: `${Math.min(100, 8 + sample.latencyMs / 5)}%` } : undefined}
                  title={`${new Date(sample.atMs).toLocaleTimeString()} — ${sample.latencyMs === null ? "failed" : formatLatency(sample.latencyMs)}`}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
