// Drafts (docs/FEATURES.md §13 "Drafts: list/get/save/delete — dangerous-
// flagged saves → confirm"): channels.drafts.list as a master list with a
// detail peek (channels.drafts.get), a create/edit modal, and delete.
// Both mutating verbs are dangerous+admin on the wire, so BOTH run through
// ConfirmSurface; save carries confirm metadata in the body
// (additionalProperties: true), delete is a bare DELETE on the path (its
// input schema takes nothing else — the confirmation is this UI's gate).

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { compactJson } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import { ErrorState, SkeletonBlock } from "../../components/feedback.tsx";
import { channelsKeys } from "./keys.ts";
import { QueryPanel } from "./QueryPanel.tsx";
import { readDrafts, type DraftRecord } from "./channels-wire.ts";

/** Detail peek — channels.drafts.get rendered verbatim (the look-something-up
 * surface; edit/delete stay on the list row). */
function DraftDetailPeek({ draftId }: { draftId: string }) {
  const detail = useQuery({
    queryKey: [...channelsKeys.drafts, draftId],
    queryFn: () => invoke("channels.drafts.get", { params: { draftId } }),
  });
  if (detail.isPending) return <SkeletonBlock variant="text" lines={8} />;
  if (detail.isError) {
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="Failed to load draft" />;
  }
  return <pre className="channels-peek-raw">{compactJson(detail.data)}</pre>;
}

function emptyDraft(): DraftRecord {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "draft",
    title: "",
    message: "",
    channel: "",
    route: "",
    webhook: "",
    link: "",
    tags: [],
    sentResponseId: "",
    sendError: "",
  };
}

