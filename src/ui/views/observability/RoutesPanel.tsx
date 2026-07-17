// Routes snapshot + bindings CRUD — routes.snapshot (read-only) and
// routes.bindings.{list,create,update,delete}. The binding record shape
// isn't pinned by the contracts package for this pin, so create/update take
// a raw JSON body instead of guessing field names wrong — honest about what
// this app actually knows. Delete is dangerous-flagged upstream (operator-
// routes.ts) and goes through the shared ConfirmSurface with a typed
// confirmation, never a native confirm().

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { clearDraft, useDraftState } from "../../lib/drafts.ts";
import { asRecord, bestId, bestTitle, compactJson, firstArray } from "../../lib/wire.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { obsKeys } from "./keys.ts";

type BindingFormMode = { type: "create" } | { type: "edit"; bindingId: string; initialJson: string };

function draftKeyForBindingForm(mode: BindingFormMode): string {
  return mode.type === "create" ? "providers.routes-binding.create" : `providers.routes-binding.${mode.bindingId}`;
}

export function RoutesPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formMode, setFormMode] = useState<BindingFormMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  const routesSnapshot = useQuery({
    queryKey: obsKeys.routesSnapshot,
    queryFn: () => gv.invoke("routes.snapshot"),
    retry: false,
  });
  const bindings = useQuery({
    queryKey: obsKeys.routesBindings,
    queryFn: () => gv.invoke("routes.bindings.list"),
    retry: false,
  });

  const bindingRows = useMemo(() => firstArray(bindings.data, ["items", "bindings", "data"]), [bindings.data]);
  const bindingsUnavailable = bindings.isError && isMethodUnavailableError(bindings.error);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: obsKeys.routesBindings });

  const createBinding = useMutation({
    mutationFn: (body: unknown) => gv.invoke("routes.bindings.create", { body }),
    onSuccess: async () => {
      setFormMode(null);
      clearDraft("providers.routes-binding.create");
      await invalidate();
      toast({ title: "Binding created", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Create failed", description: formatError(error), tone: "danger" }),
  });

  const updateBinding = useMutation({
    mutationFn: ({ bindingId, body }: { bindingId: string; body: unknown }) =>
      gv.invoke("routes.bindings.update", { params: { bindingId }, body }),
    onSuccess: async (_result, variables) => {
      setFormMode(null);
      clearDraft(`providers.routes-binding.${variables.bindingId}`);
      await invalidate();
      toast({ title: "Binding updated", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Update failed", description: formatError(error), tone: "danger" }),
  });

  const deleteBinding = useMutation({
    mutationFn: (bindingId: string) => gv.invoke("routes.bindings.delete", { params: { bindingId } }),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidate();
      toast({ title: "Binding deleted", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Delete failed", description: formatError(error), tone: "danger" }),
  });

  function submitBindingForm(mode: BindingFormMode, body: unknown): void {
    if (mode.type === "create") createBinding.mutate(body);
    else updateBinding.mutate({ bindingId: mode.bindingId, body });
  }

  return (
    <div className="obs-routes">
      <section className="obs-subsection">
        <div className="obs-panel-toolbar">
          <span className="obs-panel-toolbar__summary">Routes snapshot</span>
          <button type="button" className="obs-btn" aria-label="Refresh routes snapshot" onClick={() => void routesSnapshot.refetch()}>
            <RefreshCw size={14} aria-hidden="true" className={routesSnapshot.isFetching ? "spinning" : undefined} />
          </button>
        </div>
        {routesSnapshot.isPending && <SkeletonBlock variant="text" lines={3} />}
        {routesSnapshot.isError && isMethodUnavailableError(routesSnapshot.error) && (
          <UnavailableState capability="routes.snapshot" />
        )}
        {routesSnapshot.isError && !isMethodUnavailableError(routesSnapshot.error) && (
          <ErrorState error={routesSnapshot.error} onRetry={() => void routesSnapshot.refetch()} title="Failed to load routes snapshot" />
        )}
        {routesSnapshot.isSuccess && (
          <details className="obs-raw-panel">
            <summary>Snapshot payload</summary>
            <pre>{compactJson(routesSnapshot.data)}</pre>
          </details>
        )}
      </section>

      <section className="obs-subsection">
        <div className="obs-panel-toolbar">
          <span className="obs-panel-toolbar__summary">Bindings{bindings.isSuccess ? ` · ${bindingRows.length}` : ""}</span>
          <button type="button" className="obs-btn" onClick={() => setFormMode({ type: "create" })}>
            <Plus size={14} aria-hidden="true" /> Add binding
          </button>
          <button type="button" className="obs-btn" aria-label="Refresh bindings" onClick={() => void bindings.refetch()}>
            <RefreshCw size={14} aria-hidden="true" className={bindings.isFetching ? "spinning" : undefined} />
          </button>
        </div>

        {bindings.isPending && <SkeletonBlock variant="text" lines={3} />}
        {bindingsUnavailable && <UnavailableState capability="routes.bindings.list" description="route bindings cannot be listed." />}
        {bindings.isError && !bindingsUnavailable && (
          <ErrorState error={bindings.error} onRetry={() => void bindings.refetch()} title="Failed to load route bindings" />
        )}
        {bindings.isSuccess && bindingRows.length === 0 && (
          <EmptyState title="No route bindings" description="Add a binding to route a path to a target." />
        )}
        {bindings.isSuccess && bindingRows.length > 0 && (
          <ul className="obs-simple-rows">
            {bindingRows.map((row, i) => {
              const record = asRecord(row);
              const id = bestId(record) || String(i);
              const label = bestTitle(record, `binding ${id}`);
              return (
                <li key={id} className="obs-simple-row obs-simple-row--binding">
                  <span className="obs-table__mono">{id}</span>
                  <span>{label}</span>
                  <button
                    type="button"
                    className="obs-btn"
                    onClick={() => setFormMode({ type: "edit", bindingId: id, initialJson: compactJson(row) })}
                  >
                    <Pencil size={13} aria-hidden="true" /> Edit
                  </button>
                  <button
                    type="button"
                    className="obs-btn obs-btn--danger"
                    onClick={() => setDeleteTarget({ id, label })}
                  >
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {formMode && (
        <RouteBindingForm
          key={draftKeyForBindingForm(formMode)}
          mode={formMode}
          submitting={createBinding.isPending || updateBinding.isPending}
          onCancel={() => setFormMode(null)}
          onSubmit={(body) => submitBindingForm(formMode, body)}
        />
      )}

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete route binding"
        target={deleteTarget?.label ?? ""}
        blastRadius="Removes this route binding from the daemon immediately — any traffic depending on this path/target mapping stops resolving."
        danger
        requireTypedText={deleteTarget?.id}
        confirmLabel={deleteBinding.isPending ? "Deleting…" : "Delete binding"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteBinding.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}

// ─── Create/edit form — a raw JSON body, persisted as a draft. Keyed by the
// parent (create vs. this specific bindingId) so it remounts, and therefore
// re-syncs from storage, per target. ─────────────────────────────────────────

function RouteBindingForm({
  mode,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: BindingFormMode;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (body: unknown) => void;
}) {
  const [formJson, setFormJson] = useDraftState(
    draftKeyForBindingForm(mode),
    mode.type === "create" ? "{\n  \n}" : mode.initialJson,
  );
  const [formJsonError, setFormJsonError] = useState<string | null>(null);

  function submit(): void {
    try {
      const parsed = JSON.parse(formJson);
      setFormJsonError(null);
      onSubmit(parsed);
    } catch {
      setFormJsonError("Not valid JSON.");
    }
  }

  return (
    <div className="obs-inline-form" role="group" aria-label={mode.type === "create" ? "Create route binding" : "Edit route binding"}>
      <label>
        <span>
          {mode.type === "create" ? "New binding" : `Edit binding ${mode.bindingId}`} (raw JSON body — this
          daemon's binding schema isn't pinned in this app build)
        </span>
        <textarea value={formJson} onChange={(e) => setFormJson(e.target.value)} rows={6} spellCheck={false} />
      </label>
      {formJsonError && <p className="obs-inline-form__error">{formJsonError}</p>}
      <div className="obs-inline-form__actions">
        <button type="button" className="obs-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="obs-btn obs-btn--primary" onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : mode.type === "create" ? "Create binding" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
