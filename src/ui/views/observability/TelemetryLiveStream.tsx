// Live telemetry stream — telemetry.stream, a pausable live tail with a
// buffer cap. This is one of the sanctioned "render straight from SSE
// frames" exceptions (docs/UX.md §4 / lib/realtime.ts docblock): the tail IS
// the feature, not an invalidation signal. Pausing stops painting new frames
// but keeps buffering (capped) so nothing is silently dropped, and the panel
// says exactly how many are waiting — never a silent freeze.

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { openSse } from "../../lib/sse.ts";
import { compactJson } from "../../lib/wire.ts";
import { formatTimestamp } from "./obs-wire.ts";

interface TailFrame {
  seq: number;
  event: string;
  data: unknown;
  receivedAtMs: number;
}

const BUFFER_CAP = 500;

export function TelemetryLiveStream() {
  const [frames, setFrames] = useState<TailFrame[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [bufferedWhilePaused, setBufferedWhilePaused] = useState(0);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const seqRef = useRef(0);
  const pendingRef = useRef<TailFrame[]>([]);

  const flushPending = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    const toAdd = pendingRef.current;
    pendingRef.current = [];
    setFrames((prev) => [...toAdd, ...prev].slice(0, BUFFER_CAP));
    setBufferedWhilePaused(0);
  }, []);

  useEffect(() => {
    setStreamError(null);
    const path = gv.streamPath("telemetry.stream");
    const dispose = openSse(path, {
      onReady: () => {
        setConnected(true);
        setStreamError(null);
      },
      onEvent: (event, data) => {
        seqRef.current += 1;
        const frame: TailFrame = { seq: seqRef.current, event, data, receivedAtMs: Date.now() };
        if (pausedRef.current) {
          pendingRef.current = [frame, ...pendingRef.current].slice(0, BUFFER_CAP);
          setBufferedWhilePaused(pendingRef.current.length);
        } else {
          setFrames((prev) => [frame, ...prev].slice(0, BUFFER_CAP));
        }
      },
      onError: () => {
        setConnected(false);
        setStreamError("Live stream disconnected — reconnecting.");
      },
    });
    return () => {
      dispose();
      setConnected(false);
    };
  }, []);

  function togglePause(): void {
    setPaused((prev) => {
      const next = !prev;
      if (!next) flushPending();
      return next;
    });
  }

  function clearBuffer(): void {
    setFrames([]);
    pendingRef.current = [];
    setBufferedWhilePaused(0);
  }

  return (
    <div className="obs-live-stream">
      <div className="obs-live-stream__toolbar">
        <span className={connected ? "badge ok" : "badge bad"}>{connected ? "connected" : "disconnected"}</span>
        {paused && bufferedWhilePaused > 0 && (
          <span className="badge warning">paused, {bufferedWhilePaused} buffered</span>
        )}
        {streamError && <span className="obs-live-stream__error">{streamError}</span>}
        <button type="button" className="obs-btn" onClick={togglePause}>
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" className="obs-btn" onClick={clearBuffer}>
          <Trash2 size={14} aria-hidden="true" /> Clear
        </button>
      </div>

      {frames.length === 0 ? (
        <p className="obs-live-stream__empty">
          {paused ? "Paused — no frames buffered yet." : "Waiting for the daemon to emit a telemetry frame…"}
        </p>
      ) : (
        <ul className="obs-live-stream__list" aria-label="Live telemetry frames" aria-live="off">
          {frames.map((frame) => (
            <li key={frame.seq} className="obs-live-stream__frame">
              <span className="obs-live-stream__frame-head">
                <code>{frame.event}</code>
                <span>{formatTimestamp(frame.receivedAtMs)}</span>
              </span>
              <pre className="obs-live-stream__frame-body">{compactJson(frame.data)}</pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
