// FleetAttempts — best-of-N attempt groups (fleet.attempts.*, operator
// contract 1.11): passing siblings run in isolated worktrees and park
// HELD instead of auto-merging; a human (or autoAccept) picks the winner.
//
// useFleetAttemptGroups polls alongside the fleet snapshot and degrades to
// an empty group list — SILENTLY — when this daemon has never heard of the
// verb (isMethodUnavailableError): an older daemon simply has no best-of-N
// feature, not a failure to report.
//
// FleetAttemptsSection collapses the groups into one "Best-of-N (N)" list
// entry per group; AttemptComparisonModal is the detail surface where every
// candidate is compared (diff stat + usage/cost side by side) and picked.
// fleet.attempts.judge PROPOSES a winner with reasons — rendered clearly
// labeled as model judgment, never an auto-pick; a not-invokable judge
// (no judge model configured) renders "pick manually", not an error.
// fleet.attempts.pick's result.applied is the ONLY success signal — an HTTP
// ok with applied:false (the group went stale) is NOT a completed merge.

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, Gavel, Layers, Trophy } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { errorStatus, formatError, isMethodNotInvokableError, isMethodUnavailableError } from "../../lib/errors.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { asArray, asRecord, firstString } from "../../lib/wire.ts";
import { FLEET_POLL_INTERVAL_MS } from "./fleet.ts";

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface AttemptCandidateUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCallCount: number;
  readonly costUsd: number | null;
  readonly costState: string;
}

export interface AttemptCandidateDiff {
  readonly files: readonly string[];
  readonly unifiedDiff: string;
  readonly stat: string;
}

export interface AttemptCandidate {
  readonly itemId: string;
  readonly attemptIndex: number;
  /** 'held-merge' | 'failed' (open string — render verbatim if ever unknown). */
  readonly state: string;
  readonly title: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
  readonly usage: AttemptCandidateUsage;
  readonly failureReason: string | null;
  readonly diff: AttemptCandidateDiff | null;
}

export interface AttemptJudgment {
  readonly proposedWinnerItemId: string | null;
  readonly reasons: readonly string[];
  readonly model: string | null;
}

export interface AttemptGroup {
  readonly groupId: string;
  readonly workstreamId: string;
  readonly sourceTitle: string;
  readonly ready: boolean;
  readonly candidates: readonly AttemptCandidate[];
  readonly autoAccept: boolean;
  readonly judgment: AttemptJudgment | null;
}

function normalizeUsage(value: unknown): AttemptCandidateUsage {
  const record = asRecord(value);
  return {
    inputTokens: optionalNumber(record["inputTokens"]) ?? 0,
    outputTokens: optionalNumber(record["outputTokens"]) ?? 0,
    toolCallCount: optionalNumber(record["toolCallCount"]) ?? 0,
    costUsd: optionalNumber(record["costUsd"]),
    costState: firstString(record, ["costState"]),
  };
}

function normalizeDiff(value: unknown): AttemptCandidateDiff | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  return {
    files: asArray(record["files"]).filter((f): f is string => typeof f === "string"),
    unifiedDiff: firstString(record, ["unifiedDiff"]),
    stat: firstString(record, ["stat"]),
  };
}

function normalizeCandidate(value: unknown): AttemptCandidate {
  const record = asRecord(value);
  return {
    itemId: firstString(record, ["itemId"]),
    attemptIndex: optionalNumber(record["attemptIndex"]) ?? 0,
    state: firstString(record, ["state"]),
    title: firstString(record, ["title"]),
    worktreePath: record["worktreePath"] === null ? null : firstString(record, ["worktreePath"]) || null,
    branch: record["branch"] === null ? null : firstString(record, ["branch"]) || null,
    usage: normalizeUsage(record["usage"]),
    failureReason: record["failureReason"] === null ? null : firstString(record, ["failureReason"]) || null,
    diff: normalizeDiff(record["diff"]),
  };
}

function normalizeJudgment(value: unknown): AttemptJudgment | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  return {
    proposedWinnerItemId: record["proposedWinnerItemId"] === null ? null : firstString(record, ["proposedWinnerItemId"]) || null,
    reasons: asArray(record["reasons"]).filter((r): r is string => typeof r === "string"),
    model: record["model"] === null ? null : firstString(record, ["model"]) || null,
  };
}

function normalizeGroup(value: unknown): AttemptGroup {
  const record = asRecord(value);
  return {
    groupId: firstString(record, ["groupId"]),
    workstreamId: firstString(record, ["workstreamId"]),
    sourceTitle: firstString(record, ["sourceTitle"]),
    ready: record["ready"] === true,
    candidates: asArray(record["candidates"]).map(normalizeCandidate),
    autoAccept: record["autoAccept"] === true,
    judgment: normalizeJudgment(record["judgment"]),
  };
}

