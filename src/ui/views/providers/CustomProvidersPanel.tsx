// Custom provider JSON management (docs/GAPS.md §14 row 8, MISSING): a panel
// over the app-local /app/local/providers CRUD contract — list the files
// under ~/.goodvibes/tui/providers/*.json, edit each as raw JSON with parse
// validation, create a new file (filename validated bare-*.json by the
// server), and delete (dangerous, ConfirmSurface). The daemon hot-reloads
// this shared store on its own schedule — this app never restarts it, so the
// caption says exactly that instead of implying a live effect.

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileJson, Plus, RefreshCw, Trash2 } from "lucide-react";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  customProvidersApi,
  isProvidersLocalRouteUnavailable,
  providersLocalKeys,
  type CustomProviderFile,
} from "./providers-local-api.ts";

export function CustomProvidersPanel({
  prefill,
  onPrefillConsumed,
}: {
  /** Set by LlmScanPanel's "use as custom provider" action; consumed once. */
  prefill?: { suggestedFile: string; json: Record<string, unknown> } | null;
  onPrefillConsumed?: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const list = useQuery({
    queryKey: providersLocalKeys.customList,
    queryFn: () => customProvidersApi.list(),
    retry: false,
  });

  useEffect(() => {
    if (prefill) setCreating(true);
  }, [prefill]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: providersLocalKeys.customList });

  const save = useMutation({
    mutationFn: ({ file, json }: { file: string; json: Record<string, unknown> }) => customProvidersApi.put(file, json),
    onSuccess: async (_r, v) => {
      await invalidate();
      toast({ title: "Custom provider saved", description: v.file, tone: "success" });
      setEditingFile(null);
      setCreating(false);
      onPrefillConsumed?.();
    },
    onError: (error: unknown) => toast({ title: "Save failed", description: formatError(error), tone: "danger" }),
  });

  const remove = useMutation({
    mutationFn: (file: string) => customProvidersApi.remove(file),
    onSuccess: async (result) => {
      await invalidate();
      toast({ title: "Custom provider file deleted", description: result.file, tone: "info" });
      setPendingDelete(null);
    },
    onError: (error: unknown) => toast({ title: "Delete failed", description: formatError(error), tone: "danger" }),
  });

  const unavailable = list.isError && isProvidersLocalRouteUnavailable(list.error);
  const rows = list.data?.providers ?? [];

  return (
    <section className="providers-panel providers-custom" aria-label="Custom provider JSON">
      <div className="providers-panel__title">
        <h3>Custom Providers</h3>
        <div className="providers-custom__title-actions">
          <button
            type="button"
            className="providers-icon-button"
            aria-label="Refresh custom providers"
            onClick={() => void list.refetch()}
          >
            <RefreshCw size={14} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
          <FileJson size={16} aria-hidden="true" />
        </div>
      </div>

      <p className="providers-custom__note">
        Raw JSON files under <code>{list.data?.dir ?? "~/.goodvibes/tui/providers"}</code>, shared with the TUI.
        The daemon hot-reloads this store on its own schedule — this app edits the files but does not trigger that
        reload itself, so a change may take a moment to take effect.
      </p>

      {list.isPending && <SkeletonBlock variant="block" height={80} />}

      {unavailable && (
        <UnavailableState
          capability="/app/local/providers"
          description="custom provider JSON management is not part of this build."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} title="Failed to load custom providers" onRetry={() => void list.refetch()} />
      )}

      {list.isSuccess && (
        <>
          {rows.length === 0 && !creating && (
            <EmptyState
              icon={<FileJson size={24} aria-hidden="true" />}
              title="No custom provider files"
              description="Add a provider-config JSON file the daemon's TUI-shared provider store will pick up."
              action={{ label: "New file", onClick: () => setCreating(true) }}
            />
          )}

          {rows.length > 0 && (
            <ul className="providers-custom__list">
              {rows.map((row) => (
                <CustomProviderRow
                  key={row.file}
                  row={row}
                  editing={editingFile === row.file}
                  saving={save.isPending && save.variables?.file === row.file}
                  onEdit={() => setEditingFile(row.file)}
                  onCancel={() => setEditingFile(null)}
                  onSave={(json) => save.mutate({ file: row.file, json })}
                  onDelete={() => setPendingDelete(row.file)}
                />
              ))}
            </ul>
          )}

          {!creating && rows.length > 0 && (
            <button type="button" className="providers-button" onClick={() => setCreating(true)}>
              <Plus size={13} aria-hidden="true" /> New file
            </button>
          )}

          {creating && (
            <CreateProviderFileForm
              saving={save.isPending}
              initialFile={prefill?.suggestedFile}
              initialJson={prefill?.json}
              onCancel={() => {
                setCreating(false);
                onPrefillConsumed?.();
              }}
              onSubmit={(file, json) => save.mutate({ file, json })}
            />
          )}
        </>
      )}

      <ConfirmSurface
        open={pendingDelete !== null}
        action="Delete custom provider file"
        target={pendingDelete ?? ""}
        blastRadius="Removes this JSON file from ~/.goodvibes/tui/providers — the daemon hot-reloads this store on its own schedule, so it stops seeing this custom provider without needing a restart."
        danger
        confirmLabel="Delete file"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete);
        }}
      />
    </section>
  );
}

