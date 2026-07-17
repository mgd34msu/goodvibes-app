// Live-turn chrome: the thinking strip (turn state machine + elapsed + token
// throughput — estimated from streamed chars and labelled "~"; wire-reported
// usage supersedes it) and collapsible tool-call blocks with contract status
// glyphs (docs/UX.md §4 streaming rules).

import { Ban, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { compactJson } from "../../lib/wire.ts";
import { estimateTokens } from "./message-utils.ts";
import type { ToolCallBlock, TurnMetrics } from "./types.ts";

// ─── Tool-call blocks ────────────────────────────────────────────────────────

interface ToolCallItemProps {
  block: ToolCallBlock;
  /** sessions.toolCalls.cancel(sessionId, callId) — omitted entirely once
   * useChatStream reports the daemon has never heard of the verb. */
  onCancel?: (callId: string) => void;
  cancelling: boolean;
}

function ToolCallItem({ block, onCancel, cancelling }: ToolCallItemProps) {
  const [open, setOpen] = useState(false);
  const statusLabel = block.status === "running" ? "running" : block.status === "error" ? "error" : "done";
  const showCancel = block.status === "running" && Boolean(onCancel);
  return (
    <div className={`tool-call tool-call--${block.status}`}>
      <button
        type="button"
        className="tool-call__header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Tool call ${block.toolName} — ${statusLabel}`}
      >
        {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        <span className="tool-call__name">{block.toolName}</span>
        <StatusBadge value={cancelling ? "cancelling" : statusLabel} />
      </button>
      {showCancel && (
        <button
          type="button"
          className="tool-call__cancel"
          disabled={cancelling}
          aria-label={`Cancel tool call ${block.toolName}`}
          title="Cancel this tool call — the turn and any other running calls keep going"
          onClick={(event) => {
            event.stopPropagation();
            onCancel?.(block.toolCallId);
          }}
        >
          <Ban size={12} aria-hidden="true" />
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      )}
      {open && (
        <div className="tool-call__detail">
          {block.input !== undefined && (
            <div className="tool-call__section">
              <span className="tool-call__section-label">Input</span>
              <pre>{compactJson(block.input)}</pre>
            </div>
          )}
          {block.result !== undefined && (
            <div className="tool-call__section">
              <span className="tool-call__section-label">Result</span>
              <pre>{compactJson(block.result)}</pre>
            </div>
          )}
          {block.input === undefined && block.result === undefined && (
            <p className="tool-call__empty">No payload reported for this call.</p>
          )}
        </div>
      )}
    </div>
  );
}

export interface ToolCallBlocksProps {
  blocks: ToolCallBlock[];
  /** sessions.toolCalls.cancel — undefined once the daemon build has proven
   * it doesn't support the verb, so no call ever offers a cancel button. */
  onCancel?: (callId: string) => void;
  cancellingIds?: ReadonlySet<string>;
}

export function ToolCallBlocks({ blocks, onCancel, cancellingIds }: ToolCallBlocksProps) {
  if (!blocks.length) return null;
  return (
    <div className="tool-calls" role="log" aria-label="Tool activity">
      {blocks.map((block) => (
        <ToolCallItem
          key={block.toolCallId}
          block={block}
          {...(onCancel ? { onCancel } : {})}
          cancelling={cancellingIds?.has(block.toolCallId) ?? false}
        />
      ))}
    </div>
  );
}

// ─── Thinking strip ──────────────────────────────────────────────────────────

interface ThinkingStripProps {
  turnState: string;
  metrics: TurnMetrics | null;
  streaming: boolean;
  /** False while ChatView is the keep-alive view sitting behind another
   * (display:none — see ChatView's own `viewVisible` MutationObserver). Chat
   * never unmounts on a view switch, so without this the 500ms tick would
   * keep ticking, invisibly, for as long as a turn runs in the background. */
  viewVisible: boolean;
  onStop?: () => void;
}

export function ThinkingStrip({ turnState, metrics, streaming, viewVisible, onStop }: ThinkingStripProps) {
  // 500ms tick keeps elapsed/tok-per-sec live while a turn runs and this
  // view is actually visible.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!streaming || !viewVisible) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(timer);
  }, [streaming, viewVisible]);

  if (!streaming && turnState !== "syncing") return null;

  const elapsedMs = metrics ? Date.now() - metrics.startedAt : 0;
  const elapsedSec = elapsedMs / 1000;
  const tokens = metrics ? estimateTokens(metrics.deltaChars) : 0;
  const tokensPerSec = elapsedSec > 0.5 && tokens > 0 ? (tokens / elapsedSec).toFixed(1) : "";

  return (
    <div className="thinking-strip" role="status" aria-live="polite">
      <StatusBadge value={turnState} />
      {metrics && elapsedSec >= 1 && <span className="thinking-strip__stat">{Math.floor(elapsedSec)}s</span>}
      {tokens > 0 && (
        <span className="thinking-strip__stat" title="Estimated from streamed characters (~4 chars/token)">
          ~{tokens} tok
        </span>
      )}
      {tokensPerSec && <span className="thinking-strip__stat">{tokensPerSec} tok/s</span>}
      {onStop && (
        <button type="button" className="thinking-strip__stop" onClick={onStop} aria-label="Stop generating">
          Stop
        </button>
      )}
    </div>
  );
}

// ─── Context usage meter (wire-reported only — honest-hidden otherwise) ──────

export function ContextMeter({ metrics }: { metrics: TurnMetrics | null }) {
  const usage = metrics?.usage;
  if (!usage) return null;
  const used = usage.contextTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (!used) return null;
  const max = usage.maxContextTokens;
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : null;
  const fresh = usage.inputTokens !== undefined && usage.cachedTokens !== undefined
    ? `${usage.inputTokens - usage.cachedTokens} fresh · ${usage.cachedTokens} cached`
    : "";
  return (
    <div
      className="context-meter"
      role="status"
      title={`Context usage reported by the daemon${fresh ? ` — ${fresh}` : ""}`}
    >
      <span className="context-meter__label">
        context {used.toLocaleString()} tok{max ? ` / ${max.toLocaleString()}` : ""}
        {fresh ? ` (${fresh})` : ""}
      </span>
      {pct !== null && (
        <span className="context-meter__bar" aria-hidden="true">
          <span className="context-meter__fill" style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}
