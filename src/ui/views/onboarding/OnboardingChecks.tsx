// The three live checks from docs/UX.md §5 — daemon / auth / provider+model —
// with real-time status, inline repair, and per-check retry. Used by both the
// first-run onboarding overlay and the re-runnable Doctor surface. Every
// failure names a next action; nothing here is modal-blocking.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { fetchAppHealth, queryKeys } from "../../lib/queries.ts";
import { gv } from "../../lib/gv.ts";
import { formatError, isAuthExpiredError, isMethodUnavailableError } from "../../lib/errors.ts";
import { CONTRACT_STATE_GLYPHS, type ContractStatusState } from "../../lib/generated/presentation-tokens.ts";
import { announce } from "../../lib/announcer.ts";
import {
  authExplicitlyRejected,
  configuredModelFrom,
  daemonCheck,
  envKeyForProvider,
  modelOptionsFrom,
  principalFrom,
  providerOptionsFrom,
  PROVIDER_ENV_KEYS,
  type CheckResult,
  type CheckState,
  type ProviderOption,
} from "./checks.ts";

const CHECK_STATE_TO_CONTRACT: Record<CheckState, ContractStatusState> = {
  pass: "good",
  fail: "bad",
  checking: "info",
  unavailable: "warn",
};

function CheckRow({
  title,
  result,
  onRetry,
  children,
}: {
  title: string;
  result: CheckResult;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const contractState = CHECK_STATE_TO_CONTRACT[result.state];
  return (
    <li className={`onboarding-check onboarding-check--${result.state}`}>
      <span className="onboarding-check__glyph" data-state={contractState} aria-hidden="true">
        {result.state === "checking" ? (
          <RefreshCw size={13} className="spinning" />
        ) : (
          CONTRACT_STATE_GLYPHS[contractState]
        )}
      </span>
      <div className="onboarding-check__body">
        <div className="onboarding-check__head">
          <span className="onboarding-check__title">{title}</span>
          <span className="onboarding-check__summary">{result.summary}</span>
        </div>
        {result.detail && <p className="onboarding-check__detail">{result.detail}</p>}
        {children}
      </div>
      {onRetry && result.state !== "checking" && (
        <button type="button" className="onboarding-check__retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Provider + model inline fix (picker, key entry via config.set, model pick)
// ---------------------------------------------------------------------------

function ProviderFix({
  options,
  hasModel,
}: {
  options: ProviderOption[];
  hasModel: boolean;
}) {
  const queryClient = useQueryClient();
  // Picker offers daemon-known providers first, then the SDK credential
  // inventory, so a zero-provider daemon still has a path forward.
  const pickerIds = useMemo(() => {
    const ids = options.map((o) => o.id);
    for (const id of Object.keys(PROVIDER_ENV_KEYS)) if (!ids.includes(id)) ids.push(id);
    return ids;
  }, [options]);

  const [providerId, setProviderId] = useState(() => pickerIds[0] ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [modelKey, setModelKey] = useState("");

  const selected = options.find((o) => o.id === providerId);
  const models = useMemo(() => (selected ? modelOptionsFrom(selected) : []), [selected]);
  const envKey = envKeyForProvider(providerId);

  const saveKey = useMutation({
    mutationFn: async () => {
      if (!envKey) throw new Error(`No credential key known for "${providerId}".`);
      await gv.config.set({ key: envKey, value: apiKey.trim() });
    },
    onSuccess: async () => {
      setApiKey("");
      announce("Provider key saved — revalidating providers");
      // Validate by refetching: the daemon re-derives provider status.
      await Promise.allSettled([
        queryClient.refetchQueries({ queryKey: queryKeys.providers }),
        queryClient.refetchQueries({ queryKey: queryKeys.configAll }),
      ]);
    },
  });

  const saveModel = useMutation({
    mutationFn: async () => {
      const value = modelKey.trim();
      if (!value) throw new Error("Pick or enter a model first.");
      await gv.config.set({ key: "provider.model", value });
    },
    onSuccess: async () => {
      announce("Default model saved");
      await queryClient.refetchQueries({ queryKey: queryKeys.configAll });
    },
  });

  return (
    <div className="onboarding-fix">
      <div className="onboarding-fix__row">
        <label className="onboarding-fix__label" htmlFor="onboarding-provider">
          Provider
        </label>
        <select
          id="onboarding-provider"
          className="onboarding-fix__input"
          value={providerId}
          onChange={(e) => {
            setProviderId(e.target.value);
            setModelKey("");
          }}
        >
          {pickerIds.map((id) => (
            <option key={id} value={id}>
              {options.find((o) => o.id === id)?.label ?? id}
            </option>
          ))}
        </select>
      </div>

      <div className="onboarding-fix__row">
        <label className="onboarding-fix__label" htmlFor="onboarding-key">
          API key
        </label>
        <input
          id="onboarding-key"
          className="onboarding-fix__input"
          type="password"
          autoComplete="off"
          placeholder={envKey ? `Stored as ${envKey}` : "No key slot known for this provider"}
          value={apiKey}
          disabled={!envKey || saveKey.isPending}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button
          type="button"
          className="onboarding-fix__action"
          disabled={!envKey || !apiKey.trim() || saveKey.isPending}
          onClick={() => saveKey.mutate()}
        >
          {saveKey.isPending ? "Saving…" : "Save key"}
        </button>
      </div>
      {!envKey && (
        <p className="onboarding-fix__hint">
          This provider takes credentials through its own auth flow — configure it with the TUI
          (<code>goodvibes config</code>) or set its environment variable before starting the daemon.
        </p>
      )}
      {saveKey.isError && <p className="onboarding-fix__error">{formatError(saveKey.error)}</p>}
      {saveKey.isSuccess && (
        <p className="onboarding-fix__hint">
          Key stored{envKey ? ` as ${envKey}` : ""}. Providers revalidated — check the summary above.
        </p>
      )}

      {!hasModel && (
        <div className="onboarding-fix__row">
          <label className="onboarding-fix__label" htmlFor="onboarding-model">
            Default model
          </label>
          {models.length > 0 ? (
            <select
              id="onboarding-model"
              className="onboarding-fix__input"
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
            >
              <option value="">Pick a model…</option>
              {models.map((m) => (
                <option key={m.registryKey} value={m.registryKey}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="onboarding-model"
              className="onboarding-fix__input"
              type="text"
              placeholder="provider:model (this daemon lists no models yet)"
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
            />
          )}
          <button
            type="button"
            className="onboarding-fix__action"
            disabled={!modelKey.trim() || saveModel.isPending}
            onClick={() => saveModel.mutate()}
          >
            {saveModel.isPending ? "Saving…" : "Use model"}
          </button>
        </div>
      )}
      {saveModel.isError && <p className="onboarding-fix__error">{formatError(saveModel.error)}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The three checks
// ---------------------------------------------------------------------------

export interface OnboardingChecksProps {
  /**
   * Reports whether all three checks currently pass (drives "Start
   * chatting") and whether the daemon is reachable at all (drives whether
   * daemon-dependent sections below the checks — permissions/import/pairing —
   * render their live content or wait).
   */
  onStatus: (allPass: boolean, daemonUp: boolean) => void;
}

export function OnboardingChecks({ onStatus }: OnboardingChecksProps) {
  const queryClient = useQueryClient();

  const health = useQuery({
    queryKey: queryKeys.appHealth,
    queryFn: fetchAppHealth,
    refetchInterval: 5_000,
    retry: 0,
  });
  const daemonResult = daemonCheck(health.data, health.isError);
  const daemonUp = daemonResult.state === "pass";

  const auth = useQuery({
    queryKey: queryKeys.authCurrent,
    queryFn: () => gv.control.authCurrent(),
    enabled: daemonUp,
    retry: 0,
  });

  const providers = useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => gv.providers.list(),
    enabled: daemonUp,
    retry: 0,
  });

  const config = useQuery({
    queryKey: queryKeys.configAll,
    queryFn: () => gv.config.get(),
    enabled: daemonUp,
    retry: 0,
  });

  // --- auth result ----------------------------------------------------------
  let authResult: CheckResult;
  if (!daemonUp) {
    authResult = { state: "unavailable", summary: "Waiting for daemon" };
  } else if (auth.isPending) {
    authResult = { state: "checking", summary: "Checking token…" };
  } else if (auth.isError) {
    authResult = {
      state: "fail",
      summary: "Token rejected",
      detail: isAuthExpiredError(auth.error)
        ? "The proxy-injected companion token was refused. The shared pairing store (~/.goodvibes/daemon) may be stale — restart the app to re-pair, or run the TUI once on this machine."
        : formatError(auth.error),
    };
  } else if (authExplicitlyRejected(auth.data)) {
    authResult = {
      state: "fail",
      summary: "Not signed in",
      detail: "The daemon answered but reports no authenticated principal for this client.",
    };
  } else {
    const principal = principalFrom(auth.data);
    authResult = {
      state: "pass",
      summary: principal ? `Signed in as ${principal}` : "Token accepted",
    };
  }

  // --- provider + model result ----------------------------------------------
  const providerOptions = providers.isSuccess ? providerOptionsFrom(providers.data) : [];
  const configuredModel = config.isSuccess ? configuredModelFrom(config.data) : "";
  let providerResult: CheckResult;
  let showProviderFix = false;
  if (!daemonUp) {
    providerResult = { state: "unavailable", summary: "Waiting for daemon" };
  } else if (providers.isPending || config.isPending) {
    providerResult = { state: "checking", summary: "Checking providers…" };
  } else if (providers.isError && isMethodUnavailableError(providers.error)) {
    providerResult = {
      state: "unavailable",
      summary: "providers.list not served",
      detail: "The connected daemon does not serve the provider inventory — chat may still work if it was configured elsewhere.",
    };
  } else if (providers.isError) {
    providerResult = { state: "fail", summary: "Provider inventory failed", detail: formatError(providers.error) };
  } else if (providerOptions.length > 0 && configuredModel) {
    providerResult = { state: "pass", summary: configuredModel };
  } else {
    showProviderFix = true;
    providerResult = {
      state: "fail",
      summary: providerOptions.length === 0 ? "No provider configured" : "No default model set",
      detail:
        providerOptions.length === 0
          ? "Pick a provider and store an API key — the daemon revalidates instantly."
          : "Providers are available; pick the default model chat should use.",
    };
  }

  const allPass = daemonResult.state === "pass" && authResult.state === "pass" && providerResult.state === "pass";
  useEffect(() => {
    onStatus(allPass, daemonUp);
  }, [allPass, daemonUp, onStatus]);

  return (
    <ol className="onboarding-checks">
      <CheckRow
        title="Daemon"
        result={daemonResult}
        onRetry={() => void queryClient.refetchQueries({ queryKey: queryKeys.appHealth })}
      />
      <CheckRow
        title="Auth"
        result={authResult}
        onRetry={
          daemonUp ? () => void queryClient.refetchQueries({ queryKey: queryKeys.authCurrent }) : undefined
        }
      />
      <CheckRow
        title="Provider & model"
        result={providerResult}
        onRetry={
          daemonUp
            ? () =>
                void Promise.allSettled([
                  queryClient.refetchQueries({ queryKey: queryKeys.providers }),
                  queryClient.refetchQueries({ queryKey: queryKeys.configAll }),
                ])
            : undefined
        }
      >
        {showProviderFix && <ProviderFix options={providerOptions} hasModel={Boolean(configuredModel)} />}
      </CheckRow>
    </ol>
  );
}
