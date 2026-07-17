// Principals — the named-identity registry (principals.*, contract 1.11).
// Every row shows channel:value identities as badges; create/edit go through
// a modal form with a one-per-line "channel:value" textarea (identities
// REPLACE the set on update, never merge — same as the daemon's own
// semantics). Delete is behind a danger confirm: mapped identities resolve
// as unknown afterwards until re-mapped. A small resolve probe below the
// toolbar answers channel+value -> named principal, or the honest "unknown
// principal" — never a fabricated identity.
//
// No wire event for this domain (not on lib/realtime.ts's DOMAIN_INVALIDATIONS)
// — freshness comes from mutation-driven invalidation plus ChannelsView's
// manual refresh, same posture as fleet.*/checkpoints.*/ci.*.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { clearDraft, useDraftState } from "../../lib/drafts.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { QueryPanel } from "./QueryPanel.tsx";
import { readPrincipalResolution, readPrincipals, type PrincipalRecord } from "./channels-wire.ts";

const PRINCIPAL_KINDS = ["user", "bot", "service", "token"] as const;

interface DraftIdentity {
  channel: string;
  value: string;
}

function identitiesToDraft(identities: readonly DraftIdentity[]): string {
  return identities.map((i) => `${i.channel}:${i.value}`).join("\n");
}

function identitiesFromDraft(draft: string): DraftIdentity[] {
  return draft
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [channel, ...rest] = line.split(":");
      return { channel: (channel ?? "").trim(), value: rest.join(":").trim() };
    })
    .filter((identity) => identity.channel && identity.value);
}

type FormState = { mode: "create" } | { mode: "edit"; principal: PrincipalRecord };

interface PrincipalInput {
  name: string;
  kind: string;
  identities: DraftIdentity[];
}

