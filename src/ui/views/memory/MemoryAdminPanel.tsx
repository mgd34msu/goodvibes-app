// Vector index + embeddings admin (FEATURES.md §7: vector stats / rebuild,
// embedding provider doctor + default set).
//
// memory.vector.rebuild and memory.embeddings.default.set are admin-access
// routes; a non-admin token gets the daemon's own rejection surfaced verbatim
// in a toast. Rebuild goes through ConfirmSurface (docs/UX.md §4) — the wire
// method itself takes no confirm field, so the surface gates the CLICK, and
// nothing is sent until the operator confirms.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  formatTimestamp,
  memoryKeys,
  parseDoctorReport,
  parseVectorStats,
  type MemoryVectorStats,
} from "./memory-wire.ts";

function boolBadge(value: boolean, yes: string, no: string) {
  return <span className={`badge ${value ? "ok" : "warning"}`}>{value ? yes : no}</span>;
}

function VectorStatsFacts({ stats }: { stats: MemoryVectorStats }) {
  return (
    <dl className="memory-admin__facts">
      <div>
        <dt>Backend</dt>
        <dd>{stats.backend}</dd>
      </div>
      <div>
        <dt>State</dt>
        <dd>
          {boolBadge(stats.enabled, "enabled", "disabled")} {boolBadge(stats.available, "available", "unavailable")}
        </dd>
      </div>
      <div>
        <dt>Indexed records</dt>
        <dd>{stats.indexedRecords ?? "—"}</dd>
      </div>
      <div>
        <dt>Dimensions</dt>
        <dd>{stats.dimensions ?? "—"}</dd>
      </div>
      <div>
        <dt>Embedding provider</dt>
        <dd>{stats.embeddingProviderLabel || stats.embeddingProviderId || "—"}</dd>
      </div>
      {stats.path && (
        <div>
          <dt>Index path</dt>
          <dd>
            <code>{stats.path}</code>
          </dd>
        </div>
      )}
      {stats.error && (
        <div>
          <dt>Error</dt>
          <dd className="memory-admin__error-text">{stats.error}</dd>
        </div>
      )}
      {stats.platformLimitReason && (
        <div>
          <dt>Platform limit</dt>
          <dd>{stats.platformLimitReason}</dd>
        </div>
      )}
    </dl>
  );
}

