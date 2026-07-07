// Personas — docs/FEATURES.md §8: list / create / edit / activate / delete
// over /app/registries/personas, with SINGLE-ACTIVE enforced client-side
// (activating one persona also writes active:false to every other active
// record — the store itself is permissive). Right panel: the VIBE.md editor
// (VibePanel — real disk writes). Discovery: parse persona-like sections out
// of VIBE.md and offer them as candidates (VibeDiscoveryModal).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadCloud, Pencil, Plus, Power, RefreshCw, Trash2, Users, Wand2 } from "lucide-react";
import { formatError } from "../../lib/errors.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  REGISTRY_POLL_MS,
  createRegistryItem,
  deleteRegistryItem,
  isRegistryUnavailable,
  listRegistryItems,
  parsePersona,
  regKeys,
  updateRegistryItem,
  type PersonaItem,
} from "../routines/registries.ts";
import { ImportBridgeModal } from "../routines/ImportBridgeModal.tsx";
import { PersonaEditorModal, type PersonaDraft } from "./PersonaEditorModal.tsx";
import { VibeDiscoveryModal } from "./VibeDiscoveryModal.tsx";
import { VibePanel } from "./VibePanel.tsx";

type EditorTarget = { mode: "create" } | { mode: "edit"; persona: PersonaItem } | null;

