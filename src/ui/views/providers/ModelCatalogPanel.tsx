// ModelCatalogPanel — the "Catalog" tab inside the Model Workspace modal
// (docs/GAPS.md top-10 gap #8 / docs/FEATURES.md §14 row 5): real catalog
// browsing over models.dev's public api.json (4000+ models across every
// provider it tracks), not just whatever this daemon's providers.list
// already returns. Read-only browsing — no config writes; routing a target
// to a model stays on the Workspace tab (model-catalog.ts / config.set).
//
// Network-honest: model-dev-catalog.ts holds the 24h localStorage cache +
// manual refresh. When models.dev cannot be reached AND there is no cache to
// fall back to, this panel degrades to the SAME providers.list this app
// already calls elsewhere — the pre-existing behavior — with an explicit note
// that it is a fallback, never presented as the real catalog.

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search, WifiOff } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { formatRelative } from "../../lib/wire.ts";
import { EmptyState, SkeletonBlock } from "../../components/feedback.tsx";
import { modelsFromProvidersResponse } from "./model-catalog.ts";
import {
  fetchModelsDevCatalog,
  filterRemoteModels,
  remoteModalityOptions,
  remoteModelsFromCatalog,
  remoteProviderOptions,
  remotePriceTier,
  REMOTE_PRICE_TIER_LABELS,
  type RemoteModel,
  type RemotePriceTier,
} from "./model-dev-catalog.ts";

/** Local query keys, unique-prefixed so they never collide with this app's
 * shared queryKeys.providers or another view's cache entries. */
const CATALOG_QUERY_KEY = ["providers-model-dev-catalog"] as const;
const FALLBACK_QUERY_KEY = ["providers-model-dev-catalog-fallback"] as const;

const ROW_RENDER_CAP = 400;

