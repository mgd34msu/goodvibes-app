// OS service card (docs/GAPS.md §20 row 8, the section's last MISSING row):
// services.status/.install/.start/.stop/.restart/.uninstall are declared in
// the route table (`/api/service/*`) but were never invoked from src/ui —
// this section is that first caller. Every action is admin-scoped on the
// wire; install/stop/restart/uninstall additionally change what's running on
// the host (a systemd/launchd unit that manages the daemon process), so they
// go through ConfirmSurface with copy naming exactly that. Status is
// re-polled after every action instead of trusting the mutation's own
// response, since the unit's real state can only be observed by asking
// again. Rendering is wire-shape-defensive: the input schemas for every
// services.* method are additionalProperties:false (no body to send), and
// the output schema only *requires* platform/serviceName/path/installed/
// autostart/running/commandPreview/suggestedCommands — pid/logPath/contents/
// lastAction/actionError/network are all optional, so each is read with
// firstString/firstNumber and rendered only when present.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cog, Play, RefreshCw, Square, Trash2, Wrench } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, errorStatus, isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, asArray, firstString, firstNumber } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { settingsKeys, SETTINGS_POLL_MS } from "./settings-queries.ts";

interface ServiceStatus {
  platform: string;
  serviceName: string;
  path: string;
  installed: boolean;
  autostart: boolean;
  running: boolean;
  pid: number | undefined;
  logPath: string;
  commandPreview: string;
  lastAction: string;
  actionError: string;
}

function readStatus(data: unknown): ServiceStatus {
  const record = asRecord(data);
  return {
    platform: firstString(record, ["platform"]),
    serviceName: firstString(record, ["serviceName"]),
    path: firstString(record, ["path"]),
    installed: record["installed"] === true,
    autostart: record["autostart"] === true,
    running: record["running"] === true,
    pid: firstNumber(record, ["pid"]),
    logPath: firstString(record, ["logPath"]),
    commandPreview: firstString(record, ["commandPreview"]),
    lastAction: firstString(record, ["lastAction"]),
    actionError: firstString(record, ["actionError"]),
  };
}

function readSuggestedCommands(data: unknown): string[] {
  return asArray(asRecord(data)["suggestedCommands"]).filter((v): v is string => typeof v === "string");
}

type ServiceAction = "install" | "start" | "stop" | "restart" | "uninstall";

const ACTION_METHOD: Record<ServiceAction, string> = {
  install: "services.install",
  start: "services.start",
  stop: "services.stop",
  restart: "services.restart",
  uninstall: "services.uninstall",
};

const ACTION_BLAST_RADIUS: Record<ServiceAction, string> = {
  install:
    "Writes and enables a systemd (or launchd on macOS) unit that manages this machine's GoodVibes daemon process outside of this app — the daemon can then start on login/boot even when the app itself isn't open.",
  start: "Starts the installed unit now, launching the daemon process it manages if it isn't already running.",
  stop: "Stops the installed unit now. The daemon process it manages exits; anything talking to this daemon (this app, other clients) loses its connection until it is started again.",
  restart: "Stops and immediately restarts the installed unit's daemon process. Any in-flight requests or open sessions against this daemon are interrupted.",
  uninstall: "Removes the unit file from the system and disables autostart. The daemon this app is currently using is not itself deleted, but nothing will bring it back automatically after the next reboot.",
};

const ACTION_LABEL: Record<ServiceAction, string> = {
  install: "Install service",
  start: "Start service",
  stop: "Stop service",
  restart: "Restart service",
  uninstall: "Uninstall service",
};

// Disruptive per the brief: install/stop/restart/uninstall change what's
// running on the machine or interrupt it. start (bringing an already-
// installed, currently-stopped unit up) is the one non-disruptive action.
const CONFIRM_REQUIRED: Record<ServiceAction, boolean> = {
  install: true,
  start: false,
  stop: true,
  restart: true,
  uninstall: true,
};

