// ModelWorkspaceModal — the multi-target model picker (main / helper / tool /
// tts / embeddings), search + price/tier filters, toward the TUI's Model
// Workspace (docs/FEATURES.md §14). Ported from goodvibes-webui
// src/components/model-workspace/ModelWorkspaceModal.tsx, adapted to this pin:
// every target routes through config.get/config.set (no models.* verbs exist
// here — see model-catalog.ts header), and EVERY write is confirm-gated
// through the shared ConfirmSurface (admin config write) with confirm:true +
// explicitUserRequest forwarded on the wire.
//
// Filters are wire-honest: search/provider/group-by always work; the price
// filter enables only when at least one model carries real tier data; the
// capability filter has NO wire data on this pin and renders disabled with a
// note, never a silent no-op.

import { useMemo, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pin, PinOff, Search } from "lucide-react";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock } from "../../components/feedback.tsx";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { errorStatus, formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import {
  buildTargetEnableEntry,
  buildTargetWriteEntries,
  configuredProviderIdsFromProvidersResponse,
  filterModels,
  groupModels,
  hasAnyCapabilityData,
  hasAnyQualityTierData,
  hasAnyTierData,
  MODEL_TARGETS,
  modelsFromProvidersResponse,
  providerIdsFromProvidersResponse,
  readConfigString,
  readTargetRouting,
  TARGET_LABELS,
  targetHasNoModelConcept,
  type CatalogModel,
  type CategoryFilter,
  type GroupByMode,
  type ModelTarget,
} from "./model-catalog.ts";
import { isFavoriteModel, toggleFavoriteModel, useFavoriteModels } from "./favorites.ts";

export interface ModelWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
}

/** One confirm-gated batch of config writes. */
interface PendingWrite {
  /** Verb-first action line for the ConfirmSurface. */
  action: string;
  /** The exact target (model / provider / flag) being routed. */
  target: string;
  /** Plain-words blast radius naming every config key written. */
  blastRadius: string;
  entries: readonly (readonly [string, unknown])[];
}

const REASONING_LEVELS = ["instant", "low", "medium", "high"] as const;

