// Memory — the canonical cross-surface store (docs/FEATURES.md §7, ported
// from goodvibes-webui src/views/memory/*).
//
// Browse/search rides memory.records.search, whose recall-honesty envelope
// (mode actually ran, indexUnavailableReason, caveat, exclusion counts) is
// surfaced verbatim via MemorySearchHonestyNote. The semantic toggle asks the
// SAME verb for semantic:true — the server decides honestly whether the index
// answered — and additionally overlays similarity scores from
// memory.records.search-semantic when that verb is served. Add / detail peek
// (update + review transitions + links) / review queue / delete-with-confirm /
// export-import (JSON bundle download/upload) / vector + doctor admin live in
// the panels around it.
//
// Realtime: memory.* has NO wire event domain (docs/FEATURES.md §16 pin) —
// the review queue polls every 30s and every mutation invalidates the
// ["memory"] prefix, which refetches list + open peeks + queue + admin.

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, RefreshCw, Search, Upload } from "lucide-react";
import { gv, invoke } from "../../lib/gv.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorBoundary, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { AddMemoryForm, ADD_MEMORY_SUMMARY_INPUT_ID, type MemoryAddDraft } from "./AddMemoryForm.tsx";
import { MemoryRecordPeek } from "./MemoryRecordPeek.tsx";
import { MemoryRecordRow } from "./MemoryRecordRow.tsx";
import { MemorySearchHonestyNote } from "./MemorySearchHonestyNote.tsx";
import { ReviewQueuePanel, type MemoryReviewDraft } from "./ReviewQueuePanel.tsx";
import { MemoryAdminPanel } from "./MemoryAdminPanel.tsx";
import {
  MEMORY_CLASSES,
  MEMORY_SCOPES,
  downloadJson,
  extractBundle,
  filtersToBody,
  memoryKeys,
  parseImportCounts,
  parseMemoryRecords,
  parseRecordEntity,
  parseSearchEnvelope,
  parseSemanticScores,
  splitTags,
  type MemoryFilters,
  type MemoryRecord,
} from "./memory-wire.ts";
import { asRecord } from "../../lib/wire.ts";

const DEFAULT_FILTERS: MemoryFilters = { limit: 100 };

/** Review-queue poll cadence — no wire events exist for memory.* (pinned
 * upstream gap), so freshness here is poll + refetch-on-mutation. */
const REVIEW_QUEUE_POLL_MS = 30_000;

interface PendingImport {
  bundle: Record<string, unknown>;
  recordCount: number;
  linkCount: number;
  filename: string;
}

export function MemoryView(): React.ReactElement {
  return (
    <ErrorBoundary
      fallback={(error, reset) => <ErrorState error={error} onRetry={reset} title="Memory view failed" />}
    >
      <MemoryViewInner />
    </ErrorBoundary>
  );
}

