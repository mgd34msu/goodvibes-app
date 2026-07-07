// Reports tab: knowledge reports (knowledge.reports.list / report.get peek),
// usage records (knowledge.usage.list — where knowledge actually got used),
// and extraction records (knowledge.extractions.list / extraction.get peek).

import { useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { BarChart3, FileSearch, ScrollText } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { firstNumber, firstString } from "../../lib/wire.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState } from "../../components/feedback.tsx";
import { DataBlock, Pager, QueryStates } from "./KnowledgeBits.tsx";
import { kKeys, formatEpoch, knowledgeId, knowledgeList, knowledgeTitle, pageSlice } from "./lib.ts";

const PAGE_SIZE = 20;

function DetailPeek({ methodId, id, capability }: { methodId: string; id: string; capability: string }) {
  const detail = useQuery({
    queryKey: methodId === "knowledge.report.get" ? kKeys.reportDetail(id) : kKeys.extractionDetail(id),
    queryFn: () => invoke(methodId, { params: { id } }),
  });
  return (
    <div className="knowledge-peek-body">
      <QueryStates
        query={detail}
        capability={capability}
        unavailableDescription="detail records are not served."
        isEmpty={false}
        empty={null}
      >
        <DataBlock title="Record" value={detail.data} open />
      </QueryStates>
    </div>
  );
}

function RecordSection({
  label,
  icon,
  query,
  capability,
  listKey,
  emptyTitle,
  emptyDescription,
  onOpen,
}: {
  label: string;
  icon: React.ReactNode;
  query: UseQueryResult<unknown, unknown>;
  capability: string;
  listKey: string;
  emptyTitle: string;
  emptyDescription: string;
  onOpen?: (id: string, title: string) => void;
}) {
  const [page, setPage] = useState(0);
  const items = knowledgeList(query.data, listKey);
  const pageItems = pageSlice(items, page, PAGE_SIZE);

  return (
    <section className="knowledge-panel" aria-label={label}>
      <header className="knowledge-panel__head">
        <h3>{label}</h3>
        {icon}
      </header>
      <QueryStates
        query={query}
        capability={capability}
        unavailableDescription={`${label.toLowerCase()} are not served.`}
        isEmpty={items.length === 0}
        empty={<EmptyState title={emptyTitle} description={emptyDescription} />}
      >
        <ul className="knowledge-records">
          {pageItems.map((item, index) => {
            const id = knowledgeId(item);
            const title = knowledgeTitle(item, `${label} ${page * PAGE_SIZE + index + 1}`);
            const status = firstString(item, ["status", "state", "usageKind", "kind"]);
            const when = formatEpoch(firstNumber(item, ["createdAt", "usedAt", "generatedAt", "updatedAt"]));
            const summary = firstString(item, ["summary", "description", "reason", "targetId"]);
            const clickable = Boolean(onOpen && id);
            const body = (
              <>
                <span className="knowledge-records__head">
                  <strong>{title}</strong>
                  {status && <StatusBadge value={status} />}
                </span>
                {summary && <span className="knowledge-records__summary">{summary}</span>}
                {when && <span className="knowledge-records__meta">{when}</span>}
              </>
            );
            return (
              <li key={id || index}>
                {clickable ? (
                  <button
                    type="button"
                    className="knowledge-records__row knowledge-records__row--button"
                    onClick={() => onOpen && id && onOpen(id, title)}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="knowledge-records__row">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
        <Pager page={page} pageSize={PAGE_SIZE} total={items.length} onPage={setPage} label={label.toLowerCase()} />
      </QueryStates>
    </section>
  );
}

export function ReportsPanel({ active }: { active: boolean }) {
  const peek = usePeek();

  // None of these have wire events — slow polls while the tab is visible.
  const reports = useQuery({
    queryKey: kKeys.reports,
    queryFn: () => invoke("knowledge.reports.list", { query: { limit: 100 } }),
    refetchInterval: active ? 60_000 : false,
  });
  const usage = useQuery({
    queryKey: kKeys.usage,
    queryFn: () => invoke("knowledge.usage.list", { query: { limit: 100 } }),
    refetchInterval: active ? 60_000 : false,
  });
  const extractions = useQuery({
    queryKey: kKeys.extractions,
    queryFn: () => invoke("knowledge.extractions.list", { query: { limit: 100 } }),
    refetchInterval: active ? 60_000 : false,
  });

  return (
    <div className="knowledge-reports">
      <RecordSection
        label="Reports"
        icon={<ScrollText size={16} aria-hidden="true" />}
        query={reports}
        capability="knowledge.reports.list"
        listKey="reports"
        emptyTitle="No reports"
        emptyDescription="Knowledge reports appear after jobs and refinement runs produce them."
        onOpen={(id, title) =>
          peek.open({
            title,
            content: <DetailPeek methodId="knowledge.report.get" id={id} capability="knowledge.report.get" />,
          })
        }
      />
      <RecordSection
        label="Usage"
        icon={<BarChart3 size={16} aria-hidden="true" />}
        query={usage}
        capability="knowledge.usage.list"
        listKey="usage"
        emptyTitle="No usage recorded"
        emptyDescription="Usage records show where knowledge items were actually injected or cited."
      />
      <RecordSection
        label="Extractions"
        icon={<FileSearch size={16} aria-hidden="true" />}
        query={extractions}
        capability="knowledge.extractions.list"
        listKey="extractions"
        emptyTitle="No extractions"
        emptyDescription="Extractions are produced while sources are processed into nodes."
        onOpen={(id, title) =>
          peek.open({
            title,
            content: (
              <DetailPeek methodId="knowledge.extraction.get" id={id} capability="knowledge.extraction.get" />
            ),
          })
        }
      />
    </div>
  );
}
