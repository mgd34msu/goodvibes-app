// Permissions-posture pick (docs/GAPS.md §22 row 5). Reads security.settings
// for the daemon's own live audit of the `permissions.mode` key; only offers
// the config.set write path when that audit actually lists the key — a
// daemon that doesn't gets the honest read-only explanation, never a fake
// picker (docs/FEATURES.md "Permissions posture pick": `config.set
// permissions.mode`, admin-scoped, dangerous — routed through ConfirmSurface
// exactly like the settings config editor routes its own dangerous keys).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldQuestion } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { announce } from "../../lib/announcer.ts";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { SkeletonBlock } from "../../components/feedback.tsx";
import { onboardingKeys } from "./keys.ts";
import {
  PERMISSIONS_MODE_KEY,
  PERMISSIONS_MODE_OPTIONS,
  labelForPermissionsMode,
  permissionsModeFromConfig,
  permissionsSecurityRow,
} from "./permissions.ts";

export function PermissionsStep({ daemonUp }: { daemonUp: boolean }) {
  const queryClient = useQueryClient();
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  const security = useQuery({
    queryKey: onboardingKeys.security,
    queryFn: () => gv.invoke("security.settings"),
    enabled: daemonUp,
    retry: false,
  });

  const config = useQuery({
    queryKey: queryKeys.configAll,
    queryFn: () => gv.config.get(),
    enabled: daemonUp,
    retry: false,
  });

  const write = useMutation({
    mutationFn: ({ value, meta }: { value: string; meta: ConfirmMetadata }) =>
      gv.config.set({ key: PERMISSIONS_MODE_KEY, value, ...meta }),
    onSuccess: async () => {
      setPendingValue(null);
      announce("Permission posture updated");
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: queryKeys.configAll }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.security }),
      ]);
    },
  });

  if (!daemonUp) return null;
  if (security.isPending || config.isPending) {
    return (
      <div className="onboarding-section">
        <h3 className="onboarding-section__title">Permission posture</h3>
        <SkeletonBlock variant="text" lines={2} />
      </div>
    );
  }

  const row = security.isSuccess ? permissionsSecurityRow(security.data) : undefined;
  const securityUnavailable = security.isError && isMethodUnavailableError(security.error);
  const keyDiscovered = row !== undefined;
  const currentValue = row?.currentState || permissionsModeFromConfig(config.data) || "prompt";

  return (
    <div className="onboarding-section">
      <h3 className="onboarding-section__title">
        <ShieldQuestion size={14} aria-hidden="true" /> Permission posture
      </h3>

      {!keyDiscovered && (
        <p className="onboarding-section__hint">
          {securityUnavailable
            ? "This daemon does not serve security.settings, so this app cannot confirm a writable permission-mode key exists here — no picker is offered to avoid a fake choice. Whatever posture the daemon already runs stays in effect."
            : "The daemon's security audit does not list a permissions.mode key on this build — no picker is offered to avoid a fake choice. Whatever posture the daemon already runs stays in effect."}
        </p>
      )}

      {keyDiscovered && (
        <>
          <p className="onboarding-section__hint">
            Current posture: <strong>{labelForPermissionsMode(currentValue)}</strong>
            {row?.summary ? ` — ${row.summary}` : ""}
          </p>
          <ul className="onboarding-permissions">
            {PERMISSIONS_MODE_OPTIONS.map((option) => (
              <li key={option.value} className="onboarding-permissions__option">
                <label>
                  <input
                    type="radio"
                    name="onboarding-permissions-mode"
                    value={option.value}
                    checked={currentValue === option.value}
                    disabled={write.isPending}
                    onChange={() => setPendingValue(option.value)}
                  />
                  <span className="onboarding-permissions__label">{option.label}</span>
                  <span className="onboarding-permissions__desc">{option.hint}</span>
                </label>
              </li>
            ))}
          </ul>
          {row?.insecureWhen && (
            <p className="onboarding-section__hint onboarding-section__hint--warn">{row.insecureWhen}</p>
          )}
          {write.isError && <p className="onboarding-fix__error">{formatError(write.error)}</p>}
        </>
      )}

      <ConfirmSurface
        open={pendingValue !== null}
        action="Change permission posture"
        target={PERMISSIONS_MODE_KEY}
        blastRadius="This changes the approval posture for every surface and agent using this daemon — not just this app."
        danger
        confirmLabel="Change posture"
        onCancel={() => setPendingValue(null)}
        onConfirm={(meta) => {
          if (pendingValue) write.mutate({ value: pendingValue, meta });
        }}
      >
        {pendingValue && (
          <p className="settings-confirm-value">
            New posture: <code>{labelForPermissionsMode(pendingValue)}</code>
          </p>
        )}
      </ConfirmSurface>
    </div>
  );
}
