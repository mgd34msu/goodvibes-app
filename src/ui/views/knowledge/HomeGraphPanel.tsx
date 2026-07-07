// Home-graph tab: the Home Assistant integration mirror of the wiki
// (docs/FEATURES.md §6 rows 21-22, `homeassistant.homeGraph.*`, 25 wire
// methods — docs/GAPS.md gap #2). Shapes below are read straight off the
// SDK's own d.ts (node_modules/@pellux/goodvibes-sdk/dist/platform/knowledge/
// home-graph/{types,service}.d.ts) rather than guessed field names.
//
// Capability-honesty at the panel level: `status` is probed once; when it
// 404s the whole tab renders a single UnavailableState ("HA integration not
// configured on this daemon") instead of 25 broken buttons. When status
// succeeds, every section below still uses its own QueryStates/mutation
// error handling — an individual sub-method can still be missing on a build
// that otherwise has the integration (wire-or-delete: each is invoked for
// real, honesty renders per-method when one of them specifically 404s).
//
// All access:"admin" routes here go through the single shared
// PendingConfirmSurface (confirm:true + explicitUserRequest). `reset` is the
// one `dangerous:true` route — danger styling + typed confirmation.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  Compass,
  FileText,
  Link as LinkIcon,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import type { ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  DataBlock,
  FactGrid,
  JsonParamsField,
  parseJsonParams,
  PendingConfirmSurface,
  QueryStates,
  type PendingAction,
} from "./KnowledgeBits.tsx";
import { KNOWLEDGE_PREFIX, kKeys, graphId, graphTitle, scalarEntries } from "./lib.ts";

const HG = "homeassistant.homeGraph";

// ─── Availability probe (mirrors KnowledgeView's useAgentScopeProbe) ────────

function useHomeGraphProbe() {
  const probe = useQuery({
    queryKey: kKeys.homeGraphProbe,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      try {
        return await invoke(`${HG}.status`);
      } catch (error) {
        if (isMethodUnavailableError(error)) return null;
        throw error;
      }
    },
  });
  return probe;
}

// ─── Ask & Browse ────────────────────────────────────────────────────────────