export function DraftsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const peek = usePeek();
  const [editing, setEditing] = useState<{ draft: DraftRecord; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<DraftRecord | null>(null);

  const drafts = useQuery({
    queryKey: channelsKeys.drafts,
    queryFn: () => invoke("channels.drafts.list", { query: { limit: 100 } }),
    select: readDrafts,
  });

  const remove = useMutation({
    // drafts.delete takes only the path param — the ConfirmSurface below is
    // the gate; there is no confirm field in its input schema to forward.
    mutationFn: (draft: DraftRecord) =>
      invoke("channels.drafts.delete", { params: { draftId: draft.id } }),
    onSuccess: async (_result, draft) => {
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: channelsKeys.all });
      toast({ title: `Draft deleted`, description: draft.title || draft.id, tone: "info" });
    },
    onError: (error: unknown) => {
      setDeleting(null);
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    },
  });

  return (
    <div className="channels-drafts">
      <div className="channels-filter-row">
        <span className="channels-filter-row__summary">
          {drafts.isSuccess ? `${drafts.data.drafts.length} of ${drafts.data.total}` : ""}
        </span>
        <button
          type="button"
          className="channels-btn channels-btn--primary"
          onClick={() => setEditing({ draft: emptyDraft(), isNew: true })}
        >
          <Plus size={13} aria-hidden="true" /> New draft
        </button>
      </div>

      <QueryPanel
        query={drafts}
        capability="channels.drafts.list"
        unavailableDescription="outbound message drafts cannot be listed."
        errorTitle="Failed to load drafts"
        isEmpty={(page) => page.drafts.length === 0}
        emptyIcon={<FileText size={28} aria-hidden="true" />}
        emptyTitle="No drafts"
        emptyDescription="Outbound channel messages staged for review live here until they are sent or discarded."
        skeletonLines={6}
      >
        {(page) => (
          <ul className="channels-catalog__list" aria-label="Channel drafts">
            {page.drafts.map((draft) => (
              <li key={draft.id} className="channels-catalog__row">
                <div className="channels-catalog__text">
                  <span className="channels-catalog__label">
                    {draft.title || "(untitled)"}
                    <StatusBadge value={draft.status} />
                    {draft.sendError && <span className="badge bad">send failed</span>}
                  </span>
                  <span className="channels-catalog__desc">{draft.message.slice(0, 160)}</span>
                  <span className="channels-audit__meta">
                    {draft.channel && <code>channel {draft.channel}</code>}
                    {draft.route && <code>route {draft.route}</code>}
                    {draft.updatedAt && <span>updated {draft.updatedAt}</span>}
                    {draft.tags.length > 0 && <span>tags: {draft.tags.join(", ")}</span>}
                  </span>
                  {draft.sendError && <span className="channels-drafts__error">{draft.sendError}</span>}
                </div>
                <div className="channels-catalog__row-actions">
                  <button
                    type="button"
                    className="channels-btn"
                    onClick={() =>
                      peek.open({
                        title: draft.title || `Draft ${draft.id}`,
                        content: <DraftDetailPeek draftId={draft.id} />,
                      })
                    }
                  >
                    <Eye size={13} aria-hidden="true" /> View
                  </button>
                  <button
                    type="button"
                    className="channels-btn"
                    onClick={() => setEditing({ draft, isNew: false })}
                  >
                    <Pencil size={13} aria-hidden="true" /> Edit
                  </button>
                  <button
                    type="button"
                    className="channels-btn channels-btn--danger"
                    onClick={() => setDeleting(draft)}
                  >
                    <Trash2 size={13} aria-hidden="true" /> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryPanel>

      <DraftEditModal
        key={editing ? editing.draft.id : "none"}
        editing={editing}
        onClose={() => setEditing(null)}
      />

      <ConfirmSurface
        open={deleting !== null}
        action="Delete draft"
        target={deleting?.title || deleting?.id || ""}
        blastRadius="Removes the draft from the daemon store for every surface — this cannot be undone."
        danger
        requireTypedText="delete"
        confirmLabel="Delete draft"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// ─── Create/edit modal ───────────────────────────────────────────────────────

function DraftEditModal({
  editing,
  onClose,
}: {
  editing: { draft: DraftRecord; isNew: boolean } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  const base = editing?.draft;
  const [title, setTitle] = useState(base?.title ?? "");
  const [message, setMessage] = useState(base?.message ?? "");
  const [channel, setChannel] = useState(base?.channel ?? "");
  const [route, setRoute] = useState(base?.route ?? "");
  const [link, setLink] = useState(base?.link ?? "");
  const [tags, setTags] = useState((base?.tags ?? []).join(", "));

  const save = useMutation({
    mutationFn: (meta: ConfirmMetadata) => {
      if (!base) throw new Error("No draft");
      // Full record on the wire (all of version/id/createdAt/updatedAt/status/
      // message are required by the input schema); optional string fields are
      // omitted when blank rather than sent as "".
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      return invoke("channels.drafts.save", {
        body: {
          version: base.version,
          id: base.id,
          createdAt: base.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: base.status || "draft",
          message,
          ...(title ? { title } : {}),
          ...(channel ? { channel } : {}),
          ...(route ? { route } : {}),
          ...(link ? { link } : {}),
          ...(tagList.length > 0 ? { tags: tagList } : {}),
          ...meta,
        },
      });
    },
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: channelsKeys.all });
      toast({ title: editing?.isNew ? "Draft created" : "Draft saved", tone: "success" });
      onClose();
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Save failed", description: formatError(error), tone: "danger" });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!message.trim() || save.isPending) return;
    setConfirming(true);
  }

  return (
    <>
      <Modal
        open={editing !== null}
        onClose={onClose}
        title={editing?.isNew ? "New draft" : `Edit draft: ${base?.title || base?.id || ""}`}
        size="lg"
      >
        {editing && (
          <form className="channels-policy-form" onSubmit={handleSubmit}>
            <label className="channels-field">
              <span>Title</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="channels-field">
              <span>Message (required)</span>
              <textarea
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="channels-field__code"
              />
            </label>
            <div className="channels-policy-form__grid">
              <label className="channels-field">
                <span>Channel</span>
                <input
                  type="text"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  placeholder="e.g. slack"
                  spellCheck={false}
                />
              </label>
              <label className="channels-field">
                <span>Route</span>
                <input
                  type="text"
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                  placeholder="route id"
                  spellCheck={false}
                />
              </label>
              <label className="channels-field">
                <span>Link</span>
                <input type="text" value={link} onChange={(e) => setLink(e.target.value)} spellCheck={false} />
              </label>
              <label className="channels-field">
                <span>Tags (comma-separated)</span>
                <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} spellCheck={false} />
              </label>
            </div>
            <div className="channels-invoke__actions">
              <button type="button" className="channels-btn" onClick={onClose} disabled={save.isPending}>
                Cancel
              </button>
              <button
                type="submit"
                className="channels-btn channels-btn--primary"
                disabled={!message.trim() || save.isPending}
              >
                {save.isPending ? "Saving…" : "Save draft…"}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <ConfirmSurface
        open={confirming && editing !== null}
        action={editing?.isNew ? "Create draft" : "Save draft"}
        target={title || base?.id || ""}
        blastRadius="Writes to the daemon draft store shared by every surface. The daemon flags draft saves as dangerous because staged drafts can be sent onward to real recipients."
        danger
        confirmLabel="Save draft"
        onConfirm={(meta) => save.mutate(meta)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
