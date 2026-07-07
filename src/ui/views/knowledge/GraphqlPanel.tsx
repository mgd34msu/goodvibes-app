// GraphQL tab: power-user console over knowledge.graphql.execute with the
// schema (knowledge.graphql.schema) in a collapsible sidebar. Query +
// variables textareas, Ctrl/Cmd+Enter to run, results as pretty JSON with
// GraphQL errors surfaced separately from transport errors.

import { useState, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Braces } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { asRecord, compactJson, firstArray, firstString } from "../../lib/wire.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { formatCombo } from "../../lib/keybindings.ts";
import { kKeys } from "./lib.ts";

// Platform-aware run hint: "Ctrl+Enter" on Linux/Windows, "⌘Enter" on macOS —
// the handler accepts both ctrl and meta, so the label must match the OS.
const RUN_HINT = formatCombo("mod+Enter");

const DEFAULT_QUERY = `# Knowledge GraphQL console — ${RUN_HINT} to run
{
  __typename
}
`;

export function GraphqlPanel() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [variablesText, setVariablesText] = useState("");
  const [variablesError, setVariablesError] = useState("");
  const [schemaOpen, setSchemaOpen] = useState(true);

  const schema = useQuery({
    queryKey: kKeys.graphqlSchema,
    queryFn: () => invoke("knowledge.graphql.schema"),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const execute = useMutation({
    mutationFn: (body: { query: string; variables?: Record<string, unknown> }) =>
      invoke("knowledge.graphql.execute", { body }),
  });

  function run(): void {
    const text = query.trim();
    if (!text || execute.isPending) return;
    let variables: Record<string, unknown> | undefined;
    const varsRaw = variablesText.trim();
    if (varsRaw) {
      try {
        variables = asRecord(JSON.parse(varsRaw));
        setVariablesError("");
      } catch {
        setVariablesError("Variables must be valid JSON.");
        return;
      }
    } else {
      setVariablesError("");
    }
    execute.mutate({ query: text, ...(variables ? { variables } : {}) });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      run();
    }
  }

  const schemaText = firstString(schema.data, ["schema", "sdl", "text"]);
  const result = asRecord(execute.data);
  const gqlErrors = firstArray(result, ["errors"]);
  const executeUnavailable = execute.isError && isMethodUnavailableError(execute.error);

  return (
    <div className="knowledge-graphql">
      <section className="knowledge-panel knowledge-graphql__console" aria-label="GraphQL console">
        <header className="knowledge-panel__head">
          <h3>GraphQL console</h3>
          <Braces size={16} aria-hidden="true" />
        </header>
        <label className="knowledge-graphql__label" htmlFor="knowledge-graphql-query">
          Query
        </label>
        <textarea
          id="knowledge-graphql-query"
          className="knowledge-graphql__editor"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          rows={10}
          spellCheck={false}
        />
        <label className="knowledge-graphql__label" htmlFor="knowledge-graphql-vars">
          Variables (JSON, optional)
        </label>
        <textarea
          id="knowledge-graphql-vars"
          className="knowledge-graphql__editor knowledge-graphql__editor--vars"
          value={variablesText}
          onChange={(e) => setVariablesText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          spellCheck={false}
          placeholder='{ "limit": 10 }'
        />
        {variablesError && (
          <p className="knowledge-form__error" role="alert">
            {variablesError}
          </p>
        )}
        <div className="knowledge-graphql__actions">
          <button
            type="button"
            className="knowledge-button knowledge-button--primary"
            disabled={execute.isPending || !query.trim()}
            onClick={run}
          >
            {execute.isPending ? "Running…" : `Run (${RUN_HINT})`}
          </button>
        </div>

        {executeUnavailable && (
          <UnavailableState
            capability="knowledge.graphql.execute"
            description="the knowledge GraphQL endpoint is not served."
          />
        )}
        {execute.isError && !executeUnavailable && (
          <ErrorState error={execute.error} onRetry={run} title="Execution failed" />
        )}
        {execute.isSuccess && (
          <div className="knowledge-graphql__result" aria-live="polite">
            {gqlErrors.length > 0 && (
              <div className="knowledge-graphql__errors" role="alert">
                <strong>
                  {gqlErrors.length} GraphQL error{gqlErrors.length === 1 ? "" : "s"}
                </strong>
                <pre>{compactJson(gqlErrors)}</pre>
              </div>
            )}
            <pre className="knowledge-graphql__data">{compactJson(result["data"] ?? execute.data)}</pre>
          </div>
        )}
      </section>

      <aside className="knowledge-panel knowledge-graphql__schema" aria-label="GraphQL schema">
        <header className="knowledge-panel__head">
          <h3>Schema</h3>
          <button
            type="button"
            className="knowledge-link"
            aria-expanded={schemaOpen}
            onClick={() => setSchemaOpen((v) => !v)}
          >
            {schemaOpen ? "Hide" : "Show"}
          </button>
        </header>
        {schemaOpen &&
          (schema.isPending ? (
            <SkeletonBlock variant="text" lines={8} />
          ) : schema.isError ? (
            isMethodUnavailableError(schema.error) ? (
              <UnavailableState
                capability="knowledge.graphql.schema"
                description="the schema explorer has nothing to show."
              />
            ) : (
              <p className="knowledge-form__error">{formatError(schema.error)}</p>
            )
          ) : schemaText ? (
            <pre className="knowledge-graphql__sdl">{schemaText}</pre>
          ) : (
            <pre className="knowledge-graphql__sdl">{compactJson(schema.data)}</pre>
          ))}
      </aside>
    </div>
  );
}
