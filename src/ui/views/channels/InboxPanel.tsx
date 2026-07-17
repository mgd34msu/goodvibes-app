// Channels inbox (docs/FEATURES.md §13 "Inbox (triage-decorated)"):
// channels.inbox.list rendered with its triage decorations preserved —
// unread marker, provider + kind badges, attachment count, route/thread ids.
// Read-only observability (pages observe, modals configure); replies happen
// through channel actions.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Paperclip } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { formatRelative } from "../../lib/wire.ts";
import { channelsKeys } from "./keys.ts";
import { QueryPanel } from "./QueryPanel.tsx";
import { readInbox, type InboxItem } from "./channels-wire.ts";

/** communication-domain invalidation is the fast path; inbound traffic on
 * quiet providers may not emit a frame, so a 30s poll is the honesty floor. */
const INBOX_POLL_MS = 30_000;
const INBOX_LIMIT = 100;

export function InboxPanel() {
  const [providerFilter, setProviderFilter] = useState("");

  const inbox = useQuery({
    queryKey: channelsKeys.inbox(providerFilter, INBOX_LIMIT),
    queryFn: () =>
      invoke("channels.inbox.list", {
        query: { limit: INBOX_LIMIT, provider: providerFilter || undefined },
      }),
    refetchInterval: INBOX_POLL_MS,
    select: readInbox,
  });

  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const item of inbox.data?.items ?? []) if (item.provider) set.add(item.provider);
    if (providerFilter) set.add(providerFilter);
    return [...set].sort();
  }, [inbox.data, providerFilter]);

  return (
    <div className="channels-inbox">
      <div className="channels-filter-row">
        <label className="channels-filter">
          <span>Provider</span>
          <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {inbox.isSuccess && (
          <span className="channels-filter-row__summary">
            {inbox.data.items.length} of {inbox.data.total}
            {inbox.data.truncated ? " (truncated)" : ""}
          </span>
        )}
      </div>

      <QueryPanel
        query={inbox}
        capability="channels.inbox.list"
        unavailableDescription="the unified channel inbox cannot be listed."
        errorTitle="Failed to load inbox"
        isEmpty={(page) => page.items.length === 0}
        emptyIcon={<Inbox size={28} aria-hidden="true" />}
        emptyTitle="Inbox is empty"
        emptyDescription={
          providerFilter
            ? `No inbound messages from ${providerFilter}.`
            : "Inbound messages from connected channel surfaces land here with their triage decorations."
        }
        skeletonLines={6}
      >
        {(page) => (
          <ul className="channels-inbox__list" aria-label="Inbox messages">
            {page.items.map((item) => (
              <InboxRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </QueryPanel>
    </div>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  return (
    <li className={item.unread ? "channels-inbox-item channels-inbox-item--unread" : "channels-inbox-item"}>
      <span className="channels-inbox-item__unread" aria-hidden="true" />
      <div className="channels-inbox-item__main">
        <div className="channels-inbox-item__head">
          <span className="channels-inbox-item__from" title={item.fromAddress || undefined}>
            {item.from || item.fromAddress || "unknown sender"}
          </span>
          <span className="badge neutral">{item.provider}</span>
          {item.kind && <span className="badge info">{item.kind}</span>}
          {item.unread && <span className="badge warning">unread</span>}
          {item.attachmentCount > 0 && (
            <span className="channels-inbox-item__attachments">
              <Paperclip size={12} aria-hidden="true" /> {item.attachmentCount}
            </span>
          )}
        </div>
        {item.subject && <span className="channels-inbox-item__subject">{item.subject}</span>}
        {/* CSS clamps this to 2 lines (unbounded daemon text) — title= gives
            the full body on hover since there's no detail view to expand into. */}
        <span className="channels-inbox-item__preview" title={item.bodyPreview || undefined}>
          {item.bodyPreview}
        </span>
        <div className="channels-inbox-item__meta">
          <span>{item.receivedAt !== undefined ? formatRelative(item.receivedAt) : "time unknown"}</span>
          {item.routeId && <code>route {item.routeId}</code>}
          {item.threadId && <code>thread {item.threadId}</code>}
        </div>
      </div>
    </li>
  );
}