function AskSection({ onOpenItem }: { onOpenItem: (title: string, record: unknown) => void }) {
  const [query, setQuery] = useState("");
  const ask = useMutation({
    mutationFn: (text: string) =>
      invoke(`${HG}.askHomeGraph`, {
        body: { query: text, limit: 10, includeSources: true, includeConfidence: true, includeLinkedObjects: true },
      }),
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    const text = query.trim();
    if (!text || ask.isPending) return;
    ask.mutate(text);
  }

  const answer = asRecord(asRecord(ask.data)["answer"]);
  const answerText = firstString(answer, ["text"]);
  const confidence = firstNumber(answer, ["confidence"]);
  const sources = firstArray(answer, ["sources"]);
  const linkedObjects = firstArray(answer, ["linkedObjects"]);

  return (
    <section className="knowledge-panel" aria-label="Ask home graph">
      <header className="knowledge-panel__head">
        <h3>Ask</h3>
        <Brain size={16} aria-hidden="true" />
      </header>
      <form className="knowledge-ask__form" onSubmit={submit}>
        <input
          className="knowledge-ask__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about entities, devices, areas, automations…"
          aria-label="Ask the home graph a question"
        />
        <button type="submit" className="knowledge-button knowledge-button--primary" disabled={ask.isPending || !query.trim()}>
          {ask.isPending ? "Asking…" : "Ask"}
        </button>
      </form>
      {ask.isPending && <SkeletonBlock variant="text" lines={3} />}
      {ask.isError &&
        (isMethodUnavailableError(ask.error) ? (
          <UnavailableState capability={`${HG}.askHomeGraph`} description="grounded home-graph answers are not served." />
        ) : (
          <ErrorState error={ask.error} onRetry={() => query.trim() && ask.mutate(query.trim())} title="Ask failed" />
        ))}
      {ask.isSuccess && (
        <div className="knowledge-answer" aria-label="Answer">
          <header className="knowledge-answer__head">
            <h4>Answer</h4>
            {confidence !== undefined && <span className="badge neutral">confidence {(confidence * 100).toFixed(0)}%</span>}
          </header>
          {answerText ? <p>{answerText}</p> : <DataBlock title="Raw response" value={ask.data} open />}
          {sources.length > 0 && (
            <ul className="knowledge-answer__citations">
              {sources.map((source, index) => {
                const id = graphId(source);
                const title = graphTitle(source, `Source ${index + 1}`);
                return (
                  <li key={id || index}>
                    <button type="button" className="knowledge-link" onClick={() => onOpenItem(title, source)}>
                      {title}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {linkedObjects.length > 0 && <DataBlock title={`Linked objects (${linkedObjects.length})`} value={linkedObjects} />}
        </div>
      )}
    </section>
  );
}

function BrowseSection() {
  const browse = useQuery({
    queryKey: kKeys.homeGraphSources, // browse returns nodes/edges/sources/issues together; keyed with sources
    queryFn: () => invoke(`${HG}.browse`, { query: { limit: 200 } }),
  });
  const nodes = firstArray(browse.data, ["nodes"]);
  const sources = firstArray(browse.data, ["sources"]);
  const edges = firstArray(browse.data, ["edges"]);

  return (
    <section className="knowledge-panel" aria-label="Browse home graph">
      <header className="knowledge-panel__head">
        <h3>Browse</h3>
        <Compass size={16} aria-hidden="true" />
      </header>
      <QueryStates
        query={browse}
        capability={`${HG}.browse`}
        unavailableDescription="the home-graph namespace cannot be browsed."
        isEmpty={nodes.length === 0 && sources.length === 0}
        empty={
          <EmptyState
            icon={<Compass size={24} aria-hidden="true" />}
            title="Home graph is empty"
            description="Sync a snapshot to populate entities, devices, areas, and automations."
          />
        }
      >
        <p className="knowledge-hint">
          {nodes.length} node{nodes.length === 1 ? "" : "s"} · {edges.length} edge{edges.length === 1 ? "" : "s"} ·{" "}
          {sources.length} source{sources.length === 1 ? "" : "s"}
        </p>
        <ul className="knowledge-records">
          {nodes.slice(0, 100).map((node, index) => {
            const record = asRecord(node);
            const kind = firstString(record, ["kind", "recordKind"]) || "node";
            const title = graphTitle(record, `Node ${index + 1}`);
            return (
              <li key={graphId(record) || index} className="knowledge-records__row">
                <span className="knowledge-records__head">
                  <strong>{title}</strong>
                  <span className="badge neutral">{kind}</span>
                </span>
              </li>
            );
          })}
        </ul>
        {nodes.length > 100 && <p className="knowledge-hint">Showing the first 100 of {nodes.length} nodes.</p>}
      </QueryStates>
    </section>
  );
}

// ─── Map & pages ─────────────────────────────────────────────────────────────

function MapPagesSection({ onOpenItem }: { onOpenItem: (title: string, record: unknown) => void }) {
  const map = useMutation({ mutationFn: () => invoke(`${HG}.map`, { body: { limit: 200, includeSources: true, includeIssues: true } }) });
  const pages = useQuery({
    queryKey: kKeys.homeGraphPages,
    queryFn: () => invoke(`${HG}.pages.list`, { query: { limit: 100 } }),
  });
  const pageItems = firstArray(pages.data, ["pages"]);

  return (
    <div className="knowledge-two-col">
      <section className="knowledge-panel" aria-label="Home graph map">
        <header className="knowledge-panel__head">
          <h3>Map</h3>
          <Compass size={16} aria-hidden="true" />
        </header>
        <button type="button" className="knowledge-button" disabled={map.isPending} onClick={() => map.mutate()}>
          {map.isPending ? "Loading…" : "Load map"}
        </button>
        {map.isError &&
          (isMethodUnavailableError(map.error) ? (
            <UnavailableState capability={`${HG}.map`} description="the home-graph visual map is not served." />
          ) : (
            <ErrorState error={map.error} onRetry={() => map.mutate()} title="Map failed" />
          ))}
        {map.isSuccess && (
          <>
            <p className="knowledge-hint">
              {firstArray(map.data, ["nodes"]).length} node(s) · {firstArray(map.data, ["edges"]).length} edge(s)
            </p>
            <DataBlock title="Map result" value={map.data} />
          </>
        )}
      </section>
      <section className="knowledge-panel" aria-label="Generated pages">
        <header className="knowledge-panel__head">
          <h3>Pages</h3>
          <FileText size={16} aria-hidden="true" />
        </header>
        <QueryStates
          query={pages}
          capability={`${HG}.pages.list`}
          unavailableDescription="generated device/room pages are not served."
          isEmpty={pageItems.length === 0}
          empty={<EmptyState title="No generated pages" description="Device passports and room pages appear here once generated." />}
        >
          <ul className="knowledge-records">
            {pageItems.map((page, index) => {
              const record = asRecord(page);
              const source = asRecord(record["source"]);
              const id = graphId(source);
              const title = graphTitle(source, `Page ${index + 1}`);
              return (
                <li key={id || index}>
                  <button
                    type="button"
                    className="knowledge-records__row knowledge-records__row--button"
                    onClick={() => onOpenItem(title, page)}
                  >
                    <strong>{title}</strong>
                  </button>
                </li>
              );
            })}
          </ul>
        </QueryStates>
      </section>
    </div>
  );
}

// ─── Sources & issues ────────────────────────────────────────────────────────

function SourcesIssuesSection({
  onOpenItem,
  requestConfirm,
}: {
  onOpenItem: (title: string, record: unknown) => void;
  requestConfirm: (action: PendingAction) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sources = useQuery({ queryKey: kKeys.homeGraphSources, queryFn: () => invoke(`${HG}.sources.list`, { query: { limit: 100 } }) });
  const issues = useQuery({ queryKey: kKeys.homeGraphIssues, queryFn: () => invoke(`${HG}.listHomeGraphIssues`, { query: { limit: 100 } }) });

  const review = useMutation({
    mutationFn: ({ issueId, action, meta }: { issueId: string; action: "accept" | "reject" | "resolve" | "forget"; meta: ConfirmMetadata }) =>
      invoke(`${HG}.reviewHomeGraphFact`, { body: { issueId, action, ...meta } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: kKeys.homeGraphIssues });
      toast({ title: "Fact reviewed", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Review failed", description: formatError(error), tone: "danger" }),
  });

  const sourceItems = firstArray(sources.data, ["sources"]);
  const issueItems = firstArray(issues.data, ["issues"]);

  return (
    <div className="knowledge-two-col">
      <section className="knowledge-panel" aria-label="Home graph sources">
        <header className="knowledge-panel__head">
          <h3>Sources</h3>
          <BookOpen size={16} aria-hidden="true" />
        </header>
        <QueryStates
          query={sources}
          capability={`${HG}.sources.list`}
          unavailableDescription="home-graph sources cannot be listed."
          isEmpty={sourceItems.length === 0}
          empty={<EmptyState title="No sources" description="Sync a snapshot to create the first source." />}
        >
          <ul className="knowledge-records">
            {sourceItems.map((item, index) => {
              const id = graphId(item);
              const title = graphTitle(item, `Source ${index + 1}`);
              const status = firstString(item, ["status"]) || "unknown";
              return (
                <li key={id || index}>
                  <button
                    type="button"
                    className="knowledge-records__row knowledge-records__row--button"
                    onClick={() => onOpenItem(title, item)}
                  >
                    <span className="knowledge-records__head">
                      <strong>{title}</strong>
                      <StatusBadge value={status} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </QueryStates>
      </section>
      <section className="knowledge-panel" aria-label="Home graph issues">
        <header className="knowledge-panel__head">
          <h3>Issues</h3>
          <AlertTriangle size={16} aria-hidden="true" />
        </header>
        <QueryStates
          query={issues}
          capability={`${HG}.listHomeGraphIssues`}
          unavailableDescription="home-graph quality issues cannot be listed."
          isEmpty={issueItems.length === 0}
          empty={<EmptyState title="No open issues" description="Quality issues appear when the home graph finds something to repair." />}
        >
          <ul className="knowledge-records">
            {issueItems.map((item, index) => {
              const id = graphId(item);
              const message = firstString(item, ["message", "summary"]) || `Issue ${index + 1}`;
              const severity = firstString(item, ["severity"]) || "unknown";
              return (
                <li key={id || index} className="knowledge-records__row">
                  <span className="knowledge-records__head">
                    <strong>{message}</strong>
                    <StatusBadge value={severity} />
                  </span>
                  {id && (
                    <span className="knowledge-schedules__actions">
                      <button
                        type="button"
                        className="knowledge-button"
                        disabled={review.isPending}
                        onClick={() =>
                          requestConfirm({
                            action: "Accept home-graph fact",
                            target: message,
                            blastRadius: "Marks this fact reviewed and accepted; it stops appearing as an open issue.",
                            run: (meta) => review.mutate({ issueId: id, action: "accept", meta }),
                          })
                        }
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="knowledge-button knowledge-button--danger"
                        disabled={review.isPending}
                        onClick={() =>
                          requestConfirm({
                            action: "Reject home-graph fact",
                            target: message,
                            blastRadius: "Marks this fact reviewed and rejected.",
                            danger: true,
                            run: (meta) => review.mutate({ issueId: id, action: "reject", meta }),
                          })
                        }
                      >
                        Reject
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </QueryStates>
      </section>
    </div>
  );
}

// ─── Ingest & link ───────────────────────────────────────────────────────────

function IngestSection({ requestConfirm }: { requestConfirm: (action: PendingAction) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [artifactId, setArtifactId] = useState("");
  const [linkTargetKind, setLinkTargetKind] = useState("entity");
  const [linkTargetId, setLinkTargetId] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });

  const ingestUrl = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${HG}.ingestHomeGraphUrl`, { body: { url: url.trim(), ...meta } }),
    onSuccess: async () => {
      setUrl("");
      await invalidate();
      toast({ title: "URL ingested into home graph", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Ingest failed", description: formatError(error), tone: "danger" }),
  });

  const ingestNote = useMutation({
    mutationFn: (meta: ConfirmMetadata) =>
      invoke(`${HG}.ingestHomeGraphNote`, { body: { title: noteTitle.trim() || undefined, body: noteBody.trim(), ...meta } }),
    onSuccess: async () => {
      setNoteTitle("");
      setNoteBody("");
      await invalidate();
      toast({ title: "Note ingested into home graph", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Ingest failed", description: formatError(error), tone: "danger" }),
  });

  const ingestArtifact = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${HG}.ingestHomeGraphArtifact`, { body: { artifactId: artifactId.trim(), ...meta } }),
    onSuccess: async () => {
      setArtifactId("");
      await invalidate();
      toast({ title: "Artifact ingested into home graph", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Ingest failed", description: formatError(error), tone: "danger" }),
  });

  const link = useMutation({
    mutationFn: ({ id, kind, meta }: { id: string; kind: string; meta: ConfirmMetadata }) =>
      invoke(`${HG}.linkHomeGraphKnowledge`, { body: { target: { kind, id }, ...meta } }),
    onSuccess: async () => {
      setLinkTargetId("");
      await invalidate();
      toast({ title: "Linked to knowledge", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Link failed", description: formatError(error), tone: "danger" }),
  });

  const unlink = useMutation({
    mutationFn: ({ id, kind, meta }: { id: string; kind: string; meta: ConfirmMetadata }) =>
      invoke(`${HG}.unlinkHomeGraphKnowledge`, { body: { target: { kind, id }, ...meta } }),
    onSuccess: async () => {
      setLinkTargetId("");
      await invalidate();
      toast({ title: "Unlinked", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Unlink failed", description: formatError(error), tone: "danger" }),
  });

  return (
    <div className="knowledge-two-col">
      <section className="knowledge-panel" aria-label="Ingest into home graph">
        <header className="knowledge-panel__head">
          <h3>Ingest</h3>
          <Upload size={16} aria-hidden="true" />
        </header>
        <form
          className="knowledge-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!url.trim() || ingestUrl.isPending) return;
            requestConfirm({
              action: "Ingest URL into home graph",
              target: url.trim(),
              blastRadius: "Fetches this URL and adds it as a source in the home-graph knowledge space.",
              run: (meta) => ingestUrl.mutate(meta),
            });
          }}
        >
          <label>
            URL
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </label>
          <button type="submit" className="knowledge-button knowledge-button--primary" disabled={!url.trim() || ingestUrl.isPending}>
            {ingestUrl.isPending ? "Ingesting…" : "Ingest URL"}
          </button>
        </form>
        <form
          className="knowledge-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!noteBody.trim() || ingestNote.isPending) return;
            requestConfirm({
              action: "Ingest note into home graph",
              target: noteTitle.trim() || "(untitled note)",
              blastRadius: "Adds this note as a source in the home-graph knowledge space.",
              run: (meta) => ingestNote.mutate(meta),
            });
          }}
        >
          <label>
            Note title (optional)
            <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
          </label>
          <label>
            Note
            <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={3} />
          </label>
          <button type="submit" className="knowledge-button" disabled={!noteBody.trim() || ingestNote.isPending}>
            {ingestNote.isPending ? "Ingesting…" : "Ingest note"}
          </button>
        </form>
        <form
          className="knowledge-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!artifactId.trim() || ingestArtifact.isPending) return;
            requestConfirm({
              action: "Ingest artifact into home graph",
              target: artifactId.trim(),
              blastRadius: "Extracts this artifact and adds it as a source in the home-graph knowledge space.",
              run: (meta) => ingestArtifact.mutate(meta),
            });
          }}
        >
          <label>
            Artifact id
            <input value={artifactId} onChange={(e) => setArtifactId(e.target.value)} placeholder="artifact id" />
          </label>
          <button type="submit" className="knowledge-button" disabled={!artifactId.trim() || ingestArtifact.isPending}>
            {ingestArtifact.isPending ? "Ingesting…" : "Ingest artifact"}
          </button>
        </form>
      </section>
      <section className="knowledge-panel" aria-label="Link home graph to knowledge">
        <header className="knowledge-panel__head">
          <h3>Link / unlink</h3>
          <LinkIcon size={16} aria-hidden="true" />
        </header>
        <form className="knowledge-form">
          <label>
            Target kind
            <select value={linkTargetKind} onChange={(e) => setLinkTargetKind(e.target.value)}>
              {["entity", "device", "area", "automation", "script", "scene", "room"].map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target id
            <input value={linkTargetId} onChange={(e) => setLinkTargetId(e.target.value)} placeholder="entity/device/area id" />
          </label>
          <div className="knowledge-form__split">
            <button
              type="button"
              className="knowledge-button knowledge-button--primary"
              disabled={!linkTargetId.trim() || link.isPending}
              onClick={() =>
                requestConfirm({
                  action: "Link home graph to knowledge",
                  target: `${linkTargetKind}:${linkTargetId.trim()}`,
                  blastRadius: "Creates a knowledge-graph edge linking this home-graph object to the wiki knowledge store.",
                  run: (meta) => link.mutate({ id: linkTargetId.trim(), kind: linkTargetKind, meta }),
                })
              }
            >
              Link
            </button>
            <button
              type="button"
              className="knowledge-button"
              disabled={!linkTargetId.trim() || unlink.isPending}
              onClick={() =>
                requestConfirm({
                  action: "Unlink home graph from knowledge",
                  target: `${linkTargetKind}:${linkTargetId.trim()}`,
                  blastRadius: "Removes the link edge (and its materialized node if nothing else references it). A no-op if never linked.",
                  run: (meta) => unlink.mutate({ id: linkTargetId.trim(), kind: linkTargetKind, meta }),
                })
              }
            >
              Unlink
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

// ─── Maintenance: sync / reindex / device passport / room page / packet / reset

function MaintenanceSection({ requestConfirm }: { requestConfirm: (action: PendingAction) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [projectionParams, setProjectionParams] = useState("{}");
  const [importDraft, setImportDraft] = useState("{}");
  const [lastResult, setLastResult] = useState<{ label: string; value: unknown } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });

  const sync = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${HG}.syncHomeGraph`, { body: { ...meta } }),
    onSuccess: async (result) => {
      setLastResult({ label: "Sync", value: result });
      await invalidate();
      toast({ title: "Home graph synced", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Sync failed", description: formatError(error), tone: "danger" }),
  });

  const reindex = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${HG}.reindex`, { body: { ...meta } }),
    onSuccess: async (result) => {
      setLastResult({ label: "Reindex", value: result });
      await invalidate();
      toast({ title: "Home graph reindexed", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Reindex failed", description: formatError(error), tone: "danger" }),
  });

  const passport = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${HG}.refreshDevicePassport`, { body: { ...parseJsonParams(projectionParams), ...meta } }),
    onSuccess: async (result) => {
      setLastResult({ label: "Device passport", value: result });
      await invalidate();
      toast({ title: "Device passport refreshed", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Device passport failed", description: formatError(error), tone: "danger" }),
  });

  const roomPage = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${HG}.generateRoomPage`, { body: { ...parseJsonParams(projectionParams), ...meta } }),
    onSuccess: async (result) => {
      setLastResult({ label: "Room page", value: result });
      await invalidate();
      toast({ title: "Room page generated", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Room page failed", description: formatError(error), tone: "danger" }),
  });

  const packet = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${HG}.generateHomeGraphPacket`, { body: { ...parseJsonParams(projectionParams), ...meta } }),
    onSuccess: async (result) => {
      setLastResult({ label: "Packet", value: result });
      toast({ title: "Home graph packet generated", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Packet failed", description: formatError(error), tone: "danger" }),
  });

  const reset = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${HG}.reset`, { body: { ...meta } }),
    onSuccess: async (result) => {
      setLastResult({ label: "Reset", value: result });
      await invalidate();
      toast({ title: "Home graph space reset", tone: "warning" });
    },
    onError: (error: unknown) => toast({ title: "Reset failed", description: formatError(error), tone: "danger" }),
  });

  const exportSpace = useMutation({
    mutationFn: () => invoke(`${HG}.export`, { body: {} }),
    onSuccess: (result) => {
      setLastResult({ label: "Export", value: result });
      setImportDraft(JSON.stringify(result, null, 2));
      toast({ title: "Home graph exported", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Export failed", description: formatError(error), tone: "danger" }),
  });

  const importSpace = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${HG}.import`, { body: { data: parseJsonParams(importDraft), ...meta } }),
    onSuccess: async (result) => {
      setLastResult({ label: "Import", value: result });
      await invalidate();
      toast({ title: "Home graph imported", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Import failed", description: formatError(error), tone: "danger" }),
  });

  return (
    <section className="knowledge-panel" aria-label="Home graph maintenance">
      <header className="knowledge-panel__head">
        <h3>Maintenance</h3>
        <RefreshCw size={16} aria-hidden="true" />
      </header>
      <div className="knowledge-maintenance">
        <button
          type="button"
          className="knowledge-button knowledge-button--primary"
          disabled={sync.isPending}
          onClick={() =>
            requestConfirm({
              action: "Sync home graph",
              target: "the connected Home Assistant installation",
              blastRadius: "Pulls a fresh snapshot (entities/devices/areas/automations) and rebuilds the home-graph knowledge nodes.",
              run: (meta) => sync.mutate(meta),
            })
          }
        >
          {sync.isPending ? "Syncing…" : "Sync snapshot"}
        </button>
        <button
          type="button"
          className="knowledge-button"
          disabled={reindex.isPending}
          onClick={() =>
            requestConfirm({
              action: "Reindex home graph",
              target: "the entire home-graph index",
              blastRadius: "Rebuilds derived indexes over all home-graph sources and nodes; queries may be stale while it runs.",
              run: (meta) => reindex.mutate(meta),
            })
          }
        >
          {reindex.isPending ? "Reindexing…" : "Reindex"}
        </button>
        <button
          type="button"
          className="knowledge-button knowledge-button--danger"
          disabled={reset.isPending}
          onClick={() =>
            requestConfirm({
              action: "Reset home graph space",
              target: "the entire home-graph knowledge space",
              blastRadius: "Deletes all home-graph sources, nodes, edges, issues, extractions, schedules, and refinement tasks for this installation. Artifacts may be preserved depending on options.",
              danger: true,
              requireTypedText: "reset",
              run: (meta) => reset.mutate(meta),
            })
          }
        >
          {reset.isPending ? "Resetting…" : "Reset space"}
        </button>
      </div>

      <JsonParamsField
        value={projectionParams}
        onChange={setProjectionParams}
        label="Projection target (JSON — e.g. {&quot;deviceId&quot;:&quot;…&quot;} or {&quot;areaId&quot;:&quot;…&quot;})"
      />
      <div className="knowledge-maintenance">
        <button
          type="button"
          className="knowledge-button"
          disabled={passport.isPending}
          onClick={() =>
            requestConfirm({
              action: "Refresh device passport",
              target: projectionParams,
              blastRadius: "Regenerates the device passport page/artifact for the targeted device.",
              run: (meta) => passport.mutate(meta),
            })
          }
        >
          {passport.isPending ? "Refreshing…" : "Refresh device passport"}
        </button>
        <button
          type="button"
          className="knowledge-button"
          disabled={roomPage.isPending}
          onClick={() =>
            requestConfirm({
              action: "Generate room page",
              target: projectionParams,
              blastRadius: "Generates a room/area page artifact for the targeted area.",
              run: (meta) => roomPage.mutate(meta),
            })
          }
        >
          {roomPage.isPending ? "Generating…" : "Generate room page"}
        </button>
        <button
          type="button"
          className="knowledge-button"
          disabled={packet.isPending}
          onClick={() =>
            requestConfirm({
              action: "Generate home-graph packet",
              target: projectionParams,
              blastRadius: "Generates a sharing packet (markdown + artifact) for the targeted device/area/room.",
              run: (meta) => packet.mutate(meta),
            })
          }
        >
          {packet.isPending ? "Generating…" : "Generate packet"}
        </button>
      </div>

      <div className="knowledge-maintenance">
        <button type="button" className="knowledge-button" disabled={exportSpace.isPending} onClick={() => exportSpace.mutate()}>
          {exportSpace.isPending ? "Exporting…" : "Export space"}
        </button>
      </div>
      <JsonParamsField value={importDraft} onChange={setImportDraft} label="Import data (JSON — a prior Export result)" />
      <button
        type="button"
        className="knowledge-button knowledge-button--danger"
        disabled={importSpace.isPending}
        onClick={() =>
          requestConfirm({
            action: "Import home graph",
            target: "the home-graph knowledge space",
            blastRadius: "Merges this exported dump's sources, nodes, edges, issues, and extractions into the current space.",
            danger: true,
            run: (meta) => importSpace.mutate(meta),
          })
        }
      >
        {importSpace.isPending ? "Importing…" : "Import space"}
      </button>

      {lastResult && <DataBlock title={`${lastResult.label} result`} value={lastResult.value} open />}
    </section>
  );
}

// ─── Refinement ──────────────────────────────────────────────────────────────

function RefinementSection({ requestConfirm }: { requestConfirm: (action: PendingAction) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const peek = usePeek();

  const tasks = useQuery({
    queryKey: kKeys.homeGraphRefinementTasks,
    queryFn: () => invoke(`${HG}.refinement.tasks.list`, { query: { limit: 100 } }),
    refetchInterval: 15_000,
  });

  const run = useMutation({
    mutationFn: (meta: ConfirmMetadata) => invoke(`${HG}.refinement.run`, { body: { ...meta } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: kKeys.homeGraphRefinementTasks });
      toast({ title: "Home-graph refinement started", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Refinement failed", description: formatError(error), tone: "danger" }),
  });

  const cancel = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      invoke(`${HG}.refinement.task.cancel`, { params: { id }, body: { ...meta } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: kKeys.homeGraphRefinementTasks });
      toast({ title: "Refinement task cancelled", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Cancel failed", description: formatError(error), tone: "danger" }),
  });

  const items = firstArray(tasks.data, ["tasks"]);

  const openTask = (id: string) =>
    peek.open({
      title: `Refinement task ${id}`,
      content: <RefinementTaskPeek taskId={id} />,
    });

  return (
    <section className="knowledge-panel" aria-label="Home graph refinement">
      <header className="knowledge-panel__head">
        <h3>Refinement</h3>
        <Sparkles size={16} aria-hidden="true" />
      </header>
      <button
        type="button"
        className="knowledge-button knowledge-button--primary"
        disabled={run.isPending}
        onClick={() =>
          requestConfirm({
            action: "Run home-graph refinement",
            target: "open home-graph knowledge gaps",
            blastRadius: "The daemon searches for and may ingest new sources to repair gaps in the home-graph store.",
            run: (meta) => run.mutate(meta),
          })
        }
      >
        {run.isPending ? "Running…" : "Run refinement"}
      </button>
      <QueryStates
        query={tasks}
        capability={`${HG}.refinement.tasks.list`}
        unavailableDescription="home-graph refinement task history is not served."
        isEmpty={items.length === 0}
        empty={<EmptyState title="No refinement tasks" description="Run refinement to scan home-graph gaps and repair them." />}
      >
        <ul className="knowledge-refine__tasks">
          {items.map((task, index) => {
            const id = graphId(task);
            const state = firstString(task, ["state", "status"]) || "unknown";
            const cancellable = ["pending", "queued", "running", "in-progress"].includes(state.toLowerCase());
            return (
              <li key={id || index} className="knowledge-refine__task">
                <button type="button" className="knowledge-link" disabled={!id} onClick={() => id && openTask(id)}>
                  <strong>{id || `Task ${index + 1}`}</strong>
                </button>
                <StatusBadge value={state} />
                {cancellable && id && (
                  <button
                    type="button"
                    className="knowledge-button"
                    disabled={cancel.isPending}
                    onClick={() =>
                      requestConfirm({
                        action: "Cancel refinement task",
                        target: id,
                        blastRadius: "Stops this background refinement task.",
                        run: (meta) => cancel.mutate({ id, meta }),
                      })
                    }
                  >
                    Cancel
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </QueryStates>
    </section>
  );
}

function RefinementTaskPeek({ taskId }: { taskId: string }) {
  const task = useQuery({
    queryKey: kKeys.homeGraphRefinementTask(taskId),
    queryFn: () => invoke(`${HG}.refinement.task.get`, { params: { id: taskId } }),
  });
  return (
    <div className="knowledge-peek-body">
      <QueryStates
        query={task}
        capability={`${HG}.refinement.task.get`}
        unavailableDescription="refinement task detail is not served."
        isEmpty={false}
        empty={null}
      >
        <DataBlock title="Task" value={task.data} open />
      </QueryStates>
    </div>
  );
}

// ─── Status header ───────────────────────────────────────────────────────────

function StatusHeader({ status }: { status: unknown }) {
  const record = asRecord(status);
  const readiness = asRecord(record["readiness"]);
  const facts = scalarEntries(record).filter(([key]) => !["ok", "capabilities"].includes(key));
  const capabilities = firstArray(record, ["capabilities"]).filter((c): c is string => typeof c === "string");
  return (
    <section className="knowledge-status" aria-label="Home graph status">
      <div className="knowledge-status__meta">
        <StatusBadge value={firstString(readiness, ["state"]) || "unknown"} />
      </div>
      <FactGrid facts={facts} />
      {capabilities.length > 0 && (
        <p className="knowledge-hint">Capabilities: {capabilities.join(", ")}</p>
      )}
    </section>
  );
}

// ─── Panel root ──────────────────────────────────────────────────────────────

export function HomeGraphPanel() {
  const peek = usePeek();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const probe = useHomeGraphProbe();

  // Home-graph sources/nodes live in a SEPARATE knowledge store from the wiki
  // (docs/research/tui-daemon-architecture.md:79 — `knowledge-home-graph.sqlite`
  // is its own database), so this can't reuse KnowledgeItemPeekBody's
  // `knowledge.item.get` call — that would query the wrong store. Every list
  // here already has the full record in hand; the peek just renders it.
  const openItem = (title: string, record: unknown) =>
    peek.open({
      title,
      content: (
        <div className="knowledge-peek-body">
          <DataBlock title="Record" value={record} open />
        </div>
      ),
    });

  if (probe.isPending) return <SkeletonBlock variant="text" lines={6} />;
  if (probe.isError) {
    return (
      <ErrorState
        error={probe.error}
        onRetry={() => void probe.refetch()}
        title="Home graph availability unknown"
      />
    );
  }
  if (probe.data === null) {
    return (
      <UnavailableState
        capability={`${HG}.status`}
        description="this daemon has no Home Assistant home-graph integration configured — every ask/browse/map/ingest/sync surface below depends on it."
      />
    );
  }

  return (
    <div className="knowledge-homegraph">
      <StatusHeader status={probe.data} />
      <div className="knowledge-two-col">
        <AskSection onOpenItem={openItem} />
        <BrowseSection />
      </div>
      <MapPagesSection onOpenItem={openItem} />
      <SourcesIssuesSection onOpenItem={openItem} requestConfirm={setPending} />
      <IngestSection requestConfirm={setPending} />
      <RefinementSection requestConfirm={setPending} />
      <MaintenanceSection requestConfirm={setPending} />
      <PendingConfirmSurface pending={pending} onCancel={() => setPending(null)} />
    </div>
  );
}