export function ModelWorkspaceModal({ open, onClose }: ModelWorkspaceModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [target, setTarget] = useState<ModelTarget>("main");
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupByMode>("provider");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const favorites = useFavoriteModels();

  const providers = useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => gv.providers.list(),
    enabled: open,
  });
  const config = useQuery({
    queryKey: queryKeys.configAll,
    queryFn: () => gv.config.get(),
    enabled: open,
    retry: false,
  });

  const allModels = useMemo(() => modelsFromProvidersResponse(providers.data), [providers.data]);
  const providerIds = useMemo(() => providerIdsFromProvidersResponse(providers.data), [providers.data]);
  const configuredProviderIds = useMemo(
    () => configuredProviderIdsFromProvidersResponse(providers.data),
    [providers.data],
  );
  const priceDataAvailable = useMemo(() => hasAnyTierData(allModels), [allModels]);
  const capabilityDataAvailable = useMemo(() => hasAnyCapabilityData(allModels), [allModels]);
  const qualityTierDataAvailable = useMemo(() => hasAnyQualityTierData(allModels), [allModels]);

  const routing = useMemo(() => readTargetRouting(target, config.data), [target, config.data]);
  const reasoningEffort = readConfigString(config.data, "provider.reasoningEffort");

  const filtered = useMemo(
    () =>
      filterModels(allModels, {
        query,
        provider: providerFilter || undefined,
        categoryFilter,
        availableOnly,
        configuredProviderIds,
      }),
    [allModels, query, providerFilter, categoryFilter, availableOnly, configuredProviderIds],
  );

  const effectiveGroupBy: GroupByMode = groupBy === "qualityTier" && !qualityTierDataAvailable ? "provider" : groupBy;
  const groups = useMemo(() => groupModels(filtered, effectiveGroupBy), [filtered, effectiveGroupBy]);
  const pinned = useMemo(
    () => filtered.filter((model) => favorites.includes(model.registryKey)),
    [filtered, favorites],
  );

  const write = useMutation({
    mutationFn: async ({ pending, meta }: { pending: PendingWrite; meta: ConfirmMetadata }) => {
      // Sequential, not Promise.all: the daemon's /config route accepts one
      // key at a time — several keys for one target means several awaited
      // config.set calls in a row. The ConfirmSurface metadata rides each one.
      for (const [key, value] of pending.entries) {
        await gv.config.set({ key, value, ...meta });
      }
    },
    onSuccess: async (_data, { pending }) => {
      setPendingWrite(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.configAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
      ]);
      toast({ title: `${TARGET_LABELS[target]} updated`, description: pending.target, tone: "success" });
    },
    onError: (error: unknown) => {
      setPendingWrite(null);
      toast({ title: "Config write failed", description: formatError(error), tone: "danger" });
    },
  });

  function requestUseModel(model: CatalogModel): void {
    const entries = buildTargetWriteEntries(target, model.provider, model.id);
    setPendingWrite({
      action: `Set ${TARGET_LABELS[target]} ${targetHasNoModelConcept(target) ? "provider" : "model"}`,
      target: targetHasNoModelConcept(target) ? model.provider : model.registryKey,
      blastRadius: `Writes shared config key${entries.length === 1 ? "" : "s"} ${entries
        .map(([key]) => key)
        .join(", ")} — every surface on this daemon (TUI, agent, webui, app) follows the new routing.`,
      entries,
    });
  }

  function requestToggleEnabled(enabled: boolean): void {
    const entry = buildTargetEnableEntry(target, enabled);
    if (!entry) return;
    setPendingWrite({
      action: `${enabled ? "Enable" : "Disable"} ${TARGET_LABELS[target]}`,
      target: entry[0],
      blastRadius: `Writes shared config key ${entry[0]}=${String(enabled)} — daemon-wide, all surfaces follow.`,
      entries: [entry],
    });
  }

  function requestReasoningEffort(value: string): void {
    setPendingWrite({
      action: "Set default reasoning effort",
      target: value,
      blastRadius:
        "Writes shared config key provider.reasoningEffort — the daemon-wide default for new turns on every surface.",
      entries: [["provider.reasoningEffort", value]],
    });
  }

  // While a confirm is pending, Escape/backdrop on the underlying workspace
  // must cancel the confirm only — both Modal Escape handlers fire on the same
  // keypress, so the workspace's close is guarded here.
  function handleWorkspaceClose(): void {
    if (pendingWrite) {
      setPendingWrite(null);
      return;
    }
    onClose();
  }

  const configRefused = config.isError && errorStatus(config.error) === 403;
  const isLoading = providers.isPending || config.isPending;
  const loadError = providers.isError ? providers.error : config.isError && !configRefused ? config.error : null;
  const embeddingsMode = targetHasNoModelConcept(target);
  const enableEntry = buildTargetEnableEntry(target, true);

  function modelRow(model: CatalogModel): ReactElement {
    const isCurrent = embeddingsMode
      ? model.provider === routing.provider
      : model.provider === routing.provider && model.id === routing.model;
    const pinnedNow = isFavoriteModel(model.registryKey);
    return (
      <article
        key={model.registryKey}
        className={isCurrent ? "providers-model-row providers-model-row--current" : "providers-model-row"}
        role="listitem"
        aria-label={`${model.label}${isCurrent ? ", currently routed" : ""}`}
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
            disabled={isCurrent || write.isPending || configRefused}
            aria-pressed={isCurrent}
            onClick={() => requestUseModel(model)}
          >
            {isCurrent ? "Current" : "Use"}
          </button>
        </div>
      </article>
    );
  }

  return (
    <>
      <Modal
        open={open}
        onClose={handleWorkspaceClose}
        title="Model Workspace"
        size="lg"
        headerExtra={
          <div className="model-workspace-targets" role="tablist" aria-label="Model routing target">
            {MODEL_TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={t === target}
                className={
                  t === target ? "model-workspace-target model-workspace-target--active" : "model-workspace-target"
                }
                onClick={() => setTarget(t)}
              >
                {TARGET_LABELS[t]}
              </button>
            ))}
          </div>
        }
      >
        <div className="model-workspace-routing" aria-live="polite">
          {configRefused ? (
            <span className="model-workspace-routing__note">
              {routing.label}: current routing hidden — config.get requires an admin-scoped token.
            </span>
          ) : routing.unset ? (
            <span className="model-workspace-routing__note">
              {routing.label}: not configured{routing.configuredNote ? ` — ${routing.configuredNote}` : ""}
            </span>
          ) : (
            <span className="model-workspace-routing__current">
              {routing.label}:{" "}
              <strong>{embeddingsMode ? routing.provider : `${routing.provider}:${routing.model}`}</strong>
              {routing.configuredNote ? ` (${routing.configuredNote})` : ""}
            </span>
          )}
          {enableEntry && !configRefused && (
            <label className="model-workspace-toggle">
              <input
                type="checkbox"
                checked={routing.enabled}
                disabled={write.isPending}
                onChange={(event) => requestToggleEnabled(event.target.checked)}
              />
              <span>Enabled</span>
            </label>
          )}
          {target === "main" && !configRefused && config.isSuccess && (
            <label className="model-workspace-reasoning" title="provider.reasoningEffort — daemon-wide default">
              <span>Reasoning effort</span>
              <select
                value={REASONING_LEVELS.includes(reasoningEffort as (typeof REASONING_LEVELS)[number]) ? reasoningEffort : ""}
                disabled={write.isPending}
                onChange={(event) => {
                  if (event.target.value) requestReasoningEffort(event.target.value);
                }}
              >
                <option value="" disabled>
                  {reasoningEffort ? reasoningEffort : "unset"}
                </option>
                {REASONING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="model-workspace-filters">
          <label className="model-workspace-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search models"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search models"
            />
          </label>

          {!embeddingsMode && (
            <>
              <label className="model-workspace-filter">
                <span>Provider</span>
                <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
                  <option value="">All</option>
                  {providerIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>

              <label
                className="model-workspace-filter"
                title={priceDataAvailable ? undefined : "No tier data reported by this daemon"}
              >
                <span>Price</span>
                <select
                  value={categoryFilter}
                  disabled={!priceDataAvailable}
                  onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
                >
                  <option value="all">All</option>
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                  <option value="subscription">Subscription</option>
                </select>
                {!priceDataAvailable && (
                  <small className="model-workspace-filter__note">Not reported by this daemon</small>
                )}
              </label>

              <label className="model-workspace-filter" title="Not reported by this daemon">
                <span>Capability</span>
                <select value="none" disabled={!capabilityDataAvailable} onChange={() => undefined}>
                  <option value="none">None</option>
                  <option value="reasoning">Reasoning</option>
                  <option value="toolUse">Tool use</option>
                  <option value="multimodal">Multimodal</option>
                </select>
                <small className="model-workspace-filter__note">Not reported by this daemon</small>
              </label>

              <label className="model-workspace-filter">
                <span>Group</span>
                <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupByMode)}>
                  <option value="provider">Provider</option>
                  <option value="family">Family</option>
                  <option value="pricingTier">Pricing tier</option>
                  <option value="qualityTier" disabled={!qualityTierDataAvailable}>
                    Quality tier{qualityTierDataAvailable ? "" : " (unavailable)"}
                  </option>
                </select>
              </label>

              <label className="model-workspace-toggle">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(event) => setAvailableOnly(event.target.checked)}
                />
                <span>Available only</span>
              </label>
            </>
          )}
        </div>

        {isLoading ? (
          <div className="providers-skeleton-list" aria-label="Loading model workspace" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonBlock key={i} variant="block" height={48} />
            ))}
          </div>
        ) : loadError !== null ? (
          <ErrorState
            error={loadError}
            title="Failed to load the model workspace"
            onRetry={() => {
              void providers.refetch();
              void config.refetch();
            }}
          />
        ) : embeddingsMode ? (
          providerIds.length === 0 ? (
            <EmptyState title="No providers" description="No providers are registered with the daemon." />
          ) : (
            <div className="providers-model-grid" role="list" aria-label="Embedding providers">
              {providerIds.map((id) => {
                const isCurrent = id === routing.provider;
                return (
                  <article
                    key={id}
                    className={isCurrent ? "providers-model-row providers-model-row--current" : "providers-model-row"}
                    role="listitem"
                  >
                    <div
                      className={`providers-model-row__current-icon${isCurrent ? "" : " providers-model-row__current-icon--hidden"}`}
                      aria-hidden="true"
                    >
                      <Check size={16} />
                    </div>
                    <div className="providers-model-row__copy">
                      <strong>{id}</strong>
                    </div>
                    <div className="providers-model-row__actions">
                      <button
                        type="button"
                        className={isCurrent ? "providers-button" : "providers-button providers-button--primary"}
                        disabled={isCurrent || write.isPending || configRefused}
                        onClick={() => requestUseModel({ id: "", registryKey: id, provider: id, label: id })}
                      >
                        {isCurrent ? "Current" : "Use"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )
        ) : filtered.length === 0 ? (
          <EmptyState title="No models" description="No models match the current search/filter." />
        ) : (
          <div className="model-workspace-groups">
            {pinned.length > 0 && (
              <section className="model-workspace-group" aria-label="Pinned models">
                <h3 className="model-workspace-group__title">Pinned</h3>
                <div className="providers-model-grid" role="list" aria-label="Pinned models">
                  {pinned.map(modelRow)}
                </div>
              </section>
            )}
            {groups.map((group) => (
              <section key={group.key} className="model-workspace-group" aria-label={group.label}>
                {(groups.length > 1 || pinned.length > 0) && (
                  <h3 className="model-workspace-group__title">{group.label}</h3>
                )}
                <div className="providers-model-grid" role="list" aria-label={`Models in ${group.label}`}>
                  {group.models.map(modelRow)}
                </div>
              </section>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmSurface
        open={pendingWrite !== null}
        action={pendingWrite?.action ?? ""}
        target={pendingWrite?.target ?? ""}
        blastRadius={pendingWrite?.blastRadius ?? ""}
        confirmLabel={write.isPending ? "Writing…" : undefined}
        onConfirm={(meta) => {
          if (pendingWrite && !write.isPending) write.mutate({ pending: pendingWrite, meta });
        }}
        onCancel={() => setPendingWrite(null)}
      >
        {pendingWrite && (
          <ul className="model-workspace-write-list">
            {pendingWrite.entries.map(([key, value]) => (
              <li key={key}>
                <code>
                  {key} = {JSON.stringify(value)}
                </code>
              </li>
            ))}
          </ul>
        )}
      </ConfirmSurface>
    </>
  );
}
