// Routines — local recipes (docs/FEATURES.md §8): list / create / edit
// (name, ordered steps, tags, requirements, enabled) / delete over the
// app-local /app/registries/routines store; "Start in chat" prints the steps
// into the chat composer draft (documented localStorage handoff, see
// registries.ts) and bumps startCount; explicit confirm-gated PROMOTION to a
// daemon schedule via automation.schedules.create (PromoteScheduleModal).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, DownloadCloud, MessageSquare, Pencil, Plus, RefreshCw, Repeat, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { registerCommand, runCommand, unregisterCommand } from "../../lib/commands.ts";
import { useToast } from "../../lib/toast.ts";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  REGISTRY_POLL_MS,
  createRegistryItem,
  deleteRegistryItem,
  isRegistryUnavailable,
  listRegistryItems,
  parseRoutine,
  regKeys,
  routineStepsText,
  updateRegistryItem,
  writeChatDraftHandoff,
  type RoutineItem,
} from "./registries.ts";
import { RoutineEditorModal, type RoutineDraft } from "./RoutineEditorModal.tsx";
import { PromoteScheduleModal, type PromoteCapability } from "./PromoteScheduleModal.tsx";
import { ImportBridgeModal } from "./ImportBridgeModal.tsx";

type EditorTarget = { mode: "create" } | { mode: "edit"; routine: RoutineItem } | null;

