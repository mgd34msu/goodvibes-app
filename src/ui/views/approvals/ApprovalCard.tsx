// One approval's full interactive card: category × risk × status badges,
// per-hunk edit selection with REAL diffs (docs/UX.md §4 — not just a
// summary line), approve/deny/claim/cancel, decision trail, "why" reasons,
// and session correlation. Ported from goodvibes-webui
// src/views/approvals/ApprovalCard.tsx; exported standalone so FleetView can
// render the same card inline on a correlated node (FEATURES §3).
//
// A claimed approval is NOT actionable here: `claimedBy` under shared
// bearer-token auth cannot distinguish "this window" from "another surface
// with the same token", and two surfaces must never both resolve one
// approval. Deny always requires a note (docs/UX.md §4) — the parent owns
// the note modal and passes onDeny as its opener.

import { useMemo } from "react";
import { Ban, Check, ExternalLink, Hourglass, X } from "lucide-react";
import {
  auditEntryLabel,
  auditTrail,
  isActionableApproval,
  isTerminalApprovalStatus,
  jumpToSession,
  partialApprovalLabel,
  readApprovalEditHunks,
  riskTone,
  approvalStatusTone,
  type ApprovalEditHunk,
  type ApprovalRecord,
} from "../../lib/approvals.ts";
import { formatRelative } from "../../lib/wire.ts";

export interface ApprovalCardProps {
  record: ApprovalRecord;
  selected: ReadonlySet<number>;
  onToggleHunk: (index: number) => void;
  /** Omitting selectedHunks approves the whole request (back-compat). */
  onApprove: (selectedHunks?: readonly number[]) => void;
  /** Opens the deny-with-note modal — the note is required, never optional. */
  onDeny: () => void;
  approving: boolean;
  denying: boolean;
  /** Optional — omit to hide Claim/Cancel (e.g. a read-only surface). */
  onClaim?: () => void;
  onCancel?: () => void;
  claiming?: boolean;
  cancelling?: boolean;
  /** Deep-link/jump highlight (toast → jump, ?filter[approval]=…). */
  focused?: boolean;
}

/** Real diff rendering for one edit hunk: find = removed, replace = added. */
function HunkDiff({ hunk }: { hunk: ApprovalEditHunk }) {
  const findLines = hunk.find.split("\n");
  const replaceLines = hunk.replace.split("\n");
  return (
    <pre className="hunk-diff" aria-label={`Proposed edit in ${hunk.path}`}>
      {findLines.map((line, i) => (
        <span key={`del-${i}`} className="hunk-diff__line hunk-diff__line--del">
          {`- ${line}`}
        </span>
      ))}
      {replaceLines.map((line, i) => (
        <span key={`add-${i}`} className="hunk-diff__line hunk-diff__line--add">
          {`+ ${line}`}
        </span>
      ))}
    </pre>
  );
}

