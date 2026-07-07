// Browse tab: sources / nodes / issues master lists (client-paginated over a
// capped fetch) with a shared right peek for item drill-in (knowledge.item.get).
// Sources surface health inline (status + crawl errors). Nodes keep the webui
// W8 honesty rule: "N indexing jobs ran, 0 nodes" is a named state contrasted
// against knowledge.status, never a bare empty.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, BookOpen, GitBranch } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { asRecord, firstNumber, firstString } from "../../lib/wire.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState } from "../../components/feedback.tsx";
import { Pager, QueryStates } from "./KnowledgeBits.tsx";
import { KnowledgeItemPeekBody, previewText } from "./ItemPeek.tsx";
import { kKeys, knowledgeId, knowledgeList, knowledgeStatusText, knowledgeTitle, pageSlice } from "./lib.ts";

const PAGE_SIZE = 25;
const FETCH_CAP = 200;

interface BrowseListProps {
  label: string;
  capability: string;
  queryKey: readonly unknown[];
  listKey: string;
  active: boolean;
  /** No wire event exists for this list — poll while the tab is visible. */
  pollMs?: number;
  empty: React.ReactNode;
  emptyOverride?: (items: unknown[]) => React.ReactNode | null;
  onOpen: (id: string, title: string) => void;
}

function BrowseList({ label, capability, queryKey, listKey, active, pollMs, empty, emptyOverride, onOpen }: BrowseListProps) {
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey,
    queryFn: () => invoke(capability, { query: { limit: FETCH_CAP } }),
    // Poll only while this tab is visible; lists without wire events would
    // otherwise go stale silently (knowledge domain events cover status/
    // sources/issues, nodes have none).
    refetchInterval: active && pollMs ? pollMs : false,
  });

  const items = knowledgeList(query.data, listKey);
  const pageItems = pageSlice(items, page, PAGE_SIZE);
  const override = query.isSuccess && items.length === 0 && emptyOverride ? emptyOverride(items) : null;

  return (
    <section className="knowledge-browse__pane" aria-label={label}>
      <header className="knowledge-browse__head">
        <h3>{label}</h3>
        {query.isSuccess && <span className="knowledge-browse__count">{items.length}{items.length >= FETCH_CAP ? "+" : ""}</span>}
      </header>
      <QueryStates
        query={query}
        capability={capability}
        unavailableDescription={`${label.toLowerCase()} cannot be listed.`}
        isEmpty={items.length === 0}
        empty={override ?? empty}
      >
        <ul className="knowledge-browse__list">
          {pageItems.map((item, index) => {
            const id = knowledgeId(item);
            const title = knowledgeTitle(item, `${label.slice(0, -1)} ${page * PAGE_SIZE + index + 1}`);
            const status = knowledgeStatusText(item);
            const crawlError = firstString(item, ["crawlError"]);
            const summary = previewText(item, ["summary", "description", "message", "reason", "sourceUri", "slug"]);
            return (
              <li key={id || index}>
                <button
                  type="button"
                  className="knowledge-browse__row"
                  onClick={() => id && onOpen(id, title)}
                  disabled={!id}
                >
                  <span className="knowledge-browse__row-head">
                    <strong>{title}</strong>
                    {status !== "unknown" && <StatusBadge value={status} />}
                  </span>
                  {summary && <span className="knowledge-browse__row-summary">{summary}</span>}
                  {crawlError && <span className="knowledge-browse__row-error">crawl error: {crawlError}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <Pager page={page} pageSize={PAGE_SIZE} total={items.length} onPage={setPage} label={label.toLowerCase()} />
      </QueryStates>
    </section>
  );
}

export function BrowsePanel({ active, onViewJobs }: { active: boolean; onViewJobs: () => void }) {
  const peek = usePeek();
  // Status supplies the jobs-ran/zero-nodes contrast for the Nodes empty state.
  const status = useQuery({ queryKey: kKeys.status, queryFn: () => invoke("knowledge.status") });
  const jobRunCount = status.isSuccess ? firstNumber(asRecord(status.data), ["jobRunCount"]) ?? 0 : null;

  const openItem = (id: string, title: string) =>
    peek.open({ title, content: <KnowledgeItemPeekBody itemId={id} /> });

  return (
    <div className="knowledge-browse">
      <BrowseList
        label="Sources"
        capability="knowledge.sources.list"
        queryKey={kKeys.sources}
        listKey="sources"
        active={active}
        empty={
          <EmptyState
            icon={<BookOpen size={24} aria-hidden="true" />}
            title="No sources"
            description="Ingest a URL from the Ingest tab to add your first source."
          />
        }
        onOpen={openItem}
      />
      <BrowseList
        label="Nodes"
        capability="knowledge.nodes.list"
        queryKey={kKeys.nodes}
        listKey="nodes"
        active={active}
        pollMs={30_000}
        empty={
          <EmptyState
            icon={<GitBranch size={24} aria-hidden="true" />}
            title="No nodes yet"
            description="Nodes appear after sources are processed."
          />
        }
        emptyOverride={() =>
          jobRunCount && jobRunCount > 0 ? (
            <EmptyState
              icon={<AlertCircle size={24} aria-hidden="true" />}
              title={`${jobRunCount} indexing job${jobRunCount === 1 ? "" : "s"} ran, 0 nodes`}
              description="Indexing may still be in progress, filtered everything out, or be failing to produce nodes."
              action={{ label: "View jobs", onClick: onViewJobs }}
            />
          ) : null
        }
        onOpen={openItem}
      />
      <BrowseList
        label="Issues"
        capability="knowledge.issues.list"
        queryKey={kKeys.issues}
        listKey="issues"
        active={active}
        empty={
          <EmptyState
            icon={<AlertCircle size={24} aria-hidden="true" />}
            title="No issues"
            description="Issues are flagged automatically while sources are processed."
          />
        }
        onOpen={openItem}
      />
    </div>
  );
}