function MemoryViewInner() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const peek = usePeek();

  // ── Search form drafts + applied filters ──────────────────────────────────
  const [queryText, setQueryText] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [scopeFilter, setScopeFilter] = useState("");
  const [clsFilter, setClsFilter] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [recall, setRecall] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<MemoryFilters>(DEFAULT_FILTERS);

  const [deleteTarget, setDeleteTarget] = useState<MemoryRecord | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const list = useQuery({
    queryKey: memoryKeys.list(appliedFilters),
    queryFn: async () => parseSearchEnvelope(await gv.memory.records.search(filtersToBody(appliedFilters, true))),
    retry: false,
  });

  // Similarity-score overlay: only meaningful when the server says semantic
  // ACTUALLY ran (list.data.mode) — never claim a ranking a literal scan made.
  const semanticScores = useQuery({
    queryKey: memoryKeys.semantic(appliedFilters),
    queryFn: async () =>
      parseSemanticScores(
        await gv.memory.records.searchSemantic(filtersToBody({ ...appliedFilters, semantic: false }, false)),
      ),
    enabled: Boolean(appliedFilters.semantic) && list.isSuccess && list.data.mode === "semantic",
    retry: false,
  });

  const reviewQueue = useQuery({
    queryKey: memoryKeys.reviewQueue,
    queryFn: async () =>
      parseMemoryRecords(asRecord(await gv.memory.reviewQueue({ limit: 50 }))["records"]),
    // No wire events for memory — poll while the view is mounted.
    refetchInterval: REVIEW_QUEUE_POLL_MS,
    retry: false,
  });

  const invalidateAll = useCallback(
    () => queryClient.invalidateQueries({ queryKey: memoryKeys.all }),
    [queryClient],
  );

  // ── Mutations ──────────────────────────────────────────────────────────────

  const add = useMutation({
    mutationFn: (input: MemoryAddDraft) => gv.memory.records.add(input),
    onSuccess: async (result) => {
      await invalidateAll();
      const created = parseRecordEntity(result);
      toast({ title: "Memory added", description: created?.summary, tone: "success" });
    },
  });

  const remove = useMutation({
    mutationFn: (record: MemoryRecord) => gv.memory.records.delete(record.id),
    onSuccess: async (result, record) => {
      await invalidateAll();
      // Delete-means-delete honesty: the daemon answers {deleted:false} when
      // no such record existed — never claim a phantom row was removed.
      const deleted = asRecord(result)["deleted"];
      if (deleted === false) {
        toast({ title: "Nothing deleted", description: "No record with that id existed.", tone: "warning" });
      } else {
        toast({ title: "Memory deleted", description: record.summary, tone: "info" });
      }
    },
    onError: (error: unknown) => {
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    },
  });

  const updateReview = useMutation({
    mutationFn: ({ id, input }: { id: string; input: MemoryReviewDraft }) =>
      gv.memory.records.updateReview(id, { id, ...input }),
    onSuccess: async () => {
      await invalidateAll();
      toast({ title: "Review saved", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not save the review", description: formatError(error), tone: "danger" });
    },
  });

  const exportBundle = useMutation({
    mutationFn: async () => {
      // Export takes the shared filter fields — recall is search-only and is
      // deliberately NOT forwarded (filtersToBody(…, false)).
      const result = await invoke("memory.records.export", { body: filtersToBody(appliedFilters, false) });
      return asRecord(asRecord(result)["bundle"] ?? result);
    },
    onSuccess: (bundle) => {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(`memory-bundle-${stamp}.json`, bundle);
      const meta = extractBundle(bundle);
      toast({
        title: "Bundle exported",
        description: meta ? `${meta.recordCount} records, ${meta.linkCount} links downloaded.` : undefined,
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      if (isMethodUnavailableError(error)) {
        toast({
          title: "Export not available",
          description: "This daemon does not serve memory.records.export.",
          tone: "warning",
        });
        return;
      }
      toast({ title: "Export failed", description: formatError(error), tone: "danger" });
    },
  });

  const importBundle = useMutation({
    mutationFn: (bundle: Record<string, unknown>) => invoke("memory.records.import", { body: { bundle } }),
    onSuccess: async (result) => {
      await invalidateAll();
      const counts = parseImportCounts(result);
      toast({
        title: "Bundle imported",
        description: `${counts.importedRecords} records added, ${counts.skippedRecords} skipped (ids already present), ${counts.importedLinks} links added.`,
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      if (isMethodUnavailableError(error)) {
        toast({
          title: "Import not available",
          description: "This daemon does not serve memory.records.import.",
          tone: "warning",
        });
        return;
      }
      toast({ title: "Import failed", description: formatError(error), tone: "danger" });
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const openDetail = useCallback(
    (record: MemoryRecord) => {
      peek.open({ title: record.summary, content: <MemoryRecordPeek initial={record} /> });
    },
    [peek],
  );

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const tags = splitTags(tagsInput);
    setAppliedFilters({
      limit: 100,
      ...(queryText.trim() ? { query: queryText.trim() } : {}),
      ...(semantic ? { semantic: true } : {}),
      ...(scopeFilter ? { scope: scopeFilter } : {}),
      ...(clsFilter ? { cls: clsFilter } : {}),
      ...(tags.length ? { tags } : {}),
      ...(recall ? { recall: true } : {}),
    });
  }

  function resetSearch(): void {
    setQueryText("");
    setSemantic(false);
    setScopeFilter("");
    setClsFilter("");
    setTagsInput("");
    setRecall(false);
    setAppliedFilters(DEFAULT_FILTERS);
  }

  async function handleImportFile(file: File): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast({ title: "Not a JSON file", description: `${file.name} could not be parsed.`, tone: "danger" });
      return;
    }
    const meta = extractBundle(parsed);
    if (!meta) {
      toast({
        title: "Not a memory bundle",
        description: `${file.name} has no records array — expected a memory.records.export download.`,
        tone: "danger",
      });
      return;
    }
    setPendingImport({ ...meta, filename: file.name });
  }

  // ── Palette commands (view-scoped; live only while mounted) ────────────────
  useEffect(() => {
    registerCommand({
      id: "memory.refresh",
      title: "Refresh Memory",
      group: "know",
      keywords: ["memory", "records", "reload"],
      run: () => void queryClient.invalidateQueries({ queryKey: memoryKeys.all }),
    });
    registerCommand({
      id: "memory.add",
      title: "Add Memory Record",
      group: "know",
      keywords: ["memory", "note", "remember", "fact"],
      run: () => document.getElementById(ADD_MEMORY_SUMMARY_INPUT_ID)?.focus(),
    });
    registerCommand({
      id: "memory.import",
      title: "Import Memory Bundle",
      group: "know",
      keywords: ["memory", "import", "bundle", "upload", "handoff"],
      run: () => fileInputRef.current?.click(),
    });
    return () => {
      unregisterCommand("memory.refresh");
      unregisterCommand("memory.add");
      unregisterCommand("memory.import");
    };
  }, [queryClient]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const listUnavailable = list.isError && isMethodUnavailableError(list.error);
  const recallFloor = list.data?.recallFloor;
  const scores = semanticScores.data;

  let recordsBody: ReactNode;
  if (list.isPending) {
    recordsBody = (
      <div className="memory-skeleton-group">
        <SkeletonBlock width="100%" height={40} />
        <SkeletonBlock width="100%" height={40} />
        <SkeletonBlock width="100%" height={40} />
      </div>
    );
  } else if (listUnavailable) {
    recordsBody = (
      <UnavailableState
        capability="memory.records.search"
        description="the canonical memory store cannot be browsed, searched, or edited here. Upgrade the daemon to use Memory."
      />
    );
  } else if (list.isError) {
    recordsBody = <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Search failed" />;
  } else if (list.data.records.length === 0) {
    recordsBody = (
      <EmptyState
        icon={<Database size={28} aria-hidden="true" />}
        title="No memory recorded yet"
        description="Add a memory on the right, or broaden your search filters."
      />
    );
  } else {
    recordsBody = (
      <div className="memory-record-list">
        {list.data.records.map((record) => (
          <MemoryRecordRow
            key={record.id}
            record={record}
            recallFloor={recallFloor}
            {...(scores?.has(record.id) ? { similarity: scores.get(record.id) } : {})}
            onOpen={openDetail}
            onDelete={setDeleteTarget}
            deleting={remove.isPending && remove.variables?.id === record.id}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="memory-view">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Database size={14} aria-hidden="true" /> Memory
          {list.isSuccess ? ` · ${list.data.records.length} shown` : ""}
        </span>
        <div className="memory-toolbar__actions">
          <button
            type="button"
            className="memory-button"
            onClick={() => exportBundle.mutate()}
            disabled={exportBundle.isPending}
            aria-busy={exportBundle.isPending}
            title="Export the records matching the current filters (plus their links) as a JSON bundle"
          >
            <Download size={13} aria-hidden="true" />
            {exportBundle.isPending ? "Exporting…" : "Export"}
          </button>
          <button
            type="button"
            className="memory-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importBundle.isPending}
            title="Import a memory bundle JSON file (id-keyed union — never overwrites)"
          >
            <Upload size={13} aria-hidden="true" />
            {importBundle.isPending ? "Importing…" : "Import"}
          </button>
          <button
            type="button"
            className="section-toolbar__refresh"
            aria-label="Refresh memory"
            onClick={() => void invalidateAll()}
          >
            <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="memory-import-input"
        aria-label="Choose a memory bundle JSON file to import"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleImportFile(file);
        }}
      />

      <form className="memory-search" onSubmit={submitSearch}>
        <input
          className="memory-search__query"
          value={queryText}
          onChange={(event) => setQueryText(event.target.value)}
          placeholder="Search memory (leave blank to browse everything)"
          aria-label="Search memory"
        />
        <label className="memory-check" title="Ask the semantic index; the result states which index actually answered">
          <input type="checkbox" checked={semantic} onChange={(event) => setSemantic(event.target.checked)} />
          Semantic
        </label>
        <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)} aria-label="Filter by scope">
          <option value="">Any scope</option>
          {MEMORY_SCOPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select value={clsFilter} onChange={(event) => setClsFilter(event.target.value)} aria-label="Filter by type">
          <option value="">Any type</option>
          {MEMORY_CLASSES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          className="memory-search__tags"
          value={tagsInput}
          onChange={(event) => setTagsInput(event.target.value)}
          placeholder="Tags (comma separated)"
          aria-label="Filter by tags"
        />
        <label
          className="memory-check"
          title="Apply the recall-injection contract server-side: exclude flagged records outright and drop records below the confidence floor, so this shows what the agent would actually recall."
        >
          <input type="checkbox" checked={recall} onChange={(event) => setRecall(event.target.checked)} />
          What the agent would recall
        </label>
        <button className="memory-button memory-button--primary" type="submit" disabled={list.isFetching}>
          <Search size={13} aria-hidden="true" />
          {list.isFetching ? "Searching…" : "Search"}
        </button>
        <button className="memory-button" type="button" onClick={resetSearch}>
          Reset
        </button>
      </form>

      <div aria-live="polite">
        {list.data && !listUnavailable && (
          <MemorySearchHonestyNote result={list.data} limit={appliedFilters.limit} />
        )}
        {semanticScores.isError && isMethodUnavailableError(semanticScores.error) && (
          <p className="memory-semantic-note" role="status">
            Similarity scores unavailable — this daemon does not serve <code>memory.records.search-semantic</code>;
            the ranked list above still comes from the semantic index.
          </p>
        )}
      </div>

      <div className="memory-columns">
        <section className="memory-panel memory-panel--records" aria-label="Memory records">
          <div className="memory-panel__title">
            <h2>Records</h2>
          </div>
          {recordsBody}
          {remove.isError && <ErrorState error={remove.error} title="Delete failed" />}
        </section>

        <aside className="memory-rail">
          <AddMemoryForm isPending={add.isPending} error={add.error} onSubmit={(input) => add.mutate(input)} />

          <section className="memory-panel" aria-label="Review queue">
            <div className="memory-panel__title">
              <h2>Review queue</h2>
              {reviewQueue.isSuccess && <span className="badge neutral">{reviewQueue.data.length}</span>}
            </div>
            <ReviewQueuePanel
              records={reviewQueue.data ?? []}
              isPending={reviewQueue.isPending}
              error={reviewQueue.error}
              onRetry={() => void reviewQueue.refetch()}
              savingId={updateReview.isPending ? (updateReview.variables?.id ?? null) : null}
              onSave={(id, input) => updateReview.mutate({ id, input })}
              onOpen={openDetail}
            />
          </section>

          <MemoryAdminPanel />
        </aside>
      </div>

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete memory record"
        target={deleteTarget?.summary ?? ""}
        blastRadius="Delete means delete: the record and its links are removed from the store AND the semantic index — not flagged, not archived. This cannot be undone."
        danger
        confirmLabel="Delete permanently"
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmSurface
        open={pendingImport !== null}
        action="Import memory bundle"
        target={pendingImport?.filename ?? ""}
        blastRadius={`Adds up to ${pendingImport?.recordCount ?? 0} records and ${pendingImport?.linkCount ?? 0} links to the canonical store as an id-keyed union — existing ids are left untouched (counted as skipped), nothing is overwritten or deleted, and re-running is idempotent.`}
        confirmLabel="Import"
        onConfirm={() => {
          if (pendingImport) importBundle.mutate(pendingImport.bundle);
          setPendingImport(null);
        }}
        onCancel={() => setPendingImport(null)}
      />
    </div>
  );
}
