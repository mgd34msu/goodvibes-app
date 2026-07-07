// Documents & Compare — docs/FEATURES.md §11. Two tabs:
//  · Drafts: versioned markdown documents in the app-local /app/registries/
//    documents collection — editor with save-as-version, version timeline
//    with client-side line diffs between any two versions, review comments
//    stored on the item (superset-tolerant), and .md export.
//  · Model compare: blind two-model comparison (CompareLab.tsx).
//
// Realtime: the documents registry is app-local with no wire events — a 30s
// refetchInterval keeps other-window edits visible; mutations invalidate the
// "documents-registry" prefix.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, GitCompare, History, MessageSquare, Package } from "lucide-react";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { formatError, errorStatus } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { formatRelative } from "../../lib/wire.ts";
import { useUrlState } from "../../lib/router.ts";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  createDocument,
  deleteDocument,
  docKeys,
  documentFrom,
  downloadText,
  exportFilename,
  listDocuments,
  listVersions,
  rawWithComments,
  saveVersion,
  updateDocument,
  versionFrom,
  type DocRecord,
  type DocVersion,
} from "./documents-data.ts";
import { diffLines, diffStats } from "./line-diff.ts";
import { CompareLab } from "./CompareLab.tsx";
import { PacketsPanel } from "./PacketsPanel.tsx";

function isRegistryUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 501;
}

const NEW_DOC_INPUT_ID = "documents-new-title-input";

type DocTab = "drafts" | "compare" | "packets";

function tabFromFilter(value: string | undefined): DocTab | null {
  return value === "drafts" || value === "compare" || value === "packets" ? value : null;
}

export function DocumentsView() {
  // Deep-linkable tab: ?view=documents&filter[tab]=packets&filter[note]=<id>
  // — the /note toast's "Open in Documents" jump link lands here (chat's
  // useSlashCommands.ts drives this same filter shape).
  const { filters, setFilters } = useUrlState();
  const [tab, setTab] = useState<DocTab>(() => tabFromFilter(filters.tab) ?? "drafts");
  // setFilters is re-created by useUrlState on every URL change (it closes
  // over the current urlState) — the palette-command effect below registers
  // ONCE on mount, so it goes through this ref rather than a stale closure.
  const setFiltersRef = useRef(setFilters);
  setFiltersRef.current = setFilters;

  useEffect(() => {
    const fromFilter = tabFromFilter(filters.tab);
    if (fromFilter && fromFilter !== tab) setTab(fromFilter);
  }, [filters.tab, tab]);

  function selectTab(next: DocTab): void {
    setTab(next);
    setFiltersRef.current({ tab: next }, { replace: true });
  }

  useEffect(() => {
    registerCommand({
      id: "documents.new",
      title: "Documents: new draft",
      group: "know",
      keywords: ["document", "draft", "markdown"],
      run: () => {
        selectTab("drafts");
        document.getElementById(NEW_DOC_INPUT_ID)?.focus();
      },
    });
    registerCommand({
      id: "documents.compare",
      title: "Documents: blind model compare",
      group: "know",
      keywords: ["compare", "models", "blind", "a/b"],
      run: () => selectTab("compare"),
    });
    registerCommand({
      id: "documents.packets",
      title: "Documents: review packets & notes",
      group: "know",
      keywords: ["packet", "wizard", "preset", "freshness", "zip", "share", "note"],
      run: () => selectTab("packets"),
    });
    return () => {
      unregisterCommand("documents.new");
      unregisterCommand("documents.compare");
      unregisterCommand("documents.packets");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="documents-view">
      <div className="documents-tabs" role="tablist" aria-label="Documents sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "drafts"}
          className={tab === "drafts" ? "documents-tab documents-tab--active" : "documents-tab"}
          onClick={() => selectTab("drafts")}
        >
          <FileText size={14} aria-hidden="true" /> Drafts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "compare"}
          className={tab === "compare" ? "documents-tab documents-tab--active" : "documents-tab"}
          onClick={() => selectTab("compare")}
        >
          <GitCompare size={14} aria-hidden="true" /> Model compare
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "packets"}
          className={tab === "packets" ? "documents-tab documents-tab--active" : "documents-tab"}
          onClick={() => selectTab("packets")}
        >
          <Package size={14} aria-hidden="true" /> Packets & notes
        </button>
      </div>
      {/* All three tabs stay mounted (display toggling) so a running compare,
          an unsaved draft, and the packet wizard all survive tab switches —
          docs/UX.md §4. */}
      <div style={tab === "drafts" ? undefined : { display: "none" }}>
        <DraftsSection />
      </div>
      <div style={tab === "compare" ? undefined : { display: "none" }}>
        <CompareLab />
      </div>
      <div style={tab === "packets" ? undefined : { display: "none" }}>
        <PacketsPanel highlightNoteId={filters.note} />
      </div>
    </div>
  );
}