export function PersonasView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editor, setEditor] = useState<EditorTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<PersonaItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);

  const list = useQuery({
    queryKey: regKeys.collection("personas"),
    queryFn: () => listRegistryItems("personas"),
    // App-local file store — no wire event exists, so poll (cheap local read).
    refetchInterval: REGISTRY_POLL_MS,
    retry: false,
  });

  const personas = useMemo(() => (list.data ?? []).map(parsePersona), [list.data]);
  const activePersona = personas.find((p) => p.active);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: regKeys.collection("personas") });

  const save = useMutation({
    mutationFn: ({ target, draft }: { target: PersonaItem | null; draft: PersonaDraft }) => {
      if (target) return updateRegistryItem("personas", target.id, { ...target.raw, ...draft });
      return createRegistryItem("personas", { ...draft, active: false });
    },
    onSuccess: async (_result, { target }) => {
      await invalidate();
      setEditor(null);
      toast({ title: target ? "Persona updated" : "Persona created", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Save failed", description: formatError(error), tone: "danger" });
    },
  });

  // Single-active enforcement lives HERE: deactivate every other active
  // record first, then activate the target, so a mid-flight failure can only
  // leave zero active personas — never two.
  const activate = useMutation({
    mutationFn: async (persona: PersonaItem) => {
      const others = personas.filter((p) => p.active && p.id !== persona.id);
      for (const other of others) {
        await updateRegistryItem("personas", other.id, { ...other.raw, active: false });
      }
      await updateRegistryItem("personas", persona.id, { ...persona.raw, active: true });
      return persona;
    },
    onSuccess: async (persona) => {
      await invalidate();
      toast({ title: `Persona "${persona.name}" is now active`, tone: "success" });
    },
    onError: async (error: unknown) => {
      await invalidate(); // partial writes possible — re-read the truth
      toast({ title: "Activation failed", description: formatError(error), tone: "danger" });
    },
  });

  const deactivate = useMutation({
    mutationFn: (persona: PersonaItem) =>
      updateRegistryItem("personas", persona.id, { ...persona.raw, active: false }),
    onSuccess: async (_result, persona) => {
      await invalidate();
      toast({ title: `Persona "${persona.name}" deactivated`, tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Deactivation failed", description: formatError(error), tone: "danger" });
    },
  });

  const remove = useMutation({
    mutationFn: (persona: PersonaItem) => deleteRegistryItem("personas", persona.id),
    onSuccess: async (_result, persona) => {
      await invalidate();
      setDeleteTarget(null);
      toast({ title: `Deleted persona "${persona.name}"`, tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    },
  });

  useEffect(() => {
    registerCommand({
      id: "personas.create",
      title: "Personas: New Persona",
      group: "assistant",
      keywords: ["persona", "personality", "create"],
      run: () => setEditor({ mode: "create" }),
    });
    registerCommand({
      id: "personas.discover",
      title: "Personas: Discover from VIBE.md",
      group: "assistant",
      keywords: ["persona", "vibe", "discover", "import"],
      run: () => setDiscoveryOpen(true),
    });
    return () => {
      unregisterCommand("personas.create");
      unregisterCommand("personas.discover");
    };
  }, []);

  const unavailable = list.isError && isRegistryUnavailable(list.error);

  return (
    <div className="personas-view reg-view">
      <div className="personas-view__list">
        <div className="reg-toolbar">
          <span className="reg-toolbar__summary">
            <Users size={14} aria-hidden="true" /> Personas
            {list.isSuccess ? ` · ${personas.length}` : ""}
            {activePersona ? ` · active: ${activePersona.name}` : list.isSuccess ? " · none active" : ""}
          </span>
          <button type="button" className="reg-button" onClick={() => setDiscoveryOpen(true)}>
            <Wand2 size={14} aria-hidden="true" /> Discover from VIBE.md
          </button>
          <button type="button" className="reg-button" onClick={() => setImportOpen(true)}>
            <DownloadCloud size={14} aria-hidden="true" /> Import from goodvibes-agent
          </button>
          <button type="button" className="reg-button reg-button--primary" onClick={() => setEditor({ mode: "create" })}>
            <Plus size={14} aria-hidden="true" /> New persona
          </button>
          <button
            type="button"
            className="reg-icon-button"
            aria-label="Refresh personas"
            onClick={() => void list.refetch()}
          >
            <RefreshCw size={14} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
        </div>

        {list.isPending && <SkeletonBlock variant="text" lines={5} />}

        {unavailable && (
          <UnavailableState
            capability="/app/registries/personas"
            description="the app-local persona registry is not part of this build, so personas cannot be listed or edited."
          />
        )}

        {list.isError && !unavailable && (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load personas" />
        )}

        {list.isSuccess && personas.length === 0 && (
          <EmptyState
            icon={<Users size={28} aria-hidden="true" />}
            title="No personas yet"
            description="A persona is a reusable personality prompt. Create one, or discover candidates from your VIBE.md."
            action={{ label: "New persona", onClick: () => setEditor({ mode: "create" }) }}
          />
        )}

        {list.isSuccess && personas.length > 0 && (
          <ul className="reg-rows">
            {personas.map((persona) => (
              <li key={persona.id} className={persona.active ? "reg-row reg-row--active" : "reg-row"}>
                <div className="reg-row__head">
                  <span className="reg-row__name">{persona.name}</span>
                  {persona.active && <span className="badge ok">active</span>}
                  {persona.source && <span className="badge neutral">{persona.source}</span>}
                </div>
                {persona.description && <p className="reg-row__description">{persona.description}</p>}
                {persona.prompt && (
                  <p className="reg-row__snippet">
                    {persona.prompt.slice(0, 180)}
                    {persona.prompt.length > 180 ? "…" : ""}
                  </p>
                )}
                <div className="reg-row__actions">
                  {persona.active ? (
                    <button
                      type="button"
                      className="reg-button"
                      onClick={() => deactivate.mutate(persona)}
                      disabled={deactivate.isPending || activate.isPending}
                    >
                      <Power size={13} aria-hidden="true" /> Deactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="reg-button"
                      onClick={() => activate.mutate(persona)}
                      disabled={activate.isPending || deactivate.isPending}
                      title="Activating deactivates any other active persona (single-active)"
                    >
                      <Power size={13} aria-hidden="true" /> Activate
                    </button>
                  )}
                  <button type="button" className="reg-button" onClick={() => setEditor({ mode: "edit", persona })}>
                    <Pencil size={13} aria-hidden="true" /> Edit
                  </button>
                  <button
                    type="button"
                    className="reg-button reg-button--danger"
                    onClick={() => setDeleteTarget(persona)}
                  >
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <VibePanel />

      <PersonaEditorModal
        open={editor !== null}
        persona={editor?.mode === "edit" ? editor.persona : null}
        saving={save.isPending}
        onClose={() => setEditor(null)}
        onSave={(draft) => save.mutate({ target: editor?.mode === "edit" ? editor.persona : null, draft })}
      />

      <VibeDiscoveryModal open={discoveryOpen} existing={personas} onClose={() => setDiscoveryOpen(false)} />

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete persona"
        target={deleteTarget?.name ?? ""}
        blastRadius={
          deleteTarget?.active
            ? "This persona is currently ACTIVE — deleting it leaves no active persona. VIBE.md is not touched."
            : "Removes this persona from the app-local registry. VIBE.md is not touched."
        }
        danger
        confirmLabel={remove.isPending ? "Deleting…" : "Delete persona"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && !remove.isPending) remove.mutate(deleteTarget);
        }}
      />

      <ImportBridgeModal open={importOpen} onClose={() => setImportOpen(false)} defaultCollection="personas" />
    </div>
  );
}
