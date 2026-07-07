// Artifacts — docs/FEATURES.md §12. Paginated artifacts.list with kind
// facets, upload (file picker → base64 → artifacts.create), and a detail
// panel with real content preview off artifacts.content.get: markdown
// renders, text/json/csv show raw (capped), images/audio/video play from a
// blob URL (plain <img src> cannot carry the required x-gv-app header, so
// bytes come through appFetch), and binaries get an honest download button.
// Promote-to-knowledge is confirm-gated knowledge.ingest.artifact (admin).
//
// Realtime: artifacts.* has no wire event domain (pinned upstream) — the
// list polls every 30s.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, RefreshCw, Upload } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { appFetch, HttpError } from "../../lib/http.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { useUrlState } from "../../lib/router.ts";
import { formatRelative, compactJson } from "../../lib/wire.ts";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  artifactFrom,
  artifactKeys,
  artifactsFromListResponse,
  createdArtifactId,
  fileToBase64,
  formatBytes,
  isTextKind,
  KIND_FACETS,
  kindOf,
  listTotalFrom,
  type ArtifactKind,
  type ArtifactRecord,
} from "./artifacts-data.ts";

const PAGE_SIZE = 50;
/** Preview cap — larger text bodies truncate with an honest note. */
const TEXT_PREVIEW_CAP = 256 * 1024;

const UPLOAD_INPUT_ID = "artifacts-upload-input";