/** Polls fleet.attempts.list alongside the fleet snapshot; a daemon that has
 * never heard of best-of-N degrades to an empty group list SILENTLY (no
 * error state — it simply has no feature, not a failure). */
export function useFleetAttemptGroups(enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.fleetAttempts,
    queryFn: async () => {
      try {
        const raw = asRecord(await gv.fleet.attempts.list());
        return asArray(raw["groups"]).map(normalizeGroup);
      } catch (error) {
        if (isMethodUnavailableError(error)) return [];
        throw error;
      }
    },
    refetchInterval: FLEET_POLL_INTERVAL_MS,
    retry: false,
    enabled,
  });
  return { groups: query.data ?? [], query };
}

function candidateCostLabel(usage: AttemptCandidateUsage): string {
  if (usage.costState === "unpriced" || usage.costUsd == null) {
    return usage.costState === "estimated" ? "estimating…" : "unpriced";
  }
  const amount = `$${usage.costUsd.toFixed(usage.costUsd < 1 ? 4 : 2)}`;
  return usage.costState === "estimated" ? `~${amount}` : amount;
}

export function FleetAttemptsSection({
  groups,
  onOpenGroup,
}: {
  groups: readonly AttemptGroup[];
  onOpenGroup: (groupId: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="fleet-attempts">
      <div className="fleet-attempts__head">
        <Layers size={13} aria-hidden="true" /> Best-of-N <span className="fleet-attempts__count">{groups.length}</span>
      </div>
      <ul className="fleet-attempts__list">
        {groups.map((group) => {
          const held = group.candidates.filter((c) => c.state === "held-merge").length;
          return (
            <li key={group.groupId}>
              <button
                type="button"
                className={`fleet-attempts__group${group.ready ? " ready" : ""}`}
                onClick={() => onOpenGroup(group.groupId)}
              >
                <span className="fleet-attempts__group-title">{group.sourceTitle || group.groupId}</span>
                <span className="fleet-attempts__group-badges">
                  {group.ready ? (
                    <span className="badge warning">Ready — compare &amp; pick</span>
                  ) : (
                    <span className="badge neutral">Waiting for attempts</span>
                  )}
                  <span className="badge neutral">
                    {held}/{group.candidates.length} held
                  </span>
                  {group.judgment && <span className="badge neutral">judge ready</span>}
                </span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AttemptComparisonModal({
  open,
  group,
  onClose,
  onPicked,
}: {
  open: boolean;
  group: AttemptGroup;
  onClose: () => void;
  onPicked: () => void;
}) {
  const heldCandidates = useMemo(() => group.candidates.filter((c) => c.state === "held-merge"), [group.candidates]);
  const [judgment, setJudgment] = useState<AttemptJudgment | null>(group.judgment);
  const [selectedId, setSelectedId] = useState<string>(
    () => group.judgment?.proposedWinnerItemId ?? heldCandidates[0]?.itemId ?? "",
  );
  const [confirmPick, setConfirmPick] = useState(false);
  const [staleNote, setStaleNote] = useState<string | null>(null);

  const judge = useMutation({
    mutationFn: () => gv.fleet.attempts.judge({ groupId: group.groupId }),
    onSuccess: (result) => {
      const normalized = normalizeJudgment(result);
      setJudgment(normalized);
      if (normalized?.proposedWinnerItemId) setSelectedId(normalized.proposedWinnerItemId);
    },
  });

  const pick = useMutation({
    mutationFn: (winnerItemId: string) =>
      gv.fleet.attempts.pick({ groupId: group.groupId, winnerItemId, confirm: true }),
    onSuccess: (result) => {
      const applied = asRecord(result)["applied"] === true;
      if (!applied) {
        setStaleNote("The daemon did not apply this pick — the group may no longer be ready. Refresh the fleet and try again.");
        return;
      }
      onPicked();
      onClose();
    },
    onError: (error: unknown) => {
      if (errorStatus(error) === 409) {
        setStaleNote("This group is no longer ready to pick — refresh the fleet and try again.");
      }
    },
  });

  const judgeUnavailable = judge.isError && isMethodNotInvokableError(judge.error);
  const selectedCandidate = group.candidates.find((c) => c.itemId === selectedId);

  return (
    <Modal open={open} onClose={onClose} title={`Compare attempts — ${group.sourceTitle || group.groupId}`} size="lg">
      <div className="attempt-cmp">
        <p className="attempt-cmp__intro">
          {heldCandidates.length} held candidate{heldCandidates.length === 1 ? "" : "s"} of {group.candidates.length}.
          Pick the winner to merge it and clean the losing worktrees.
        </p>

        <div className="attempt-cmp__judge">
          <div className="attempt-cmp__judge-head">
            <Gavel size={14} aria-hidden="true" />
            <strong>Model judgment</strong>
            <span className="attempt-cmp__judge-tag">MODEL PROPOSAL — advisory only; you still confirm</span>
            <button type="button" className="fleet-action" disabled={judge.isPending} onClick={() => judge.mutate()}>
              {judge.isPending ? "Asking the judge…" : judgment ? "Re-run judge" : "Ask the judge"}
            </button>
          </div>
          {judgeUnavailable && <p className="attempt-cmp__note" role="note">Pick manually — no judge model is configured on this daemon.</p>}
          {judge.isError && !judgeUnavailable && (
            <p className="attempt-cmp__error" role="alert">
              {formatError(judge.error)}
            </p>
          )}
          {judgment && (
            <div className="attempt-cmp__judgment">
              <p>
                Proposes{" "}
                <strong>
                  {group.candidates.find((c) => c.itemId === judgment.proposedWinnerItemId)?.title ??
                    judgment.proposedWinnerItemId ??
                    "no clear winner"}
                </strong>
                {judgment.model ? ` (scored by ${judgment.model})` : ""}.
              </p>
              {judgment.reasons.length > 0 && (
                <ul className="attempt-cmp__reasons">
                  {judgment.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="attempt-cmp__candidates">
          {group.candidates.map((candidate) => {
            const held = candidate.state === "held-merge";
            const isProposed = judgment?.proposedWinnerItemId === candidate.itemId;
            return (
              <div
                key={candidate.itemId}
                className={`attempt-cmp__candidate${isProposed ? " attempt-cmp__candidate--proposed" : ""}`}
              >
                <div className="attempt-cmp__candidate-head">
                  <label className="attempt-cmp__pick-radio">
                    <input
                      type="radio"
                      name="attempt-winner"
                      value={candidate.itemId}
                      checked={selectedId === candidate.itemId}
                      disabled={!held}
                      onChange={() => setSelectedId(candidate.itemId)}
                    />
                    <span className="attempt-cmp__candidate-title">
                      #{candidate.attemptIndex + 1} {candidate.title}
                    </span>
                  </label>
                  <span className={`badge ${held ? "ok" : "bad"}`}>{candidate.state}</span>
                  {isProposed && <span className="badge warning">judge pick</span>}
                  <span className="badge neutral">{candidateCostLabel(candidate.usage)}</span>
                </div>
                <div className="attempt-cmp__candidate-meta">
                  <small>
                    {candidate.usage.inputTokens} in · {candidate.usage.outputTokens} out ·{" "}
                    {candidate.usage.toolCallCount} tool calls
                  </small>
                  {candidate.branch && <small> · {candidate.branch}</small>}
                </div>
                {candidate.failureReason && (
                  <p className="attempt-cmp__failure" role="note">
                    Failed: {candidate.failureReason}
                  </p>
                )}
                {candidate.diff ? (
                  <div className="attempt-cmp__diff">
                    <p className="attempt-cmp__diff-stat">{candidate.diff.stat || `${candidate.diff.files.length} file(s) changed`}</p>
                    {candidate.diff.files.length > 0 && (
                      <p className="attempt-cmp__diff-files">{candidate.diff.files.join(", ")}</p>
                    )}
                    {candidate.diff.unifiedDiff && (
                      <details className="attempt-cmp__diff-raw">
                        <summary>Diff</summary>
                        <pre>{candidate.diff.unifiedDiff}</pre>
                      </details>
                    )}
                  </div>
                ) : (
                  !candidate.failureReason && <p className="attempt-cmp__note" role="note">No diff captured for this candidate.</p>
                )}
              </div>
            );
          })}
        </div>

        {staleNote && (
          <p className="attempt-cmp__error" role="alert">
            {staleNote}
          </p>
        )}
        {pick.isError && errorStatus(pick.error) !== 409 && (
          <p className="attempt-cmp__error" role="alert">
            {formatError(pick.error)}
          </p>
        )}

        <div className="attempt-cmp__actions">
          <button
            type="button"
            className="fleet-action fleet-action--primary"
            disabled={!selectedId || pick.isPending || heldCandidates.length === 0}
            onClick={() => setConfirmPick(true)}
          >
            <Trophy size={14} aria-hidden="true" /> {pick.isPending ? "Merging winner…" : "Pick this winner"}
          </button>
        </div>
      </div>

      <ConfirmSurface
        open={confirmPick}
        action="Pick this attempt as the winner"
        target={selectedCandidate?.title ?? selectedId}
        danger
        blastRadius="Merges the winner through the integration lane and cleans every losing worktree — cannot be undone."
        confirmLabel="Pick winner"
        onConfirm={() => {
          setConfirmPick(false);
          setStaleNote(null);
          pick.mutate(selectedId);
        }}
        onCancel={() => setConfirmPick(false)}
      />
    </Modal>
  );
}
