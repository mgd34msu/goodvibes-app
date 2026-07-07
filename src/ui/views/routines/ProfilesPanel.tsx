// Profiles — docs/FEATURES.md §8 row 7. Named app-level preset bundles over
// the existing "profiles" registry collection (server-side store already
// generic across collections; no bun-side work needed here). A profile
// stores a persona snapshot + an informational skills list + a VIBE.md
// snapshot; three starter templates (dev/research/writing) prefill sensible
// defaults so a user does not start from a blank form.
//
// HONEST SCOPE (the row's own ask, answered directly in the UI copy):
// activating a profile does exactly two things — (1) makes its embedded
// persona the single active persona in the Personas registry (creating or
// updating a persona named after the profile), and (2) overwrites the real
// VIBE.md file with the profile's saved content. That is the full blast
// radius. "Isolated app homes" (separate GOODVIBES_APP_HOME roots) are a
// goodvibes-tui/daemon concept this app does not implement — the skills list
// is shown for reference only and is NOT auto-enabled/disabled on activate.

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, FlaskConical, PenLine, Plus, Power, Sparkles, Trash2 } from "lucide-react";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  REGISTRY_POLL_MS,
  createRegistryItem,
  deleteRegistryItem,
  isRegistryUnavailable,
  listRegistryItems,
  parsePersona,
  parseProfile,
  regKeys,
  saveVibe,
  updateRegistryItem,
  type ProfileItem,
} from "./registries.ts";

interface ProfileTemplate {
  id: string;
  label: string;
  icon: ReactNode;
  description: string;
  personaDescription: string;
  personaPrompt: string;
  skills: string[];
  vibeContent: string;
}

const TEMPLATES: ProfileTemplate[] = [
  {
    id: "dev",
    label: "Dev",
    icon: <Code2 size={14} aria-hidden="true" />,
    description: "Heads-down implementation: read the diff, make the smallest correct change, run the checks.",
    personaDescription: "Focused implementation persona — terse, code-first, verifies before claiming done.",
    personaPrompt:
      "You are a focused software engineer. Prefer the smallest correct change over a rewrite. Read existing code and conventions before writing new code. Run typecheck/tests/build before declaring anything done. State assumptions and open questions plainly instead of guessing silently.",
    skills: ["repo-search", "test-runner", "diff-review"],
    vibeContent:
      "# Dev profile\n\nPrioritize correctness and minimal diffs. Always verify with the project's own checks (typecheck, tests, build) before calling something finished. Ask before touching files outside the stated scope.\n",
  },
  {
    id: "research",
    label: "Research",
    icon: <FlaskConical size={14} aria-hidden="true" />,
    description: "Wide-scan investigation: gather sources, cross-check claims, write up findings with citations.",
    personaDescription: "Research persona — skeptical, source-grounded, distinguishes fact from inference.",
    personaPrompt:
      "You are a careful researcher. Gather multiple independent sources before asserting a claim as fact. Always separate what a source says from your own inference. Cite sources for every non-obvious claim. Flag contradictions between sources instead of silently picking one.",
    skills: ["web-search", "source-credibility", "citation-formatting"],
    vibeContent:
      "# Research profile\n\nGround every claim in a cited source. When sources disagree, say so explicitly rather than averaging or guessing. Prefer primary sources over summaries when available.\n",
  },
  {
    id: "writing",
    label: "Writing",
    icon: <PenLine size={14} aria-hidden="true" />,
    description: "Prose drafting and editing: clear structure, plain language, consistent voice.",
    personaDescription: "Writing persona — plain language, active voice, cuts filler.",
    personaPrompt:
      "You are a clear, concise writer. Prefer plain language and active voice. Cut filler words and hedging. Structure long output with headings or lists when it helps a reader scan. Match the requested tone exactly rather than defaulting to a formal register.",
    skills: ["editing", "style-consistency"],
    vibeContent:
      "# Writing profile\n\nPlain language, active voice, no filler. Match the tone the user asked for. Keep paragraphs short.\n",
  },
];

function blankTemplate(): ProfileTemplate {
  return {
    id: "custom",
    label: "Custom",
    icon: <Sparkles size={14} aria-hidden="true" />,
    description: "",
    personaDescription: "",
    personaPrompt: "",
    skills: [],
    vibeContent: "",
  };
}

interface ProfileDraft {
  name: string;
  description: string;
  template: string;
  personaDescription: string;
  personaPrompt: string;
  skillsText: string;
  vibeContent: string;
}

function draftFromProfile(profile: ProfileItem): ProfileDraft {
  return {
    name: profile.name,
    description: profile.description,
    template: profile.template,
    personaDescription: profile.personaDescription,
    personaPrompt: profile.personaPrompt,
    skillsText: profile.skills.join(", "),
    vibeContent: profile.vibeContent,
  };
}

function draftFromTemplate(template: ProfileTemplate): ProfileDraft {
  return {
    name: "",
    description: template.description,
    template: template.id,
    personaDescription: template.personaDescription,
    personaPrompt: template.personaPrompt,
    skillsText: template.skills.join(", "),
    vibeContent: template.vibeContent,
  };
}

