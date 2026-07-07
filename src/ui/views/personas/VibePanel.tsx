// VIBE.md editor panel — the anti-desktop-lie surface (docs/FEATURES.md §8):
// GET /app/registries/vibe reads and PUT writes the REAL file
// ~/.goodvibes/app/VIBE.md on disk, never a database. The panel shows the
// resolved path, an explicit "writes to disk" caption, honest save states,
// and an edit/preview toggle (MarkdownMessage).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileText, Pencil, RefreshCw } from "lucide-react";
import { useToast } from "../../lib/toast.ts";
import { formatError } from "../../lib/errors.ts";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { fetchVibe, isRegistryUnavailable, regKeys, saveVibe } from "../routines/registries.ts";

export function VibePanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string | null>(null); // null = pristine (mirror server)
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  const vibe = useQuery({
    queryKey: regKeys.vibe,
    queryFn: fetchVibe,
    // Real disk file with no wire event — poll is deliberately slow; edits
    // from the agent CLI or an editor surface within a minute.
    refetchInterval: 60_000,
    retry: false,
  });

  const serverContent = vibe.data?.content ?? "";
  const value = draft ?? serverContent;
  const dirty = draft !== null && draft !== serverContent;

  // A fresh server read that matches the local draft clears the dirty flag.
  useEffect(() => {
    if (draft !== null && draft === serverContent) setDraft(null);
  }, [draft, serverContent]);

  const save = useMutation({
    mutationFn: (content: string) => saveVibe(content),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: regKeys.vibe });
      setDraft(null);
      toast({ title: "VIBE.md written to disk", description: vibe.data?.path, tone: "success" });
    },
    onError: (error: unknown) => {
      toast({
        title: "VIBE.md write failed",
        description: `${formatError(error)} — your draft is still in the editor.`,
        tone: "danger",
      });
    },
  });

  const unavailable = vibe.isError && isRegistryUnavailable(vibe.error);

  return (
    <section className="vibe-panel" aria-label="VIBE.md personality editor">
      <div className="vibe-panel__head">
        <span className="vibe-panel__title">
          <FileText size={14} aria-hidden="true" /> VIBE.md
        </span>
        {vibe.isSuccess && !vibe.data.exists && <span className="badge warning">file not created yet</span>}
        {dirty && <span className="badge info">unsaved changes</span>}
        <span className="vibe-panel__spacer" />
        <div className="vibe-panel__modes" role="tablist" aria-label="Editor mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "edit"}
            className={mode === "edit" ? "reg-button reg-button--active" : "reg-button"}
            onClick={() => setMode("edit")}
          >
            <Pencil size={13} aria-hidden="true" /> Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "preview"}
            className={mode === "preview" ? "reg-button reg-button--active" : "reg-button"}
            onClick={() => setMode("preview")}
          >
            <Eye size={13} aria-hidden="true" /> Preview
          </button>
        </div>
        <button
          type="button"
          className="reg-icon-button"
          aria-label="Reload VIBE.md from disk"
          onClick={() => void vibe.refetch()}
        >
          <RefreshCw size={14} aria-hidden="true" className={vibe.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      <p className="vibe-panel__caption">
        Saving writes the real file <code>{vibe.data?.path ?? "~/.goodvibes/app/VIBE.md"}</code> on disk —
        the same personality file the assistant reads. Nothing is stored in a database.
      </p>

      {vibe.isPending && <SkeletonBlock variant="text" lines={6} />}

      {unavailable && (
        <UnavailableState
          capability="/app/registries/vibe"
          description="the VIBE.md file bridge is not part of this build, so the personality file cannot be read or written."
        />
      )}

      {vibe.isError && !unavailable && (
        <ErrorState error={vibe.error} onRetry={() => void vibe.refetch()} title="Failed to read VIBE.md" />
      )}

      {vibe.isSuccess && mode === "edit" && (
        <textarea
          className="vibe-panel__editor"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"# VIBE\n\nDescribe how your assistant should sound and behave…"}
          spellCheck={false}
          aria-label="VIBE.md content"
          disabled={save.isPending}
        />
      )}

      {vibe.isSuccess && mode === "preview" && (
        <div className="vibe-panel__preview">
          {value.trim() ? (
            <MarkdownMessage content={value} />
          ) : (
            <p className="vibe-panel__empty">Nothing to preview yet.</p>
          )}
        </div>
      )}

      {vibe.isSuccess && (
        <div className="vibe-panel__actions">
          <button
            type="button"
            className="reg-button"
            disabled={!dirty || save.isPending}
            onClick={() => setDraft(null)}
          >
            Discard changes
          </button>
          <button
            type="button"
            className="reg-button reg-button--primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(value)}
          >
            {save.isPending ? "Writing…" : "Save to disk"}
          </button>
        </div>
      )}
    </section>
  );
}