export function PrincipalsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formState, setFormState] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PrincipalRecord | null>(null);

  const principals = useQuery({
    queryKey: queryKeys.principals,
    queryFn: () => gv.principals.list(),
    select: readPrincipals,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.principals });

  const create = useMutation({
    mutationFn: (input: PrincipalInput) => gv.principals.create(input),
    onSuccess: async () => {
      setFormState(null);
      clearDraft("channels.principal.new.identities");
      await invalidate();
      toast({ title: "Principal created", tone: "success" });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to create principal", description: formatError(error), tone: "danger" }),
  });

  const update = useMutation({
    mutationFn: ({ principalId, input }: { principalId: string; input: PrincipalInput }) =>
      gv.principals.update(principalId, input),
    onSuccess: async (_result, variables) => {
      setFormState(null);
      clearDraft(`channels.principal.${variables.principalId}.identities`);
      await invalidate();
      toast({ title: "Principal updated", tone: "success" });
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to update principal", description: formatError(error), tone: "danger" }),
  });

  const remove = useMutation({
    mutationFn: (principalId: string) => gv.principals.delete(principalId) as Promise<{ deleted?: boolean }>,
    onSuccess: async (result: { deleted?: boolean } | undefined) => {
      setDeleteTarget(null);
      await invalidate();
      toast(
        result?.deleted === false
          ? { title: "Principal already gone", description: "No principal with that id existed.", tone: "info" }
          : { title: "Principal deleted", tone: "info" },
      );
    },
    onError: (error: unknown) =>
      toast({ title: "Failed to delete principal", description: formatError(error), tone: "danger" }),
  });

  function handleSubmit(input: PrincipalInput): void {
    if (formState?.mode === "edit") {
      update.mutate({ principalId: formState.principal.id, input });
    } else {
      create.mutate(input);
    }
  }

  return (
    <section className="channels-principals" aria-label="Principals">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Users size={14} aria-hidden="true" /> Principals
          {principals.isSuccess ? ` · ${principals.data.length}` : ""}
        </span>
        <button
          type="button"
          className="channels-btn channels-btn--primary"
          onClick={() => setFormState({ mode: "create" })}
        >
          <Plus size={13} aria-hidden="true" /> New principal
        </button>
      </div>

      <ResolveProbe />

      <QueryPanel
        query={principals}
        capability="principals.list"
        unavailableDescription="named identities cannot be listed, resolved, or edited."
        errorTitle="Failed to load principals"
        isEmpty={(rows) => rows.length === 0}
        emptyIcon={<Users size={28} aria-hidden="true" />}
        emptyTitle="No principals yet"
        emptyDescription="Create one to attribute channel messages to a named identity."
        skeletonLines={4}
      >
        {(rows) => (
          <ul className="channels-catalog__list" aria-label="Principals">
            {rows.map((principal) => (
              <li key={principal.id} className="channels-catalog__row">
                <div className="channels-catalog__text">
                  <span className="channels-catalog__label">
                    {principal.name}
                    <span className="badge neutral">{principal.kind}</span>
                  </span>
                  <span className="channels-catalog__desc">
                    {principal.identities.length === 0 ? (
                      "no channel identities mapped"
                    ) : (
                      principal.identities.map((identity, index) => (
                        <code key={index} className="channels-catalog__id">
                          {identity.channel}:{identity.value}
                        </code>
                      ))
                    )}
                  </span>
                </div>
                <div className="channels-catalog__row-actions">
                  <button
                    type="button"
                    className="channels-btn"
                    onClick={() => setFormState({ mode: "edit", principal })}
                  >
                    <Pencil size={13} aria-hidden="true" /> Edit
                  </button>
                  <button
                    type="button"
                    className="channels-btn channels-btn--danger"
                    onClick={() => setDeleteTarget(principal)}
                  >
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryPanel>

      <PrincipalFormModal
        key={formState?.mode === "edit" ? formState.principal.id : formState?.mode === "create" ? "create" : "none"}
        state={formState}
        submitting={create.isPending || update.isPending}
        onSubmit={handleSubmit}
        onClose={() => setFormState(null)}
      />

      <ConfirmSurface
        open={deleteTarget !== null}
        danger
        action="Delete principal"
        target={deleteTarget?.name ?? ""}
        blastRadius="This is permanent. Any channel identities mapped to this principal resolve as unknown until re-mapped to another principal."
        confirmLabel={remove.isPending ? "Deleting…" : "Delete principal"}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

function PrincipalFormModal({
  state,
  submitting,
  onSubmit,
  onClose,
}: {
  state: FormState | null;
  submitting: boolean;
  onSubmit: (input: PrincipalInput) => void;
  onClose: () => void;
}) {
  const editing = state?.mode === "edit" ? state.principal : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<string>(editing?.kind ?? "user");
  // The identities textarea is the field worth persisting — a hand-typed list
  // of "channel:value" lines a user would grieve retyping. This component
  // remounts per form target (key on the parent, PrincipalsPanel), so a
  // stable per-entity key is enough; no manual reset effect needed.
  const [identitiesDraft, setIdentitiesDraft] = useDraftState(
    `channels.principal.${editing?.id ?? "new"}.identities`,
    editing ? identitiesToDraft(editing.identities) : "",
  );

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    onSubmit({ name: trimmed, kind, identities: identitiesFromDraft(identitiesDraft) });
  }

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={editing ? `Edit principal: ${editing.name}` : "New principal"}
    >
      <form className="channels-policy-form" onSubmit={handleSubmit}>
        <label className="channels-field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} required />
        </label>
        <label className="channels-field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={submitting}>
            {PRINCIPAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="channels-field">
          <span>Channel identities (one per line, "channel:value") — replaces the full set on save</span>
          <textarea
            rows={4}
            value={identitiesDraft}
            onChange={(e) => setIdentitiesDraft(e.target.value)}
            placeholder="slack:U123ABC"
            spellCheck={false}
            className="channels-field__code"
            disabled={submitting}
          />
        </label>
        <div className="channels-invoke__actions">
          <button type="button" className="channels-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="channels-btn channels-btn--primary" disabled={submitting || !name.trim()}>
            {submitting ? "Saving…" : editing ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Resolve probe ────────────────────────────────────────────────────────────

function ResolveProbe() {
  const [channel, setChannel] = useState("");
  const [value, setValue] = useState("");

  const resolve = useMutation({
    mutationFn: (input: { channel: string; value: string }) => gv.principals.resolve(input),
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const c = channel.trim();
    const v = value.trim();
    if (!c || !v || resolve.isPending) return;
    resolve.mutate({ channel: c, value: v });
  }

  const resolution = resolve.data !== undefined ? readPrincipalResolution(resolve.data) : null;

  return (
    <form className="channels-filter-row" onSubmit={handleSubmit} aria-label="Resolve a channel identity">
      <label className="channels-filter channels-filter--grow">
        <span>Channel</span>
        <input type="text" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="slack" />
      </label>
      <label className="channels-filter channels-filter--grow">
        <span>Value</span>
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder="U123ABC" />
      </label>
      <button type="submit" className="channels-btn" disabled={resolve.isPending || !channel.trim() || !value.trim()}>
        <Search size={13} aria-hidden="true" /> {resolve.isPending ? "Resolving…" : "Resolve"}
      </button>
      {resolve.isError && <span className="channels-invoke__error">{formatError(resolve.error)}</span>}
      {resolution && (
        <span className={resolution.known ? "badge ok" : "badge neutral"}>
          {resolution.known && resolution.principal
            ? `${resolution.principal.name} (${resolution.principal.kind})`
            : "unknown principal"}
        </span>
      )}
    </form>
  );
}