export function ArtifactsView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { filters, setFilters } = useUrlState();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [kindFilter, setKindFilter] = useState<ArtifactKind | "">("");
  const [nameFilter, setNameFilter] = useState("");
  const [selectedId, setSelectedId] = useState(() => filters["artifact"] ?? "");
  const uploadRef = useRef<HTMLInputElement>(null);

  // artifacts.* has no wire event — poll every 30s (docs rule: comment it).
  const list = useQuery({
    queryKey: artifactKeys.list(limit),
    queryFn: () => gv.artifacts.list({ limit, offset: 0 }),
    refetchInterval: 30_000,
  });
  const records = useMemo(() => artifactsFromListResponse(list.data), [list.data]);
  const total = useMemo(() => listTotalFrom(list.data), [list.data]);

  const kindCounts = useMemo(() => {
    const counts = new Map<ArtifactKind, number>();
    for (const record of records) counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
    return counts;
  }, [records]);

  const filtered = useMemo(
    () =>
      records.filter((record) => {
        if (kindFilter && record.kind !== kindFilter) return false;
        if (nameFilter && !record.filename.toLowerCase().includes(nameFilter.toLowerCase())) return false;
        return true;
      }),
    [records, kindFilter, nameFilter],
  );

  const selected = records.find((r) => r.id === selectedId) ?? null;

  // Capability probe for the confirm-gated promote verb (sessions pattern).
  const ingestCapability = useQuery({
    queryKey: artifactKeys.capability("knowledge.ingest.artifact"),
    queryFn: () => gv.probeMethod("knowledge.ingest.artifact"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const canPromote = ingestCapability.isSuccess ? ingestCapability.data : undefined;

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const ids: string[] = [];
      for (const file of files) {
        const dataBase64 = await fileToBase64(file);
        const created = await gv.artifacts.create({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          dataBase64,
          metadata: { surface: "app", uploadedVia: "artifacts-view" },
        });
        const id = createdArtifactId(created);
        if (!id) throw new Error(`Upload of ${file.name} did not return an artifact id`);
        ids.push(id);
      }
      return ids;
    },
    onSuccess: async (ids) => {
      await queryClient.invalidateQueries({ queryKey: artifactKeys.all });
      toast({ title: `Uploaded ${ids.length} artifact${ids.length === 1 ? "" : "s"}`, tone: "success" });
      const first = ids[0];
      if (first) setSelectedId(first);
    },
    onError: (error: unknown) => toast({ title: "Upload failed", description: formatError(error), tone: "danger" }),
  });

  useEffect(() => {
    registerCommand({
      id: "artifacts.upload",
      title: "Artifacts: upload files",
      group: "know",
      keywords: ["upload", "file", "artifact"],
      run: () => document.getElementById(UPLOAD_INPUT_ID)?.click(),
    });
    registerCommand({
      id: "artifacts.refresh",
      title: "Artifacts: refresh list",
      group: "know",
      keywords: ["artifacts", "reload"],
      run: () => void queryClient.invalidateQueries({ queryKey: artifactKeys.all }),
    });
    return () => {
      unregisterCommand("artifacts.upload");
      unregisterCommand("artifacts.refresh");
    };
  }, [queryClient]);

  function select(id: string): void {
    const next = selectedId === id ? "" : id;
    setSelectedId(next);
    // Keep the peeked artifact deep-linkable (?filter[artifact]=id).
    setFilters({ artifact: next || undefined }, { replace: true });
  }

  const unavailable = list.isError && isMethodUnavailableError(list.error);
  const canLoadMore = total !== undefined ? records.length < total : records.length >= limit;

  return (
    <div className="artifacts-view">
      <section className="artifacts-list-pane" aria-label="Artifacts">
        <div className="section-toolbar">
          <span className="section-toolbar__summary">
            <Archive size={14} aria-hidden="true" /> Artifacts
            {list.isSuccess ? ` · ${records.length}${total !== undefined ? ` of ${total}` : ""}` : ""}
          </span>
          <div className="artifacts-toolbar-actions">
            <button
              type="button"
              className="artifacts-upload-button"
              onClick={() => uploadRef.current?.click()}
              disabled={upload.isPending || unavailable}
            >
              <Upload size={14} aria-hidden="true" /> {upload.isPending ? "Uploading…" : "Upload"}
            </button>
            <button
              type="button"
              className="section-toolbar__refresh"
              aria-label="Refresh artifacts"
              onClick={() => void list.refetch()}
            >
              <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
            </button>
          </div>
          <input
            ref={uploadRef}
            id={UPLOAD_INPUT_ID}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) upload.mutate(files);
            }}
          />
        </div>

        <div className="artifacts-filters">
          <input
            type="search"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="Filter by filename…"
            aria-label="Filter artifacts by filename"
          />
          <div className="artifacts-facets" role="group" aria-label="Kind facets">
            <button
              type="button"
              className={kindFilter === "" ? "artifacts-facet artifacts-facet--active" : "artifacts-facet"}
              onClick={() => setKindFilter("")}
            >
              all
            </button>
            {KIND_FACETS.filter((kind) => (kindCounts.get(kind) ?? 0) > 0).map((kind) => (
              <button
                key={kind}
                type="button"
                className={kindFilter === kind ? "artifacts-facet artifacts-facet--active" : "artifacts-facet"}
                onClick={() => setKindFilter((current) => (current === kind ? "" : kind))}
              >
                {kind} <span className="artifacts-facet__count">{kindCounts.get(kind)}</span>
              </button>
            ))}
          </div>
        </div>

        {list.isPending && <SkeletonBlock variant="text" lines={6} />}
        {unavailable && (
          <UnavailableState
            capability="artifacts.list"
            description="artifacts cannot be browsed or uploaded from this app."
          />
        )}
        {list.isError && !unavailable && (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load artifacts" />
        )}
        {list.isSuccess && filtered.length === 0 && (
          <EmptyState
            icon={<Archive size={28} aria-hidden="true" />}
            title={records.length === 0 ? "No artifacts" : "Nothing matches the filters"}
            description={
              records.length === 0
                ? "Files created by chats, reports, and uploads land here."
                : "Clear the kind facet or filename filter to see the rest."
            }
          />
        )}

        {filtered.length > 0 && (
          <ul className="artifacts-rows">
            {filtered.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  className={selectedId === record.id ? "artifact-row artifact-row--active" : "artifact-row"}
                  onClick={() => select(record.id)}
                  aria-expanded={selectedId === record.id}
                >
                  <span className="artifact-row__name">{record.filename}</span>
                  <span className="artifact-row__meta">
                    <span className={`badge ${record.kind === "other" ? "neutral" : "info"}`}>{record.kind}</span>
                    {record.mimeType && <span className="artifact-row__mime">{record.mimeType}</span>}
                    {formatBytes(record.sizeBytes) && <span>{formatBytes(record.sizeBytes)}</span>}
                    {record.createdAt !== undefined && <span>{formatRelative(record.createdAt)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {list.isSuccess && records.length > 0 && canLoadMore && (
          <button
            type="button"
            className="artifacts-load-more"
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
            disabled={list.isFetching}
          >
            {list.isFetching ? "Loading…" : "Load more"}
          </button>
        )}
      </section>

      <section className="artifacts-detail-pane" aria-label="Artifact detail">
        {selected ? (
          <ArtifactDetail key={selected.id} record={selected} canPromote={canPromote} />
        ) : (
          <EmptyState
            icon={<Archive size={28} aria-hidden="true" />}
            title="Pick an artifact"
            description="Select a row to preview its content — markdown, code, images, audio, and video render in place."
          />
        )}
      </section>
    </div>
  );
}

// ─── Detail + content preview ────────────────────────────────────────────────

type ContentState =
  | { phase: "loading" }
  | { phase: "error"; error: unknown }
  | { phase: "text"; text: string; truncated: boolean }
  | { phase: "media"; url: string; mime: string }
  | { phase: "binary"; url: string; mime: string };

function ArtifactDetail({ record, canPromote }: { record: ArtifactRecord; canPromote: boolean | undefined }) {
  const { toast } = useToast();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [content, setContent] = useState<ContentState>({ phase: "loading" });

  const detail = useQuery({
    queryKey: artifactKeys.detail(record.id),
    queryFn: () => gv.artifacts.get(record.id),
  });
  const meta = useMemo(() => (detail.data ? artifactFrom(detail.data) : record), [detail.data, record]);

  // Content bytes are fetched imperatively (not via TanStack) so blob object
  // URLs get a clear create/revoke lifecycle tied to this component.
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setContent({ phase: "loading" });
    (async () => {
      try {
        const path = gv.artifacts.contentPath(record.id);
        const res = await appFetch(path, { signal: controller.signal });
        if (!res.ok) {
          throw new HttpError(res.status, path, await res.text().catch(() => ""));
        }
        const mime = res.headers.get("content-type") || record.mimeType || "application/octet-stream";
        const kind = kindOf(mime, record.filename);
        if (isTextKind(kind)) {
          const text = await res.text();
          if (controller.signal.aborted) return;
          setContent({
            phase: "text",
            text: text.length > TEXT_PREVIEW_CAP ? text.slice(0, TEXT_PREVIEW_CAP) : text,
            truncated: text.length > TEXT_PREVIEW_CAP,
          });
          return;
        }
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        if (kind === "image" || kind === "audio" || kind === "video" || kind === "pdf") {
          setContent({ phase: "media", url: objectUrl, mime });
        } else {
          setContent({ phase: "binary", url: objectUrl, mime });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setContent({ phase: "error", error });
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [record.id, record.mimeType, record.filename]);

  const promote = useMutation({
    mutationFn: (vars: { artifactId: string; confirm: true; explicitUserRequest: true }) =>
      gv.invoke("knowledge.ingest.artifact", { body: vars }),
    onSuccess: () => {
      setPromoteOpen(false);
      toast({ title: "Sent to Knowledge", description: "The artifact is being ingested.", tone: "success" });
    },
    onError: (error: unknown) => {
      const description = isMethodUnavailableError(error)
        ? "knowledge.ingest.artifact is not available on this daemon."
        : formatError(error);
      toast({ title: "Promote failed", description, tone: "danger" });
    },
  });

  function downloadCurrent(): void {
    if (content.phase === "media" || content.phase === "binary") {
      triggerDownload(content.url, meta.filename);
      return;
    }
    if (content.phase === "text") {
      const url = URL.createObjectURL(new Blob([content.text], { type: meta.mimeType || "text/plain" }));
      triggerDownload(url, meta.filename);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }

  const previewKind = kindOf(
    content.phase === "media" || content.phase === "binary" ? content.mime : meta.mimeType,
    meta.filename,
  );

  return (
    <div className="artifact-detail">
      <header className="artifact-detail__header">
        <h2 className="artifact-detail__title">{meta.filename}</h2>
        <div className="artifact-detail__actions">
          <button
            type="button"
            onClick={downloadCurrent}
            disabled={content.phase === "loading" || content.phase === "error"}
          >
            <Download size={14} aria-hidden="true" /> Download
          </button>
          <button
            type="button"
            onClick={() => setPromoteOpen(true)}
            disabled={canPromote === false}
            title={
              canPromote === false ? "knowledge.ingest.artifact is not available on this daemon" : undefined
            }
          >
            Promote to Knowledge
          </button>
        </div>
      </header>

      <dl className="artifact-detail__facts">
        <dt>Id</dt>
        <dd>
          <code>{meta.id}</code>
        </dd>
        <dt>Type</dt>
        <dd>
          {meta.mimeType || "unknown"} <span className="badge neutral">{meta.kind}</span>
        </dd>
        {formatBytes(meta.sizeBytes) && (
          <>
            <dt>Size</dt>
            <dd>{formatBytes(meta.sizeBytes)}</dd>
          </>
        )}
        {meta.createdAt !== undefined && (
          <>
            <dt>Created</dt>
            <dd>{formatRelative(meta.createdAt)}</dd>
          </>
        )}
        {Object.keys(meta.metadata).length > 0 && (
          <>
            <dt>Metadata</dt>
            <dd>
              <pre className="artifact-detail__metadata">{compactJson(meta.metadata)}</pre>
            </dd>
          </>
        )}
      </dl>
      {detail.isError && (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="Metadata fetch failed" />
      )}

      <div className="artifact-preview">
        {content.phase === "loading" && <SkeletonBlock height={160} />}
        {content.phase === "error" &&
          (isMethodUnavailableError(content.error) ? (
            <UnavailableState
              capability="artifacts.content.get"
              description="artifact bytes cannot be fetched, so no preview or download."
            />
          ) : (
            <ErrorState error={content.error} title="Content fetch failed" />
          ))}
        {content.phase === "text" && (
          <>
            {content.truncated && (
              <p className="artifact-preview__note" role="status">
                Showing the first {Math.round(TEXT_PREVIEW_CAP / 1024)} KB — download for the full file.
              </p>
            )}
            {previewKind === "markdown" ? (
              <div className="artifact-preview__markdown">
                <MarkdownMessage content={content.text} />
              </div>
            ) : (
              <pre className="artifact-preview__text">{content.text}</pre>
            )}
          </>
        )}
        {content.phase === "media" && previewKind === "image" && (
          <img className="artifact-preview__image" src={content.url} alt={meta.filename} />
        )}
        {content.phase === "media" && previewKind === "audio" && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio className="artifact-preview__audio" src={content.url} controls aria-label={meta.filename} />
        )}
        {content.phase === "media" && previewKind === "video" && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video className="artifact-preview__video" src={content.url} controls aria-label={meta.filename} />
        )}
        {content.phase === "media" && previewKind === "pdf" && (
          <object className="artifact-preview__pdf" data={content.url} type="application/pdf" aria-label={meta.filename}>
            <p className="artifact-preview__note">
              Inline PDF rendering is not available in this webview — use Download.
            </p>
          </object>
        )}
        {content.phase === "binary" && (
          <p className="artifact-preview__note" role="status">
            No inline preview for {content.mime || "this binary"} — use Download.
          </p>
        )}
      </div>

      <ConfirmSurface
        open={promoteOpen}
        action="Ingest artifact into Knowledge"
        target={`${meta.filename} (${meta.id})`}
        blastRadius="The daemon reads this artifact's content and adds it to the shared knowledge base used by every surface. Admin-scoped."
        confirmLabel="Ingest artifact"
        onCancel={() => setPromoteOpen(false)}
        onConfirm={(confirmMeta) => promote.mutate({ artifactId: meta.id, ...confirmMeta })}
      />
    </div>
  );
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
