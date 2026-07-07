// Contract explorer (docs/FEATURES.md §17): control.contract +
// control.methods.list/.get + control.events.catalog — the
// observability-of-the-API surface. Every method row links its admin/confirm
// (dangerous) flags so an operator can tell what a palette action or a
// ConfirmSurface-gated button actually requires before invoking it.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, bestId, compactJson, firstArray, firstString } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import { obsKeys } from "./keys.ts";

interface MethodRow {
  id: string;
  access: string;
  dangerous: boolean;
  ws: boolean;
  description: string;
  raw: unknown;
}

function readMethodRows(payload: unknown): MethodRow[] {
  const rows = firstArray(payload, ["items", "methods", "data"]);
  return rows.map((row, i) => {
    const record = asRecord(row);
    return {
      id: bestId(record) || firstString(record, ["methodId", "method"]) || `method-${i}`,
      access: firstString(record, ["access", "scope", "role"]) || "unknown",
      dangerous: record["dangerous"] === true,
      ws: record["ws"] === true,
      description: firstString(record, ["description", "summary"]),
      raw: row,
    };
  });
}

interface EventCatalogRow {
  id: string;
  domain: string;
  type: string;
  description: string;
  raw: unknown;
}

function readEventCatalogRows(payload: unknown): EventCatalogRow[] {
  const rows = firstArray(payload, ["items", "events", "data"]);
  return rows.map((row, i) => {
    const record = asRecord(row);
    return {
      id: bestId(record) || `event-${i}`,
      domain: firstString(record, ["domain"]) || "unknown",
      type: firstString(record, ["type", "eventType"]) || "unknown",
      description: firstString(record, ["description", "summary"]),
      raw: row,
    };
  });
}

export function ContractSection() {
  const [search, setSearch] = useState("");
  const { open } = usePeek();

  const contract = useQuery({ queryKey: obsKeys.controlContract, queryFn: () => gv.control.contract(), retry: false });
  const methods = useQuery({ queryKey: obsKeys.controlMethods, queryFn: () => gv.control.methods.list(), retry: false });
  const eventsCatalog = useQuery({
    queryKey: obsKeys.controlEventsCatalog,
    queryFn: () => gv.control.eventsCatalog(),
    retry: false,
  });

  const methodRows = useMemo(() => readMethodRows(methods.data), [methods.data]);
  const eventRows = useMemo(() => readEventCatalogRows(eventsCatalog.data), [eventsCatalog.data]);

  const filteredMethods = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return methodRows;
    return methodRows.filter((m) => m.id.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
  }, [methodRows, search]);

  const methodsUnavailable = methods.isError && isMethodUnavailableError(methods.error);

  async function inspectMethod(methodId: string): Promise<void> {
    try {
      const detail = await gv.control.methods.get(methodId);
      open({ title: methodId, content: <pre className="obs-peek-json">{compactJson(detail)}</pre> });
    } catch (error) {
      open({ title: methodId, content: <pre className="obs-peek-json">{compactJson({ error: String(error) })}</pre> });
    }
  }

  return (
    <div className="obs-contract">
      <section className="obs-subsection">
        <div className="obs-panel-toolbar">
          <span className="obs-panel-toolbar__summary">Contract summary</span>
        </div>
        {contract.isPending && <SkeletonBlock variant="text" lines={2} />}
        {contract.isError && isMethodUnavailableError(contract.error) && <UnavailableState capability="control.contract" />}
        {contract.isError && !isMethodUnavailableError(contract.error) && (
          <ErrorState error={contract.error} onRetry={() => void contract.refetch()} title="Failed to load contract" />
        )}
        {contract.isSuccess && (
          <details className="obs-raw-panel">
            <summary>Raw control.contract payload</summary>
            <pre>{compactJson(contract.data)}</pre>
          </details>
        )}
      </section>

      <section className="obs-subsection">
        <div className="obs-panel-toolbar">
          <span className="obs-panel-toolbar__summary">Methods{methods.isSuccess ? ` · ${filteredMethods.length}/${methodRows.length}` : ""}</span>
        </div>
        <label className="obs-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search methods by id or description…"
            aria-label="Search methods"
          />
        </label>

        {methods.isPending && <SkeletonBlock variant="text" lines={5} />}
        {methodsUnavailable && <UnavailableState capability="control.methods.list" description="the method catalog is not exposed." />}
        {methods.isError && !methodsUnavailable && (
          <ErrorState error={methods.error} onRetry={() => void methods.refetch()} title="Failed to load methods" />
        )}
        {methods.isSuccess && filteredMethods.length === 0 && (
          <EmptyState title={search.trim() ? "No methods match" : "No methods reported"} />
        )}
        {methods.isSuccess && filteredMethods.length > 0 && (
          <ul className="obs-simple-rows">
            {filteredMethods.map((m) => (
              <li key={m.id} className="obs-simple-row obs-simple-row--method">
                <button type="button" className="obs-simple-row__button" onClick={() => void inspectMethod(m.id)}>
                  <code>{m.id}</code>
                  <span className="badge neutral">{m.access}</span>
                  {m.dangerous && <span className="badge bad">dangerous</span>}
                  {m.ws && <span className="badge info">ws</span>}
                  {m.description && <span className="obs-simple-row__description">{m.description}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="obs-subsection">
        <div className="obs-panel-toolbar">
          <span className="obs-panel-toolbar__summary">Event catalog{eventsCatalog.isSuccess ? ` · ${eventRows.length}` : ""}</span>
        </div>
        {eventsCatalog.isPending && <SkeletonBlock variant="text" lines={3} />}
        {eventsCatalog.isError && isMethodUnavailableError(eventsCatalog.error) && (
          <UnavailableState capability="control.events.catalog" description="the event catalog is not exposed." />
        )}
        {eventsCatalog.isError && !isMethodUnavailableError(eventsCatalog.error) && (
          <ErrorState error={eventsCatalog.error} onRetry={() => void eventsCatalog.refetch()} title="Failed to load event catalog" />
        )}
        {eventsCatalog.isSuccess && eventRows.length === 0 && <EmptyState title="No events cataloged" />}
        {eventsCatalog.isSuccess && eventRows.length > 0 && (
          <ul className="obs-simple-rows">
            {eventRows.map((row) => (
              <li key={row.id} className="obs-simple-row">
                <span className="badge neutral">{row.domain}</span>
                <code>{row.type}</code>
                {row.description && <span className="obs-simple-row__description">{row.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
