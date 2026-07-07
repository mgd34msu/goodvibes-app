// Providers & Models — docs/FEATURES.md §14. Master/detail over
// providers.list with per-route auth-freshness derivation (provider-status.ts,
// ported from goodvibes-webui), provider detail + usage (providers.get /
// providers.usage.get), secret-free credential status (credentials.get),
// accounts snapshot (accounts.snapshot), current-model display + provider-first
// model-second selection (config provider.model — this pin has no models.*
// verbs, see model-catalog.ts), and the Model Workspace modal for multi-target
// routing. Config writes are confirm-gated through ConfirmSurface.
//
// Freshness: the `providers` SSE domain (lib/realtime.ts DOMAIN_INVALIDATIONS)
// invalidates the ["providers"] prefix — the list, every open detail/usage
// query, and the credential panel all key under that prefix on purpose.
// accounts.snapshot has no wire event and polls (see AccountsPanel).

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cpu, ExternalLink, KeyRound, Pin, PinOff, RefreshCw, Route, SlidersHorizontal } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { errorStatus, formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, bestId, bestTitle, compactJson } from "../../lib/wire.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorBoundary, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
// Provider option normalization is shared with chat's composer picker —
// imported read-only from views/chat to stay DRY (sanctioned by the brief).
import { providerOptionsFromResponse } from "../chat/provider-models.ts";
import { deriveProviderStatus, providerHeaderLabel } from "./provider-status.ts";
import {
  modelsFromProviderRecord,
  readConfigString,
  splitRegistryKey,
  type CatalogModel,
} from "./model-catalog.ts";
import { toggleFavoriteModel, useFavoriteModels } from "./favorites.ts";
import { CredentialStatusPanel } from "./CredentialStatusPanel.tsx";
import { AccountsPanel } from "./AccountsPanel.tsx";
import { SubscriptionsPanel } from "./SubscriptionsPanel.tsx";
import { ModelWorkspaceModal } from "./ModelWorkspaceModal.tsx";
import { FailoverPostureCard } from "./FailoverPostureCard.tsx";
import { CustomProvidersPanel } from "./CustomProvidersPanel.tsx";
import { LlmScanPanel } from "./LlmScanPanel.tsx";

// ── Provider list (record rows with HONEST freshness pills) ──────────────────

