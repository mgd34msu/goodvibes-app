// Research — docs/FEATURES.md §10. Two halves:
//  · Web search: web_search.query with a provider picker fed by
//    web_search.providers.list; ranked, source-labeled results.
//  · Research runs: the app-local /app/registries/research-runs collection —
//    create a run from a question, collect search results into findings
//    (note + credibility triage), generate a sourced markdown report as an
//    artifact (artifacts.create → reportArtifactId), and promote individual
//    sources to Knowledge via confirm-gated knowledge.ingest.url (admin).
//
// Realtime: the runs registry is app-local with no wire events — a 30s
// refetchInterval keeps other-window edits visible. Web search is on-demand.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Globe, Search, SearchCheck } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { formatError, errorCode, errorStatus, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { asRecord, firstString, formatRelative, type AnyRecord } from "../../lib/wire.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  base64FromText,
  composeReportMarkdown,
  createRun,
  CREDIBILITY_LEVELS,
  credibilityFrom,
  deleteRun,
  fetchUrlPreview,
  listRuns,
  makeLogEntry,
  rawWithCheckpoint,
  rawWithFindings,
  rawWithLog,
  reportFilename,
  researchKeys,
  RUN_STATUSES,
  runFrom,
  searchProvidersFrom,
  searchResultsFrom,
  updateRun,
  type Credibility,
  type ResearchRun,
  type SearchResult,
  type UrlPreview,
} from "./research-data.ts";

/** The app-local registry service answering 404/501 means the collection is
 * not wired on this build — honest UnavailableState, never a blank. */
function isRegistryUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 501;
}

const SEARCH_INPUT_ID = "research-web-search-input";
const NEW_RUN_INPUT_ID = "research-new-run-input";

// ─── URL inspection drawer (docs/GAPS.md §10 row 7) ──────────────────────────

interface InspectTarget {
  url: string;
  title: string;
  source: string;
}

