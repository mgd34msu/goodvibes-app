// Hooks — .goodvibes/hooks.json editor (docs/GAPS.md §5 row 10) against the
// app-local GET/PUT /app/local/hooks route (src/bun/local-tools.ts). No wire
// method backs this: the file lives on the machine this app runs on, not on
// the daemon, so there is no realtime domain and no poll — refetch happens on
// mount and after a save. Save is admin-flavored: writing an operational
// config file that changes hook behavior everywhere still gets the confirm
// treatment this app reserves for consequential actions.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileJson, RotateCcw, Save } from "lucide-react";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  HOOK_EVENT_CATEGORIES,
  HOOK_EVENT_PHASES,
  HOOK_TYPES,
  hooksApi,
  hooksLocalKeys,
  isHooksRouteUnavailable,
  parseHooksSaveError,
  type HooksSaveError,
} from "./hooks-api.ts";

/** Best-effort line/column from a JSON.parse-style character offset — a display convenience over the daemon's own position, never a re-derivation of it. */
function lineAndColumnAt(content: string, position: number): { line: number; column: number } {
  const clipped = Math.max(0, Math.min(position, content.length));
  const prefix = content.slice(0, clipped);
  const lastNewline = prefix.lastIndexOf("\n");
  return { line: prefix.split("\n").length, column: clipped - lastNewline };
}

export function HooksSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [saveError, setSaveError] = useState<HooksSaveError | null>(null);

  const file = useQuery({
    queryKey: hooksLocalKeys.file,
    queryFn: () => hooksApi.get(),
  });

  // Sync the draft from a fresh load/reload — never clobber in-progress edits.
  useEffect(() => {
    if (file.data && draft === null) setDraft(file.data.content);
  }, [file.data, draft]);

  const save = useMutation({
    mutationFn: (content: string) => hooksApi.put(content),
    onSuccess: async () => {
      setConfirmSave(false);
      setSaveError(null);
      await queryClient.invalidateQueries({ queryKey: hooksLocalKeys.file });
      toast({ title: "hooks.json saved", tone: "success" });
    },
    onError: (error: unknown) => {
      const parsed = parseHooksSaveError(error);
      setSaveError(parsed);
      setConfirmSave(false);
      toast({ title: "Save failed", description: parsed.message, tone: "danger" });
    },
  });

  if (file.isPending) return <SkeletonBlock variant="text" lines={8} />;

  if (file.isError && isHooksRouteUnavailable(file.error)) {
    return (
      <UnavailableState
        capability="app.local.hooks"
        description="this build's local-tools bridge doesn't expose the hooks.json editor yet."
      />
    );
  }

  if (file.isError) {
    return <ErrorState error={file.error} onRetry={() => void file.refetch()} title="Failed to load hooks.json" />;
  }

  const dirty = draft !== null && draft !== file.data.content;
  const position = saveError?.position;
  const location = position !== undefined && draft !== null ? lineAndColumnAt(draft, position) : null;

  return (
    <section className="hooks-section" aria-label="Hooks">
      <div className="hooks-section__layout">
        <div className="hooks-section__editor">
          <div className="hooks-section__toolbar">
            <span className="hooks-section__toolbar-summary">
              <FileJson size={14} aria-hidden="true" /> Hooks
            </span>
          </div>
          <p className="hooks-section__caption" role="note">
            Writes <code>{file.data.path}</code> — this app never runs hooks itself; the daemon and TUI read this
            file when they dispatch hook events.
          </p>

          <textarea
            className="hooks-section__textarea"
            value={draft ?? ""}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaveError(null);
            }}
            spellCheck={false}
            rows={20}
            aria-label="hooks.json content"
          />

          {saveError && (
            <div className="hooks-section__error" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              <div>
                <strong>{saveError.message}</strong>
                {saveError.detail && <p>{saveError.detail}</p>}
                {location && (
                  <p>
                    Around line {location.line}, column {location.column} (character {position}).
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="hooks-section__actions">
            <button
              type="button"
              className="hooks-section__discard"
              disabled={!dirty}
              onClick={() => {
                setDraft(file.data.content);
                setSaveError(null);
              }}
            >
              <RotateCcw size={13} aria-hidden="true" /> Discard changes
            </button>
            <button
              type="button"
              className="hooks-section__save"
              disabled={!dirty || save.isPending}
              onClick={() => setConfirmSave(true)}
            >
              <Save size={13} aria-hidden="true" /> {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <aside className="hooks-section__reference" aria-label="Hook event reference">
          <h3>Hook event reference</h3>
          <p className="hooks-section__reference-note" role="note">
            From this app's own research notes on the TUI (docs/research/tui-features.md) — documented, not
            exhaustive. Event paths follow <code>Phase:Category:Specific</code>; the exact "Specific" leaves and
            wildcard syntax aren't enumerated there, so this reference stops at the two documented axes.
          </p>
          <dl className="hooks-section__reference-grid">
            <dt>Phases</dt>
            <dd>{HOOK_EVENT_PHASES.join(" / ")}</dd>
            <dt>Categories</dt>
            <dd>{HOOK_EVENT_CATEGORIES.join(" / ")}</dd>
            <dt>Hook types</dt>
            <dd>{HOOK_TYPES.join(" / ")}</dd>
          </dl>
        </aside>
      </div>

      <ConfirmSurface
        open={confirmSave}
        action="Save hooks.json"
        target={file.data.path}
        blastRadius="Overwrites the file on disk immediately. The daemon and TUI re-read it on their own schedule — hook behavior everywhere that reads this file changes as soon as they do."
        confirmLabel="Save"
        onConfirm={() => {
          if (draft !== null) save.mutate(draft);
        }}
        onCancel={() => setConfirmSave(false)}
      />
    </section>
  );
}