function CustomProviderRow({
  row,
  editing,
  saving,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  row: CustomProviderFile;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (json: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(row.json ?? {}, null, 2));
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    if (editing) {
      setText(JSON.stringify(row.json ?? {}, null, 2));
      setParseError("");
    }
  }, [editing, row.json]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setParseError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Not valid JSON.");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setParseError("Must be a JSON object at the top level.");
      return;
    }
    onSave(parsed as Record<string, unknown>);
  }

  return (
    <li className="providers-custom__row">
      <div className="providers-custom__row-head">
        <code>{row.file}</code>
        {row.error && <span className="badge bad">parse error on disk: {row.error}</span>}
        {!editing && (
          <div className="providers-custom__row-actions">
            <button type="button" className="providers-button" onClick={onEdit} disabled={saving}>
              Edit
            </button>
            <button type="button" className="providers-button providers-button--danger" onClick={onDelete}>
              <Trash2 size={13} aria-hidden="true" /> Delete
            </button>
          </div>
        )}
      </div>
      {!editing && <pre className="providers-raw providers-custom__preview">{JSON.stringify(row.json, null, 2)}</pre>}
      {editing && (
        <form className="providers-custom__editor" onSubmit={handleSubmit}>
          <textarea
            className="providers-custom__textarea"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label={`${row.file} JSON`}
          />
          {parseError && (
            <span className="settings-editor__error" role="alert">
              {parseError}
            </span>
          )}
          <div className="settings-editor__actions">
            <button type="button" className="settings-editor__cancel" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="settings-editor__save" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function CreateProviderFileForm({
  saving,
  initialFile,
  initialJson,
  onCancel,
  onSubmit,
}: {
  saving: boolean;
  initialFile?: string;
  initialJson?: Record<string, unknown>;
  onCancel: () => void;
  onSubmit: (file: string, json: Record<string, unknown>) => void;
}) {
  const [file, setFile] = useState(initialFile ?? "");
  const [text, setText] = useState(() => JSON.stringify(initialJson ?? { id: "", label: "", baseUrl: "" }, null, 2));
  const [parseError, setParseError] = useState("");
  const [nameError, setNameError] = useState("");

  function validFilename(name: string): boolean {
    return name.length > 0 && name.endsWith(".json") && !name.includes("/") && !name.includes("\\");
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setParseError("");
    setNameError("");
    const trimmed = file.trim();
    if (!validFilename(trimmed)) {
      setNameError("Filename must be a bare name ending in .json, no path separators.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Not valid JSON.");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setParseError("Must be a JSON object at the top level.");
      return;
    }
    onSubmit(trimmed, parsed as Record<string, unknown>);
  }

  return (
    <form className="providers-custom__editor providers-custom__create" onSubmit={handleSubmit}>
      <label className="providers-custom__filename-field">
        <span>Filename</span>
        <input
          value={file}
          onChange={(e) => setFile(e.target.value)}
          placeholder="my-provider.json"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {nameError && (
        <span className="settings-editor__error" role="alert">
          {nameError}
        </span>
      )}
      <textarea
        className="providers-custom__textarea"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="New provider file JSON"
      />
      {parseError && (
        <span className="settings-editor__error" role="alert">
          {parseError}
        </span>
      )}
      <div className="settings-editor__actions">
        <button type="button" className="settings-editor__cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="settings-editor__save" disabled={saving || !file.trim()}>
          {saving ? "Creating…" : "Create file"}
        </button>
      </div>
    </form>
  );
}