export function ApprovalCard({
  record,
  selected,
  onToggleHunk,
  onApprove,
  onDeny,
  approving,
  denying,
  onClaim,
  onCancel,
  claiming = false,
  cancelling = false,
  focused = false,
}: ApprovalCardProps) {
  const hunks = useMemo(() => readApprovalEditHunks(record), [record]);
  const actionable = isActionableApproval(record);
  const terminal = isTerminalApprovalStatus(record.status);
  const partialLabel = useMemo(() => partialApprovalLabel(record), [record]);
  const auditEntries = useMemo(() => auditTrail(record), [record]);
  const busy = approving || denying || claiming || cancelling;

  const decisionButtons = (
    <>
      <button
        type="button"
        className="approval-card__btn approval-card__btn--approve"
        disabled={busy}
        onClick={() => onApprove(undefined)}
      >
        <Check size={14} aria-hidden="true" /> {hunks ? "Approve all" : approving ? "Approving…" : "Approve"}
      </button>
      <button type="button" className="approval-card__btn approval-card__btn--deny" disabled={busy} onClick={onDeny}>
        <Ban size={14} aria-hidden="true" /> {denying ? "Denying…" : "Deny…"}
      </button>
      {onClaim && (
        <button
          type="button"
          className="approval-card__btn"
          disabled={busy}
          onClick={onClaim}
          title="Lock this approval to your surface"
        >
          <Hourglass size={14} aria-hidden="true" /> {claiming ? "Claiming…" : "Claim"}
        </button>
      )}
      {onCancel && (
        <button
          type="button"
          className="approval-card__btn"
          disabled={busy}
          onClick={onCancel}
          title="Withdraw without a decision"
        >
          <X size={14} aria-hidden="true" /> {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      )}
    </>
  );

  return (
    <li className={focused ? "approval-card approval-card--focused" : "approval-card"} data-approval-id={record.id}>
      <header className="approval-card__header">
        <span className="approval-card__tool">{record.request.tool}</span>
        <span className="approval-card__badges">
          <span className="badge neutral">{record.request.category}</span>
          <span className={`badge ${riskTone(record.request.analysis.riskLevel)}`}>
            {record.request.analysis.riskLevel}
          </span>
          <span className={`badge ${approvalStatusTone(record.status)}`}>{record.status}</span>
        </span>
      </header>

      {record.request.analysis.summary && <p className="approval-card__summary">{record.request.analysis.summary}</p>}

      <div className="approval-card__meta">
        {record.request.analysis.target && <small>target {record.request.analysis.target}</small>}
        {record.request.workingDirectory && <small>in {record.request.workingDirectory}</small>}
        <small>requested {formatRelative(record.createdAt)}</small>
        {record.sessionId && (
          <button
            type="button"
            className="approval-card__session-link"
            onClick={() => jumpToSession(record.sessionId ?? "")}
            title="Open the session this approval belongs to"
          >
            <ExternalLink size={12} aria-hidden="true" /> session {record.sessionId.slice(0, 8)}
          </button>
        )}
      </div>

      {record.status === "claimed" && (
        <p className="approval-card__note" role="note">
          Claimed by {record.claimedBy ?? "another surface"} — not actionable here.
        </p>
      )}

      {terminal && (
        <p className="approval-card__note" role="note">
          {record.status}
          {record.resolvedAt ? ` ${formatRelative(record.resolvedAt)}` : ""}
          {record.resolvedBy ? ` by ${record.resolvedBy}` : ""}
          {partialLabel ? ` — ${partialLabel}` : ""}
        </p>
      )}

      {terminal && (
        <details className="approval-card__details">
          <summary>Decision trail</summary>
          {auditEntries.length > 0 ? (
            <ul className="approval-card__audit-list">
              {auditEntries.map((entry) => (
                <li key={entry.id}>
                  {auditEntryLabel(entry)} — {formatRelative(entry.createdAt)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="approval-card__details-empty">No decision trail reported for this record.</p>
          )}
        </details>
      )}

      {actionable && hunks && (
        <div className="approval-card__hunks">
          <ul className="hunk-rows">
            {hunks.map((hunk, index) => (
              <li key={hunk.id ?? index} className="hunk-row">
                <label className="hunk-row__label">
                  <input
                    type="checkbox"
                    checked={selected.has(index)}
                    onChange={() => onToggleHunk(index)}
                    aria-label={`Include hunk ${index + 1} in ${hunk.path}`}
                  />
                  <span className="hunk-row__path">{hunk.path}</span>
                </label>
                <HunkDiff hunk={hunk} />
              </li>
            ))}
          </ul>
          <div className="approval-card__actions">
            <button
              type="button"
              className="approval-card__btn approval-card__btn--approve"
              disabled={selected.size === 0 || busy}
              onClick={() => onApprove([...selected])}
              title="Approve only the checked hunks — the daemon computes the modified edit"
            >
              <Check size={14} aria-hidden="true" /> Approve selected ({selected.size})
            </button>
            {decisionButtons}
          </div>
        </div>
      )}

      {actionable && !hunks && <div className="approval-card__actions">{decisionButtons}</div>}

      {record.request.analysis.reasons.length > 0 && (
        <details className="approval-card__details">
          <summary>Why</summary>
          <ul className="approval-card__reason-list">
            {record.request.analysis.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