export function ModelCatalogPanel() {
  const forceRefreshRef = useRef(false);
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modality, setModality] = useState("");
  const [priceTier, setPriceTier] = useState<RemotePriceTier | "all">("all");

  const catalog = useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: () => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return fetchModelsDevCatalog(force);
    },
    // The 24h TTL lives in model-dev-catalog.ts's own localStorage cache, not
    // react-query's in-memory staleness — this query is cheap to re-run and
    // the cache check inside fetchModelsDevCatalog decides whether it hits
    // the network at all.
    staleTime: Infinity,
    retry: false,
  });

  // Kept warm alongside the primary query (not gated behind it visually)
  // so the offline-fallback path below is instant, not a second spinner.
  const providersFallback = useQuery({
    queryKey: FALLBACK_QUERY_KEY,
    queryFn: () => gv.providers.list(),
    enabled: catalog.isError,
    retry: false,
  });

  const remoteModels = useMemo(
    () => (catalog.data ? remoteModelsFromCatalog(catalog.data.raw) : []),
    [catalog.data],
  );
  const providerOptions = useMemo(() => remoteProviderOptions(remoteModels), [remoteModels]);
  const modalityOptions = useMemo(() => remoteModalityOptions(remoteModels), [remoteModels]);
  const filtered = useMemo(
    () =>
      filterRemoteModels(remoteModels, {
        query,
        providerId: providerId || undefined,
        modality: modality || undefined,
        priceTier,
      }),
    [remoteModels, query, providerId, modality, priceTier],
  );

  function refresh(): void {
    forceRefreshRef.current = true;
    void catalog.refetch();
  }

  if (catalog.isPending) {
    return (
      <div className="providers-skeleton-list" aria-label="Loading model catalog" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBlock key={i} variant="block" height={48} />
        ))}
      </div>
    );
  }

  if (catalog.isError) {
    const fallbackModels = providersFallback.data ? modelsFromProvidersResponse(providersFallback.data) : [];
    return (
      <div className="model-catalog-panel">
        <div className="model-catalog-panel__offline-note" role="alert">
          <WifiOff size={14} aria-hidden="true" />
          <span>
            models.dev could not be reached ({formatError(catalog.error)}) and there is no cached catalog yet —
            showing the {fallbackModels.length} model{fallbackModels.length === 1 ? "" : "s"} this daemon's own
            provider registry reports instead. That is the same list the Workspace tab uses; it is not the full
            models.dev catalog.
          </span>
          <button type="button" className="providers-button" onClick={refresh}>
            <RefreshCw size={13} aria-hidden="true" /> Retry
          </button>
        </div>
        {fallbackModels.length === 0 ? (
          <EmptyState title="No catalog available" description="Neither models.dev nor this daemon reported any models." />
        ) : (
          <div className="providers-model-grid" role="list" aria-label="Providers-reported models (offline fallback)">
            {fallbackModels.map((model) => (
              <article key={model.registryKey} className="providers-model-row" role="listitem">
                <div className="providers-model-row__copy">
                  <strong>{model.label}</strong>
                  <span>{model.registryKey}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  const source = catalog.data?.source;
  const fetchedAt = catalog.data?.fetchedAt;

  return (
    <div className="model-catalog-panel">
      <div className="model-catalog-panel__status" aria-live="polite">
        <span>
          {remoteModels.length} models across {providerOptions.length} providers · as of{" "}
          {fetchedAt !== undefined ? formatRelative(fetchedAt) : "unknown"}
          {source === "stale-cache" ? " (refresh failed — showing the last successful fetch)" : ""}
        </span>
        <button
          type="button"
          className="providers-icon-button"
          title="Refresh from models.dev"
          aria-label="Refresh catalog"
          onClick={refresh}
        >
          <RefreshCw size={14} className={catalog.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      <div className="model-workspace-filters">
        <label className="model-workspace-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search catalog"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search catalog"
          />
        </label>
        <label className="model-workspace-filter">
          <span>Provider</span>
          <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
            <option value="">All ({providerOptions.length})</option>
            {providerOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label className="model-workspace-filter">
          <span>Modality</span>
          <select value={modality} onChange={(event) => setModality(event.target.value)}>
            <option value="">All</option>
            {modalityOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="model-workspace-filter">
          <span>Price tier</span>
          <select value={priceTier} onChange={(event) => setPriceTier(event.target.value as RemotePriceTier | "all")}>
            <option value="all">All</option>
            {(Object.keys(REMOTE_PRICE_TIER_LABELS) as RemotePriceTier[]).map((tier) => (
              <option key={tier} value={tier}>
                {REMOTE_PRICE_TIER_LABELS[tier]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No models match" description="Try clearing a filter or the search text." />
      ) : (
        <div className="providers-model-grid" role="list" aria-label="Catalog models">
          {filtered.slice(0, ROW_RENDER_CAP).map((model) => (
            <RemoteModelRow key={model.registryKey} model={model} />
          ))}
        </div>
      )}
      {filtered.length > ROW_RENDER_CAP && (
        <p className="model-catalog-panel__truncate-note">
          Showing the first {ROW_RENDER_CAP} of {filtered.length} matches — narrow the search or filters to see more.
        </p>
      )}
    </div>
  );
}

function RemoteModelRow({ model }: { model: RemoteModel }) {
  const tier = remotePriceTier(model);
  return (
    <article className="providers-model-row" role="listitem" aria-label={model.name}>
      <div className="providers-model-row__copy">
        <strong>{model.name}</strong>
        <span>{model.registryKey}</span>
        <span className="providers-model-price">
          {tier ? REMOTE_PRICE_TIER_LABELS[tier] : "Pricing unreported"}
          {model.inputPricePerMillion !== undefined && model.outputPricePerMillion !== undefined
            ? ` · $${model.inputPricePerMillion}/$${model.outputPricePerMillion} per M tok`
            : ""}
          {model.contextWindow ? ` · ${model.contextWindow.toLocaleString()} ctx` : ""}
        </span>
        {(model.reasoning || model.toolCall || model.openWeights) && (
          <span className="model-catalog-row__flags">
            {model.reasoning && <span className="badge neutral">reasoning</span>}
            {model.toolCall && <span className="badge neutral">tool use</span>}
            {model.openWeights && <span className="badge neutral">open weights</span>}
          </span>
        )}
      </div>
    </article>
  );
}