// ─── Drafts (master list + editor) ───────────────────────────────────────────

function DraftsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState("");
  const [newTitle, setNewTitle] = useState("");

  // App-local registry: no wire events — poll every 30s.
  const docsQuery = useQuery({
    queryKey: docKeys.list,
    queryFn: listDocuments,
    refetchInterval: 30_000,
  });
  const docs = useMemo(() => (docsQuery.data ?? []).map(documentFrom).filter((d) => d.id), [docsQuery.data]);
  const selected = docs.find((d) => d.id === selectedId) ?? null;

  const create = useMutation({
    mutationFn: (title: string) => createDocument({ title, headVersion: 0 }),
    onSuccess: async (item) => {
      setNewTitle("");
      await queryClient.invalidateQueries({ queryKey: docKeys.all });
      const id = documentFrom(item).id;
      if (id) setSelectedId(id);
      toast({ title: "Draft created", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Create failed", description: formatError(error), tone: "danger" }),
  });

  const unavailable = docsQuery.isError && isRegistryUnavailable(docsQuery.error);

  function handleCreate(event: FormEvent): void {
    event.preventDefault();
    const trimmed = newTitle.trim();
    if (trimmed && !create.isPending) create.mutate(trimmed);
  }

  return (
    <div className="documents-drafts">
      <aside className="documents-list" aria-label="Documents">
        <form className="documents-list__create" onSubmit={handleCreate}>
          <input
            id={NEW_DOC_INPUT_ID}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New draft title…"
            aria-label="New draft title"
            disabled={unavailable}
          />
          <button type="submit" disabled={!newTitle.trim() || create.isPending || unavailable}>
            {create.isPending ? "…" : "Create"}
          </button>
        </form>

        {docsQuery.isPending && <SkeletonBlock variant="text" lines={4} />}
        {unavailable && (
          <UnavailableState
            capability="/app/registries/documents"
            description="the app-local document registry is not served by this build, so drafts cannot be stored."
          />
        )}
        {docsQuery.isError && !unavailable && (
          <ErrorState error={docsQuery.error} onRetry={() => void docsQuery.refetch()} title="Failed to load drafts" />
        )}
        {docsQuery.isSuccess && docs.length === 0 && (
          <EmptyState
            icon={<FileText size={28} aria-hidden="true" />}
            title="No drafts"
            description="Create a draft to get a versioned markdown editor with diffs and review comments."
          />
        )}
        {docs.length > 0 && (
          <ul className="documents-list__items">
            {docs.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  className={selectedId === doc.id ? "documents-item documents-item--active" : "documents-item"}
                  onClick={() => setSelectedId(doc.id)}
                >
                  <span className="documents-item__title">{doc.title}</span>
                  <span className="documents-item__meta">
                    v{doc.headVersion}
                    {doc.comments.length > 0 ? ` · ${doc.comments.length} comment${doc.comments.length === 1 ? "" : "s"}` : ""}
                    {doc.updatedAt !== undefined ? ` · ${formatRelative(doc.updatedAt)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="documents-editor-pane">
        {selected ? (
          <DocumentEditor key={selected.id} doc={selected} onDeleted={() => setSelectedId("")} />
        ) : (
          <EmptyState
            icon={<FileText size={28} aria-hidden="true" />}
            title="Pick a draft"
            description="Select a document on the left to edit it, walk its version timeline, and review comments."
          />
        )}
      </div>
    </div>
  );
}

// ─── Editor + version timeline + diff + comments ─────────────────────────────

function DocumentEditor({ doc, onDeleted }: { doc: DocRecord; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const versionsQuery = useQuery({
    queryKey: docKeys.versions(doc.id),
    queryFn: () => listVersions(doc.id),
    refetchInterval: 30_000, // app-local registry — no wire events
  });
  const versions = useMemo(
    () => (versionsQuery.data ?? []).map(versionFrom).sort((x, y) => y.v - x.v),
    [versionsQuery.data],
  );
  const head = versions[0];

  const [draft, setDraft] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // The editor buffer starts from the head version content once it loads;
  // user edits (draft !== null) are never clobbered by refetches.
  const text = draft ?? head?.content ?? "";
  const dirty = draft !== null && draft !== (head?.content ?? "");

  const save = useMutation({
    mutationFn: () => saveVersion(doc.id, text, label.trim() || undefined),
    onSuccess: async () => {
      setDraft(null);
      setLabel("");
      await queryClient.invalidateQueries({ queryKey: docKeys.all });
      toast({ title: `Saved as v${doc.headVersion + 1}`, tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Save failed", description: formatError(error), tone: "danger" }),
  });

  const remove = useMutation({
    mutationFn: () => deleteDocument(doc.id),
    onSuccess: async () => {
      setDeleteOpen(false);
      await queryClient.invalidateQueries({ queryKey: docKeys.all });
      toast({ title: "Draft deleted", tone: "info" });
      onDeleted();
    },
    onError: (error: unknown) => toast({ title: "Delete failed", description: formatError(error), tone: "danger" }),
  });

  return (
    <div className="document-editor">
      <header className="document-editor__header">
        <h2 className="document-editor__title">{doc.title}</h2>
        <div className="document-editor__actions">
          <input
            type="text"
            className="document-editor__label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Version label (optional)"
            aria-label="Version label"
          />
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            title={dirty ? undefined : "No changes since the head version"}
          >
            {save.isPending ? "Saving…" : `Save as v${doc.headVersion + 1}`}
          </button>
          <button type="button" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
            {preview ? "Edit" : "Preview"}
          </button>
          <button type="button" onClick={() => downloadText(exportFilename(doc.title), text)}>
            Export .md
          </button>
          <button type="button" className="document-editor__delete" onClick={() => setDeleteOpen(true)}>
            Delete
          </button>
        </div>
      </header>

      {dirty && (
        <p className="document-editor__dirty" role="status">
          Unsaved changes — save as a version to keep them.
        </p>
      )}

      {versionsQuery.isPending ? (
        <SkeletonBlock height={220} />
      ) : preview ? (
        <div className="document-editor__preview">
          <MarkdownMessage content={text} />
        </div>
      ) : (
        <textarea
          className="document-editor__textarea"
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write markdown…"
          aria-label={`Content of ${doc.title}`}
          spellCheck
        />
      )}
      {versionsQuery.isError && (
        <ErrorState
          error={versionsQuery.error}
          onRetry={() => void versionsQuery.refetch()}
          title="Version history failed to load"
        />
      )}

      {versions.length > 0 && <VersionTimeline versions={versions} />}

      <CommentsSection doc={doc} />

      <ConfirmSurface
        open={deleteOpen}
        action="Delete draft"
        target={doc.title}
        blastRadius={`Removes the document and its ${versions.length} version(s) from the app registry. This cannot be undone.`}
        danger
        requireTypedText={doc.title.slice(0, 24)}
        confirmLabel="Delete draft"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

// ─── Version timeline + diff ─────────────────────────────────────────────────

function VersionTimeline({ versions }: { versions: DocVersion[] }) {
  // Default: newest vs the one before it.
  const [fromV, setFromV] = useState<number | null>(null);
  const [toV, setToV] = useState<number | null>(null);

  const effectiveTo = toV ?? versions[0]?.v ?? 0;
  const effectiveFrom = fromV ?? versions[1]?.v ?? effectiveTo;
  const fromVersion = versions.find((v) => v.v === effectiveFrom);
  const toVersion = versions.find((v) => v.v === effectiveTo);

  const diff = useMemo(() => {
    if (!fromVersion || !toVersion || fromVersion.v === toVersion.v) return null;
    return diffLines(fromVersion.content, toVersion.content);
  }, [fromVersion, toVersion]);
  const stats = diff ? diffStats(diff) : null;

  return (
    <section className="document-versions" aria-label="Version timeline">
      <h3 className="document-versions__title">
        <History size={14} aria-hidden="true" /> Versions ({versions.length})
      </h3>
      <ol className="document-versions__timeline">
        {versions.map((version) => (
          <li key={version.v} className="document-versions__entry">
            <span className="badge neutral">v{version.v}</span>
            <span className="document-versions__meta">
              {version.label && <em>{version.label} · </em>}
              {formatRelative(version.createdAt)} · {version.content.split("\n").length} lines
            </span>
          </li>
        ))}
      </ol>

      {versions.length > 1 && (
        <div className="document-versions__diff-controls">
          <label>
            Diff from
            <select value={effectiveFrom} onChange={(e) => setFromV(Number(e.target.value))}>
              {versions.map((v) => (
                <option key={v.v} value={v.v}>
                  v{v.v}
                </option>
              ))}
            </select>
          </label>
          <label>
            to
            <select value={effectiveTo} onChange={(e) => setToV(Number(e.target.value))}>
              {versions.map((v) => (
                <option key={v.v} value={v.v}>
                  v{v.v}
                </option>
              ))}
            </select>
          </label>
          {stats && (
            <span className="document-versions__stats">
              <span className="badge ok">+{stats.added}</span>
              <span className="badge bad">−{stats.removed}</span>
            </span>
          )}
        </div>
      )}

      {diff && (
        <pre className="document-diff" aria-label={`Diff v${effectiveFrom} to v${effectiveTo}`}>
          {diff.map((line, index) => (
            <span
              key={index}
              className={
                line.type === "add" ? "document-diff__line document-diff__line--add" : line.type === "del" ? "document-diff__line document-diff__line--del" : "document-diff__line"
              }
            >
              {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
              {line.text}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
    </section>
  );
}

// ─── Review comments (stored on the item, superset-tolerant) ─────────────────

function CommentsSection({ doc }: { doc: DocRecord }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");

  const saveComments = useMutation({
    mutationFn: (comments: typeof doc.comments) => updateDocument(doc.id, rawWithComments(doc, comments)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: docKeys.all }),
    onError: (error: unknown) =>
      toast({ title: "Comment update failed", description: formatError(error), tone: "danger" }),
  });

  function addComment(event: FormEvent): void {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || saveComments.isPending) return;
    const comment = {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      createdAt: Date.now(),
      resolved: false,
      raw: {},
    };
    saveComments.mutate([...doc.comments, comment]);
    setText("");
  }

  return (
    <section className="document-comments" aria-label="Review comments">
      <h3 className="document-comments__title">
        <MessageSquare size={14} aria-hidden="true" /> Review comments ({doc.comments.length})
      </h3>
      {doc.comments.length === 0 && <p className="document-comments__empty">No comments on this draft.</p>}
      {doc.comments.length > 0 && (
        <ul className="document-comments__list">
          {doc.comments.map((comment) => (
            <li key={comment.id || comment.text} className={comment.resolved ? "document-comment document-comment--resolved" : "document-comment"}>
              <p className="document-comment__text">{comment.text}</p>
              <div className="document-comment__meta">
                <span>{formatRelative(comment.createdAt)}</span>
                <button
                  type="button"
                  onClick={() =>
                    saveComments.mutate(
                      doc.comments.map((c) => (c.id === comment.id ? { ...c, resolved: !c.resolved } : c)),
                    )
                  }
                  disabled={saveComments.isPending}
                >
                  {comment.resolved ? "Reopen" : "Resolve"}
                </button>
                <button
                  type="button"
                  onClick={() => saveComments.mutate(doc.comments.filter((c) => c.id !== comment.id))}
                  disabled={saveComments.isPending}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="document-comments__form" onSubmit={addComment}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a review comment…"
          aria-label="New review comment"
        />
        <button type="submit" disabled={!text.trim() || saveComments.isPending}>
          Comment
        </button>
      </form>
    </section>
  );
}
