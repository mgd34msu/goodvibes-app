// Overview tab: knowledge.status dashboard tiles + Ask/Search console.
// Ask renders a markdown answer with its citation list (answer.sources),
// confidence, and linked objects; Search renders scored results that peek
// into knowledge.item.get. Honors the store scope switcher: agent scope
// routes ask/search/status to /api/goodvibes-agent/knowledge/* (probed at
// runtime — docs/FEATURES.md §6 agent-scoped knowledge row).

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Brain, Search } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { appJson } from "../../lib/http.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { CopyValue, DataBlock } from "./KnowledgeBits.tsx";
import { kKeys, knowledgeId, knowledgeTitle } from "./lib.ts";
import { KnowledgeItemPeekBody } from "./ItemPeek.tsx";
import type { KnowledgeScope } from "./scope.ts";
import { agentKnowledgePath } from "./scope.ts";

const STATUS_TILES: ReadonlyArray<readonly [key: string, label: string]> = [
  ["sourceCount", "Sources"],
  ["nodeCount", "Nodes"],
  ["edgeCount", "Edges"],
  ["issueCount", "Issues"],
  ["extractionCount", "Extractions"],
  ["jobRunCount", "Job runs"],
  ["refinementTaskCount", "Refinement tasks"],
  ["candidateCount", "Candidates"],
  ["reportCount", "Reports"],
  ["usageCount", "Usage records"],
];

