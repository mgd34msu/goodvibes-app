// Realtime invalidation over the daemon's multiplexed SSE feed.
// Doctrine (webui useRealtimeInvalidation): frames only INVALIDATE query keys,
// they are never rendered directly. The sanctioned exceptions — chat token
// streaming and terminal turn events — open their own per-session streams.
// EventSource cannot carry the x-gv-app header, so this rides lib/sse.ts's
// fetch-based parser (Last-Event-ID resume + backoff built in).

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openSse } from "./sse.ts";
import { queryKeys } from "./queries.ts";
import type { SseState } from "./daemon-health.ts";

/**
 * Domain → query keys a frame on that domain revalidates. The daemon writes
 * `event: <domain>` per frame on GET /api/control-plane/events?domains=a,b,c.
 * fleet/checkpoints/memory/calendar have NO wire events (pinned upstream) —
 * their views poll; do not add their keys here without a real event.
 */
export const DOMAIN_INVALIDATIONS: Record<string, readonly (readonly unknown[])[]> = {
  tasks: [queryKeys.tasks],
  permissions: [queryKeys.approvals],
  providers: [queryKeys.providers],
  knowledge: [queryKeys.knowledgeStatus, queryKeys.knowledgeSources, queryKeys.knowledgeIssues],
  "control-plane": [queryKeys.control],
  agents: [queryKeys.agents, queryKeys.fleet],
  workflows: [queryKeys.workflows, queryKeys.fleet],
  deliveries: [queryKeys.deliveries],
  communication: [queryKeys.channels],
  mcp: [queryKeys.mcp],
};

const INVALIDATION_EVENTS_PATH = `/api/control-plane/events?domains=${Object.keys(DOMAIN_INVALIDATIONS).join(",")}`;

/** The un-domained session-update wire event rides its own narrowed stream. */
const SESSION_EVENTS_PATH = "/api/control-plane/events?domains=session";
const SESSION_UPDATE_WIRE_EVENT = "session-update";

/**
 * The ONE operator-facing string realtime failures collapse to. Transport
 * error bodies (raw daemon JSON) are never painted into a banner.
 */
export const REALTIME_PAUSED_MESSAGE =
  "Live updates paused — reconnecting. Views fall back to periodic refresh until the stream returns.";

// ---------------------------------------------------------------------------
// Module-level SSE status store — StatusStrip reads this without prop drilling.
// Tracks the state AND the epoch-ms deadline of the next reconnect attempt so
// the strip can render an honest "retry in Ns" countdown while paused.
// ---------------------------------------------------------------------------

let _sseState: SseState = "disabled";
let _sseRetryAt: number | null = null;
const _listeners = new Set<() => void>();

function notifySse(): void {
  _listeners.forEach((fn) => fn());
}

function setSseState(next: SseState): void {
  const retryAt = next === "error" ? _sseRetryAt : null;
  if (_sseState === next && _sseRetryAt === retryAt) return;
  _sseState = next;
  _sseRetryAt = retryAt;
  notifySse();
}

function setSseRetryAt(deadline: number | null): void {
  if (_sseRetryAt === deadline) return;
  _sseRetryAt = deadline;
  notifySse();
}

function subscribeSseState(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

export function useSseState(): SseState {
  return useSyncExternalStore(subscribeSseState, () => _sseState, () => _sseState);
}

/** Epoch ms of the next scheduled SSE reconnect, null unless paused. */
export function useSseRetryAt(): number | null {
  return useSyncExternalStore(subscribeSseState, () => _sseRetryAt, () => _sseRetryAt);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Open the single multiplexed invalidation stream. Returns the operator-facing
 * error copy when live updates are paused, null while healthy.
 */
export function useRealtimeInvalidation(enabled: boolean): string | null {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSseState("disabled");
      return undefined;
    }
    setSseState("connecting");
    const dispose = openSse(INVALIDATION_EVENTS_PATH, {
      onReady: () => {
        setError(null);
        setSseState("active");
      },
      onEvent: (eventName) => {
        setSseState("active");
        const keys = DOMAIN_INVALIDATIONS[eventName];
        if (!keys) return;
        for (const key of keys) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      },
      onError: () => {
        setError(REALTIME_PAUSED_MESSAGE);
        setSseState("error");
      },
      onReconnectScheduled: (delayMs) => {
        setSseRetryAt(Date.now() + delayMs);
      },
    });
    return () => {
      dispose();
      setSseState("disabled");
    };
  }, [enabled, queryClient]);

  return error;
}

export interface SessionRealtimeState {
  error: string | null;
  connected: boolean;
}

// Module-level mirror of the session-update stream health so views (Sessions,
// Fleet) can thread "live updates paused" honesty into composers without
// opening a second stream — AppShell owns the ONE useSessionRealtime mount.
let _sessionStreamPaused = true;
const _sessionStreamListeners = new Set<() => void>();

function setSessionStreamPaused(next: boolean): void {
  if (_sessionStreamPaused === next) return;
  _sessionStreamPaused = next;
  _sessionStreamListeners.forEach((fn) => fn());
}

function subscribeSessionStream(listener: () => void): () => void {
  _sessionStreamListeners.add(listener);
  return () => {
    _sessionStreamListeners.delete(listener);
  };
}

/** True while the raw session-update stream is down/reconnecting. */
export function useSessionStreamPaused(): boolean {
  return useSyncExternalStore(subscribeSessionStream, () => _sessionStreamPaused, () => _sessionStreamPaused);
}

/**
 * Consume the un-domained `session-update` wire event: invalidate the
 * 'sessions' prefix (list + every open detail/messages query). Never renders
 * from the frame.
 */
export function useSessionRealtime(enabled: boolean): SessionRealtimeState {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const dispose = openSse(SESSION_EVENTS_PATH, {
      onReady: () => {
        setConnected(true);
        setError(null);
        setSessionStreamPaused(false);
      },
      onEvent: (eventName) => {
        if (eventName !== SESSION_UPDATE_WIRE_EVENT) return;
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      },
      onError: () => {
        setConnected(false);
        setError(REALTIME_PAUSED_MESSAGE);
        setSessionStreamPaused(true);
      },
    });
    return () => {
      dispose();
      setSessionStreamPaused(true);
    };
  }, [enabled, queryClient]);

  return { error, connected };
}