function ProviderList({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly unknown[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="providers-record-list">
      {items.map((item, index) => {
        const id = bestId(item) || String(index);
        const status = deriveProviderStatus(item);
        return (
          <button
            key={`${id}-${index}`}
            type="button"
            className={selectedId === id ? "providers-record-row providers-record-row--selected" : "providers-record-row"}
            onClick={() => onSelect(id)}
          >
            <strong>{bestTitle(item, id)}</strong>
            <span>{id}</span>
            <StatusBadge value={status.freshness} />
          </button>
        );
      })}
    </div>
  );
}

export function ProvidersView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const peek = usePeek();
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [modelWorkspaceOpen, setModelWorkspaceOpen] = useState(false);
  const [pendingMainModel, setPendingMainModel] = useState<CatalogModel | null>(null);
  const favorites = useFavoriteModels();
  // Local LLM scan → "use as custom provider" hands off a prefill to the
  // custom-provider editor below it (docs/GAPS.md §14 rows 8/9).
  const [customProviderPrefill, setCustomProviderPrefill] = useState<{
    suggestedFile: string;
    json: Record<string, unknown>;
  } | null>(null);

  const providers = useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => gv.providers.list(),
  });
  // Full config read (admin) — current model + reasoning default live here.
  const config = useQuery({
    queryKey: queryKeys.configAll,
    queryFn: () => gv.config.get(),
    retry: false,
  });

  const providerOptions = useMemo(() => providerOptionsFromResponse(providers.data), [providers.data]);
  const providerList = useMemo(() => providerOptions.map((option) => option.value), [providerOptions]);

  const selectedProvider = useMemo(() => {
    if (!selectedProviderId) return providerList[0];
    return providerList.find((provider) => bestId(provider) === selectedProviderId) ?? providerList[0];
  }, [providerList, selectedProviderId]);
  const selectedId = bestId(selectedProvider);

  // Detail/usage keys are 'providers'-PREFIXED so the providers domain
  // invalidation refetches the list AND every open detail in one shot.
  const providerDetail = useQuery({
    queryKey: [...queryKeys.providers, selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => gv.providers.get(selectedId),
  });
  const usage = useQuery({
    queryKey: [...queryKeys.providers, selectedId, "usage"],
    enabled: Boolean(selectedId),
    queryFn: () => gv.providers.usage(selectedId),
    retry: false,
  });

  // Status derives from BOTH the list record and the freshest providers.get
  // snapshot (webui ruling: the two shapes don't share key names for
  // configured/configuredVia/routes, so a shallow merge can't clobber either).
  const selectedProviderDetail = providerDetail.data ?? selectedProvider;
  const selectedProviderCombined = useMemo(
    () => ({ ...asRecord(selectedProvider), ...asRecord(selectedProviderDetail) }),
    [selectedProvider, selectedProviderDetail],
  );
  const selectedProviderStatus = useMemo(
    () => deriveProviderStatus(selectedProviderCombined),
    [selectedProviderCombined],
  );

  const models = useMemo(() => {
    const fromDetail = modelsFromProviderRecord(selectedProviderDetail);
    return fromDetail.length > 0 ? fromDetail : modelsFromProviderRecord(selectedProvider);
  }, [selectedProviderDetail, selectedProvider]);

  // Current model = shared config provider.model (registry key).
  const currentRegistryKey = readConfigString(config.data, "provider.model");
  const currentParts = splitRegistryKey(currentRegistryKey);
  const currentProvider = currentParts.provider || readConfigString(config.data, "provider.name");
  const configRefused = config.isError && errorStatus(config.error) === 403;

  const selectMainModel = useMutation({
    mutationFn: ({ model, meta }: { model: CatalogModel; meta: ConfirmMetadata }) =>
      gv.config.set({ key: "provider.model", value: model.registryKey, ...meta }),
    onSuccess: async (_data, { model }) => {
      setPendingMainModel(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.configAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
      ]);
      toast({ title: "Main chat model changed", description: model.registryKey, tone: "success" });
    },
    onError: (error: unknown) => {
      setPendingMainModel(null);
      toast({ title: "Failed to set model", description: formatError(error), tone: "danger" });
    },
  });

  // ── Keyboard navigation for the provider list ──────────────────────────────
  const providerListRef = useRef<HTMLDivElement>(null);
  const handleProviderKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const rows = Array.from(
      providerListRef.current?.querySelectorAll<HTMLButtonElement>(".providers-record-row") ?? [],
    );
    if (rows.length === 0) return;
    const currentIndex = rows.findIndex((el) => el === document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = Math.min(currentIndex + 1, rows.length - 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(currentIndex - 1, 0);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = rows.length - 1;
    rows[nextIndex]?.focus();
  }, []);

  // ── Peek: raw runtime + usage for the selected provider ────────────────────
  const openPeek = useCallback(() => {
    peek.open({
      title: bestTitle(selectedProvider, selectedId || "Provider"),
      content: (
        <div className="providers-peek">
          <h3>Provider runtime</h3>
          <pre className="providers-raw">{compactJson(selectedProviderDetail)}</pre>
          <h3>Usage</h3>
          <pre className="providers-raw">
            {usage.isSuccess ? compactJson(usage.data) : "Usage not loaded — see the usage panel."}
          </pre>
        </div>
      ),
    });
  }, [peek, selectedProvider, selectedId, selectedProviderDetail, usage.isSuccess, usage.data]);

  // ── Palette commands — view-scoped, live only while mounted ────────────────
  useEffect(() => {
    registerCommand({
      id: "providers.refresh",
      title: "Refresh Providers",
      group: "system",
      keywords: ["providers", "models", "reload"],
      run: () => void queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
    });
    registerCommand({
      id: "providers.modelWorkspace",
      title: "Open Model Workspace",
      group: "system",
      keywords: ["models", "routing", "helper", "tool", "tts", "embeddings", "browse"],
      run: () => setModelWorkspaceOpen(true),
    });
    return () => {
      unregisterCommand("providers.refresh");
      unregisterCommand("providers.modelWorkspace");
    };
  }, [queryClient]);

  const listUnavailable = providers.isError && isMethodUnavailableError(providers.error);
  const usageUnavailable = usage.isError && isMethodUnavailableError(usage.error);

  return (
    <div className="providers-view">
      {/* ── Master: provider list ─────────────────────────────────────────── */}
      <aside className="providers-list-pane" aria-label="Providers">
        <div className="providers-pane-title">
          <Cpu size={16} aria-hidden="true" />
          <h2>Providers</h2>
          <button
            type="button"
            className="providers-icon-button"
            aria-label="Refresh providers"
            onClick={() => void providers.refetch()}
          >
            <RefreshCw size={14} aria-hidden="true" className={providers.isFetching ? "spinning" : undefined} />
          </button>
        </div>

        {providers.isPending ? (
          <div className="providers-skeleton-list" aria-label="Loading providers" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonBlock key={i} variant="block" height={40} />
            ))}
          </div>
        ) : listUnavailable ? (
          <UnavailableState
            capability="providers.list"
            description="provider registry and model inventory cannot be shown."
          />
        ) : providers.isError ? (
          <ErrorState
            error={providers.error}
            title="Failed to load providers"
            onRetry={() => void providers.refetch()}
          />
        ) : providerList.length === 0 ? (
          <EmptyState
            icon={<Cpu size={28} aria-hidden="true" />}
            title="No providers"
            description="No providers are registered with the daemon."
          />
        ) : (
          <div
            ref={providerListRef}
            className="providers-list-scroll"
            role="group"
            aria-label="Provider list"
            onKeyDown={handleProviderKeyDown}
          >
            <ProviderList items={providerList} selectedId={selectedId} onSelect={setSelectedProviderId} />
          </div>
        )}
      </aside>

      {/* ── Detail ────────────────────────────────────────────────────────── */}
      <ErrorBoundary
        fallback={(err, reset) => (
          <ErrorState error={err} title="Provider view error" onRetry={reset} className="providers-detail-pane" />
        )}
      >
        <section
          className="providers-detail-pane"
          aria-label={selectedId ? bestTitle(selectedProvider, selectedId) : "Provider detail"}
        >
          <div className="providers-detail-header">
            <div>
              <button
                type="button"
                className="providers-peek-trigger"
                onClick={openPeek}
                aria-label={`Open raw details for ${bestTitle(selectedProvider, selectedId || "Provider")}`}
                disabled={!selectedId}
              >
                <h2>{bestTitle(selectedProvider, selectedId || "Provider")}</h2>
                {selectedId && <ExternalLink size={14} aria-hidden="true" />}
              </button>
              <span className="providers-detail-header__sub">
                {selectedId || "No provider selected"}
                {selectedId ? ` · ${providerHeaderLabel(selectedProviderStatus)}` : ""}
              </span>
            </div>
            <div className="providers-detail-header__actions">
              <StatusBadge value={selectedProviderStatus.freshness} />
              <button
                type="button"
                className="providers-button providers-button--primary"
                onClick={() => setModelWorkspaceOpen(true)}
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
                Model Workspace
              </button>
            </div>
          </div>

          {/* Current model (shared config provider.model) */}
          <section className="providers-panel" aria-label="Current model">
            <div className="providers-panel__title">
              <h3>Current Model (main chat)</h3>
              <Route size={16} aria-hidden="true" />
            </div>
            {config.isPending ? (
              <SkeletonBlock variant="block" height={40} />
            ) : configRefused ? (
              <div className="providers-degraded-note" role="status">
                <strong>Admin access required</strong>
                <span>The daemon default model lives in shared config (config.get is admin-scoped).</span>
              </div>
            ) : config.isError ? (
              <ErrorState
                error={config.error}
                title="Failed to load current model"
                onRetry={() => void config.refetch()}
              />
            ) : (
              <div className="providers-current-model">
                <div className="providers-current-model__copy">
                  <strong>{currentParts.model || "No model selected"}</strong>
                  <span>{currentRegistryKey || "provider.model is not configured on this daemon"}</span>
                </div>
                {currentProvider ? <StatusBadge value={currentProvider} /> : null}
              </div>
            )}
          </section>

          {/* Models reported for the selected provider — provider-first, model-second */}
          <section className="providers-panel" aria-label="Models for the selected provider">
            <div className="providers-panel__title">
              <h3>Models</h3>
              <Route size={16} aria-hidden="true" />
            </div>
            {providerDetail.isFetching && models.length === 0 ? (
              <div className="providers-skeleton-list" aria-busy="true" aria-label="Loading models">
                {Array.from({ length: 3 }, (_, i) => (
                  <SkeletonBlock key={i} variant="block" height={48} />
                ))}
              </div>
            ) : models.length === 0 ? (
              <EmptyState
                icon={<Route size={24} aria-hidden="true" />}
                title="No models"
                description="No models reported for this provider on this daemon."
              />
            ) : (
              <div className="providers-model-grid" role="list" aria-label="Available models">
                {models.map((model) => {
                  const isCurrent = model.registryKey === currentRegistryKey;
                  const pinnedNow = favorites.includes(model.registryKey);
                  return (
                    <article
                      key={model.registryKey}
                      className={isCurrent ? "providers-model-row providers-model-row--current" : "providers-model-row"}
                      role="listitem"
                      aria-label={`${model.label}${isCurrent ? ", currently selected" : ""}`}
                    >
                      <div
                        className={`providers-model-row__current-icon${isCurrent ? "" : " providers-model-row__current-icon--hidden"}`}
                        aria-hidden="true"
                      >
                        <Check size={16} />
                      </div>
                      <div className="providers-model-row__copy">
                        <strong>{model.label}</strong>
                        <span>{model.registryKey}</span>
                        {(model.tier ?? model.pricing) && (
                          <span className="providers-model-price">
                            {model.tier ?? ""}
                            {model.pricing
                              ? `${model.tier ? " · " : ""}$${model.pricing.inputPerMillionTokens}/$${model.pricing.outputPerMillionTokens} per M tok`
                              : ""}
                          </span>
                        )}
                      </div>
                      <div className="providers-model-row__actions">
                        <button
                          type="button"
                          className="providers-pin-button"
                          aria-label={pinnedNow ? `Unpin ${model.label}` : `Pin ${model.label}`}
                          aria-pressed={pinnedNow}
                          title={pinnedNow ? "Unpin favorite" : "Pin favorite (app-local)"}
                          onClick={() => toggleFavoriteModel(model.registryKey)}
                        >
                          {pinnedNow ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          className={isCurrent ? "providers-button" : "providers-button providers-button--primary"}
                          disabled={isCurrent || selectMainModel.isPending || configRefused}
                          aria-pressed={isCurrent}
                          title={
                            configRefused
                              ? "Writing provider.model requires an admin-scoped token"
                              : undefined
                          }
                          onClick={() => setPendingMainModel(model)}
                        >
                          {isCurrent ? (
                            <>
                              <Check size={14} aria-hidden="true" /> Current
                            </>
                          ) : (
                            "Use"
                          )}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Auth routes — per-route freshness, never rolled up away */}
          <section className="providers-panel" aria-label="Authentication routes">
            <div className="providers-panel__title">
              <h3>Auth Routes</h3>
              <KeyRound size={16} aria-hidden="true" />
            </div>
            {selectedProviderStatus.routes.length === 0 ? (
              <EmptyState
                icon={<KeyRound size={24} aria-hidden="true" />}
                title="No route detail"
                description="No authentication route detail reported for this provider."
              />
            ) : (
              <div className="providers-model-grid" role="list" aria-label="Authentication routes">
                {selectedProviderStatus.routes.map((route, index) => (
                  <article
                    key={`${route.route}-${index}`}
                    className="providers-model-row"
                    role="listitem"
                    aria-label={`${route.label}, ${route.freshness}`}
                  >
                    <div className="providers-model-row__copy">
                      <strong>{route.label}</strong>
                      <span>{route.detail ?? route.route}</span>
                      {route.repairHints.length > 0 && (
                        <ul className="providers-repair-hints">
                          {route.repairHints.map((hint) => (
                            <li key={hint}>{hint}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <StatusBadge value={route.freshness} />
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Usage for the selected provider */}
          <section className="providers-panel" aria-label="Provider usage">
            <div className="providers-panel__title">
              <h3>Usage</h3>
              <Route size={16} aria-hidden="true" />
            </div>
            {!selectedId ? (
              <EmptyState title="No provider selected" description="Select a provider to see its usage." />
            ) : usage.isPending ? (
              <SkeletonBlock variant="text" lines={3} />
            ) : usageUnavailable ? (
              <UnavailableState
                capability="providers.usage.get"
                description="per-provider usage windows cannot be shown."
              />
            ) : usage.isError ? (
              <ErrorState error={usage.error} title="Failed to load usage" onRetry={() => void usage.refetch()} />
            ) : (
              <pre className="providers-raw">{compactJson(usage.data)}</pre>
            )}
          </section>

          <CredentialStatusPanel selectedProviderId={selectedId} />
          <AccountsPanel />
          <SubscriptionsPanel />
          <FailoverPostureCard />
          <LlmScanPanel
            onUseAsCustomProvider={(suggestedFile, json) => setCustomProviderPrefill({ suggestedFile, json })}
          />
          <CustomProvidersPanel
            prefill={customProviderPrefill}
            onPrefillConsumed={() => setCustomProviderPrefill(null)}
          />
        </section>
      </ErrorBoundary>

      {/* Confirm-gated main-model write (shared config, daemon-wide) */}
      <ConfirmSurface
        open={pendingMainModel !== null}
        action="Set main chat model"
        target={pendingMainModel?.registryKey ?? ""}
        blastRadius="Writes shared config key provider.model — the daemon default every surface (TUI, agent, webui, app) uses when a session has no explicit model."
        confirmLabel={selectMainModel.isPending ? "Writing…" : "Set model"}
        onConfirm={(meta) => {
          if (pendingMainModel && !selectMainModel.isPending) {
            selectMainModel.mutate({ model: pendingMainModel, meta });
          }
        }}
        onCancel={() => setPendingMainModel(null)}
      />

      <ModelWorkspaceModal open={modelWorkspaceOpen} onClose={() => setModelWorkspaceOpen(false)} />
    </div>
  );
}