export function RoutinesView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editor, setEditor] = useState<EditorTarget>(null);
  const [promoteTarget, setPromoteTarget] = useState<RoutineItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoutineItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [filterText, setFilterText] = useState("");

  const list = useQuery({
    queryKey: regKeys.collection("routines"),
    queryFn: () => listRegistryItems("routines"),
    // App-local file store — no wire event exists, so poll (cheap local read).
    refetchInterval: REGISTRY_POLL_MS,
    retry: false,
  });

  // Promotion capability probe — daemon 1.0.0 may not serve every contract
  // method; honest quad-state like the sessions.delete pattern.
  const promoteCapability = useQuery({
    queryKey: ["capability", "automation.schedules.create"],
    queryFn: () => gv.probeMethod("automation.schedules.create"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const promoteState: PromoteCapability = promoteCapability.isSuccess
    ? promoteCapability.data
      ? "available"
      : "unavailable"
    : promoteCapability.isError
      ? "uncertain"
      : "checking";

  const routines = useMemo(() => (list.data ?? []).map(parseRoutine), [list.data]);
  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return routines;
    return routines.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        r.steps.some((step) => step.toLowerCase().includes(q)),
    );
  }, [routines, filterText]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: regKeys.collection("routines") });

  const save = useMutation({
    mutationFn: ({ target, draft }: { target: RoutineItem | null; draft: RoutineDraft }) => {
      if (target) {
        return updateRegistryItem("routines", target.id, { ...target.raw, ...draft });
      }
      return createRegistryItem("routines", { ...draft, startCount: 0 });
    },
    onSuccess: async (_result, { target }) => {
      await invalidate();
      setEditor(null);
      toast({ title: target ? "Routine updated" : "Routine created", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Save failed", description: formatError(error), tone: "danger" });
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: (routine: RoutineItem) =>
      updateRegistryItem("routines", routine.id, { ...routine.raw, enabled: !routine.enabled }),
    onSuccess: () => void invalidate(),
    onError: (error: unknown) => {
      toast({ title: "Toggle failed", description: formatError(error), tone: "danger" });
    },
  });

  const remove = useMutation({
    mutationFn: (routine: RoutineItem) => deleteRegistryItem("routines", routine.id),
    onSuccess: async (_result, routine) => {
      await invalidate();
      setDeleteTarget(null);
      toast({ title: `Deleted routine "${routine.name}"`, tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    },
  });

  // "Start in chat": bump startCount (agent semantics — starting a routine
  // records usage), hand the steps to the chat composer draft, jump to Chat.
  const startInChat = useMutation({
    mutationFn: async (routine: RoutineItem) => {
      await updateRegistryItem("routines", routine.id, {
        ...routine.raw,
        startCount: routine.startCount + 1,
      });
      return routine;
    },
    onSuccess: (routine) => {
      void invalidate();
      const handedOff = writeChatDraftHandoff(routineStepsText(routine.name, routine.steps), `routine:${routine.id}`);
      runCommand("nav.chat");
      toast({
        title: `Routine "${routine.name}" started`,
        description: handedOff
          ? "Its steps are waiting in the chat composer draft."
          : "Could not hand the steps to the composer (local storage unavailable).",
        tone: handedOff ? "success" : "warning",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Start failed", description: formatError(error), tone: "danger" });
    },
  });

  // Palette commands scoped to this view module (additive-only registry API).
  useEffect(() => {
    registerCommand({
      id: "routines.create",
      title: "Routines: New Routine",
      group: "assistant",
      keywords: ["routine", "recipe", "steps", "create"],
      run: () => setEditor({ mode: "create" }),
    });
    registerCommand({
      id: "routines.import",
      title: "Routines: Import from goodvibes-agent",
      group: "assistant",
      keywords: ["routine", "import", "agent", "bridge"],
      run: () => setImportOpen(true),
    });
    return () => {
      unregisterCommand("routines.create");
      unregisterCommand("routines.import");
    };
  }, []);

  const unavailable = list.isError && isRegistryUnavailable(list.error);

  return (
    <div className="routines-view reg-view">
      <div className="reg-toolbar">
        <span className="reg-toolbar__summary">
          <Repeat size={14} aria-hidden="true" /> Routines
          {list.isSuccess ? ` · ${routines.length}` : ""}
        </span>
        <span className="reg-search">
          <input
            type="search"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter by name, tag, step"
            aria-label="Filter routines"
          />
        </span>
        <button type="button" className="reg-button" onClick={() => setImportOpen(true)}>
          <DownloadCloud size={14} aria-hidden="true" /> Import from goodvibes-agent
        </button>
        <button type="button" className="reg-button reg-button--primary" onClick={() => setEditor({ mode: "create" })}>
          <Plus size={14} aria-hidden="true" /> New routine
        </button>
        <button
          type="button"
          className="reg-icon-button"
          aria-label="Refresh routines"
          onClick={() => void list.refetch()}
        >
          <RefreshCw size={14} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {list.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState
          capability="/app/registries/routines"
          description="the app-local routine registry is not part of this build, so routines cannot be listed or edited."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load routines" />
      )}

      {list.isSuccess && filtered.length === 0 && (
        <EmptyState
          icon={<Repeat size={28} aria-hidden="true" />}
          title={filterText ? "No routines match the filter" : "No routines yet"}
          description={
            filterText
              ? "Try a different name, tag, or step text."
              : "Routines are reusable step-by-step recipes you can start in chat or promote to a daemon schedule."
          }
          action={
            filterText
              ? { label: "Clear filter", onClick: () => setFilterText("") }
              : { label: "New routine", onClick: () => setEditor({ mode: "create" }) }
          }
        />
      )}

      {list.isSuccess && filtered.length > 0 && (
        <ul className="reg-rows">
          {filtered.map((routine) => (
            <li key={routine.id} className="reg-row">
              <div className="reg-row__head">
                <label className="reg-row__toggle" title={routine.enabled ? "Enabled" : "Disabled"}>
                  <input
                    type="checkbox"
                    checked={routine.enabled}
                    onChange={() => toggleEnabled.mutate(routine)}
                    aria-label={`${routine.enabled ? "Disable" : "Enable"} routine ${routine.name}`}
                    disabled={toggleEnabled.isPending}
                  />
                </label>
                <span className="reg-row__name">{routine.name}</span>
                {routine.reviewState && <StatusBadge value={routine.reviewState} />}
                {routine.source && <span className="badge neutral">{routine.source}</span>}
                <span className="reg-row__meta">
                  {routine.steps.length} {routine.steps.length === 1 ? "step" : "steps"}
                  {routine.startCount > 0 ? ` · started ${routine.startCount}×` : ""}
                </span>
              </div>
              {routine.tags.length > 0 && (
                <div className="reg-row__tags">
                  {routine.tags.map((tag) => (
                    <span key={tag} className="reg-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {routine.steps.length > 0 && (
                <ol className="reg-row__steps">
                  {routine.steps.slice(0, 3).map((step, index) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <li key={index}>{step}</li>
                  ))}
                  {routine.steps.length > 3 && <li className="reg-row__more">+{routine.steps.length - 3} more</li>}
                </ol>
              )}
              <div className="reg-row__actions">
                <button
                  type="button"
                  className="reg-button"
                  onClick={() => startInChat.mutate(routine)}
                  disabled={startInChat.isPending || routine.steps.length === 0}
                >
                  <MessageSquare size={13} aria-hidden="true" /> Start in chat
                </button>
                <button
                  type="button"
                  className="reg-button"
                  onClick={() => setPromoteTarget(routine)}
                  disabled={promoteState === "unavailable"}
                  title={
                    promoteState === "unavailable"
                      ? "The connected daemon does not serve automation.schedules.create"
                      : "Create a daemon schedule from this routine (confirmed)"
                  }
                >
                  <CalendarClock size={13} aria-hidden="true" /> Promote to schedule
                </button>
                <button type="button" className="reg-button" onClick={() => setEditor({ mode: "edit", routine })}>
                  <Pencil size={13} aria-hidden="true" /> Edit
                </button>
                <button
                  type="button"
                  className="reg-button reg-button--danger"
                  onClick={() => setDeleteTarget(routine)}
                >
                  <Trash2 size={13} aria-hidden="true" /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <RoutineEditorModal
        open={editor !== null}
        routine={editor?.mode === "edit" ? editor.routine : null}
        saving={save.isPending}
        onClose={() => setEditor(null)}
        onSave={(draft) => save.mutate({ target: editor?.mode === "edit" ? editor.routine : null, draft })}
      />

      <PromoteScheduleModal
        routine={promoteTarget}
        capability={promoteState}
        onClose={() => setPromoteTarget(null)}
      />

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete routine"
        target={deleteTarget?.name ?? ""}
        blastRadius="Removes this routine from the app-local registry only. Schedules already promoted to the daemon keep running and must be removed from the Automation view."
        danger
        confirmLabel={remove.isPending ? "Deleting…" : "Delete routine"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && !remove.isPending) remove.mutate(deleteTarget);
        }}
      />

      <ImportBridgeModal open={importOpen} onClose={() => setImportOpen(false)} defaultCollection="routines" />
    </div>
  );
}