function splitSkills(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type EditorTarget = { mode: "create"; template: ProfileTemplate } | { mode: "edit"; profile: ProfileItem } | null;

export function ProfilesPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editor, setEditor] = useState<EditorTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProfileItem | null>(null);

  const list = useQuery({
    queryKey: regKeys.collection("profiles"),
    queryFn: () => listRegistryItems("profiles"),
    refetchInterval: REGISTRY_POLL_MS,
    retry: false,
  });
  const personasList = useQuery({
    queryKey: regKeys.collection("personas"),
    queryFn: () => listRegistryItems("personas"),
    refetchInterval: REGISTRY_POLL_MS,
    retry: false,
  });

  const profiles = useMemo(() => (list.data ?? []).map(parseProfile), [list.data]);
  const personas = useMemo(() => (personasList.data ?? []).map(parsePersona), [personasList.data]);
  const activeProfile = profiles.find((p) => p.active);

  const invalidateProfiles = () => queryClient.invalidateQueries({ queryKey: regKeys.collection("profiles") });
  const invalidatePersonas = () => queryClient.invalidateQueries({ queryKey: regKeys.collection("personas") });

  const save = useMutation({
    mutationFn: ({ target, draft }: { target: ProfileItem | null; draft: ProfileDraft }) => {
      const body = {
        name: draft.name.trim() || "Untitled profile",
        description: draft.description.trim(),
        template: draft.template,
        persona: {
          name: draft.name.trim() || "Untitled profile",
          description: draft.personaDescription.trim(),
          prompt: draft.personaPrompt,
        },
        skills: splitSkills(draft.skillsText),
        vibeContent: draft.vibeContent,
      };
      if (target) return updateRegistryItem("profiles", target.id, { ...target.raw, ...body });
      return createRegistryItem("profiles", { ...body, active: false });
    },
    onSuccess: async (_result, { target }) => {
      await invalidateProfiles();
      setEditor(null);
      toast({ title: target ? "Profile updated" : "Profile created", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Save failed", description: formatError(error), tone: "danger" });
    },
  });

  // Activation's ENTIRE blast radius, spelled out in code as much as prose:
  // deactivate other profiles, deactivate other personas, upsert+activate
  // this profile's persona snapshot, write VIBE.md. Any failure mid-sequence
  // is reported and the query refetches truth rather than assuming success.
  const activate = useMutation({
    mutationFn: async (profile: ProfileItem) => {
      const otherProfiles = profiles.filter((p) => p.active && p.id !== profile.id);
      for (const other of otherProfiles) {
        await updateRegistryItem("profiles", other.id, { ...other.raw, active: false });
      }
      await updateRegistryItem("profiles", profile.id, { ...profile.raw, active: true });

      const marker = `profile:${profile.id}`;
      const existingPersona = personas.find((p) => p.source === marker);
      const otherPersonas = personas.filter((p) => p.active && p.id !== existingPersona?.id);
      for (const other of otherPersonas) {
        await updateRegistryItem("personas", other.id, { ...other.raw, active: false });
      }
      if (existingPersona) {
        await updateRegistryItem("personas", existingPersona.id, {
          ...existingPersona.raw,
          name: profile.personaName,
          description: profile.personaDescription,
          prompt: profile.personaPrompt,
          active: true,
        });
      } else {
        await createRegistryItem("personas", {
          name: profile.personaName,
          description: profile.personaDescription,
          prompt: profile.personaPrompt,
          active: true,
          source: marker,
        });
      }

      await saveVibe(profile.vibeContent);
      return profile;
    },
    onSuccess: async (profile) => {
      await Promise.all([invalidateProfiles(), invalidatePersonas()]);
      toast({
        title: `Profile "${profile.name}" activated`,
        description: "Active persona set and VIBE.md content replaced.",
        tone: "success",
      });
    },
    onError: async (error: unknown) => {
      await Promise.all([invalidateProfiles(), invalidatePersonas()]);
      toast({ title: "Activation failed", description: formatError(error), tone: "danger" });
    },
  });

  const remove = useMutation({
    mutationFn: (profile: ProfileItem) => deleteRegistryItem("profiles", profile.id),
    onSuccess: async (_result, profile) => {
      await invalidateProfiles();
      setDeleteTarget(null);
      toast({ title: `Deleted profile "${profile.name}"`, tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    },
  });

  const unavailable = list.isError && isRegistryUnavailable(list.error);

  return (
    <div className="profiles-panel">
      <p className="profiles-panel__note">
        A profile is an app-level preset: a persona snapshot + an informational skills list + a VIBE.md snapshot.
        Activating one sets the active persona and overwrites VIBE.md content — nothing else. Isolated per-profile app
        homes are a goodvibes-tui/daemon concept this app does not implement.
      </p>

      <div className="reg-toolbar">
        <span className="reg-toolbar__summary">
          Profiles
          {list.isSuccess ? ` · ${profiles.length}` : ""}
          {activeProfile ? ` · active: ${activeProfile.name}` : list.isSuccess ? " · none active" : ""}
        </span>
        {[...TEMPLATES, blankTemplate()].map((template) => (
          <button
            key={template.id}
            type="button"
            className="reg-button"
            onClick={() => setEditor({ mode: "create", template })}
          >
            {template.icon} New {template.label}
          </button>
        ))}
      </div>

      {list.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState
          capability="/app/registries/profiles"
          description="the app-local profiles registry is not part of this build, so profiles cannot be listed or edited."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load profiles" />
      )}

      {list.isSuccess && profiles.length === 0 && (
        <EmptyState
          icon={<Sparkles size={28} aria-hidden="true" />}
          title="No profiles yet"
          description="Start from a template above, or build a custom bundle of persona + skills + VIBE presets."
        />
      )}

      {list.isSuccess && profiles.length > 0 && (
        <ul className="reg-rows">
          {profiles.map((profile) => (
            <li key={profile.id} className={profile.active ? "reg-row reg-row--active" : "reg-row"}>
              <div className="reg-row__head">
                <span className="reg-row__name">{profile.name}</span>
                {profile.active && <span className="badge ok">active</span>}
                <span className="badge neutral">{profile.template}</span>
              </div>
              {profile.description && <p className="reg-row__description">{profile.description}</p>}
              {profile.skills.length > 0 && (
                <div className="reg-row__tags">
                  {profile.skills.map((skill) => (
                    <span key={skill} className="reg-tag">
                      {skill}
                    </span>
                  ))}
                </div>
              )}
              <div className="reg-row__actions">
                <button
                  type="button"
                  className="reg-button"
                  onClick={() => activate.mutate(profile)}
                  disabled={activate.isPending || profile.active}
                  title="Sets the active persona and overwrites VIBE.md content"
                >
                  <Power size={13} aria-hidden="true" /> {profile.active ? "Active" : "Activate"}
                </button>
                <button
                  type="button"
                  className="reg-button"
                  onClick={() => setEditor({ mode: "edit", profile })}
                >
                  <PenLine size={13} aria-hidden="true" /> Edit
                </button>
                <button type="button" className="reg-button reg-button--danger" onClick={() => setDeleteTarget(profile)}>
                  <Trash2 size={13} aria-hidden="true" /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ProfileEditorModal
        open={editor !== null}
        initialDraft={
          editor?.mode === "edit" ? draftFromProfile(editor.profile) : editor?.mode === "create" ? draftFromTemplate(editor.template) : null
        }
        saving={save.isPending}
        onClose={() => setEditor(null)}
        onSave={(draft) => save.mutate({ target: editor?.mode === "edit" ? editor.profile : null, draft })}
      />

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete profile"
        target={deleteTarget?.name ?? ""}
        blastRadius="Removes this profile from the app-local registry only. The persona and VIBE.md content it last activated are left exactly as they are."
        danger
        confirmLabel={remove.isPending ? "Deleting…" : "Delete profile"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && !remove.isPending) remove.mutate(deleteTarget);
        }}
      />
    </div>
  );
}

function ProfileEditorModal({
  open,
  initialDraft,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  initialDraft: ProfileDraft | null;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: ProfileDraft) => void;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(
    initialDraft ?? { name: "", description: "", template: "custom", personaDescription: "", personaPrompt: "", skillsText: "", vibeContent: "" },
  );

  // Re-seed the local form whenever a fresh target opens (template or edit target changes).
  const key = initialDraft ? JSON.stringify(initialDraft) : "";
  const [seenKey, setSeenKey] = useState(key);
  if (open && key !== seenKey) {
    setSeenKey(key);
    setDraft(
      initialDraft ?? { name: "", description: "", template: "custom", personaDescription: "", personaPrompt: "", skillsText: "", vibeContent: "" },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Profile" size="lg">
      <form
        className="profile-editor"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.name.trim() || saving) return;
          onSave(draft);
        }}
      >
        <label>
          Name
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Backend dev"
            required
          />
        </label>
        <label>
          Description
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        <fieldset className="profile-editor__persona">
          <legend>Persona snapshot</legend>
          <label>
            Persona description
            <input
              value={draft.personaDescription}
              onChange={(e) => setDraft({ ...draft, personaDescription: e.target.value })}
            />
          </label>
          <label>
            Persona prompt
            <textarea
              rows={5}
              value={draft.personaPrompt}
              onChange={(e) => setDraft({ ...draft, personaPrompt: e.target.value })}
            />
          </label>
        </fieldset>
        <label>
          Skills (comma-separated, informational only — not auto-enabled)
          <input value={draft.skillsText} onChange={(e) => setDraft({ ...draft, skillsText: e.target.value })} />
        </label>
        <label>
          VIBE.md snapshot (written to disk verbatim on activate)
          <textarea rows={6} value={draft.vibeContent} onChange={(e) => setDraft({ ...draft, vibeContent: e.target.value })} />
        </label>
        <div className="profile-editor__actions">
          <button type="button" className="reg-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="reg-button reg-button--primary" disabled={saving || !draft.name.trim()}>
            <Plus size={13} aria-hidden="true" /> {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
