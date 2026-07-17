// Notification preferences (docs/FEATURES.md §19/§24): enabled toggle,
// batching cadence, quiet-while-typing, and a per-domain verbosity grid —
// coded against the /app/notifications/prefs HTTP contract the notifications
// agent implements Bun-side. Capability-honest: a 404/501 (not landed yet in
// this build) renders UnavailableState, never a fake "saved".

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, RefreshCw, Send } from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import {
  NOTIFICATION_DOMAINS,
  isNotificationsRouteUnavailable,
  notificationsApi,
  notificationsKeys,
  type DomainVerbosity,
  type NotificationBatching,
  type NotificationPrefs,
} from "./notifications-api.ts";
import { SETTINGS_POLL_MS } from "./settings-queries.ts";

const BATCHING_OPTIONS: ReadonlyArray<{ value: NotificationBatching; label: string }> = [
  { value: "off", label: "Off — every notification immediately" },
  { value: "30s", label: "Batch — every 30s" },
  { value: "5m", label: "Batch — every 5m" },
];

const VERBOSITY_OPTIONS: ReadonlyArray<{ value: DomainVerbosity; label: string }> = [
  { value: "all", label: "All" },
  { value: "important", label: "Important" },
  { value: "off", label: "Off" },
];

export function NotificationsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<NotificationPrefs | null>(null);
  const [testTitle, setTestTitle] = useState("Test notification");
  // Tracks the latest draft without adding it as an effect dependency below —
  // lets the background poll refresh `draft` from the server while it's
  // untouched, but never clobber an in-progress, unsaved edit (item 1/13:
  // drafts survive; writes never silently overwrite what the user is doing).
  const draftRef = useRef<NotificationPrefs | null>(null);
  draftRef.current = draft;

  const prefsQuery = useQuery({
    queryKey: notificationsKeys.prefs,
    queryFn: () => notificationsApi.getPrefs(),
    retry: false,
    refetchInterval: SETTINGS_POLL_MS,
  });

  useEffect(() => {
    if (!prefsQuery.data) return;
    const current = draftRef.current;
    const isDirty = current !== null && JSON.stringify(current) !== JSON.stringify(prefsQuery.data.prefs);
    if (!isDirty) setDraft(prefsQuery.data.prefs);
  }, [prefsQuery.data]);

  const save = useMutation({
    mutationFn: (prefs: NotificationPrefs) => notificationsApi.putPrefs(prefs),
    onSuccess: async (result) => {
      setDraft(result.prefs);
      await queryClient.invalidateQueries({ queryKey: notificationsKeys.prefs });
      toast({ title: "Notification prefs saved", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Failed to save prefs", description: formatError(error), tone: "danger" }),
  });

  const sendTest = useMutation({
    mutationFn: () => notificationsApi.notify(testTitle, "Sent from Settings → Notifications."),
    onSuccess: (result) => {
      toast({
        title: result.shown ? "Test notification sent" : "Notification suppressed",
        description: result.shown ? undefined : result.reason ?? "Blocked by current prefs or platform support.",
        tone: result.shown ? "success" : "info",
      });
    },
    onError: (error: unknown) => toast({ title: "Failed to send test notification", description: formatError(error), tone: "danger" }),
  });

  const unavailable = prefsQuery.isError && isNotificationsRouteUnavailable(prefsQuery.error);
  const dirty = draft !== null && prefsQuery.data !== undefined && JSON.stringify(draft) !== JSON.stringify(prefsQuery.data.prefs);

  function patch(next: Partial<NotificationPrefs>): void {
    setDraft((prev) => (prev ? { ...prev, ...next } : prev));
  }

  function patchDomain(domain: string, verbosity: DomainVerbosity): void {
    setDraft((prev) => (prev ? { ...prev, perDomain: { ...prev.perDomain, [domain]: verbosity } } : prev));
  }

  return (
    <section className="settings-notify" aria-label="Notification preferences">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Bell size={14} aria-hidden="true" /> Notifications
        </span>
        <button type="button" className="section-toolbar__refresh" aria-label="Refresh notification prefs" onClick={() => void prefsQuery.refetch()}>
          <RefreshCw size={15} aria-hidden="true" className={prefsQuery.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {prefsQuery.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState
          capability="/app/notifications/prefs"
          description="notification preferences are not part of this build — desktop notifications fall back to their defaults."
        />
      )}

      {prefsQuery.isError && !unavailable && (
        <ErrorState error={prefsQuery.error} onRetry={() => void prefsQuery.refetch()} title="Failed to load notification prefs" />
      )}

      {prefsQuery.isSuccess && draft && (
        <>
          <div className="settings-pref-grid">
            <fieldset className="settings-pref">
              <legend>Notifications</legend>
              <label className="settings-editor__toggle">
                <input type="checkbox" role="switch" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
                <span>{draft.enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </fieldset>

            <fieldset className="settings-pref">
              <legend>Batching</legend>
              <select value={draft.batching} onChange={(e) => patch({ batching: e.target.value as NotificationBatching })}>
                {BATCHING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </fieldset>

            <fieldset className="settings-pref">
              <legend>While typing</legend>
              <label className="settings-editor__toggle">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.quietWhileTyping}
                  onChange={(e) => patch({ quietWhileTyping: e.target.checked })}
                />
                <span>{draft.quietWhileTyping ? "Quiet while typing" : "Notify even while typing"}</span>
              </label>
            </fieldset>
          </div>

          <h3 className="settings-notify__subhead">Per-domain verbosity</h3>
          <ul className="settings-notify__domains">
            {NOTIFICATION_DOMAINS.map((domain) => (
              <li key={domain} className="settings-notify__domain-row">
                <code>{domain}</code>
                <div className="settings-notify__domain-options" role="radiogroup" aria-label={`${domain} verbosity`}>
                  {VERBOSITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={(draft.perDomain[domain] ?? "all") === opt.value}
                      className={
                        (draft.perDomain[domain] ?? "all") === opt.value
                          ? "settings-pref__option settings-pref__option--active"
                          : "settings-pref__option"
                      }
                      onClick={() => patchDomain(domain, opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <div className="settings-notify__actions">
            <button type="button" className="settings-editor__cancel" onClick={() => setDraft(prefsQuery.data.prefs)} disabled={!dirty || save.isPending}>
              Revert
            </button>
            <button type="button" className="settings-editor__save" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
              {save.isPending ? "Saving…" : "Save prefs"}
            </button>
          </div>

          <div className="settings-notify__test">
            <input value={testTitle} onChange={(e) => setTestTitle(e.target.value)} aria-label="Test notification title" />
            <button type="button" className="settings-secrets__add" onClick={() => sendTest.mutate()} disabled={sendTest.isPending}>
              <Send size={13} aria-hidden="true" /> {sendTest.isPending ? "Sending…" : "Send test"}
            </button>
          </div>
        </>
      )}

      {prefsQuery.isSuccess && !draft && <EmptyState title="No preferences reported" />}
    </section>
  );
}
