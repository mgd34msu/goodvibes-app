// App-own settings (docs/FEATURES.md §19): window/behavior prefs, the
// launch-at-login POSTURE, and a mirror of the notifications master switch —
// backed by src/bun/secrets.ts's /app/secrets/app-settings routes, which
// read/write the SAME ~/.goodvibes/app/settings.json the notifications agent
// uses (merged non-destructively — this module never touches the
// "notifications" top-level key).
//
// Launch-at-login is REAL when a built launcher exists under build/*-linux-
// x64 (writes/removes ~/.config/autostart/goodvibes-app.desktop); otherwise
// it renders the honest "not implemented yet" state — never a toggle that
// looks live but does nothing (docs/ARCHITECTURE.md non-negotiable #2).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppWindow, Power, RefreshCw } from "lucide-react";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { appOwnSettingsApi, isSecretsRouteUnavailable, secretsKeys } from "./secrets-api.ts";
import { isNotificationsRouteUnavailable, notificationsApi, notificationsKeys } from "./notifications-api.ts";
import { SETTINGS_POLL_MS } from "./settings-queries.ts";

export function AppLaunchSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const appSettings = useQuery({
    queryKey: secretsKeys.appSettings,
    queryFn: () => appOwnSettingsApi.get(),
    retry: false,
    refetchInterval: SETTINGS_POLL_MS,
  });

  const notifPrefs = useQuery({
    queryKey: notificationsKeys.prefs,
    queryFn: () => notificationsApi.getPrefs(),
    retry: false,
    refetchInterval: SETTINGS_POLL_MS,
  });

  const [stopDaemonOnQuit, setStopDaemonOnQuit] = useState(false);
  useEffect(() => {
    if (appSettings.data) setStopDaemonOnQuit(appSettings.data.app.stopDaemonOnQuit);
  }, [appSettings.data]);

  const saveApp = useMutation({
    mutationFn: (patch: { stopDaemonOnQuit: boolean }) => appOwnSettingsApi.put(patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: secretsKeys.appSettings });
      toast({ title: "Saved", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Failed to save", description: formatError(error), tone: "danger" }),
  });

  const toggleAutostart = useMutation({
    mutationFn: (enabled: boolean) => appOwnSettingsApi.setAutostart(enabled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: secretsKeys.appSettings });
      toast({ title: "Launch-at-login updated", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Failed to update launch-at-login", description: formatError(error), tone: "danger" }),
  });

  const toggleNotifMaster = useMutation({
    mutationFn: (enabled: boolean) => {
      const current = notifPrefs.data?.prefs;
      if (!current) throw new Error("Notification prefs have not loaded yet.");
      return notificationsApi.putPrefs({ ...current, enabled });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: notificationsKeys.prefs });
      toast({ title: "Notifications master switch updated", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Failed to update notifications", description: formatError(error), tone: "danger" }),
  });

  const unavailable = appSettings.isError && isSecretsRouteUnavailable(appSettings.error);
  const notifUnavailable = notifPrefs.isError && isNotificationsRouteUnavailable(notifPrefs.error);

  return (
    <section className="settings-launch" aria-label="App and launch settings">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <AppWindow size={14} aria-hidden="true" /> App &amp; launch
        </span>
        <button type="button" className="section-toolbar__refresh" aria-label="Refresh" onClick={() => void appSettings.refetch()}>
          <RefreshCw size={15} aria-hidden="true" className={appSettings.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {appSettings.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState capability="/app/secrets/app-settings" description="app-own settings persistence is not part of this build." />
      )}

      {appSettings.isError && !unavailable && (
        <ErrorState error={appSettings.error} onRetry={() => void appSettings.refetch()} title="Failed to load app settings" />
      )}

      {appSettings.isSuccess && (
        <>
          <fieldset className="settings-pref settings-launch__block">
            <legend>Daemon lifecycle</legend>
            <label className="settings-editor__toggle">
              <input
                type="checkbox"
                role="switch"
                checked={stopDaemonOnQuit}
                onChange={(e) => {
                  setStopDaemonOnQuit(e.target.checked);
                  saveApp.mutate({ stopDaemonOnQuit: e.target.checked });
                }}
              />
              <span>Stop the daemon when this app quits</span>
            </label>
            <p className="settings-pref__note">
              Saved for next launch. Not yet enforced at shutdown in this build — closing the app always leaves an
              adopted or spawned daemon running (docs/ARCHITECTURE.md §1: daemon-side work must survive app close).
              Stated here rather than left silent.
            </p>
          </fieldset>

          <fieldset className="settings-pref settings-launch__block">
            <legend>
              <Power size={13} aria-hidden="true" /> Launch at login
            </legend>
            <label className="settings-editor__toggle">
              <input
                type="checkbox"
                role="switch"
                checked={appSettings.data.autostart.enabled}
                disabled={!appSettings.data.autostart.supported || toggleAutostart.isPending}
                onChange={(e) => toggleAutostart.mutate(e.target.checked)}
              />
              <span>{appSettings.data.autostart.enabled ? "Enabled" : "Disabled"}</span>
            </label>
            {!appSettings.data.autostart.supported ? (
              <p className="settings-pref__note">{appSettings.data.autostart.reason}</p>
            ) : (
              <p className="settings-pref__note">
                Writes <code>~/.config/autostart/goodvibes-app.desktop</code> pointing at{" "}
                <code>{appSettings.data.autostart.launcherPath}</code>.
              </p>
            )}
          </fieldset>

          <fieldset className="settings-pref settings-launch__block">
            <legend>Notifications</legend>
            {notifPrefs.isPending && <SkeletonBlock variant="text" lines={1} />}
            {notifUnavailable && (
              <UnavailableState
                capability="/app/notifications/prefs"
                description="notification prefs aren't part of this build — manage them from the Notifications section once they land."
              />
            )}
            {notifPrefs.isSuccess && (
              <label className="settings-editor__toggle">
                <input
                  type="checkbox"
                  role="switch"
                  checked={notifPrefs.data.prefs.enabled}
                  disabled={toggleNotifMaster.isPending}
                  onChange={(e) => toggleNotifMaster.mutate(e.target.checked)}
                />
                <span>Desktop notifications master switch</span>
              </label>
            )}
            <p className="settings-pref__note">Mirrors the same toggle in the Notifications section — one control, shown in both places.</p>
          </fieldset>
        </>
      )}
    </section>
  );
}
