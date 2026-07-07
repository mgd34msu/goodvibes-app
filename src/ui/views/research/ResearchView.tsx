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

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Globe, Search } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { formatError, errorStatus, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { asRecord, firstString, formatRelative, type AnyRecord } from "../../lib/wire.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  base64FromText,
  composeReportMarkdown,
  createRun,
  CREDIBILITY_LEVELS,
  credibilityFrom,
  deleteRun,
  listRuns,
  rawWithFindings,
  reportFilename,
  researchKeys,
  runFrom,
  searchProvidersFrom,
  searchResultsFrom,
  updateRun,
  type Credibility,
  type ResearchRun,
  type SearchResult,
} from "./research-data.ts";

/** The app-local registry service answering 404/501 means the collection is
 * not wired on this build — honest UnavailableState, never a blank. */
function isRegistryUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 501;
}

const SEARCH_INPUT_ID = "research-web-search-input";
const NEW_RUN_INPUT_ID = "research-new-run-input";

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
        onQueryChange={setLastQuery}
        canPromote={canPromote}
      />
      <RunsSection
        runsQuery={runsQuery}
        runs={runs}
        selectedRun={selectedRun}
        onSelect={(id) => setSelectedRunId((current) => (current === id ? "" : id))}
        onPromote={(finding) => setPromoteTarget({ url: finding.url, title: finding.title })}
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
  onQueryChange,
  canPromote,
}: {
  onCollect: (result: SearchResult) => void;
  onPromote: (result: SearchResult) => void;
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
        });
        return firstString(created, ["id"]);
      }
      const run = runs.find((r) => r.id === runChoice);
      if (!run) throw new Error("Selected run no longer exists");
      await updateRun(run.id, { ...run.raw, findings: [...run.findings.map((f) => f.raw), finding] });
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
  canPromote,
}: {
  runsQuery: RunsQueryLike;
  runs: ResearchRun[];
  selectedRun: ResearchRun | null;
  onSelect: (id: string) => void;
  onPromote: (finding: { url: string; title: string }) => void;
  canPromote: boolean | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newQuestion, setNewQuestion] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ResearchRun | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: researchKeys.runs });

  const create = useMutation({
    mutationFn: (question: string) => createRun({ question, status: "open", findings: [] }),
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
                <RunDetail run={selectedRun} onPromote={onPromote} canPromote={canPromote} onDelete={() => setDeleteTarget(run)} />
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
  canPromote,
  onDelete,
}: {
  run: ResearchRun;
  onPromote: (finding: { url: string; title: string }) => void;
  canPromote: boolean | undefined;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: researchKeys.runs });

  const saveFindings = useMutation({
    mutationFn: (findings: typeof run.findings) => updateRun(run.id, rawWithFindings(run, findings)),
    onSuccess: () => invalidate(),
    onError: (error: unknown) => toast({ title: "Update failed", description: formatError(error), tone: "danger" }),
  });

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
      await updateRun(run.id, { ...run.raw, reportArtifactId: artifactId, status: "reported" });
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
    const next = run.findings.map((f, i) => (i === index ? { ...f, ...patch } : f));
    saveFindings.mutate(next);
  }

  function removeFinding(index: number): void {
    saveFindings.mutate(run.findings.filter((_, i) => i !== index));
  }

  return (
    <div className="research-run-detail">
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
    </div>
  );
}
