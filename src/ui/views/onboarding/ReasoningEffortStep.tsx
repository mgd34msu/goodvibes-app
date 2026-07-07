// Reasoning-effort picker step (docs/GAPS.md §22 row 4, PARTIAL → closed).
// docs/FEATURES.md: "Default model pick (+ effort)" — the model half already
// ships in OnboardingChecks' ProviderFix; this closes the "+ effort" half.
// The key is real and pinned on this daemon build: `provider.reasoningEffort`
// (config-schema.generated.ts, enum instant/low/medium/high, default
// "medium") — the same key §1's chat composer effort control writes, so no
// live per-daemon audit is needed the way PermissionsStep needs
// security.settings (that key can vary by build; this one is a fixed part of
// the pinned SDK schema this app ships against).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError } from "../../lib/errors.ts";
import { announce } from "../../lib/announcer.ts";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { SkeletonBlock } from "../../components/feedback.tsx";
import { readConfigString } from "../providers/model-catalog.ts";
import { CONFIG_SCHEMA_SNAPSHOT } from "../settings/config-schema.generated.ts";

const REASONING_EFFORT_KEY = "provider.reasoningEffort";

const EFFORT_HINTS: Record<string, string> = {
  instant: "Fastest responses, minimal deliberation.",
  low: "Quick, light reasoning for straightforward asks.",
  medium: "Balanced — the daemon's own default.",
  high: "Slower, more deliberate reasoning for hard problems.",
};

function schemaMeta() {
  return CONFIG_SCHEMA_SNAPSHOT.find((m) => m.key === REASONING_EFFORT_KEY);
}

export function ReasoningEffortStep({ daemonUp }: { daemonUp: boolean }) {
  const queryClient = useQueryClient();
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const meta = schemaMeta();

  const config = useQuery({
    queryKey: queryKeys.configAll,
    queryFn: () => gv.config.get(),
    enabled: daemonUp,
    retry: false,
  });

  const write = useMutation({
    mutationFn: ({ value, meta: confirmMeta }: { value: string; meta: ConfirmMetadata }) =>
      gv.config.set({ key: REASONING_EFFORT_KEY, value, ...confirmMeta }),
    onSuccess: async () => {
      setPendingValue(null);
      announce("Reasoning effort default updated");
      await queryClient.invalidateQueries({ queryKey: queryKeys.configAll });
    },
  });

  if (!daemonUp || !meta) return null;
  if (config.isPending) {
    return (
      <div className="onboarding-section">
        <h3 className="onboarding-section__title">Reasoning effort</h3>
        <SkeletonBlock variant="text" lines={2} />
      </div>
    );
  }

  const currentValue = readConfigString(config.data, REASONING_EFFORT_KEY) || String(meta.default);
  const options = meta.enumValues ?? [];

  return (
    <div className="onboarding-section">
      <h3 className="onboarding-section__title">
        <Gauge size={14} aria-hidden="true" /> Reasoning effort
      </h3>
      <p className="onboarding-section__hint">
        Default reasoning effort for models that support it. Current: <strong>{currentValue}</strong>
      </p>
      <ul className="onboarding-permissions">
        {options.map((option) => (
          <li key={option} className="onboarding-permissions__option">
            <label>
              <input
                type="radio"
                name="onboarding-reasoning-effort"
                value={option}
                checked={currentValue === option}
                disabled={write.isPending}
                onChange={() => setPendingValue(option)}
              />
              <span className="onboarding-permissions__label">
                {option}
                {option === meta.default ? " (daemon default)" : ""}
              </span>
              <span className="onboarding-permissions__desc">{EFFORT_HINTS[option] ?? ""}</span>
            </label>
          </li>
        ))}
      </ul>
      {write.isError && <p className="onboarding-fix__error">{formatError(write.error)}</p>}

      <ConfirmSurface
        open={pendingValue !== null}
        action="Change default reasoning effort"
        target={REASONING_EFFORT_KEY}
        blastRadius="Changes the daemon-wide default reasoning effort used by every surface and agent that doesn't explicitly override it."
        confirmLabel={write.isPending ? "Writing…" : "Set effort"}
        onCancel={() => setPendingValue(null)}
        onConfirm={(confirmMeta) => {
          if (pendingValue && !write.isPending) write.mutate({ value: pendingValue, meta: confirmMeta });
        }}
      >
        {pendingValue && (
          <p className="settings-confirm-value">
            New value: <code>{pendingValue}</code>
          </p>
        )}
      </ConfirmSurface>
    </div>
  );
}
