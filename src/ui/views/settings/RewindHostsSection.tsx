// Which surfaces are offering their conversations for rewind
// (rewind.conversation.hosts.list), next to the daemon-lifecycle controls this
// app already owns.
//
// This sits here rather than beside the rewind button because it is a statement
// about PROCESSES, not about one session: which surface is holding which
// conversation, and whether it is still polling. It belongs with the other
// "what is running and can it be reached" rows.
//
// It also says, out loud, that this app is not one of those surfaces. See
// rewind-hosts.ts for the measurement behind that: this process has no message
// store, and a host that cannot answer costs every rewind preview for its
// session a twenty-second wait to reach the same answer it would have reached
// immediately, while evicting whichever surface genuinely held the messages.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { SETTINGS_POLL_MS } from "./settings-queries.ts";
import {
  APP_HOSTING_POSTURE,
  formatLease,
  leaseLapsed,
  readConversationRewindHosts,
} from "./rewind-hosts.ts";
import { formatWhen } from "./devices.ts";

export function RewindHostsSection() {
  const hosts = useQuery({
    queryKey: queryKeys.rewindHosts,
    queryFn: () => gv.rewind.conversation.hosts.list(),
    retry: false,
    // A lease is short and renewed by polling, so a stale list here would show
    // surfaces that have already gone. No wire event exists for the registry.
    refetchInterval: SETTINGS_POLL_MS,
  });

  const parsed = useMemo(() => readConversationRewindHosts(hosts.data), [hosts.data]);

  const unavailable = hosts.isError && isMethodUnavailableError(hosts.error);
  const bridgeDown = hosts.isError && isWsBridgeUnavailableError(hosts.error);

  return (
    <section className="settings-rewind-hosts" aria-label="Conversation rewind hosts">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <History size={14} aria-hidden="true" /> Conversation rewind hosts
        </span>
        <button type="button" onClick={() => void hosts.refetch()} disabled={hosts.isFetching}>
          <RefreshCw size={14} aria-hidden="true" className={hosts.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      <p className="settings-rewind-hosts__posture" role="status">
        {APP_HOSTING_POSTURE}
      </p>

      {hosts.isPending && <SkeletonBlock variant="text" lines={2} />}

      {unavailable && (
        <UnavailableState
          capability="rewind.conversation.hosts.list"
          description="this daemon does not report which surfaces are offering their conversations, so whether a conversation rewind can be served is not checkable from here."
        />
      )}

      {bridgeDown && !unavailable && (
        <p className="settings-rewind-hosts__note" role="status">
          This is a ws-only verb and the daemon websocket bridge is not connected, so the host registry could not
          be read.
        </p>
      )}

      {hosts.isError && !unavailable && !bridgeDown && (
        <ErrorState
          error={hosts.error}
          onRetry={() => void hosts.refetch()}
          title="Failed to read the conversation rewind hosts"
        />
      )}

      {hosts.isSuccess && parsed === null && (
        <p className="settings-rewind-hosts__note" role="status">
          The daemon answered without a `hosts` array, so nothing is shown. That is different from no surface
          offering a conversation, which is why it is not being reported as such.
        </p>
      )}

      {parsed !== null && parsed.length === 0 && (
        <EmptyState
          title="No surface is offering a conversation"
          description="Conversation rewind falls through to the daemon's own store for every session. A session the daemon is not running either reports the conversation half unavailable rather than counting zero messages."
        />
      )}

      {parsed !== null && parsed.length > 0 && (
        <ul className="settings-rewind-hosts__list">
          {parsed.map((host) => {
            const lapsed = leaseLapsed(host);
            return (
              <li
                key={host.hostId}
                className={
                  lapsed
                    ? "settings-rewind-hosts__row settings-rewind-hosts__row--lapsed"
                    : "settings-rewind-hosts__row"
                }
              >
                <div>
                  <strong>{host.label}</strong>
                  <div className="settings-rewind-hosts__detail">session {host.sessionId}</div>
                  <div className="settings-rewind-hosts__detail">
                    Offered {formatWhen(host.registeredAt)} · {formatLease(host)}
                  </div>
                </div>
                <span className="settings-rewind-hosts__state">
                  {lapsed ? "stopped polling" : "serving"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
