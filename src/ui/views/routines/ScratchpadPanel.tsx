// Scratchpad — docs/FEATURES.md §8 row 11. Quick notes over the app-local
// "notes" registry collection: add/edit/tag/delete, plus two explicit
// confirm-gated promote flows that leave a durable marker on the note once
// they land:
//   - Promote to memory  → memory.records.add (class "fact", scope "project")
//   - Promote to knowledge → no daemon verb ingests raw text directly, so we
//     wrap the note's text in a small text/plain artifact (artifacts.create)
//     and then knowledge.ingest.artifact that artifact id — the same route
//     ArtifactsView's own "Promote to knowledge" button uses.
// Both promotions are one-way: the note is marked `promoted` with the
// destination id, but is NOT deleted or edited further — re-promoting stays
// possible on purpose (the daemon-side record is independent of this note).

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Brain, Plus, StickyNote, Trash2 } from "lucide-react";
import { gv, invoke } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useToast } from "../../lib/toast.ts";
import { asRecord, firstString } from "../../lib/wire.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  REGISTRY_POLL_MS,
  createRegistryItem,
  deleteRegistryItem,
  isRegistryUnavailable,
  listRegistryItems,
  parseNote,
  regKeys,
  updateRegistryItem,
  type NoteItem,
} from "./registries.ts";

function splitTags(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function noteSummary(text: string, maxLen = 140): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? text;
  const trimmed = line.trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed || "(empty note)";
}

function createdArtifactId(value: unknown): string {
  return firstString(asRecord(value), ["id", "artifactId"]);
}

type PromoteTarget = { note: NoteItem; kind: "memory" | "knowledge" } | null;

