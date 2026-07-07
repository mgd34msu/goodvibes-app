// The recall-honesty contract, surfaced verbatim (ported from goodvibes-webui
// views/memory/MemorySearchHonestyNote.tsx). Three things this MUST NEVER do:
//   1. Hide `indexUnavailableReason` — a silent empty result would read as
//      "nothing was ever stored" when the truth is "the semantic index could
//      not be consulted, so this fell back to a literal scan". Verbatim.
//   2. Hide `caveat` — the softer "ran on the hashed-only fallback provider"
//      note.
//   3. Hide the recall-filter exclusion counts when `recallFiltered` is true —
//      a caller who asked "what would the agent actually see" needs to know
//      how many records were excluded and why.
//
// `totalBeforeRecallFilter` is whatever the underlying search returned (itself
// capped at the caller's `limit`), NOT every matching record — the label says
// "of the first N matches" so it never over-claims completeness. The recall
// floor is stated from the wire value (`recallFloor`), never hardcoded.

import { AlertTriangle, Info } from "lucide-react";
import type { MemorySearchEnvelope } from "./memory-wire.ts";

export function MemorySearchHonestyNote({ result, limit }: { result: MemorySearchEnvelope; limit?: number }) {
  return (
    <div className="memory-honesty-note" aria-live="polite">
      <span className={`badge ${result.mode === "semantic" ? "ok" : "neutral"}`}>
        {result.mode === "semantic" ? "Semantic search" : "Literal search"}
      </span>

      {result.indexUnavailableReason !== null && (
        <div className="memory-honesty-note__banner memory-honesty-note__banner--degraded" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{result.indexUnavailableReason}</span>
        </div>
      )}

      {result.caveat !== null && (
        <div className="memory-honesty-note__banner memory-honesty-note__banner--caveat" role="status">
          <Info size={16} aria-hidden="true" />
          <span>{result.caveat}</span>
        </div>
      )}

      {result.recallFiltered && (
        <p className="memory-honesty-note__recall-stats">
          {result.records.length} shown after the recall filter
          {" · "}
          {result.excludedFlaggedCount} excluded (flagged stale/contradicted)
          {" · "}
          {result.excludedBelowFloorCount} excluded (below the{" "}
          {result.recallFloor !== undefined ? `${result.recallFloor}%` : "store's"} recall floor)
          {" · "}
          {result.totalBeforeRecallFilter} {typeof limit === "number" ? `of the first ${limit} matches` : "total"}{" "}
          before the recall filter
        </p>
      )}
    </div>
  );
}
