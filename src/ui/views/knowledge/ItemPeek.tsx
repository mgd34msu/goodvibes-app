// Knowledge item drill-in peek (knowledge.item.get): renders whichever facets
// the daemon returns (source / node / issue + linked records) with defensive
// readers, plus the issue-review action form (knowledge.issue.review, admin).
// Sources additionally surface health (status + crawlError + lastCrawledAt)
// and their extraction via knowledge.source.extraction.get.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../../lib/gv.ts";
import { asRecord, compactJson, firstArray, firstString } from "../../lib/wire.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { CopyValue, DataBlock, FactGrid } from "./KnowledgeBits.tsx";
import { KNOWLEDGE_PREFIX, kKeys, formatEpoch, knowledgeTitle, knowledgeStatusText, scalarEntries } from "./lib.ts";

function FacetSection({ label, value }: { label: string; value: unknown }) {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const title = knowledgeTitle(record, label);
  const status = knowledgeStatusText(record);
  const uri = firstString(record, ["sourceUri", "canonicalUri", "uri", "url"]);
  const summary = firstString(record, ["summary", "description", "message"]);
  const crawlError = firstString(record, ["crawlError"]);
  const tags = firstArray(record, ["tags"]).filter((t): t is string => typeof t === "string");
  const facts = scalarEntries(record).filter(
    ([key]) =>
      !["title", "summary", "description", "sourceUri", "canonicalUri", "uri", "url", "status", "crawlError", "svg", "content", "text", "message"].includes(
        key,
      ),
  );

  return (
    <section className="knowledge-peek-facet" aria-label={label}>
      <header className="knowledge-peek-facet__head">
        <span className="knowledge-peek-facet__label">{label}</span>
        <strong className="knowledge-peek-facet__title">{title}</strong>
        {status !== "unknown" && <StatusBadge value={status} />}
      </header>
      {summary && <p className="knowledge-peek-facet__summary">{summary}</p>}
      {uri && <CopyValue value={uri} label={`${label} URI`} />}
      {crawlError && (
        <p className="knowledge-peek-facet__error" role="note">
          Crawl error: {crawlError}
        </p>
      )}
      {tags.length > 0 && (
        <p className="knowledge-peek-facet__tags">
          {tags.map((tag) => (
            <span key={tag} className="badge neutral">
              {tag}
            </span>
          ))}
        </p>
      )}
      <FactGrid
        facts={facts.map(([k, v]) => [k, k.endsWith("At") ? formatEpoch(Number(v)) || v : v] as const)}
      />
      <DataBlock title={`Raw ${label.toLowerCase()}`} value={value} />
    </section>
  );
}

/** Issue review form — knowledge.issue.review is admin; the action vocabulary
 * is daemon-defined (free string on the wire), so common actions are offered
 * plus a custom escape hatch. Failures surface verbatim. */
function IssueReviewForm({ issueId }: { issueId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [action, setAction] = useState("resolve");
  const [customAction, setCustomAction] = useState("");
  const [value, setValue] = useState("");

  const review = useMutation({
    mutationFn: (body: { action: string; value?: string }) =>
      invoke("knowledge.issue.review", {
        params: { id: issueId },
        body: { id: issueId, action: body.action, ...(body.value ? { value: body.value } : {}) },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      toast({ title: "Issue reviewed", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Issue review failed", description: formatError(error), tone: "danger" });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    const effective = action === "custom" ? customAction.trim() : action;
    if (!effective || review.isPending) return;
    review.mutate({ action: effective, ...(value.trim() ? { value: value.trim() } : {}) });
  }

  return (
    <form className="knowledge-issue-review" onSubmit={submit} aria-label="Review issue">
      <span className="knowledge-issue-review__label">Review action</span>
      <div className="knowledge-issue-review__row">
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Review action">
          <option value="resolve">resolve</option>
          <option value="suppress">suppress</option>
          <option value="reopen">reopen</option>
          <option value="custom">custom…</option>
        </select>
        {action === "custom" && (
          <input
            value={customAction}
            onChange={(e) => setCustomAction(e.target.value)}
            placeholder="action name"
            aria-label="Custom review action"
          />
        )}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Optional value"
          aria-label="Optional review value"
        />
        <button
          type="submit"
          className="knowledge-button knowledge-button--primary"
          disabled={review.isPending || (action === "custom" && !customAction.trim())}
        >
          {review.isPending ? "Reviewing…" : "Apply"}
        </button>
      </div>
    </form>
  );
}

export function KnowledgeItemPeekBody({ itemId }: { itemId: string }) {
  const detail = useQuery({
    queryKey: kKeys.item(itemId),
    enabled: Boolean(itemId),
    queryFn: () => invoke("knowledge.item.get", { params: { id: itemId } }),
  });

  // Source extraction — only fetched when the item resolves to a source.
  const record = asRecord(detail.data);
  const sourceId = firstString(asRecord(record["source"]), ["id"]);
  const extraction = useQuery({
    queryKey: [...kKeys.item(itemId), "extraction"],
    enabled: Boolean(sourceId),
    retry: false,
    queryFn: () => invoke("knowledge.source.extraction.get", { params: { id: sourceId } }),
  });

  if (detail.isPending) return <SkeletonBlock variant="text" lines={6} />;
  if (detail.isError) {
    if (isMethodUnavailableError(detail.error)) {
      return (
        <UnavailableState capability="knowledge.item.get" description="item drill-in details cannot be loaded." />
      );
    }
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="Failed to load item" />;
  }

  const issueId = firstString(asRecord(record["issue"]), ["id"]);
  const linkedSources = firstArray(record, ["linkedSources"]);
  const linkedNodes = firstArray(record, ["linkedNodes"]);
  const relatedEdges = firstArray(record, ["relatedEdges"]);
  const hasFacet =
    Object.keys(asRecord(record["source"])).length > 0 ||
    Object.keys(asRecord(record["node"])).length > 0 ||
    Object.keys(asRecord(record["issue"])).length > 0;

  return (
    <div className="knowledge-peek-body">
      <FacetSection label="Source" value={record["source"]} />
      <FacetSection label="Node" value={record["node"]} />
      <FacetSection label="Issue" value={record["issue"]} />
      {issueId && <IssueReviewForm issueId={issueId} />}
      {!hasFacet && <DataBlock title="Item" value={detail.data} open />}
      {sourceId && extraction.isSuccess && <DataBlock title="Extraction" value={extraction.data} />}
      {linkedNodes.length > 0 && <DataBlock title={`Linked nodes (${linkedNodes.length})`} value={linkedNodes} />}
      {linkedSources.length > 0 && (
        <DataBlock title={`Linked sources (${linkedSources.length})`} value={linkedSources} />
      )}
      {relatedEdges.length > 0 && <DataBlock title={`Related edges (${relatedEdges.length})`} value={relatedEdges} />}
    </div>
  );
}

/** Raw compact preview text for list rows. */
export function previewText(value: unknown, keys: string[]): string {
  const text = firstString(value, keys);
  if (text) return text;
  const json = compactJson(value);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}
