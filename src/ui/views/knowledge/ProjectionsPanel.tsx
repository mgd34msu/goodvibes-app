// Projections tab: wiki/markdown projections over the knowledge store.
// knowledge.projections.list → target picker; knowledge.projection.render →
// read-only markdown pages viewer; knowledge.projection.materialize (admin,
// confirm-gated — it WRITES an artifact/source) behind ConfirmSurface.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { asRecord, firstArray, firstString } from "../../lib/wire.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { EmptyState, ErrorState } from "../../components/feedback.tsx";
import { DataBlock, Pager, QueryStates } from "./KnowledgeBits.tsx";
import { KNOWLEDGE_PREFIX, kKeys, knowledgeList, knowledgeTitle, pageSlice } from "./lib.ts";

const PAGE_SIZE = 25;

interface ProjectionTarget {
  key: string;
  kind: string;
  id: string;
  title: string;
}

function toTarget(raw: unknown): ProjectionTarget | null {
  const kind = firstString(raw, ["kind"]);
  if (!kind) return null;
  const id = firstString(raw, ["targetId", "id", "itemId"]);
  return { key: `${kind}:${id}`, kind, id, title: knowledgeTitle(raw, kind) };
}

function renderBody(target: ProjectionTarget) {
  return {
    kind: target.kind,
    ...(target.id ? { id: target.id } : {}),
    limit: 25,
  };
}

function PagesViewer({ value }: { value: unknown }) {
  const pages = firstArray(value, ["pages"]);
  const [index, setIndex] = useState(0);
  if (pages.length === 0) return <DataBlock title="Rendered projection" value={value} open />;
  const clamped = Math.min(index, pages.length - 1);
  const page = asRecord(pages[clamped]);
  const content = firstString(page, ["content", "markdown", "body", "text"]);
  return (
    <div className="knowledge-projection__viewer">
      <div className="knowledge-projection__pagebar" role="tablist" aria-label="Projection pages">
        {pages.map((raw, i) => {
          const title = firstString(raw, ["title", "path"]) || `Page ${i + 1}`;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === clamped}
              className={
                i === clamped
                  ? "knowledge-projection__pagetab knowledge-projection__pagetab--active"
                  : "knowledge-projection__pagetab"
              }
              onClick={() => setIndex(i)}
            >
              {title}
            </button>
          );
        })}
      </div>
      {content ? (
        <div className="knowledge-projection__markdown">
          <MarkdownMessage content={content} />
        </div>
      ) : (
        <DataBlock title="Page" value={page} open />
      )}
    </div>
  );
}

export function ProjectionsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedKey, setSelectedKey] = useState("");
  const [page, setPage] = useState(0);
  const [materializeOpen, setMaterializeOpen] = useState(false);

  const projections = useQuery({
    queryKey: kKeys.projections,
    queryFn: () => invoke("knowledge.projections.list", { query: { limit: 200 } }),
  });

  const rawTargets = knowledgeList(projections.data, "targets");
  const targets = useMemo(
    () => rawTargets.map(toTarget).filter((t): t is ProjectionTarget => t !== null),
    [rawTargets],
  );
  const selected = targets.find((t) => t.key === selectedKey) ?? targets[0] ?? null;
  const pageTargets = pageSlice(targets, page, PAGE_SIZE);

  const render = useMutation({
    mutationFn: (target: ProjectionTarget) =>
      invoke("knowledge.projection.render", { body: renderBody(target) }),
  });

  const materialize = useMutation({
    mutationFn: ({ target, meta }: { target: ProjectionTarget; meta: ConfirmMetadata }) =>
      invoke("knowledge.projection.materialize", { body: { ...renderBody(target), ...meta } }),
    onSuccess: async () => {
      setMaterializeOpen(false);
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      toast({ title: "Projection materialized", tone: "success" });
    },
    onError: (error: unknown) => {
      setMaterializeOpen(false);
      toast({ title: "Materialize failed", description: formatError(error), tone: "danger" });
    },
  });

  return (
    <div className="knowledge-projection">
      <section className="knowledge-panel" aria-label="Projection targets">
        <header className="knowledge-panel__head">
          <h3>Targets</h3>
          <FileText size={16} aria-hidden="true" />
        </header>
        <QueryStates
          query={projections}
          capability="knowledge.projections.list"
          unavailableDescription="wiki projections are not served."
          isEmpty={targets.length === 0}
          empty={
            <EmptyState
              icon={<FileText size={24} aria-hidden="true" />}
              title="No projection targets"
              description="Add sources to generate wiki projections."
            />
          }
        >
          <div className="knowledge-projection__targets" role="listbox" aria-label="Projection targets">
            {pageTargets.map((target) => {
              const active = selected?.key === target.key;
              return (
                <button
                  key={target.key}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={
                    active
                      ? "knowledge-projection__target knowledge-projection__target--active"
                      : "knowledge-projection__target"
                  }
                  onClick={() => setSelectedKey(target.key)}
                >
                  <strong>{target.title}</strong>
                  <span>
                    {target.kind}
                    {target.id ? ` · ${target.id}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={targets.length} onPage={setPage} label="projections" />
          <div className="knowledge-projection__actions">
            <button
              type="button"
              className="knowledge-button knowledge-button--primary"
              disabled={!selected || render.isPending}
              onClick={() => selected && render.mutate(selected)}
            >
              {render.isPending ? "Rendering…" : "Render"}
            </button>
            <button
              type="button"
              className="knowledge-button"
              disabled={!selected || materialize.isPending}
              onClick={() => setMaterializeOpen(true)}
            >
              {materialize.isPending ? "Materializing…" : "Materialize"}
            </button>
          </div>
        </QueryStates>
      </section>

      <section className="knowledge-panel knowledge-projection__result" aria-label="Rendered projection">
        <header className="knowledge-panel__head">
          <h3>Rendered</h3>
        </header>
        {render.isError && (
          <ErrorState
            error={render.error}
            onRetry={() => selected && render.mutate(selected)}
            title="Render failed"
          />
        )}
        {render.isSuccess ? (
          <PagesViewer value={render.data} />
        ) : (
          !render.isError && (
            <p className="knowledge-hint">Pick a target and Render to preview its wiki pages read-only.</p>
          )
        )}
        {materialize.isSuccess && <DataBlock title="Materialize result" value={materialize.data} open />}
      </section>

      <ConfirmSurface
        open={materializeOpen}
        action="Materialize projection"
        target={selected ? `${selected.kind}${selected.id ? ` · ${selected.id}` : ""} — ${selected.title}` : ""}
        blastRadius="Writes the rendered pages back into the store as an artifact/source (admin operation) — Render is the read-only preview."
        confirmLabel="Materialize"
        onConfirm={(meta) => selected && materialize.mutate({ target: selected, meta })}
        onCancel={() => setMaterializeOpen(false)}
      />
    </div>
  );
}