function InspectContent({
  target,
  onAddAsFinding,
}: {
  target: InspectTarget;
  onAddAsFinding: (preview: UrlPreview) => void;
}) {
  const previewQuery = useQuery({
    queryKey: researchKeys.inspect(target.url),
    queryFn: () => fetchUrlPreview(target.url),
    staleTime: 60_000,
    retry: false,
  });

  if (previewQuery.isPending) return <SkeletonBlock variant="text" lines={5} />;

  if (previewQuery.isError) {
    const code = errorCode(previewQuery.error);
    return (
      <div className="research-inspect">
        <p className="research-inspect__error" role="alert">
          {code === "LOCAL_FETCH_PRIVATE"
            ? "Refused — this points at a localhost / private / link-local address, so the app will not fetch it."
            : formatError(previewQuery.error)}
        </p>
        {code && <span className="badge bad">{code}</span>}
        <button type="button" onClick={() => void previewQuery.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const preview = previewQuery.data;
  return (
    <div className="research-inspect">
      {preview.title && <h3 className="research-inspect__title">{preview.title}</h3>}
      <dl className="research-inspect__facts">
        <dt>Final URL</dt>
        <dd>
          <a href={preview.finalUrl} target="_blank" rel="noreferrer">
            {preview.finalUrl}
          </a>
        </dd>
        <dt>Status</dt>
        <dd>{preview.status || "—"}</dd>
        <dt>Content type</dt>
        <dd>{preview.contentType || "—"}</dd>
      </dl>
      <pre className="research-inspect__excerpt">{preview.textExcerpt || "(empty response body)"}</pre>
      <div className="research-inspect__actions">
        <button type="button" className="research-inspect__add" onClick={() => onAddAsFinding(preview)}>
          Add as finding
        </button>
      </div>
    </div>
  );
}

/** usePeek()-backed drawer for POST /app/local/fetch-preview. Shared by both
 * search results ("Inspect" on a result) and findings ("Inspect" on a
 * finding already collected into a run). */
function useUrlInspector(onAddAsFinding: (result: SearchResult) => void): {
  inspect: (target: InspectTarget) => void;
} {
  const { open, close } = usePeek();
  return {
    inspect: (target: InspectTarget) => {
      open({
        title: "Inspect URL",
        content: (
          <InspectContent
            target={target}
            onAddAsFinding={(preview) => {
              onAddAsFinding({
                title: preview.title || target.title || target.url,
                url: target.url,
                snippet: preview.textExcerpt.slice(0, 240),
                source: target.source || "inspected",
                raw: {},
              });
              close();
            }}
          />
        ),
      });
    },
  };
}

export function ResearchView() {
  const [selectedRunId, setSelectedRunId] = useState("");
  const [collectTarget, setCollectTarget] = useState<SearchResult | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<{ url: string; title: string } | null>(null);
  const [lastQuery, setLastQuery] = useState("");

  // App-local registry: no wire events — poll every 30s (comment rule).
  const runsQuery = useQuery({
    queryKey: researchKeys.runs,
    queryFn: listRuns,
    refetchInterval: 30_000,
  });
  const runs = useMemo(() => (runsQuery.data ?? []).map(runFrom).filter((r) => r.id), [runsQuery.data]);
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  // Capability probe for the confirm-gated promote verb (sessions.delete pattern).
  const ingestCapability = useQuery({
    queryKey: researchKeys.capability("knowledge.ingest.url"),
    queryFn: () => gv.probeMethod("knowledge.ingest.url"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const canPromote = ingestCapability.isSuccess ? ingestCapability.data : undefined;

  // URL inspection (docs/GAPS.md §10 row 7) — a shared peek-panel drawer,
  // wired from both the search results list and any run's findings list.
  // Its "Add as finding" shortcut feeds the same CollectModal used by
  // "Collect into run" below.
  const { inspect } = useUrlInspector((result) => setCollectTarget(result));

  // Palette commands live only while the view is mounted.
  useEffect(() => {
    registerCommand({
      id: "research.focusSearch",
      title: "Research: focus web search",
      group: "know",
      keywords: ["web", "search", "query"],
      run: () => document.getElementById(SEARCH_INPUT_ID)?.focus(),
    });
    registerCommand({
      id: "research.newRun",
      title: "Research: start a new run",
      group: "know",
      keywords: ["research", "run", "question"],
      run: () => document.getElementById(NEW_RUN_INPUT_ID)?.focus(),
    });
    return () => {
      unregisterCommand("research.focusSearch");
      unregisterCommand("research.newRun");
    };
  }, []);

  return (
    <div className="research-view">
      <WebSearchSection
        onCollect={(result) => setCollectTarget(result)}
        onPromote={(result) => setPromoteTarget({ url: result.url, title: result.title })}
        onInspect={(result) => inspect({ url: result.url, title: result.title, source: result.source })}
        onQueryChange={setLastQuery}
        canPromote={canPromote}
      />
      <RunsSection
        runsQuery={runsQuery}
        runs={runs}
        selectedRun={selectedRun}
        onSelect={(id) => setSelectedRunId((current) => (current === id ? "" : id))}
        onPromote={(finding) => setPromoteTarget({ url: finding.url, title: finding.title })}
        onInspect={(finding: { url: string; title: string }) => inspect({ url: finding.url, title: finding.title, source: "" })}
        canPromote={canPromote}
      />
      <CollectModal
        result={collectTarget}
        runs={runs}
        defaultQuestion={lastQuery}
        onClose={() => setCollectTarget(null)}
        onCollected={(runId) => {
          setCollectTarget(null);
          setSelectedRunId(runId);
        }}
      />
      <PromoteConfirm target={promoteTarget} onClose={() => setPromoteTarget(null)} />
    </div>
  );
}

// ─── Web search ───────────────────────────────────────────────────────────────

function WebSearchSection({
  onCollect,
  onPromote,
  onInspect,
  onQueryChange,
  canPromote,
}: {
  onCollect: (result: SearchResult) => void;
  onPromote: (result: SearchResult) => void;
  onInspect: (result: SearchResult) => void;
  onQueryChange: (query: string) => void;
  canPromote: boolean | undefined;
}) {
  const [provider, setProvider] = useState("");
  const [queryText, setQueryText] = useState("");
  const [submitted, setSubmitted] = useState("");

  const providersQuery = useQuery({
    queryKey: researchKeys.searchProviders,
    queryFn: () => gv.invoke("web_search.providers.list"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const providers = useMemo(() => searchProvidersFrom(providersQuery.data), [providersQuery.data]);

  const search = useQuery({
    queryKey: researchKeys.search(provider, submitted),
    queryFn: () =>
      gv.invoke("web_search.query", {
        body: { query: submitted, ...(provider ? { provider } : {}), maxResults: 10 },
      }),
    enabled: submitted.length > 0,
    retry: false,
  });
  const results = useMemo(() => searchResultsFrom(search.data), [search.data]);

  const searchUnavailable =
    (providersQuery.isError && isMethodUnavailableError(providersQuery.error)) ||
    (search.isError && isMethodUnavailableError(search.error));

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = queryText.trim();
    if (!trimmed) return;
    setSubmitted(trimmed);
    onQueryChange(trimmed);
  }

  return (
    <section className="research-search" aria-label="Web search">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Globe size={14} aria-hidden="true" /> Web search
        </span>
      </div>

      {searchUnavailable ? (
        <UnavailableState
          capability="web_search.query"
          description="ranked web search cannot run from this app."
        />
      ) : (
        <>
          <form className="research-search__form" onSubmit={handleSubmit}>
            <input
              id={SEARCH_INPUT_ID}
              type="search"
              className="research-search__input"
              placeholder="Search the web…"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              aria-label="Web search query"
            />
            <select
              className="research-search__provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              aria-label="Search provider"
              disabled={providers.length === 0}
            >
              <option value="">
                {providersQuery.isPending
                  ? "Loading providers…"
                  : providers.length === 0
                    ? "Default provider"
                    : "Auto (default)"}
              </option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.status ? ` — ${p.status}` : ""}
                </option>
              ))}
            </select>
            <button type="submit" className="research-search__submit" disabled={!queryText.trim() || search.isFetching}>
              <Search size={14} aria-hidden="true" /> {search.isFetching ? "Searching…" : "Search"}
            </button>
          </form>
          {providersQuery.isError && !isMethodUnavailableError(providersQuery.error) && (
            <p className="research-search__provider-note" role="status">
              Provider list failed to load ({formatError(providersQuery.error)}) — searches use the daemon default.
            </p>
          )}

          {submitted && search.isFetching && <SkeletonBlock variant="text" lines={4} />}
          {submitted && search.isError && !isMethodUnavailableError(search.error) && (
            <ErrorState error={search.error} onRetry={() => void search.refetch()} title="Search failed" />
          )}
          {submitted && search.isSuccess && results.length === 0 && (
            <EmptyState
              icon={<Search size={28} aria-hidden="true" />}
              title="No results"
              description={`The search for “${submitted}” returned nothing from this provider.`}
            />
          )}
          {search.isSuccess && results.length > 0 && (
            <ol className="research-results" aria-label="Search results">
              {results.map((result, index) => (
                <li key={`${result.url}-${index}`} className="research-result">
                  <span className="research-result__rank" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="research-result__body">
                    <a className="research-result__title" href={result.url} target="_blank" rel="noreferrer">
                      {result.title}
                    </a>
                    <span className="research-result__url">{result.url}</span>
                    {result.snippet && <p className="research-result__snippet">{result.snippet}</p>}
                    <div className="research-result__meta">
                      {result.source && <span className="badge neutral">{result.source}</span>}
                      <button
                        type="button"
                        className="research-result__action"
                        onClick={() => onInspect(result)}
                        title="Fetch a read-only preview of this URL"
                      >
                        <SearchCheck size={12} aria-hidden="true" /> Inspect
                      </button>
                      <button type="button" className="research-result__action" onClick={() => onCollect(result)}>
                        Collect into run
                      </button>
                      <button
                        type="button"
                        className="research-result__action"
                        onClick={() => onPromote(result)}
                        disabled={canPromote === false}
                        title={
                          canPromote === false
                            ? "knowledge.ingest.url is not available on this daemon"
                            : "Ingest this URL into Knowledge (confirm-gated)"
                        }
                      >
                        Promote to Knowledge
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {!submitted && (
            <EmptyState
              icon={<Globe size={28} aria-hidden="true" />}
              title="Search the web"
              description="Results are ranked and source-labeled. Collect the good ones into a research run for triage."
            />
          )}
        </>
      )}
    </section>
  );
}

// ─── Collect modal (result → finding with note + credibility) ────────────────

const NEW_RUN_VALUE = "__new__";

function CollectModal({
  result,
  runs,
  defaultQuestion,
  onClose,
  onCollected,
}: {
  result: SearchResult | null;
  runs: ResearchRun[];
  defaultQuestion: string;
  onClose: () => void;
  onCollected: (runId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [runChoice, setRunChoice] = useState(NEW_RUN_VALUE);
  const [question, setQuestion] = useState("");
  const [note, setNote] = useState("");
  const [credibility, setCredibility] = useState<Credibility>("unknown");

  const resultUrl = result?.url ?? "";
  useEffect(() => {
    // Reset the draft per collected result; prefer an existing run.
    setRunChoice(runs[0]?.id ?? NEW_RUN_VALUE);
    setQuestion(defaultQuestion);
    setNote("");
    setCredibility("unknown");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultUrl]);

  const collect = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error("No result selected");
      const finding = {
        url: result.url,
        title: result.title,
        note: note.trim(),
        credibility,
        source: result.source,
        collectedAt: Date.now(),
      };
      if (runChoice === NEW_RUN_VALUE) {
        const created = await createRun({
          question: question.trim() || result.title,
          status: "open",
          findings: [finding],
          log: [
            makeLogEntry("status", "Run created (open)"),
            makeLogEntry("finding", `Collected “${result.title}” from ${result.source || "web search"}`),
          ],
        });
        return firstString(created, ["id"]);
      }
      const run = runs.find((r) => r.id === runChoice);
      if (!run) throw new Error("Selected run no longer exists");
      const existingLog = Array.isArray(run.raw["log"]) ? run.raw["log"] : [];
      await updateRun(run.id, {
        ...run.raw,
        findings: [...run.findings.map((f) => f.raw), finding],
        log: [...existingLog, makeLogEntry("finding", `Collected “${result.title}” from ${result.source || "web search"}`)],
      });
      return run.id;
    },
    onSuccess: async (runId) => {
      await queryClient.invalidateQueries({ queryKey: researchKeys.runs });
      toast({ title: "Finding collected", tone: "success" });
      onCollected(runId);
    },
    onError: (error: unknown) => {
      toast({ title: "Collect failed", description: formatError(error), tone: "danger" });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (collect.isPending) return;
    collect.mutate();
  }

  return (
    <Modal open={result !== null} onClose={onClose} title="Collect finding">
      {result && (
        <form className="research-collect" onSubmit={handleSubmit}>
          <p className="research-collect__source">
            <strong>{result.title}</strong>
            <span className="research-collect__url">{result.url}</span>
          </p>
          <label className="research-collect__label" htmlFor="collect-run">
            Research run
          </label>
          <select
            id="collect-run"
            value={runChoice}
            onChange={(e) => setRunChoice(e.target.value)}
            disabled={collect.isPending}
          >
            <option value={NEW_RUN_VALUE}>New run…</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.question}
              </option>
            ))}
          </select>
          {runChoice === NEW_RUN_VALUE && (
            <>
              <label className="research-collect__label" htmlFor="collect-question">
                Run question
              </label>
              <input
                id="collect-question"
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What is this run trying to answer?"
                disabled={collect.isPending}
              />
            </>
          )}
          <label className="research-collect__label" htmlFor="collect-note">
            Note
          </label>
          <textarea
            id="collect-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this source matters, what it claims"
            disabled={collect.isPending}
          />
          <label className="research-collect__label" htmlFor="collect-credibility">
            Credibility
          </label>
          <select
            id="collect-credibility"
            value={credibility}
            onChange={(e) => setCredibility(credibilityFrom(e.target.value))}
            disabled={collect.isPending}
          >
            {CREDIBILITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          <div className="research-collect__actions">
            <button type="button" onClick={onClose} disabled={collect.isPending}>
              Cancel
            </button>
            <button type="submit" className="research-collect__submit" disabled={collect.isPending}>
              {collect.isPending ? "Saving…" : "Save finding"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ─── Promote to Knowledge (confirm-gated, admin) ─────────────────────────────

function PromoteConfirm({
  target,
  onClose,
}: {
  target: { url: string; title: string } | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const promote = useMutation({
    mutationFn: (vars: { url: string; title: string; confirm: true; explicitUserRequest: true }) =>
      gv.invoke("knowledge.ingest.url", { body: vars }),
    onSuccess: () => {
      toast({ title: "Sent to Knowledge", description: "The URL is being ingested.", tone: "success" });
      onClose();
    },
    onError: (error: unknown) => {
      const description = isMethodUnavailableError(error)
        ? "knowledge.ingest.url is not available on this daemon."
        : formatError(error);
      toast({ title: "Promote failed", description, tone: "danger" });
    },
  });

  return (
    <ConfirmSurface
      open={target !== null}
      action="Ingest URL into Knowledge"
      target={target?.url ?? ""}
      blastRadius="The daemon fetches this page and adds it to the shared knowledge base used by every surface (TUI, agent, this app). Admin-scoped."
      confirmLabel="Ingest URL"
      onCancel={onClose}
      onConfirm={(meta) => {
        if (!target) return;
        promote.mutate({ url: target.url, title: target.title, ...meta });
      }}
    />
  );
}

// ─── Research runs ────────────────────────────────────────────────────────────

interface RunsQueryLike {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  refetch: () => unknown;
}

function RunsSection({
  runsQuery,
  runs,
  selectedRun,
  onSelect,
  onPromote,
  onInspect,
  canPromote,
}: {
  runsQuery: RunsQueryLike;
  runs: ResearchRun[];
  selectedRun: ResearchRun | null;
  onSelect: (id: string) => void;
  onPromote: (finding: { url: string; title: string }) => void;
  onInspect: (finding: { url: string; title: string }) => void;
  canPromote: boolean | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newQuestion, setNewQuestion] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ResearchRun | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: researchKeys.runs });

  const create = useMutation({
    mutationFn: (question: string) =>
      createRun({ question, status: "open", findings: [], log: [makeLogEntry("status", "Run created (open)")] }),
    onSuccess: async () => {
      setNewQuestion("");
      await invalidate();
      toast({ title: "Run created", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Create failed", description: formatError(error), tone: "danger" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRun(id),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidate();
      toast({ title: "Run deleted", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Delete failed", description: formatError(error), tone: "danger" }),
  });

  const unavailable = runsQuery.isError && isRegistryUnavailable(runsQuery.error);

  return (
    <section className="research-runs" aria-label="Research runs">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <FlaskConical size={14} aria-hidden="true" /> Research runs
          {runsQuery.isSuccess ? ` · ${runs.length}` : ""}
        </span>
      </div>

      <form
        className="research-runs__create"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = newQuestion.trim();
          if (trimmed && !create.isPending) create.mutate(trimmed);
        }}
      >
        <input
          id={NEW_RUN_INPUT_ID}
          type="text"
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          placeholder="New research question…"
          aria-label="New research question"
          disabled={unavailable}
        />
        <button type="submit" disabled={!newQuestion.trim() || create.isPending || unavailable}>
          {create.isPending ? "Creating…" : "Start run"}
        </button>
      </form>

      {runsQuery.isPending && <SkeletonBlock variant="text" lines={4} />}
      {unavailable && (
        <UnavailableState
          capability="/app/registries/research-runs"
          description="the app-local research-run registry is not served by this build, so runs cannot be stored."
        />
      )}
      {runsQuery.isError && !unavailable && (
        <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} title="Failed to load runs" />
      )}
      {runsQuery.isSuccess && runs.length === 0 && (
        <EmptyState
          icon={<FlaskConical size={28} aria-hidden="true" />}
          title="No research runs"
          description="Start a run with a question, then collect web-search results into it as triaged findings."
        />
      )}

      {runs.length > 0 && (
        <ul className="research-run-list">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className={
                  selectedRun?.id === run.id ? "research-run-card research-run-card--active" : "research-run-card"
                }
                onClick={() => onSelect(run.id)}
                aria-expanded={selectedRun?.id === run.id}
              >
                <span className="research-run-card__question">{run.question}</span>
                <span className="research-run-card__meta">
                  <StatusBadge value={run.status} />
                  <span className="badge neutral">
                    {run.findings.length} finding{run.findings.length === 1 ? "" : "s"}
                  </span>
                  {run.reportArtifactId && <span className="badge ok">report</span>}
                  {run.createdAt !== undefined && (
                    <span className="research-run-card__time">{formatRelative(run.createdAt)}</span>
                  )}
                </span>
              </button>
              {selectedRun?.id === run.id && (
                <RunDetail
                  run={selectedRun}
                  onPromote={onPromote}
                  onInspect={onInspect}
                  canPromote={canPromote}
                  onDelete={() => setDeleteTarget(run)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete research run"
        target={deleteTarget?.question ?? ""}
        blastRadius={`Removes the run and its ${deleteTarget?.findings.length ?? 0} collected finding(s) from the app registry. Report artifacts already created are kept.`}
        danger
        confirmLabel="Delete run"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </section>
  );
}

// ─── Run detail: findings triage + sourced report ────────────────────────────

function RunDetail({
  run,
  onPromote,
  onInspect,
  canPromote,
  onDelete,
}: {
  run: ResearchRun;
  onPromote: (finding: { url: string; title: string }) => void;
  onInspect: (finding: { url: string; title: string }) => void;
  canPromote: boolean | undefined;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [checkpointLabel, setCheckpointLabel] = useState("");
  const logTailRef = useRef<HTMLOListElement>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: researchKeys.runs });

  const saveFindings = useMutation({
    mutationFn: (vars: { findings: typeof run.findings; logMessage: string }) =>
      updateRun(run.id, rawWithFindings(run, vars.findings, makeLogEntry("finding", vars.logMessage))),
    onSuccess: () => invalidate(),
    onError: (error: unknown) => toast({ title: "Update failed", description: formatError(error), tone: "danger" }),
  });

  // Status transitions (docs/GAPS.md §10 row 3) — every change is logged so
  // the run's history reads as a timeline, not just a current value.
  const changeStatus = useMutation({
    mutationFn: (status: string) =>
      updateRun(run.id, rawWithLog(run, { status }, makeLogEntry("status", `Status changed: ${run.status} → ${status}`))),
    onSuccess: () => invalidate(),
    onError: (error: unknown) => toast({ title: "Status update failed", description: formatError(error), tone: "danger" }),
  });

  // Checkpoint — snapshots the current findings into run.checkpoints without
  // touching the live findings, so the run stays resumable from a known-good
  // point even if later triage goes sideways.
  const checkpoint = useMutation({
    mutationFn: (label: string) => updateRun(run.id, rawWithCheckpoint(run, label)),
    onSuccess: async () => {
      setCheckpointLabel("");
      await invalidate();
      toast({ title: "Checkpoint saved", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Checkpoint failed", description: formatError(error), tone: "danger" }),
  });

  // Auto-scroll the log tail to the bottom (newest last) whenever the log grows.
  useEffect(() => {
    const el = logTailRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.log.length]);

  // Report: composed client-side from triaged findings → artifacts.create,
  // then the run records reportArtifactId + status so every surface sees it.
  const generateReport = useMutation({
    mutationFn: async () => {
      const markdown = composeReportMarkdown(run);
      const created = await gv.artifacts.create({
        filename: reportFilename(run),
        mimeType: "text/markdown",
        dataBase64: base64FromText(markdown),
        metadata: { surface: "app", kind: "research-report", runId: run.id, question: run.question },
      });
      const record = asRecord(created);
      const artifactId =
        firstString(asRecord(record["artifact"]), ["id", "artifactId"]) || firstString(record, ["artifactId", "id"]);
      if (!artifactId) throw new Error("artifacts.create did not return an artifact id");
      await updateRun(
        run.id,
        rawWithLog(
          run,
          { reportArtifactId: artifactId, status: "reported" },
          makeLogEntry("report", `Generated sourced report (artifact ${artifactId})`),
        ),
      );
      return artifactId;
    },
    onSuccess: async (artifactId) => {
      await invalidate();
      toast({
        title: "Report generated",
        description: `Artifact ${artifactId} — view it in the Artifacts view.`,
        tone: "success",
      });
    },
    onError: (error: unknown) =>
      toast({ title: "Report failed", description: formatError(error), tone: "danger" }),
  });

  function patchFinding(index: number, patch: Partial<{ note: string; credibility: Credibility }>): void {
    const finding = run.findings[index];
    const next = run.findings.map((f, i) => (i === index ? { ...f, ...patch } : f));
    const field = "note" in patch ? "note" : "credibility";
    saveFindings.mutate({ findings: next, logMessage: `Updated ${field} for “${finding?.title ?? finding?.url}”` });
  }

  function removeFinding(index: number): void {
    const finding = run.findings[index];
    saveFindings.mutate({
      findings: run.findings.filter((_, i) => i !== index),
      logMessage: `Removed finding “${finding?.title ?? finding?.url}”`,
    });
  }

  return (
    <div className="research-run-detail">
      <div className="research-run-detail__status">
        <label htmlFor={`run-status-${run.id}`}>Status</label>
        <select
          id={`run-status-${run.id}`}
          value={RUN_STATUSES.includes(run.status as (typeof RUN_STATUSES)[number]) ? run.status : ""}
          onChange={(e) => changeStatus.mutate(e.target.value)}
          disabled={changeStatus.isPending}
        >
          {!RUN_STATUSES.includes(run.status as (typeof RUN_STATUSES)[number]) && (
            <option value="">{run.status || "open"} (custom)</option>
          )}
          {RUN_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      {run.findings.length === 0 ? (
        <p className="research-run-detail__empty">
          No findings yet — run a web search and use “Collect into run” to add triaged sources.
        </p>
      ) : (
        <ul className="research-findings" aria-label="Findings">
          {run.findings.map((finding, index) => (
            <li key={`${finding.url}-${index}`} className="research-finding">
              <div className="research-finding__head">
                <a href={finding.url} target="_blank" rel="noreferrer" className="research-finding__title">
                  {finding.title}
                </a>
                <select
                  value={finding.credibility}
                  onChange={(e) => patchFinding(index, { credibility: credibilityFrom(e.target.value) })}
                  aria-label={`Credibility for ${finding.title}`}
                  disabled={saveFindings.isPending}
                >
                  {CREDIBILITY_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>
              <span className="research-finding__url">{finding.url}</span>
              <textarea
                className="research-finding__note"
                rows={2}
                defaultValue={finding.note}
                placeholder="Triage note"
                aria-label={`Note for ${finding.title}`}
                onBlur={(e) => {
                  if (e.target.value !== finding.note) patchFinding(index, { note: e.target.value });
                }}
                disabled={saveFindings.isPending}
              />
              <div className="research-finding__actions">
                <button type="button" onClick={() => onInspect(finding)} title="Fetch a read-only preview of this URL">
                  <SearchCheck size={12} aria-hidden="true" /> Inspect
                </button>
                <button
                  type="button"
                  onClick={() => onPromote(finding)}
                  disabled={canPromote === false}
                  title={
                    canPromote === false ? "knowledge.ingest.url is not available on this daemon" : undefined
                  }
                >
                  Promote to Knowledge
                </button>
                <button type="button" onClick={() => removeFinding(index)} disabled={saveFindings.isPending}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="research-run-detail__footer">
        <button
          type="button"
          className="research-run-detail__report"
          onClick={() => generateReport.mutate()}
          disabled={run.findings.length === 0 || generateReport.isPending}
          title={run.findings.length === 0 ? "Collect at least one finding first" : undefined}
        >
          {generateReport.isPending
            ? "Generating…"
            : run.reportArtifactId
              ? "Regenerate sourced report"
              : "Generate sourced report"}
        </button>
        {run.reportArtifactId && (
          <span className="research-run-detail__artifact">
            Report artifact: <code>{run.reportArtifactId}</code>
          </span>
        )}
        <button type="button" className="research-run-detail__delete" onClick={onDelete}>
          Delete run
        </button>
      </div>

      <div className="research-run-detail__checkpoint">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const label = checkpointLabel.trim() || `checkpoint ${run.checkpoints.length + 1}`;
            if (!checkpoint.isPending) checkpoint.mutate(label);
          }}
        >
          <input
            type="text"
            value={checkpointLabel}
            onChange={(e) => setCheckpointLabel(e.target.value)}
            placeholder={`Checkpoint label (default: checkpoint ${run.checkpoints.length + 1})`}
            aria-label="Checkpoint label"
            disabled={checkpoint.isPending}
          />
          <button type="submit" disabled={checkpoint.isPending || run.findings.length === 0}>
            {checkpoint.isPending ? "Saving…" : "Checkpoint findings"}
          </button>
        </form>
        {run.checkpoints.length > 0 && (
          <ul className="research-run-detail__checkpoint-list" aria-label="Checkpoints">
            {run.checkpoints
              .slice()
              .reverse()
              .map((cp, i) => (
                <li key={`${cp.label}-${cp.at ?? i}`}>
                  <span className="badge neutral">{cp.label}</span>
                  <span>
                    {cp.findings.length} finding{cp.findings.length === 1 ? "" : "s"}
                  </span>
                  <span className="research-run-detail__checkpoint-time">{formatRelative(cp.at)}</span>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="research-run-detail__log">
        <h4 className="research-run-detail__log-title">Findings log</h4>
        {run.log.length === 0 ? (
          <p className="research-run-detail__empty">No status transitions or edits logged yet.</p>
        ) : (
          <ol className="research-run-detail__log-tail" ref={logTailRef} aria-label="Run activity log">
            {run.log.map((entry, index) => (
              <li key={`${entry.type}-${index}`}>
                <span className="research-run-detail__log-time">{formatRelative(entry.at)}</span>
                <span className="badge neutral">{entry.type}</span>
                <span>{entry.message}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
