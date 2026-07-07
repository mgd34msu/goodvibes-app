// Packet tab: knowledge.packet — preview the packed, budget-aware context an
// agent would carry into a task, with per-item "why" (reason + score,
// explainability per docs/FEATURES.md §6) and the post-1.2.0 truncation
// disclosure (truncated/totalCandidates/droppedCount are additive on the
// wire — absent fields render nothing rather than a fabricated claim).

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { DataBlock } from "./KnowledgeBits.tsx";
import { splitCsv } from "./lib.ts";

type PacketDetail = "compact" | "standard" | "detailed";

function truncationInfo(data: unknown): { totalCandidates: number; droppedCount: number } | null {
  const record = asRecord(data);
  if (record["truncated"] !== true) return null;
  const totalCandidates = record["totalCandidates"];
  const droppedCount = record["droppedCount"];
  if (typeof totalCandidates !== "number" || typeof droppedCount !== "number") return null;
  return { totalCandidates, droppedCount };
}

export function PacketPanel() {
  const [task, setTask] = useState("");
  const [writeScope, setWriteScope] = useState("");
  const [detail, setDetail] = useState<PacketDetail>("standard");
  const [budgetLimit, setBudgetLimit] = useState("");

  const packet = useMutation({
    mutationFn: () => {
      const scope = splitCsv(writeScope);
      const budget = Number(budgetLimit);
      return invoke("knowledge.packet", {
        body: {
          task: task.trim(),
          detail,
          ...(scope.length ? { writeScope: scope } : {}),
          ...(budgetLimit.trim() && Number.isFinite(budget) && budget > 0 ? { budgetLimit: budget } : {}),
        },
      });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (task.trim() && !packet.isPending) packet.mutate();
  }

  const items = firstArray(packet.data, ["items"]);
  const estimatedTokens = firstNumber(packet.data, ["estimatedTokens"]);
  const truncation = truncationInfo(packet.data);

  return (
    <div className="knowledge-packet">
      <section className="knowledge-panel" aria-label="Packet builder">
        <header className="knowledge-panel__head">
          <h3>Prompt packet</h3>
          <PackageSearch size={16} aria-hidden="true" />
        </header>
        <p className="knowledge-hint">
          Preview exactly what a task-time knowledge injection would hand an agent — each item names why it was
          picked.
        </p>
        <form className="knowledge-form" onSubmit={submit}>
          <label>
            Task
            <input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe the task this packet is for"
            />
          </label>
          <div className="knowledge-form__split">
            <label>
              Detail
              <select value={detail} onChange={(e) => setDetail(e.target.value as PacketDetail)}>
                <option value="compact">Compact</option>
                <option value="standard">Standard</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
            <label>
              Budget (tokens, optional)
              <input value={budgetLimit} onChange={(e) => setBudgetLimit(e.target.value)} inputMode="numeric" />
            </label>
          </div>
          <label>
            Write scope (comma-separated paths, optional)
            <input value={writeScope} onChange={(e) => setWriteScope(e.target.value)} />
          </label>
          <button
            type="submit"
            className="knowledge-button knowledge-button--primary"
            disabled={packet.isPending || !task.trim()}
          >
            {packet.isPending ? "Building…" : "Build packet"}
          </button>
        </form>
      </section>

      <section className="knowledge-panel" aria-label="Packet result">
        <header className="knowledge-panel__head">
          <h3>Result</h3>
        </header>
        {packet.isPending && <SkeletonBlock variant="text" lines={4} />}
        {packet.isError &&
          (isMethodUnavailableError(packet.error) ? (
            <UnavailableState
              capability="knowledge.packet"
              description="task-time packet previews are not served."
            />
          ) : (
            <ErrorState
              error={packet.error}
              onRetry={() => task.trim() && packet.mutate()}
              title="Packet build failed"
            />
          ))}
        {packet.isSuccess &&
          (items.length === 0 ? (
            <EmptyState
              icon={<PackageSearch size={24} aria-hidden="true" />}
              title="Packet has no items"
              description="Nothing in the knowledge base matched this task within the given budget."
            />
          ) : (
            <div className="knowledge-packet__result">
              <p className="knowledge-packet__summary">
                {items.length} item{items.length === 1 ? "" : "s"}
                {estimatedTokens !== undefined && <> · ~{estimatedTokens} estimated tokens</>}
              </p>
              {truncation && (
                <p className="knowledge-packet__truncation" role="note">
                  Showing {items.length} of {truncation.totalCandidates} candidates ({truncation.droppedCount}{" "}
                  dropped for budget).
                </p>
              )}
              <ul className="knowledge-packet__items">
                {items.map((item, index) => {
                  const kind = firstString(item, ["kind"]) || "item";
                  const title = firstString(item, ["title", "id"]) || `Item ${index + 1}`;
                  const reason = firstString(item, ["reason"]);
                  const score = firstNumber(item, ["score"]);
                  return (
                    <li key={firstString(item, ["id"]) || index}>
                      <span className="knowledge-packet__item-head">
                        <span className="badge neutral">{kind}</span>
                        <strong>{title}</strong>
                        {score !== undefined && (
                          <span className="knowledge-packet__score">{score.toFixed(2)}</span>
                        )}
                      </span>
                      {reason && <span className="knowledge-packet__reason">{reason}</span>}
                    </li>
                  );
                })}
              </ul>
              <DataBlock title="Raw packet" value={packet.data} />
            </div>
          ))}
        {packet.isIdle && <p className="knowledge-hint">Build a packet to see what an agent would receive.</p>}
      </section>
    </div>
  );
}