export function OsServiceSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmAction, setConfirmAction] = useState<ServiceAction | null>(null);

  const status = useQuery({
    queryKey: settingsKeys.osService,
    queryFn: () => gv.invoke("services.status"),
    retry: false,
    // No wire event covers service-unit churn — targeted poll, same cadence
    // as the rest of this view's unwired domains.
    refetchInterval: SETTINGS_POLL_MS,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: settingsKeys.osService });

  const runAction = useMutation({
    mutationFn: (action: ServiceAction) => gv.invoke(ACTION_METHOD[action]),
    onSuccess: async (_result, action) => {
      setConfirmAction(null);
      await invalidate();
      await status.refetch();
      toast({ title: `${ACTION_LABEL[action]} sent`, description: "Re-checked status from the daemon.", tone: "success" });
    },
    onError: (error: unknown, action) => {
      setConfirmAction(null);
      toast({ title: `${ACTION_LABEL[action]} failed`, description: formatError(error), tone: "danger" });
    },
  });

  function trigger(action: ServiceAction): void {
    if (CONFIRM_REQUIRED[action]) {
      setConfirmAction(action);
    } else {
      runAction.mutate(action);
    }
  }

  function confirmAndRun(_meta: ConfirmMetadata): void {
    if (confirmAction) runAction.mutate(confirmAction);
  }

  const refused = status.isError && errorStatus(status.error) === 403;
  const unavailable = status.isError && !refused && isMethodUnavailableError(status.error);
  const info = status.isSuccess ? readStatus(status.data) : undefined;
  const suggestedCommands = status.isSuccess ? readSuggestedCommands(status.data) : [];
  const busy = runAction.isPending;

  return (
    <section className="settings-os-service" aria-label="OS service">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Cog size={14} aria-hidden="true" /> OS service
          {info ? ` · ${info.installed ? (info.running ? "running" : "installed, stopped") : "not installed"}` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh service status"
          onClick={() => void status.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={status.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      <p className="settings-os-service__note">
        Manages a systemd user service (launchd on macOS) that can run the GoodVibes daemon independent of this app —
        install it once and the daemon can start on login/boot without the desktop app being open. All actions here
        are admin-scoped on the wire; installing, stopping, restarting, or uninstalling change what's actually
        running on this machine, so each asks you to confirm first.
      </p>

      {status.isPending && <SkeletonBlock variant="text" lines={4} />}

      {refused && (
        <div className="settings-refused" role="status">
          <strong>Admin access required</strong>
          <span>OS service management needs an admin-scoped principal.</span>
        </div>
      )}

      {unavailable && (
        <UnavailableState capability="services.status" description="OS service management is not served by this daemon." />
      )}

      {status.isError && !refused && !unavailable && (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} title="Failed to load service status" />
      )}

      {status.isSuccess && info && (
        <>
          <div className="settings-os-service__facts">
            <span>
              Platform: <code>{info.platform || "unknown"}</code>
            </span>
            <span>
              Service name: <code>{info.serviceName || "unknown"}</code>
            </span>
            <span>
              Unit path: <code>{info.path || "unknown"}</code>
            </span>
            <span>
              Installed: <strong>{info.installed ? "yes" : "no"}</strong>
              {info.installed && ` · autostart ${info.autostart ? "on" : "off"}`}
            </span>
            <span>
              Running: <strong>{info.running ? "yes" : "no"}</strong>
              {info.running && info.pid !== undefined && ` (pid ${info.pid})`}
            </span>
            {info.logPath && (
              <span>
                Log: <code>{info.logPath}</code>
              </span>
            )}
            {info.lastAction && (
              <span>
                Last action: <code>{info.lastAction}</code>
                {info.actionError && ` — failed: ${info.actionError}`}
              </span>
            )}
          </div>

          {info.commandPreview && (
            <pre className="settings-os-service__preview">{info.commandPreview}</pre>
          )}

          {suggestedCommands.length > 0 && (
            <div className="settings-os-service__suggested">
              <span className="settings-os-service__suggested-label">Manual equivalents (run in a terminal, not by this app):</span>
              <ul>
                {suggestedCommands.map((cmd) => (
                  <li key={cmd}>
                    <code>{cmd}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="settings-os-service__actions">
            <button
              type="button"
              className="settings-os-service__btn"
              disabled={busy || info.installed}
              onClick={() => trigger("install")}
            >
              <Wrench size={13} aria-hidden="true" /> Install
            </button>
            <button
              type="button"
              className="settings-os-service__btn"
              disabled={busy || !info.installed || info.running}
              onClick={() => trigger("start")}
            >
              <Play size={13} aria-hidden="true" /> Start
            </button>
            <button
              type="button"
              className="settings-os-service__btn"
              disabled={busy || !info.installed || !info.running}
              onClick={() => trigger("stop")}
            >
              <Square size={13} aria-hidden="true" /> Stop
            </button>
            <button
              type="button"
              className="settings-os-service__btn"
              disabled={busy || !info.installed}
              onClick={() => trigger("restart")}
            >
              <RefreshCw size={13} aria-hidden="true" /> Restart
            </button>
            <button
              type="button"
              className="settings-os-service__danger-btn"
              disabled={busy || !info.installed}
              onClick={() => trigger("uninstall")}
            >
              <Trash2 size={13} aria-hidden="true" /> Uninstall
            </button>
          </div>
        </>
      )}

      {confirmAction && (
        <ConfirmSurface
          open
          action={ACTION_LABEL[confirmAction]}
          target={info?.serviceName || info?.path || "the GoodVibes OS service"}
          blastRadius={ACTION_BLAST_RADIUS[confirmAction]}
          danger={confirmAction === "uninstall" || confirmAction === "stop"}
          confirmLabel={ACTION_LABEL[confirmAction]}
          onCancel={() => setConfirmAction(null)}
          onConfirm={confirmAndRun}
        />
      )}
    </section>
  );
}
