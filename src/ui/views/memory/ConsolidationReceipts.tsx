// Consolidation — makes memory consolidation's judgment proposals actionable
// (memory.consolidation.receipts). Crib: goodvibes-webui
// src/views/memory/ConsolidationReceipts.tsx.
//
// Idle/scheduled consolidation performs only REVERSIBLE operations on its
// own (merge exact duplicates into a survivor, decay never-referenced aged
// records) — anything needing a human call (a contradiction, a cross-scope
// duplicate, a long-stale delete) is emitted as a PROPOSAL instead of applied
// automatically. The records a proposal references are already marked into
// the review queue by the consolidation pass itself, so this panel's job is
// to make those proposals legible (what kind, which records, why) and
// ONE-TAP jumpable to the review queue below — a scroll + highlight, never a
// second resolution path and never a filter that hides anything else.
//
// A daemon build with no memory.consolidation.receipts id at all (404) and a
// build that HAS the id but no consolidation scheduler wired (501) both
// render the same honest "not available" state — isMethodUnavailableError
// already covers both status codes (lib/errors.ts). Zero runs ever having
// happened is a genuinely different, honest empty state.

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, GitMerge } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  CONSOLIDATION_PROPOSAL_KIND_LABEL,
  formatConsolidationRunAt,
  memoryKeys,
  parseConsolidationReceipts,
  type ConsolidationProposal,
} from "./memory-wire.ts";

function proposalKey(proposal: ConsolidationProposal, index: number): string {
  return `${proposal.kind}-${proposal.ids.join(",")}-${index}`;
}

export interface ConsolidationReceiptsProps {
  /** Jump to the review queue below, scrolling to it and highlighting exactly
   * these record ids — never filters the queue down to just them. */
  onReviewIds: (ids: readonly string[]) => void;
}

export function ConsolidationReceipts({ onReviewIds }: ConsolidationReceiptsProps) {
  const receipts = useQuery({
    queryKey: memoryKeys.consolidation,
    queryFn: async () => parseConsolidationReceipts(await gv.memory.consolidationReceipts()),
    // No wire event for memory.* — poll while mounted, same as the review queue.
    refetchInterval: 30_000,
    retry: false,
  });

  const unavailable = receipts.isError && isMethodUnavailableError(receipts.error);

  return (
    <section className="memory-panel memory-panel--consolidation" aria-label="Consolidation">
      <div className="memory-panel__title">
        <h2>Consolidation</h2>
        <GitMerge size={16} aria-hidden="true" />
      </div>
      <p className="memory-learning-review__note">
        Idle-time consolidation merges exact duplicates and decays never-referenced records automatically —
        reversible, nothing ever deleted. Anything needing a human call is proposed here instead; the referenced
        records are already waiting in the review queue below.
      </p>

      {receipts.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState
          capability="memory.consolidation.receipts"
          description="this daemon has no idle-time memory consolidation scheduler. Upgrade it to see what consolidation proposes here."
        />
      )}

      {receipts.isError && !unavailable && (
        <ErrorState
          error={receipts.error}
          onRetry={() => void receipts.refetch()}
          title="Consolidation receipts unavailable"
        />
      )}

      {receipts.isSuccess &&
        (() => {
          const { pendingProposals: pending, receipts: runs } = receipts.data;

          if (pending.length === 0 && runs.length === 0) {
            return (
              <EmptyState
                icon={<ClipboardCheck size={24} aria-hidden="true" />}
                title="No consolidation runs yet"
                description="This daemon has not run an idle or scheduled consolidation pass yet."
              />
            );
          }

          return (
            <>
              {pending.length > 0 && (
                <ul className="consolidation-proposals">
                  {pending.map((proposal, index) => (
                    <li key={proposalKey(proposal, index)} className="consolidation-proposal-row">
                      <div className="consolidation-proposal-row__main">
                        <span className="badge warning">
                          {CONSOLIDATION_PROPOSAL_KIND_LABEL[proposal.kind] ?? proposal.kind}
                        </span>
                        <p>{proposal.reason}</p>
                        <small>
                          {proposal.ids.length} record{proposal.ids.length === 1 ? "" : "s"}: {proposal.ids.join(", ")}
                        </small>
                      </div>
                      <button type="button" className="memory-button" onClick={() => onReviewIds(proposal.ids)}>
                        Review
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {pending.length === 0 && runs.length > 0 && (
                <p className="memory-learning-review__note">
                  Nothing currently pending a human call — every prior proposal has been resolved.
                </p>
              )}

              {runs.length > 0 && (
                <details className="consolidation-runs">
                  <summary>
                    {runs.length} run{runs.length === 1 ? "" : "s"} recorded
                  </summary>
                  <ul>
                    {runs.map((receipt) => (
                      <li key={receipt.runId} className="consolidation-run-row">
                        <strong>
                          {receipt.trigger}
                          {receipt.idle ? " (idle)" : ""}
                        </strong>{" "}
                        <span>{formatConsolidationRunAt(receipt.ranAt)}</span>
                        <p className="memory-learning-review__note">
                          Scanned {receipt.scanned} · merged {receipt.merged.length} · archived{" "}
                          {receipt.archived.length} · decayed {receipt.decayed.length} · proposed{" "}
                          {receipt.proposed.length}
                        </p>
                        {!receipt.usageSignalAvailable && (
                          <p className="memory-learning-review__note" role="note">
                            No usage instrumentation available for this run — decay ordering was best-effort.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          );
        })()}
    </section>
  );
}
