// Unified inbox — docs/FEATURES.md §9 row 8. Merges channels.inbox.list
// (omnichannel — Slack/Discord/etc, owned by the Channels view) with
// email.inbox.list (owned here) into one timestamp-interleaved list with a
// source badge per row. Each source degrades HONESTLY AND INDEPENDENTLY:
// email may be unconfigured (412/config-taxonomy) while channels answers
// fine, or vice versa — a failure on one source never hides the other's
// rows, and the panel only renders fully-unavailable when BOTH fail.
//
// This is read-only triage (mark as read only); composing/sending/replying
// still lives in EmailPanel / the Channels view — this panel is a merged
// VIEW, not a second inbox implementation.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Inbox, MessageSquare, Paperclip } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { formatError } from "../../lib/errors.ts";
import { EmptyState, SkeletonBlock } from "../../components/feedback.tsx";
import { capabilityRefusal, emailRefusal, parseInboxMessages, useEmailInbox } from "./personal-ops-data.ts";

interface ChannelsInboxItem {
  id: string;
  provider: string;
  from: string;
  subject: string;
  bodyPreview: string;
  receivedAt: number | undefined;
  unread: boolean;
  attachmentCount: number;
}

function parseChannelsInbox(value: unknown): ChannelsInboxItem[] {
  return firstArray(asRecord(value), ["items"]).map((raw) => {
    const record = asRecord(raw);
    return {
      id: firstString(record, ["id"]),
      provider: firstString(record, ["provider", "kind"]) || "channel",
      from: firstString(record, ["from", "fromAddress"]),
      subject: firstString(record, ["subject"]),
      bodyPreview: firstString(record, ["bodyPreview", "preview", "snippet"]),
      receivedAt: firstNumber(record, ["receivedAt"]),
      unread: record["unread"] === true,
      attachmentCount: firstNumber(record, ["attachmentCount"]) ?? 0,
    };
  });
}

interface UnifiedRow {
  key: string;
  source: "email" | "channel";
  badge: string;
  from: string;
  subject: string;
  preview: string;
  when: number | undefined;
  unread: boolean;
  hasAttachment: boolean;
}

export function UnifiedInboxPanel({ active = true }: { active?: boolean }) {
  const email = useEmailInbox(true, active);
  const channels = useQuery({
    queryKey: ["personal-ops", "unified-inbox", "channels"],
    queryFn: () => gv.invoke("channels.inbox.list", { query: { limit: 50 } }),
    // No wire event for channels inbox in this composed view — 30s poll,
    // matching the email side's cadence. Paused while this tab is hidden
    // behind another Personal Ops tab (item 18).
    refetchInterval: active ? 30_000 : false,
    retry: false,
  });

  const emailRows: UnifiedRow[] = useMemo(() => {
    if (!email.isSuccess) return [];
    return parseInboxMessages(email.data).map((m) => ({
      key: `email:${m.uid}`,
      source: "email" as const,
      badge: "Email",
      from: m.from,
      subject: m.subject,
      preview: m.bodyPreview,
      when: Date.parse(m.date) || undefined,
      unread: m.unread,
      hasAttachment: false,
    }));
  }, [email.isSuccess, email.data]);

  const channelRows: UnifiedRow[] = useMemo(() => {
    if (!channels.isSuccess) return [];
    return parseChannelsInbox(channels.data).map((m) => ({
      key: `channel:${m.id}`,
      source: "channel" as const,
      badge: m.provider,
      from: m.from,
      subject: m.subject,
      preview: m.bodyPreview,
      when: m.receivedAt,
      unread: m.unread,
      hasAttachment: m.attachmentCount > 0,
    }));
  }, [channels.isSuccess, channels.data]);

  const merged = useMemo(
    () => [...emailRows, ...channelRows].sort((a, b) => (b.when ?? 0) - (a.when ?? 0)),
    [emailRows, channelRows],
  );

  const emailDegraded = email.isError ? emailRefusal(email.error, "email.inbox.list") : null;
  const channelsDegraded = channels.isError
    ? capabilityRefusal(
        channels.error,
        "channels.inbox.list",
        "the connected daemon build has no channels inbox handler wired up.",
      )
    : null;

  const bothFailed = email.isError && channels.isError;
  const loading = email.isPending || channels.isPending;

  if (loading) return <SkeletonBlock variant="text" lines={5} />;

  if (bothFailed) {
    return (
      <EmptyState
        icon={<Inbox size={24} aria-hidden="true" />}
        title="Unified inbox unavailable"
        description={`Both sources failed. Email: ${emailDegraded ? emailDegraded.description : formatError(email.error)} Channels: ${channelsDegraded ? channelsDegraded.description : formatError(channels.error)}`}
      />
    );
  }

  return (
    <div className="po-unified-inbox">
      {(email.isError || channels.isError) && (
        <p className="po-unified-inbox__note" role="status">
          {email.isError && `Email: ${emailDegraded ? emailDegraded.description : formatError(email.error)}`}
          {email.isError && channels.isError && " · "}
          {channels.isError && `Channels: ${channelsDegraded ? channelsDegraded.description : formatError(channels.error)}`}
        </p>
      )}

      {merged.length === 0 && (
        <EmptyState
          icon={<Inbox size={24} aria-hidden="true" />}
          title="Inbox is clear"
          description="No email or channel messages to show."
        />
      )}

      {merged.length > 0 && (
        <ul className="po-unified-inbox__list">
          {merged.map((row) => (
            <li key={row.key} className={row.unread ? "po-unified-inbox__row po-unified-inbox__row--unread" : "po-unified-inbox__row"}>
              <span className={row.source === "email" ? "badge neutral" : "badge ok"}>{row.badge}</span>
              <span className="po-unified-inbox__from" title={row.from}>
                {row.from || "(unknown sender)"}
              </span>
              <span className="po-unified-inbox__subject" title={row.subject || "(no subject)"}>
                {row.subject || "(no subject)"}
                {row.hasAttachment && <Paperclip size={12} aria-hidden="true" />}
              </span>
              <span className="po-unified-inbox__preview" title={row.preview}>
                {row.preview}
              </span>
              <span className="po-unified-inbox__when">
                {row.when ? new Date(row.when).toLocaleString() : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="po-unified-inbox__footnote">
        <MessageSquare size={12} aria-hidden="true" /> Read-only merge of Email and Channels inboxes. Reply/compose
        actions live in their own tabs.
      </p>
    </div>
  );
}
