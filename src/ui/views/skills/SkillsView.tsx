// Skills — docs/FEATURES.md §8: list / create / edit (markdown body editor) /
// enable / disable / delete over /app/registries/skills, plus a static
// readiness rendering of each skill's DECLARED requirements (the record's
// requirements strings, rendered verbatim — no probe pretends to verify them).

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadCloud, Pencil, Plus, RefreshCw, ScrollText, Sparkles, Trash2 } from "lucide-react";
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
  parseSkill,
  regKeys,
  updateRegistryItem,
  type SkillItem,
} from "../routines/registries.ts";
import { ImportBridgeModal } from "../routines/ImportBridgeModal.tsx";
import { SkillEditorModal, type SkillDraft } from "./SkillEditorModal.tsx";
import { DaemonSkillsPanel, type DaemonSkillsPanelHandle } from "./DaemonSkillsPanel.tsx";

type EditorTarget = { mode: "create" } | { mode: "edit"; skill: SkillItem } | null;
type SkillsSection = "registry" | "daemon";

export function SkillsView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editor, setEditor] = useState<EditorTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  // Two independent skill catalogs share this view: the app-local registry
  // (below, ported from webui) and the daemon-canonical store (new — no crib
  // exists). A section switcher, not a route, keeps them one view.
  const [section, setSection] = useState<SkillsSection>("registry");
  const daemonPanelRef = useRef<DaemonSkillsPanelHandle>(null);

  const list = useQuery({
    queryKey: regKeys.collection("skills"),
    queryFn: () => listRegistryItems("skills"),
    // App-local file store — no wire event exists, so poll (cheap local read).
    refetchInterval: REGISTRY_POLL_MS,
    retry: false,
  });

  const skills = useMemo(() => (list.data ?? []).map(parseSkill), [list.data]);
  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.requirements.some((r) => r.toLowerCase().includes(q)),
    );
  }, [skills, filterText]);
  const enabledCount = skills.filter((s) => s.enabled).length;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: regKeys.collection("skills") });

  const save = useMutation({
    mutationFn: ({ target, draft }: { target: SkillItem | null; draft: SkillDraft }) => {
      if (target) return updateRegistryItem("skills", target.id, { ...target.raw, ...draft });
      return createRegistryItem("skills", { ...draft });
    },
    onSuccess: async (_result, { target }) => {
      await invalidate();
      setEditor(null);
      toast({ title: target ? "Skill updated" : "Skill created", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Save failed", description: formatError(error), tone: "danger" });
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: (skill: SkillItem) =>
      updateRegistryItem("skills", skill.id, { ...skill.raw, enabled: !skill.enabled }),
    onSuccess: () => void invalidate(),
    onError: (error: unknown) => {
      toast({ title: "Toggle failed", description: formatError(error), tone: "danger" });
    },
  });

  const remove = useMutation({
    mutationFn: (skill: SkillItem) => deleteRegistryItem("skills", skill.id),
    onSuccess: async (_result, skill) => {
      await invalidate();
      setDeleteTarget(null);
      toast({ title: `Deleted skill "${skill.name}"`, tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    },
  });

  useEffect(() => {
    registerCommand({
      id: "skills.create",
      title: "Skills: New Skill",
      group: "assistant",
      keywords: ["skill", "capability", "create", "daemon"],
      // Section-aware: opens the create form for whichever catalog is
      // currently on screen (registry app-local, or daemon-canonical).
      run: () => {
        if (section === "daemon") daemonPanelRef.current?.openCreate();
        else setEditor({ mode: "create" });
      },
    });
    registerCommand({
      id: "skills.import",
      title: "Skills: Import from goodvibes-agent",
      group: "assistant",
      keywords: ["skill", "import", "agent", "bridge"],
      run: () => setImportOpen(true),
    });
    return () => {
      unregisterCommand("skills.create");
      unregisterCommand("skills.import");
    };
  }, [section]);

  const unavailable = list.isError && isRegistryUnavailable(list.error);

  return (
    <div className="skills-view reg-view">
      <div className="skills-view__sections" role="tablist" aria-label="Skill catalog">
        <button
          type="button"
          role="tab"
          aria-selected={section === "registry"}
          className={section === "registry" ? "reg-button reg-button--active" : "reg-button"}
          onClick={() => setSection("registry")}
        >
          <Sparkles size={14} aria-hidden="true" /> Assistant skills (registry)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "daemon"}
          className={section === "daemon" ? "reg-button reg-button--active" : "reg-button"}
          onClick={() => setSection("daemon")}
        >
          <ScrollText size={14} aria-hidden="true" /> Daemon skills
        </button>
      </div>

      {section === "registry" && (
        <>
          <div className="reg-toolbar">
            <span className="reg-toolbar__summary">
              <Sparkles size={14} aria-hidden="true" /> Skills
              {list.isSuccess ? ` · ${skills.length} (${enabledCount} enabled)` : ""}
            </span>
            <span className="reg-search">
              <input
                type="search"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter by name, description, requirement"
                aria-label="Filter skills"
              />
            </span>
            <button type="button" className="reg-button" onClick={() => setImportOpen(true)}>
              <DownloadCloud size={14} aria-hidden="true" /> Import from goodvibes-agent
            </button>
            <button
              type="button"
              className="reg-button reg-button--primary"
              onClick={() => setEditor({ mode: "create" })}
            >
              <Plus size={14} aria-hidden="true" /> New skill
            </button>
            <button
              type="button"
              className="reg-icon-button"
              aria-label="Refresh skills"
              onClick={() => void list.refetch()}
            >
              <RefreshCw size={14} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
            </button>
          </div>

          {list.isPending && <SkeletonBlock variant="text" lines={5} />}

          {unavailable && (
            <UnavailableState
              capability="/app/registries/skills"
              description="the app-local skill registry is not part of this build, so skills cannot be listed or edited."
            />
          )}

          {list.isError && !unavailable && (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load skills" />
          )}

          {list.isSuccess && filtered.length === 0 && (
            <EmptyState
              icon={<Sparkles size={28} aria-hidden="true" />}
              title={filterText ? "No skills match the filter" : "No skills yet"}
              description={
                filterText
                  ? "Try a different name, description, or requirement."
                  : "A skill is a reusable markdown instruction block the assistant can apply. Create one or import from goodvibes-agent."
              }
              action={
                filterText
                  ? { label: "Clear filter", onClick: () => setFilterText("") }
                  : { label: "New skill", onClick: () => setEditor({ mode: "create" }) }
              }
            />
          )}

          {list.isSuccess && filtered.length > 0 && (
            <ul className="reg-rows">
              {filtered.map((skill) => (
                <li key={skill.id} className="reg-row">
                  <div className="reg-row__head">
                    <label className="reg-row__toggle" title={skill.enabled ? "Enabled" : "Disabled"}>
                      <input
                        type="checkbox"
                        checked={skill.enabled}
                        onChange={() => toggleEnabled.mutate(skill)}
                        aria-label={`${skill.enabled ? "Disable" : "Enable"} skill ${skill.name}`}
                        disabled={toggleEnabled.isPending}
                      />
                    </label>
                    <span className="reg-row__name">{skill.name}</span>
                    {!skill.enabled && <span className="badge neutral">disabled</span>}
                    {skill.source && <span className="badge neutral">{skill.source}</span>}
                  </div>
                  {skill.description && <p className="reg-row__description">{skill.description}</p>}
                  {skill.requirements.length > 0 && (
                    <div className="reg-row__requirements">
                      <span className="reg-row__requirements-label">Declared requirements:</span>
                      {skill.requirements.map((requirement) => (
                        <span
                          key={requirement}
                          className="badge info"
                          title="Declared by the skill — not verified by the app"
                        >
                          {requirement}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="reg-row__actions">
                    <button type="button" className="reg-button" onClick={() => setEditor({ mode: "edit", skill })}>
                      <Pencil size={13} aria-hidden="true" /> Edit
                    </button>
                    <button
                      type="button"
                      className="reg-button reg-button--danger"
                      onClick={() => setDeleteTarget(skill)}
                    >
                      <Trash2 size={13} aria-hidden="true" /> Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <SkillEditorModal
            open={editor !== null}
            skill={editor?.mode === "edit" ? editor.skill : null}
            saving={save.isPending}
            onClose={() => setEditor(null)}
            onSave={(draft) => save.mutate({ target: editor?.mode === "edit" ? editor.skill : null, draft })}
          />

          <ConfirmSurface
            open={deleteTarget !== null}
            action="Delete skill"
            target={deleteTarget?.name ?? ""}
            blastRadius="Removes this skill from the app-local registry. Imported copies in goodvibes-agent are not touched."
            danger
            confirmLabel={remove.isPending ? "Deleting…" : "Delete skill"}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => {
              if (deleteTarget && !remove.isPending) remove.mutate(deleteTarget);
            }}
          />
        </>
      )}

      {section === "daemon" && <DaemonSkillsPanel ref={daemonPanelRef} />}

      <ImportBridgeModal open={importOpen} onClose={() => setImportOpen(false)} defaultCollection="skills" />
    </div>
  );
}
