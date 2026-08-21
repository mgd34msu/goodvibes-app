// The hosted-sessions raw stream: lifecycle updates for the list, plus the LIVE
// turn/tool output of the one session this app is attached to.
//
// WHY A RAW STREAM RATHER THAN lib/realtime.ts's DOMAIN_INVALIDATIONS.
// `hosted-session-update` is a fixed wire-event NAME, not a domain name (the
// specific transition rides payload.event). useRealtimeInvalidation only
// matches frames whose `event:` field IS a domain, so a hosted-session-update
// frame is invisible to it. This is the same shape `session-update` has, and it
// gets the same treatment useSessionRealtime gives that one: its own narrowed
// stream, mounted only while the hosted panel is showing.
//
// ONE stream covers both jobs:
//  · list liveness: every hosted-session-update frame invalidates the hosted
//    list query, whichever session it names (status, counts and attached-client
//    counts all live on those rows).
//  · attach liveness: `turn`/`tools` frames whose sessionId matches the
//    attached session are decoded and handed to onStreamFrame. There is no
//    hosted-specific wire shape: a hosted loop emits exactly what a local
//    session's turn emits.
//
// THE STREAM OPENS ONCE PER `enabled` TOGGLE AND NEVER ON ATTACH/DETACH. The
// connection's path is constant; only the in-hook filtering depends on which
// session is attached, so the attached id and the callbacks are read through a
// ref that is updated every render. Reopening on each attach would burn a
// connection AND miss whatever the daemon published in the gap between close
// and reopen, which nothing replays.

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openSse } from "../../lib/sse.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError } from "../../lib/errors.ts";
import { hostedSessionIdFromLifecycle, readHostedStreamFrame, type HostedStreamFrame } from "./hosted-sessions.ts";

/** The literal wire-event name every hosted lifecycle notice rides. */
export const HOSTED_SESSION_UPDATE_WIRE_EVENT = "hosted-session-update";

/** `session` tags hosted-session-update; `turn`/`tools` carry the live output
 *  the hosted loop emits, exactly as a local session emits it. */
const HOSTED_EVENTS_PATH = "/api/control-plane/events?domains=session,turn,tools";

export const HOSTED_STREAM_PAUSED_MESSAGE =
  "Live updates paused, reconnecting. The hosted list falls back to periodic refresh until the stream returns.";

export interface UseHostedSessionRealtimeOptions {
  enabled: boolean;
  /** The attached session; turn/tools frames are forwarded only when they match. */
  attachedSessionId: string | null;
  onStreamFrame?: (frame: HostedStreamFrame) => void;
  /** The raw `{event, session, …}` payload, when it names the attached session. */
  onLifecycleUpdate?: (payload: unknown) => void;
}

export interface UseHostedSessionRealtimeResult {
  connected: boolean;
  error: string | null;
}

export function useHostedSessionRealtime(
  options: UseHostedSessionRealtimeOptions,
): UseHostedSessionRealtimeResult {
  const { enabled } = options;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Synced in its own effect (never during render) so the stream-opening effect
  // below keeps an empty dependency list beyond `enabled`.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return undefined;
    }
    const dispose = openSse(HOSTED_EVENTS_PATH, {
      onReady: () => {
        setConnected(true);
        setError(null);
      },
      onEvent: (eventName, payload) => {
        const { attachedSessionId, onStreamFrame, onLifecycleUpdate } = optionsRef.current;
        if (eventName === HOSTED_SESSION_UPDATE_WIRE_EVENT) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.hostedSessionsAll });
          if (attachedSessionId && hostedSessionIdFromLifecycle(payload) === attachedSessionId) {
            onLifecycleUpdate?.(payload);
          }
          return;
        }
        if (eventName === "turn" || eventName === "tools") {
          if (!attachedSessionId) return;
          const frame = readHostedStreamFrame(payload);
          if (frame && frame.sessionId === attachedSessionId) onStreamFrame?.(frame);
          return;
        }
        // Other `session`-domain riders carry nothing this panel renders. Same
        // "unknown key, no-op" idiom useRealtimeInvalidation uses.
      },
      onError: (streamError) => {
        setConnected(false);
        setError(`${HOSTED_STREAM_PAUSED_MESSAGE} (${formatError(streamError)})`);
      },
    });
    return () => {
      dispose();
      setConnected(false);
    };
  }, [enabled, queryClient]);

  return { connected, error };
}