export function MemoryAdminPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const vector = useQuery({
    queryKey: memoryKeys.vector,
    queryFn: async () => parseVectorStats(await invoke("memory.vector.stats")),
    retry: false,
  });

  const doctor = useQuery({
    queryKey: memoryKeys.doctor,
    queryFn: async () => parseDoctorReport(await invoke("memory.doctor")),
    retry: false,
  });

  const rebuild = useMutation({
    mutationFn: () => invoke("memory.vector.rebuild", { body: {} }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: memoryKeys.all });
      toast({ title: "Vector index rebuilt", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Rebuild failed", description: formatError(error), tone: "danger" });
    },
  });

  const setDefaultProvider = useMutation({
    mutationFn: (providerId: string) => invoke("memory.embeddings.default.set", { body: { providerId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: memoryKeys.all });
      toast({ title: "Default embedding provider set", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not set default provider", description: formatError(error), tone: "danger" });
    },
  });

  const vectorUnavailable = vector.isError && isMethodUnavailableError(vector.error);
  const doctorUnavailable = doctor.isError && isMethodUnavailableError(doctor.error);
  const embeddings = doctor.data?.embeddings ?? null;

  return (
    <section className="memory-panel" aria-label="Vector index and embeddings">
      <div className="memory-panel__title">
        <h2>Vector index</h2>
        <Activity size={16} aria-hidden="true" />
      </div>

      {vector.isPending && <SkeletonBlock width="100%" height={64} />}
      {vectorUnavailable && (
        <UnavailableState
          capability="memory.vector.stats"
          description="semantic-index posture cannot be inspected or rebuilt."
        />
      )}
      {vector.isError && !vectorUnavailable && (
        <ErrorState error={vector.error} onRetry={() => void vector.refetch()} title="Vector stats failed" />
      )}
      {vector.isSuccess && vector.data === null && (
        <p className="memory-record-detail__none">The daemon returned no vector-store posture.</p>
      )}
      {vector.isSuccess && vector.data !== null && (
        <>
          <VectorStatsFacts stats={vector.data} />
          <button
            type="button"
            className="memory-button"
            onClick={() => setConfirmRebuild(true)}
            disabled={rebuild.isPending}
            aria-busy={rebuild.isPending}
          >
            <RefreshCw size={13} aria-hidden="true" className={rebuild.isPending ? "spinning" : undefined} />
            {rebuild.isPending ? "Rebuilding…" : "Rebuild index (admin)"}
          </button>
        </>
      )}

      <div className="memory-panel__subtitle">
        <h3>Embeddings doctor</h3>
        {doctor.data?.checkedAt !== undefined && (
          <span className="memory-panel__checked-at">checked {formatTimestamp(doctor.data.checkedAt)}</span>
        )}
      </div>

      {doctor.isPending && <SkeletonBlock width="100%" height={48} />}
      {doctorUnavailable && (
        <UnavailableState
          capability="memory.doctor"
          description="embedding-provider diagnostics are not served here."
        />
      )}
      {doctor.isError && !doctorUnavailable && (
        <ErrorState error={doctor.error} onRetry={() => void doctor.refetch()} title="Doctor failed" />
      )}
      {doctor.isSuccess && embeddings === null && (
        <p className="memory-record-detail__none">The daemon returned no embeddings report.</p>
      )}
      {doctor.isSuccess && embeddings !== null && (
        <div className="memory-admin__embeddings">
          {embeddings.warnings.length > 0 && (
            <ul className="memory-admin__warnings" role="alert">
              {embeddings.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <ul className="memory-admin__providers">
            {embeddings.providers.map((provider) => {
              const active = provider.id === embeddings.activeProviderId;
              return (
                <li key={provider.id} className="memory-admin__provider">
                  <span className="memory-admin__provider-label">
                    {provider.label}
                    {active && <span className="badge ok">default</span>}
                  </span>
                  <span className="memory-admin__provider-meta">
                    <span className={`badge ${provider.state === "healthy" ? "ok" : provider.state === "degraded" ? "warning" : "neutral"}`}>
                      {provider.state}
                    </span>
                    {!provider.configured && <span className="badge warning">unconfigured</span>}
                    {provider.dimensions !== undefined && (
                      <span className="badge neutral">{provider.dimensions}d</span>
                    )}
                  </span>
                  {provider.detail && <span className="memory-admin__provider-detail">{provider.detail}</span>}
                  {!active && provider.configured && (
                    <button
                      type="button"
                      className="memory-chip-button"
                      onClick={() => setDefaultProvider.mutate(provider.id)}
                      disabled={setDefaultProvider.isPending}
                    >
                      {setDefaultProvider.isPending && setDefaultProvider.variables === provider.id
                        ? "Setting…"
                        : "Set default (admin)"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ConfirmSurface
        open={confirmRebuild}
        action="Rebuild vector index"
        target={vector.data?.path || "the memory semantic index"}
        blastRadius={`Re-embeds every memory record${
          vector.data?.indexedRecords !== undefined ? ` (${vector.data.indexedRecords} currently indexed)` : ""
        } with ${vector.data?.embeddingProviderLabel || "the active provider"}. Semantic search degrades to literal scans until the rebuild finishes. Requires an admin token.`}
        confirmLabel="Rebuild"
        onConfirm={() => {
          setConfirmRebuild(false);
          rebuild.mutate();
        }}
        onCancel={() => setConfirmRebuild(false)}
      />
    </section>
  );
}
