// The daemon's self-update posture (update.status, and update.check to run one
// tick now), next to the daemon-lifecycle controls this app already owns.
//
// This is the surface where "a new daemon version is staged" or "a release was
// installed and rolled back" is worth seeing: the app adopts or spawns the
// daemon and outlives neither, so its version changing under the user is
// exactly the kind of thing a desktop window should say out loud.
//
// update.check is not an install. It runs the same tick the schedule runs and
// returns the status afterwards; a verified release still waits for a moment
// with no work in flight. A check that FAILS is reported in the status rather
// than thrown, because the caller asked what the state is and "the check
// failed" is the answer.
//
// Both verbs are ws-only (no REST route) and go over the /app/ws bridge.

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Download } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import {
  errorStatus,
  formatError,
  isMethodUnavailableError,
  isWsBridgeUnavailableError,
} from "../../lib/errors.ts";
import { safeHref } from "../../lib/safe-href.ts";
import { useToast } from "../../lib/toast.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { SETTINGS_POLL_MS } from "./settings-queries.ts";
import { describeUpdatePosture, formatInterval, parseUpdateStatus } from "./daemon-update.ts";

const updateKeys = {
  status: ["daemon-update", "status"] as const,
} as const;

export function DaemonUpdateSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const status = useQuery({
    queryKey: updateKeys.status,
    // No wire event exists for update state; a targeted poll on the settings
    // cadence keeps a staged release from being news only after a reload.
    queryFn: () => gv.invoke("update.status", { body: {} }),
    retry: false,
    refetchInterval: SETTINGS_POLL_MS,
  });

  const parsed = useMemo(() => parseUpdateStatus(status.data), [status.data]);
  const posture = useMemo(() => describeUpdatePosture(parsed), [parsed]);

  const check = useMutation({
    mutationFn: () => gv.invoke("update.check", { body: {} }),
    onSuccess: (result) => {
      // The verb returns the status after the tick, so the panel is refreshed
      // from that payload directly rather than by asking again.
      queryClient.setQueryData(updateKeys.status, result);
      const after = describeUpdatePosture(parseUpdateStatus(result));
      toast({ title: after.headline, description: after.detail, tone: after.tone === "danger" ? "danger" : "info" });
    },
    onError: (error: unknown) => {
      const description =
        errorStatus(error) === 403
          ? "Running an update check needs an admin-scoped principal."
          : isWsBridgeUnavailableError(error)
            ? "update.check is a ws-only verb and the daemon websocket bridge is not connected."
            : formatError(error);
      toast({ title: "Update check failed", description, tone: "danger" });
    },
  });

  const unavailable = status.isError && isMethodUnavailableError(status.error);
  const refused = status.isError && errorStatus(status.error) === 403;

  return (
    <section className="settings-daemon-update" aria-label="Daemon updates">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Download size={14} aria-hidden="true" /> Daemon updates
        </span>
        <span className="settings-daemon-update__actions">
          <button
            type="button"
            className="settings-daemon-update__check"
            disabled={check.isPending || unavailable}
            onClick={() => check.mutate()}
            title="Run one update check now. This never forces an install."
          >
            <RefreshCw size={14} aria-hidden="true" className={check.isPending ? "spinning" : undefined} />
            {check.isPending ? "Checking…" : "Check now"}
          </button>
        </span>
      </div>

      {status.isPending && <SkeletonBlock variant="text" lines={2} />}

      {refused && (
        <div className="settings-refused" role="status">
          <strong>Access refused</strong>
          <span>
            The daemon refused the update-status read for this principal. Reading status needs an
            authenticated principal; running a check needs admin scope.
          </span>
        </div>
      )}

      {unavailable && (
        <UnavailableState
          capability="update.status"
          description="this daemon does not report whether it is keeping itself current."
        />
      )}

      {status.isError && !refused && !unavailable && (
        <ErrorState
          error={status.error}
          onRetry={() => void status.refetch()}
          title="Failed to read the daemon's update posture"
        />
      )}

      {status.isSuccess && (
        <>
          <div className={`settings-daemon-update__posture settings-daemon-update__posture--${posture.tone}`} role="status">
            <strong>{posture.headline}</strong>
            <span>{posture.detail}</span>
          </div>

          <dl className="settings-daemon-update__facts">
            <dt>Running</dt>
            <dd>{parsed.currentVersion || "unreported"}</dd>
            <dt>Update loop</dt>
            <dd>
              {parsed.armed
                ? formatInterval(parsed.checkIntervalMs) || "armed"
                : `off: ${parsed.offReason || "no reason given"}`}
            </dd>
            {parsed.pendingVersion && (
              <>
                <dt>Staged</dt>
                <dd>{parsed.pendingVersion}</dd>
              </>
            )}
            {parsed.rejectedVersion && (
              <>
                <dt>Rolled back</dt>
                <dd>{parsed.rejectedVersion}</dd>
              </>
            )}
            {parsed.failedCheckCount > 0 && (
              <>
                <dt>Failed checks</dt>
                <dd>
                  {parsed.failedCheckCount}
                  {parsed.lastCheckFailure ? `, last: ${parsed.lastCheckFailure}` : ""}
                </dd>
              </>
            )}
          </dl>

          {safeHref(parsed.releasesUrl) ? (
            <a
              className="settings-daemon-update__releases"
              href={safeHref(parsed.releasesUrl)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={13} aria-hidden="true" /> Release notes
            </a>
          ) : (
            parsed.releasesUrl && (
              <span className="settings-daemon-update__releases settings-daemon-update__releases--inert">
                {parsed.releasesUrl}
              </span>
            )
          )}
        </>
      )}
    </section>
  );
}
