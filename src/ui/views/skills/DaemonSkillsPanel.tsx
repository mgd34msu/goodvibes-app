// Daemon skills — skills.list/get/create/update/delete over the DAEMON's
// canonical skill store. This is the FIRST UI anywhere for this store (no
// webui/tui crib exists to port; built directly from the operator contract:
// node_modules/@pellux/goodvibes-sdk/dist/contracts/artifacts/
// operator-contract.json). Distinct from the app-local registry-based
// "Skills" section elsewhere on this view — two independent catalogs.
//
// Progressive disclosure is the WIRE's design, not a UI shortcut: skills.list
// returns only name/description/metadata (no body) so the index stays cheap
// to render at any size; expanding a row is what fetches skills.get for that
// one skill's full markdown body. Never eagerly fetch every body.

import { forwardRef, useImperativeHandle, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pencil, Plus, RefreshCw, ScrollText, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { errorStatus, formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { asRecord } from "../../lib/wire.ts";
import {
  daemonSkillKeys,
  formatSkillTimestamp,
  metadataEntries,
  parseDaemonSkill,
  parseDaemonSkillIndex,
  type DaemonSkill,
  type DaemonSkillIndexEntry,
} from "./daemon-skills-wire.ts";
import { DaemonSkillEditorModal, type DaemonSkillDraft } from "./DaemonSkillEditorModal.tsx";

type EditorTarget = { mode: "create" } | { mode: "edit"; skill: DaemonSkill } | null;

/** One expandable index row — lazily fetches the full body via skills.get
 * only once expanded, and only then (never on mount). */
function DaemonSkillRow({
  entry,
  onEdit,
  onDelete,
  deleting,
}: {
  entry: DaemonSkillIndexEntry;
  onEdit: (skill: DaemonSkill) => void;
  onDelete: (entry: DaemonSkillIndexEntry) => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const detail = useQuery({
    queryKey: daemonSkillKeys.detail(entry.name),
    queryFn: async () => parseDaemonSkill(await gv.skills.get(entry.name)),
    enabled: expanded,
    retry: false,
  });

  const entries = metadataEntries(entry.metadata);

  return (
    <li className="reg-row daemon-skill-row">
      <button
        type="button"
        className="daemon-skill-row__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <span className="reg-row__name">{entry.name}</span>
      </button>
      {entry.description && <p className="reg-row__description">{entry.description}</p>}
      {entries.length > 0 && (
        <div className="reg-row__requirements">
          <span className="reg-row__requirements-label">Metadata:</span>
          {entries.map(([key, value]) => (
            <span key={key} className="badge info" title={`${key}: ${value}`}>
              {key}: {value}
            </span>
          ))}
        </div>
      )}
      {entry.updatedAt !== undefined && (
        <p className="daemon-skill-row__updated">Updated {formatSkillTimestamp(entry.updatedAt)}</p>
      )}

      {expanded && (
        <div className="daemon-skill-row__body">
          {detail.isPending && <SkeletonBlock variant="text" lines={4} />}
          {detail.isError && (
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="Failed to load skill body" />
          )}
          {detail.isSuccess && detail.data && (
            <div className="reg-form__preview daemon-skill-row__markdown">
              <MarkdownMessage content={detail.data.body || "*(empty body)*"} />
            </div>
          )}
          {detail.isSuccess && !detail.data && (
            <p className="reg-form__help">The daemon no longer has a skill named "{entry.name}".</p>
          )}
        </div>
      )}

      <div className="reg-row__actions">
        <button
          type="button"
          className="reg-button"
          onClick={async () => {
            if (detail.data) {
              onEdit(detail.data);
              return;
            }
            const fetched = parseDaemonSkill(await gv.skills.get(entry.name));
            if (fetched) onEdit(fetched);
          }}
        >
          <Pencil size={13} aria-hidden="true" /> Edit
        </button>
        <button
          type="button"
          className="reg-button reg-button--danger"
          onClick={() => onDelete(entry)}
          disabled={deleting}
        >
          <Trash2 size={13} aria-hidden="true" /> Delete
        </button>
      </div>
    </li>
  );
}

/** Imperative handle so the parent's palette command ("Skills: New Skill")
 * can open the create form without lifting this panel's query/mutation
 * state up to SkillsView. */
export interface DaemonSkillsPanelHandle {
  openCreate: () => void;
}

export const DaemonSkillsPanel = forwardRef<DaemonSkillsPanelHandle>(function DaemonSkillsPanel(_props, ref) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editor, setEditor] = useState<EditorTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DaemonSkillIndexEntry | null>(null);
  const [nameConflict, setNameConflict] = useState(false);

  const list = useQuery({
    queryKey: daemonSkillKeys.list,
    queryFn: async () => parseDaemonSkillIndex(await gv.skills.list()),
    // No wire event for skills.* — poll while the section is mounted, plus
    // refetch on every mutation.
    refetchInterval: 30_000,
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: daemonSkillKeys.all });

  const openCreate = () => {
    setNameConflict(false);
    setEditor({ mode: "create" });
  };

  useImperativeHandle(ref, () => ({ openCreate }));

  const save = useMutation({
    mutationFn: async ({ target, draft }: { target: DaemonSkill | null; draft: DaemonSkillDraft }) => {
      if (target) {
        return gv.skills.update(target.name, {
          description: draft.description,
          body: draft.body,
          metadata: draft.metadata,
        });
      }
      return gv.skills.create({
        name: draft.name,
        description: draft.description,
        body: draft.body,
        metadata: draft.metadata,
      });
    },
    onSuccess: async (_result, { target }) => {
      await invalidate();
      setEditor(null);
      setNameConflict(false);
      toast({ title: target ? "Daemon skill updated" : "Daemon skill created", tone: "success" });
    },
    onError: (error: unknown) => {
      // 409 name-conflict on create is an inline field error, not a toast —
      // the operator is still looking at the form that caused it.
      if (errorStatus(error) === 409) {
        setNameConflict(true);
        return;
      }
      toast({ title: "Save failed", description: formatError(error), tone: "danger" });
    },
  });

  const remove = useMutation({
    mutationFn: (entry: DaemonSkillIndexEntry) => gv.skills.delete(entry.name),
    onSuccess: async (result, entry) => {
      await invalidate();
      setDeleteTarget(null);
      // Delete-means-delete honesty: {deleted:false} means no such skill
      // existed — never claim a phantom row was removed.
      const deleted = asRecord(result)["deleted"];
      if (deleted === false) {
        toast({ title: "Already gone", description: `No daemon skill named "${entry.name}" existed.`, tone: "info" });
      } else {
        toast({ title: `Deleted daemon skill "${entry.name}"`, tone: "info" });
      }
    },
    onError: (error: unknown) => {
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    },
  });

  const unavailable = list.isError && isMethodUnavailableError(list.error);

  return (
    <div className="daemon-skills-panel">
      <div className="reg-toolbar">
        <span className="reg-toolbar__summary">
          <ScrollText size={14} aria-hidden="true" /> Daemon skills
          {list.isSuccess ? ` · ${list.data.length}` : ""}
        </span>
        <button type="button" className="reg-button reg-button--primary" onClick={openCreate}>
          <Plus size={14} aria-hidden="true" /> New daemon skill
        </button>
        <button
          type="button"
          className="reg-icon-button"
          aria-label="Refresh daemon skills"
          onClick={() => void list.refetch()}
        >
          <RefreshCw size={14} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      <p className="reg-form__help daemon-skills-panel__note">
        The daemon-canonical skill store, separate from the app-local registry above. The index below is cheap —
        name, description, and metadata only. Expand a row to fetch its full markdown body.
      </p>

      {list.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState
          capability="skills.list"
          description="the daemon-canonical skill store is not part of this build, so daemon skills cannot be listed or edited."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load daemon skills" />
      )}

      {list.isSuccess && list.data.length === 0 && (
        <EmptyState
          icon={<ScrollText size={28} aria-hidden="true" />}
          title="No daemon skills yet"
          description="A daemon skill is a markdown instruction block the daemon itself stores and serves — create one to add it to the canonical store."
          action={{ label: "New daemon skill", onClick: openCreate }}
        />
      )}

      {list.isSuccess && list.data.length > 0 && (
        <ul className="reg-rows daemon-skill-rows">
          {list.data.map((entry) => (
            <DaemonSkillRow
              key={entry.name}
              entry={entry}
              onEdit={(skill) => {
                setNameConflict(false);
                setEditor({ mode: "edit", skill });
              }}
              onDelete={setDeleteTarget}
              deleting={remove.isPending && remove.variables?.name === entry.name}
            />
          ))}
        </ul>
      )}

      <DaemonSkillEditorModal
        open={editor !== null}
        skill={editor?.mode === "edit" ? editor.skill : null}
        saving={save.isPending}
        nameConflict={nameConflict}
        onClose={() => {
          setEditor(null);
          setNameConflict(false);
        }}
        onSave={(draft) => {
          setNameConflict(false);
          save.mutate({ target: editor?.mode === "edit" ? editor.skill : null, draft });
        }}
      />

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete daemon skill"
        target={deleteTarget?.name ?? ""}
        blastRadius="Delete means delete: the document is removed from the daemon's canonical store, not tombstoned. This cannot be undone."
        danger
        confirmLabel={remove.isPending ? "Deleting…" : "Delete skill"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && !remove.isPending) remove.mutate(deleteTarget);
        }}
      />
    </div>
  );
});
