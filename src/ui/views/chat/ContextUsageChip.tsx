// Session-scoped context-usage chip for the chat header — fed by
// sessions.contextUsage.get (contract 1.11). Distinct from TurnActivity.tsx's
// ContextMeter: that one is a PER-TURN wire-reported usage readout (only
// present once a turn's completed event carries a usage block); this is a
// standing SESSION-level estimate that persists across turns. `estimated` is
// ALWAYS true on this verb (docs comment on sessions.contextUsage.get) — the
// "~" is never dropped, even once the number looks confident.
//
// Refetch policy: no interval. ChatView invalidates queryKeys.sessionContextUsage
// from the same places it already invalidates chat state after a turn settles
// (invalidateChatState) — this component only reads the cache.
//
// TRAP (A2 brief): the daemon answers this verb ONLY for its own live local
// runtime session. Any other session id — including, per this app's own
// ambiguity about companion-chat vs. local-runtime session id spaces, quite
// possibly EVERY companion-chat session — comes back 404 SESSION_NOT_LOCAL.
// That is not an error to show: render nothing.

import { useQuery } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { firstNumber } from "../../lib/wire.ts";

const WARN_THRESHOLD_PCT = 80;

export function ContextUsageChip({ sessionId }: { sessionId: string }) {
  const usage = useQuery({
    queryKey: queryKeys.sessionContextUsage(sessionId),
    queryFn: () => gv.sessions.contextUsage(sessionId),
    enabled: Boolean(sessionId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // Honest-degrade verbs (SESSION_NOT_LOCAL chief among them), not
    // transient failures — no point retrying, and any error here (that
    // one included) just hides the chip below rather than showing anything
    // scary.
    retry: false,
  });

  if (!sessionId || !usage.isSuccess) return null;

  const pct = firstNumber(usage.data, ["contextUsagePct"]);
  if (pct === undefined) return null;
  const remaining = firstNumber(usage.data, ["contextRemainingTokens"]);
  const total = firstNumber(usage.data, ["contextWindow"]);
  const warn = pct >= WARN_THRESHOLD_PCT;

  const title =
    remaining !== undefined && total !== undefined
      ? `Estimated context usage — ${remaining.toLocaleString()} tokens remaining of ${total.toLocaleString()}. Always an estimate, never a measured provider count.`
      : "Estimated context usage. Always an estimate, never a measured provider count.";

  return (
    <span
      className={warn ? "chat-context-chip chat-context-chip--warn" : "chat-context-chip"}
      role="status"
      title={title}
    >
      Context: ~{Math.round(pct)}%
    </span>
  );
}