export function ScratchpadPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draftText, setDraftText] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [editing, setEditing] = useState<NoteItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NoteItem | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<PromoteTarget>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Palette command scoped to this panel's own mount — only registered while
  // the Scratchpad tab is actually showing (item 19: keyboard access).
  useEffect(() => {
    registerCommand({
      id: "routines.newNote",
      title: "Scratchpad: New Note",
      group: "assistant",
      keywords: ["note", "scratchpad", "capture"],
      run: () => composerRef.current?.focus(),
    });
    return () => unregisterCommand("routines.newNote");
  }, []);

  const list = useQuery({
    queryKey: regKeys.collection("notes"),
    queryFn: () => listRegistryItems("notes"),
    // App-local file store — no wire event exists, so poll (cheap local read).
    refetchInterval: REGISTRY_POLL_MS,
    retry: false,
  });

  const notes = useMemo(
    () => (list.data ?? []).map(parseNote).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [list.data],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: regKeys.collection("notes") });

  const add = useMutation({
    mutationFn: (input: { text: string; tags: string[] }) =>
      createRegistryItem("notes", { text: input.text, tags: input.tags, promoted: false }),
    onSuccess: async () => {
      setDraftText("");
      setDraftTags("");
      await invalidate();
      toast({ title: "Note added", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Add failed", description: formatError(error), tone: "danger" });
    },
  });

  const save = useMutation({
    mutationFn: ({ note, text, tags }: { note: NoteItem; text: string; tags: string[] }) =>
      updateRegistryItem("notes", note.id, { ...note.raw, text, tags }),
    onSuccess: async () => {
      setEditing(null);
      await invalidate();
      toast({ title: "Note updated", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Save failed", description: formatError(error), tone: "danger" });
    },
  });

  const remove = useMutation({
    mutationFn: (note: NoteItem) => deleteRegistryItem("notes", note.id),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidate();
      toast({ title: "Note deleted", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    },
  });

  const promoteToMemory = useMutation({
    mutationFn: async (note: NoteItem) => {
      const result = await gv.memory.records.add({
        cls: "fact",
        scope: "project",
        summary: noteSummary(note.text),
        detail: note.text,
        ...(note.tags.length ? { tags: note.tags } : {}),
      });
      const id = firstString(asRecord(result), ["id"]);
      await updateRegistryItem("notes", note.id, {
        ...note.raw,
        promoted: true,
        promotedTo: { kind: "memory", id: id || "unknown" },
      });
    },
    onSuccess: async () => {
      setPromoteTarget(null);
      await invalidate();
      toast({ title: "Note promoted to memory", tone: "success" });
    },
    onError: (error: unknown) => {
      setPromoteTarget(null);
      toast({ title: "Promote to memory failed", description: formatError(error), tone: "danger" });
    },
  });

  const promoteToKnowledge = useMutation({
    mutationFn: async (note: NoteItem) => {
      const artifact = await gv.artifacts.create({
        filename: `note-${note.id.slice(0, 8)}.txt`,
        mimeType: "text/plain",
        dataBase64: btoa(unescape(encodeURIComponent(note.text))),
        metadata: { surface: "app", uploadedVia: "scratchpad-promote" },
      });
      const artifactId = createdArtifactId(artifact);
      if (!artifactId) throw new Error("Artifact upload did not return an id");
      const ingested = await invoke("knowledge.ingest.artifact", {
        body: { artifactId, title: noteSummary(note.text), ...(note.tags.length ? { tags: note.tags } : {}) },
      });
      const sourceId = firstString(asRecord(asRecord(ingested)["source"]), ["id"]) || artifactId;
      await updateRegistryItem("notes", note.id, {
        ...note.raw,
        promoted: true,
        promotedTo: { kind: "knowledge", id: sourceId },
      });
    },
    onSuccess: async () => {
      setPromoteTarget(null);
      await invalidate();
      toast({ title: "Note promoted to knowledge", tone: "success" });
    },
    onError: (error: unknown) => {
      setPromoteTarget(null);
      toast({ title: "Promote to knowledge failed", description: formatError(error), tone: "danger" });
    },
  });

  const unavailable = list.isError && isRegistryUnavailable(list.error);

  return (
    <div className="scratchpad-panel">
      <form
        className="scratchpad-panel__composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draftText.trim() || add.isPending) return;
          add.mutate({ text: draftText.trim(), tags: splitTags(draftTags) });
        }}
      >
        <textarea
          ref={composerRef}
          rows={3}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder="Capture a quick note…"
          aria-label="New note text"
        />
        <div className="scratchpad-panel__composer-row">
          <input
            value={draftTags}
            onChange={(e) => setDraftTags(e.target.value)}
            placeholder="Tags, comma separated"
            aria-label="New note tags"
          />
          <button type="submit" className="reg-button reg-button--primary" disabled={add.isPending || !draftText.trim()}>
            <Plus size={13} aria-hidden="true" /> {add.isPending ? "Adding…" : "Add note"}
          </button>
        </div>
      </form>

      {list.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState
          capability="/app/registries/notes"
          description="the app-local notes registry is not part of this build, so the scratchpad cannot be used."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load notes" />
      )}

      {list.isSuccess && notes.length === 0 && (
        <EmptyState
          icon={<StickyNote size={28} aria-hidden="true" />}
          title="No notes yet"
          description="Capture a quick note above. Promote it to memory or knowledge once it is worth keeping."
        />
      )}

      {list.isSuccess && notes.length > 0 && (
        <ul className="scratchpad-panel__list">
          {notes.map((note) => (
            <li key={note.id} className="scratchpad-note">
              {editing?.id === note.id ? (
                <NoteEditor
                  note={note}
                  saving={save.isPending}
                  onCancel={() => setEditing(null)}
                  onSave={(text, tags) => save.mutate({ note, text, tags })}
                />
              ) : (
                <>
                  <p className="scratchpad-note__text">{note.text}</p>
                  <div className="scratchpad-note__meta">
                    {note.tags.map((tag) => (
                      <span key={tag} className="reg-tag">
                        {tag}
                      </span>
                    ))}
                    {note.promoted && note.promotedTo && (
                      <span className="badge ok">
                        promoted → {note.promotedTo.kind} ({note.promotedTo.id.slice(0, 8)})
                      </span>
                    )}
                  </div>
                  <div className="scratchpad-note__actions">
                    <button type="button" className="reg-button" onClick={() => setEditing(note)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="reg-button"
                      onClick={() => setPromoteTarget({ note, kind: "memory" })}
                    >
                      <Brain size={13} aria-hidden="true" /> Promote to memory
                    </button>
                    <button
                      type="button"
                      className="reg-button"
                      onClick={() => setPromoteTarget({ note, kind: "knowledge" })}
                    >
                      <BookOpen size={13} aria-hidden="true" /> Promote to knowledge
                    </button>
                    <button type="button" className="reg-button reg-button--danger" onClick={() => setDeleteTarget(note)}>
                      <Trash2 size={13} aria-hidden="true" /> Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmSurface
        open={promoteTarget !== null}
        action={promoteTarget?.kind === "memory" ? "Promote note to memory" : "Promote note to knowledge"}
        target={promoteTarget ? noteSummary(promoteTarget.note.text) : ""}
        blastRadius={
          promoteTarget?.kind === "memory"
            ? "Creates a new durable memory record (class: fact, scope: project) via memory.records.add. The note itself is left in the scratchpad, marked as promoted."
            : "Uploads the note's text as a small artifact and ingests it into the knowledge store (knowledge.ingest.artifact). The note itself is left in the scratchpad, marked as promoted."
        }
        confirmLabel="Promote"
        onConfirm={() => {
          if (!promoteTarget) return;
          if (promoteTarget.kind === "memory") promoteToMemory.mutate(promoteTarget.note);
          else promoteToKnowledge.mutate(promoteTarget.note);
        }}
        onCancel={() => setPromoteTarget(null)}
      />

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete note"
        target={deleteTarget ? noteSummary(deleteTarget.text) : ""}
        blastRadius="Removes this note from the scratchpad only. Anything already promoted to memory or knowledge is untouched."
        danger
        confirmLabel={remove.isPending ? "Deleting…" : "Delete note"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && !remove.isPending) remove.mutate(deleteTarget);
        }}
      />
    </div>
  );
}

function NoteEditor({
  note,
  saving,
  onCancel,
  onSave,
}: {
  note: NoteItem;
  saving: boolean;
  onCancel: () => void;
  onSave: (text: string, tags: string[]) => void;
}) {
  const [text, setText] = useState(note.text);
  const [tagsText, setTagsText] = useState(note.tags.join(", "));
  // Closing a dirty editor asks first instead of silently discarding it —
  // same guard the sibling registry editors (RoutineEditorModal etc.) use.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = text !== note.text || tagsText !== note.tags.join(", ");

  function requestCancel(): void {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onCancel();
  }

  if (confirmDiscard) {
    return (
      <div className="scratchpad-note__editor reg-form__discard">
        <p className="reg-form__discard-text">Discard unsaved changes to this note? The edited text and tags will be lost.</p>
        <div className="reg-form__actions">
          <button type="button" className="reg-button" onClick={() => setConfirmDiscard(false)}>
            Keep editing
          </button>
          <button type="button" className="reg-button reg-button--danger" onClick={onCancel}>
            Discard changes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="scratchpad-note__editor">
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit note text" />
      <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} aria-label="Edit note tags" />
      <div className="scratchpad-note__editor-actions">
        <button type="button" className="reg-button" onClick={requestCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="reg-button reg-button--primary"
          disabled={saving || !text.trim()}
          onClick={() => onSave(text.trim(), splitTags(tagsText))}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
