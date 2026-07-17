// Channel profiles — per-channel intake defaults (channels.profiles.*,
// contract 1.11): the model/provider/permission-mode a channel's originated
// sessions inherit. set() is an upsert keyed on (surfaceKind, channelId?) —
// the same form handles create and edit, with the key fields locked once a
// binding is being edited (the key IS the identity; changing it would create
// a new binding, not rename this one). Delete is behind a danger confirm
// naming the exact consequence: sessions this channel originates stop
// inheriting these defaults.

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError } from "../../lib/errors.ts";
import { formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { QueryPanel } from "./QueryPanel.tsx";
import { readChannelProfiles, type ChannelProfileBinding } from "./channels-wire.ts";

const PERMISSION_MODES = ["plan", "normal", "accept-edits", "auto"] as const;

type FormState = { mode: "create" } | { mode: "edit"; binding: ChannelProfileBinding };

export function ChannelProfilesPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formState, setFormState] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelProfileBinding | null>(null);

  const bindings = useQuery({
    queryKey: queryKeys.channelProfiles,
    queryFn: () => gv.channelProfiles.list(),
    select: readChannelProfiles,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.channelProfiles });

  const set = useMutation({
    mutationFn: (input: Record<string, unknown>) => gv.channelProfiles.set(input),
    onSuccess: async () => {
      setFormState(null);
      await invalidate();
      toast({ title: "Channel profile saved", tone: "success" });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to save channel profile", description: formatError(error), tone: "danger" }),
  });

  const remove = useMutation({
    mutationFn: ({ surfaceKind, channelId }: { surfaceKind: string; channelId?: string }) =>
      gv.channelProfiles.delete(surfaceKind, channelId ? { channelId } : undefined) as Promise<{ deleted?: boolean }>,
    onSuccess: async (result: { deleted?: boolean } | undefined) => {
      setDeleteTarget(null);
      await invalidate();
      toast(
        result?.deleted === false
          ? { title: "Binding already gone", description: "No binding with that key existed.", tone: "info" }
          : { title: "Channel profile deleted", tone: "info" },
      );
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to delete channel profile", description: formatError(error), tone: "danger" }),
  });

  return (
    <section className="channels-principals" aria-label="Channel profiles">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Settings2 size={14} aria-hidden="true" /> Channel profiles
          {bindings.isSuccess ? ` · ${bindings.data.length}` : ""}
        </span>
        <button
          type="button"
          className="channels-btn channels-btn--primary"
          onClick={() => setFormState({ mode: "create" })}
        >
          <Plus size={13} aria-hidden="true" /> New binding
        </button>
      </div>

      <QueryPanel
        query={bindings}
        capability="channels.profiles.list"
        unavailableDescription="per-channel model/permission defaults cannot be shown."
        errorTitle="Failed to load channel profiles"
        isEmpty={(rows) => rows.length === 0}
        emptyIcon={<Settings2 size={28} aria-hidden="true" />}
        emptyTitle="No channel profile bindings yet"
        emptyDescription="Bind a surface (and optionally one channel within it) to model/permission defaults its originated sessions inherit."
        skeletonLines={4}
      >
        {(rows) => (
          <ul className="channels-catalog__list" aria-label="Channel profile bindings">
            {rows.map((binding) => (
              <li key={binding.id} className="channels-catalog__row">
                <div className="channels-catalog__text">
                  <span className="channels-catalog__label">
                    <code className="channels-catalog__id">
                      {binding.surfaceKind}
                      {binding.channelId ? `:${binding.channelId}` : ""}
                    </code>
                  </span>
                  <span className="channels-catalog__desc">
                    {binding.model && <span className="badge neutral">model: {binding.model}</span>}
                    {binding.provider && <span className="badge neutral">provider: {binding.provider}</span>}
                    {binding.permissionMode && <span className="badge neutral">{binding.permissionMode}</span>}
                    {!binding.model && !binding.provider && !binding.permissionMode && "no defaults set"}
                  </span>
                  <span className="channels-catalog__desc">updated {formatRelative(binding.updatedAt)}</span>
                </div>
                <div className="channels-catalog__row-actions">
                  <button
                    type="button"
                    className="channels-btn"
                    onClick={() => setFormState({ mode: "edit", binding })}
                  >
                    <Pencil size={13} aria-hidden="true" /> Edit
                  </button>
                  <button
                    type="button"
                    className="channels-btn channels-btn--danger"
                    onClick={() => setDeleteTarget(binding)}
                  >
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryPanel>

      <ChannelProfileFormModal
        state={formState}
        submitting={set.isPending}
        onSubmit={(input) => set.mutate(input)}
        onClose={() => setFormState(null)}
      />

      <ConfirmSurface
        open={deleteTarget !== null}
        danger
        action="Delete channel profile binding"
        target={
          deleteTarget ? (deleteTarget.channelId ? `${deleteTarget.surfaceKind}:${deleteTarget.channelId}` : deleteTarget.surfaceKind) : ""
        }
        blastRadius="Sessions this channel originates will no longer inherit these defaults."
        confirmLabel={remove.isPending ? "Deleting…" : "Delete binding"}
        onConfirm={() => {
          if (deleteTarget) {
            remove.mutate({ surfaceKind: deleteTarget.surfaceKind, channelId: deleteTarget.channelId || undefined });
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

function ChannelProfileFormModal({
  state,
  submitting,
  onSubmit,
  onClose,
}: {
  state: FormState | null;
  submitting: boolean;
  onSubmit: (input: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const editing = state?.mode === "edit" ? state.binding : null;
  const [surfaceKind, setSurfaceKind] = useState(editing?.surfaceKind ?? "");
  const [channelId, setChannelId] = useState(editing?.channelId ?? "");
  const [model, setModel] = useState(editing?.model ?? "");
  const [provider, setProvider] = useState(editing?.provider ?? "");
  const [permissionMode, setPermissionMode] = useState(editing?.permissionMode ?? "");

  const resetKey = editing?.id ?? (state?.mode === "create" ? "create" : "none");
  useEffect(() => {
    setSurfaceKind(editing?.surfaceKind ?? "");
    setChannelId(editing?.channelId ?? "");
    setModel(editing?.model ?? "");
    setProvider(editing?.provider ?? "");
    setPermissionMode(editing?.permissionMode ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const surface = surfaceKind.trim();
    if (!surface || submitting) return;
    onSubmit({
      surfaceKind: surface,
      ...(channelId.trim() ? { channelId: channelId.trim() } : {}),
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(provider.trim() ? { provider: provider.trim() } : {}),
      ...(permissionMode ? { permissionMode } : {}),
    });
  }

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={editing ? `Edit binding: ${editing.surfaceKind}` : "New channel profile binding"}
    >
      <form className="channels-policy-form" onSubmit={handleSubmit}>
        <div className="channels-policy-form__grid">
          <label className="channels-field">
            <span>Surface kind</span>
            <input
              type="text"
              value={surfaceKind}
              onChange={(e) => setSurfaceKind(e.target.value)}
              placeholder="slack"
              disabled={submitting || Boolean(editing)}
              required
            />
          </label>
          <label className="channels-field">
            <span>Channel id (optional — scopes to one channel)</span>
            <input
              type="text"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              disabled={submitting || Boolean(editing)}
            />
          </label>
        </div>
        <div className="channels-policy-form__grid">
          <label className="channels-field">
            <span>Model (optional)</span>
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} disabled={submitting} />
          </label>
          <label className="channels-field">
            <span>Provider (optional)</span>
            <input type="text" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={submitting} />
          </label>
          <label className="channels-field">
            <span>Permission mode (optional)</span>
            <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)} disabled={submitting}>
              <option value="">— unset —</option>
              {PERMISSION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
        </div>
        {editing && (
          <p className="channels-policy-form__note">
            The surface kind and channel id are locked while editing — they are this binding's key.
          </p>
        )}
        <div className="channels-invoke__actions">
          <button type="button" className="channels-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            className="channels-btn channels-btn--primary"
            disabled={submitting || !surfaceKind.trim()}
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