function StatusDashboard({ scope }: { scope: KnowledgeScope }) {
  const status = useQuery({
    queryKey: scope === "agent" ? [...kKeys.status, "agent"] : kKeys.status,
    queryFn: () =>
      scope === "agent" ? appJson<unknown>(agentKnowledgePath("/status")) : invoke("knowledge.status"),
  });

  if (status.isPending) return <SkeletonBlock height={72} />;
  if (status.isError) {
    if (isMethodUnavailableError(status.error)) {
      return (
        <UnavailableState
          capability={scope === "agent" ? "agent knowledge /status" : "knowledge.status"}
          description="the knowledge store cannot report its counts."
        />
      );
    }
    return <ErrorState error={status.error} onRetry={() => void status.refetch()} title="Status unavailable" />;
  }

  const record = asRecord(status.data);
  const ready = record["ready"];
  const storagePath = firstString(record, ["storagePath"]);

  return (
    <section className="knowledge-status" aria-label="Knowledge status">
      <div className="knowledge-status__meta">
        <StatusBadge value={ready === false ? "not ready" : "ready"} />
        {storagePath && <CopyValue value={storagePath} label="storage path" />}
      </div>
      <div className="knowledge-status__tiles">
        {STATUS_TILES.map(([key, label]) => {
          const count = firstNumber(record, [key]);
          if (count === undefined) return null;
          return (
            <div key={key} className="knowledge-status__tile">
              <span className="knowledge-status__value">{count}</span>
              <span className="knowledge-status__label">{label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AskPanel({ scope }: { scope: KnowledgeScope }) {
  const peek = usePeek();
  const [mode, setMode] = useState<"ask" | "search">("ask");
  const [query, setQuery] = useState("");

  const run = useMutation({
    mutationFn: ({ text, runMode }: { text: string; runMode: "ask" | "search" }) => {
      if (scope === "agent") {
        return appJson<unknown>(agentKnowledgePath(runMode === "ask" ? "/ask" : "/search"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            runMode === "ask"
              ? { query: text, limit: 10, includeSources: true, includeConfidence: true }
              : { query: text, limit: 25, includeSources: true, includeNodes: true },
          ),
        });
      }
      return runMode === "ask"
        ? invoke("knowledge.ask", {
            body: {
              query: text,
              limit: 10,
              includeSources: true,
              includeConfidence: true,
              includeLinkedObjects: true,
              timeoutMs: 20_000,
            },
          })
        : invoke("knowledge.search", {
            body: { query: text, limit: 25, includeSources: true, includeNodes: true },
          });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    const text = query.trim();
    if (!text || run.isPending) return;
    run.mutate({ text, runMode: mode });
  }

  const result = run.data;
  const answer = asRecord(asRecord(result)["answer"]);
  const answerText =
    firstString(answer, ["text", "markdown", "content"]) ||
    firstString(result, ["answer", "text", "summary", "response"]);
  const confidence = firstNumber(answer, ["confidence"]);
  const citations = firstArray(answer, ["sources"]);
  const linkedObjects = firstArray(answer, ["linkedObjects", "objects"]);
  const results = useMemo(() => firstArray(result, ["results"]), [result]);
  const ranMode = run.variables?.runMode ?? mode;

  const openItem = (id: string, label: string) =>
    peek.open({ title: label, content: <KnowledgeItemPeekBody itemId={id} /> });

  return (
    <div className="knowledge-ask">
      <StatusDashboard scope={scope} />

      <form className="knowledge-ask__form" onSubmit={submit}>
        <div className="knowledge-segmented" role="group" aria-label="Query mode">
          <button
            type="button"
            className={mode === "ask" ? "knowledge-segmented__item knowledge-segmented__item--active" : "knowledge-segmented__item"}
            aria-pressed={mode === "ask"}
            onClick={() => setMode("ask")}
          >
            <Brain size={14} aria-hidden="true" /> Ask
          </button>
          <button
            type="button"
            className={mode === "search" ? "knowledge-segmented__item knowledge-segmented__item--active" : "knowledge-segmented__item"}
            aria-pressed={mode === "search"}
            onClick={() => setMode("search")}
          >
            <Search size={14} aria-hidden="true" /> Search
          </button>
        </div>
        <input
          className="knowledge-ask__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === "ask" ? "Ask the knowledge base a question" : "Search sources and nodes"}
          aria-label={mode === "ask" ? "Ask a question" : "Search knowledge"}
        />
        <button
          type="submit"
          className="knowledge-button knowledge-button--primary"
          disabled={run.isPending || !query.trim()}
        >
          {run.isPending ? "Running…" : "Run"}
        </button>
      </form>

      <div aria-live="polite">
        {run.isPending && <SkeletonBlock variant="text" lines={3} />}
        {run.isError &&
          (isMethodUnavailableError(run.error) ? (
            <UnavailableState
              capability={mode === "ask" ? "knowledge.ask" : "knowledge.search"}
              description="grounded answers and search are not served by this daemon."
            />
          ) : (
            <ErrorState
              error={run.error}
              onRetry={() => {
                if (query.trim()) run.mutate({ text: query.trim(), runMode: mode });
              }}
              title="Query failed"
            />
          ))}
      </div>

      {run.isSuccess && ranMode === "ask" && (
        <section className="knowledge-answer" aria-label="Answer">
          <header className="knowledge-answer__head">
            <h3>Answer</h3>
            {confidence !== undefined && (
              <span className="badge neutral">confidence {(confidence * 100).toFixed(0)}%</span>
            )}
          </header>
          {answerText ? (
            <div className="knowledge-answer__markdown">
              <MarkdownMessage content={answerText} />
            </div>
          ) : (
            <DataBlock title="Raw response" value={result} open />
          )}
          {citations.length > 0 && (
            <div className="knowledge-answer__citations">
              <h4>Citations ({citations.length})</h4>
              <ul>
                {citations.map((source, index) => {
                  const id = knowledgeId(source);
                  const title = knowledgeTitle(source, `Source ${index + 1}`);
                  const uri = firstString(source, ["sourceUri", "canonicalUri", "url"]);
                  return (
                    <li key={id || index}>
                      {id ? (
                        <button type="button" className="knowledge-link" onClick={() => openItem(id, title)}>
                          {title}
                        </button>
                      ) : (
                        <span>{title}</span>
                      )}
                      {uri && <CopyValue value={uri} label="citation URI" />}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {linkedObjects.length > 0 && <DataBlock title={`Linked objects (${linkedObjects.length})`} value={linkedObjects} />}
        </section>
      )}

      {run.isSuccess && ranMode === "search" && (
        <section className="knowledge-results" aria-label="Search results">
          <h3>Results ({results.length})</h3>
          {results.length === 0 ? (
            <EmptyState
              icon={<Search size={24} aria-hidden="true" />}
              title="No matches"
              description="Nothing in the knowledge base matched this query."
            />
          ) : (
            <ul className="knowledge-results__list">
              {results.map((row, index) => {
                const record = asRecord(row);
                const inner = asRecord(record["source"] ?? record["node"]);
                const id = knowledgeId(inner) || knowledgeId(record);
                const kind = firstString(record, ["kind"]) || "result";
                const score = firstNumber(record, ["score"]);
                const reason = firstString(record, ["reason"]);
                const title = knowledgeTitle(inner, knowledgeTitle(record, `Result ${index + 1}`));
                return (
                  <li key={id || index} className="knowledge-results__row">
                    <button
                      type="button"
                      className="knowledge-results__button"
                      onClick={() => id && openItem(id, title)}
                      disabled={!id}
                    >
                      <span className="knowledge-results__head">
                        <strong>{title}</strong>
                        <span className="badge neutral">{kind}</span>
                        {score !== undefined && <span className="knowledge-results__score">{score.toFixed(2)}</span>}
                      </span>
                      {reason && <span className="knowledge-results__reason">{reason}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
