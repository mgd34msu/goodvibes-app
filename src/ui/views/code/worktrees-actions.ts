// worktrees-actions.ts — per-worktree "Run setup" and "Discard" for
// WorktreesView.tsx rows (crib: goodvibes-tui's /worktree setup|discard —
// the sole reference; goodvibes-webui never shipped this surface).
//
// Both verbs are ws-only on the wire (see gv.ts's `worktrees.setupRun` /
// `worktrees.discard` comments) — a down ws bridge degrades via
// isWsBridgeUnavailableError, the same treatment CheckpointsView.tsx gives
// its own all-ws-only checkpoints.* verbs.
//
// worktrees.discard's declared inputSchema (operator-contract.json) lists
// only `path` with additionalProperties:false — it does not enumerate
// confirm/explicitUserRequest the way checkpoints.restore does. The app-wide
// convention for every OTHER dangerous-flagged verb (WatchersView.tsx's
// watchers.delete, HomeGraphPanel.tsx's *.reset/*.import, ...) is to forward
// the ConfirmSurface metadata on the wire regardless of whether the static
// contract enumerates it — the daemon's runtime accepts it even where the
// generated schema doc doesn't list it. Followed here for consistency rather
// than inventing a new pattern for this one verb.

import { useMutation } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import type { ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { asRecord, firstString } from "../../lib/wire.ts";

// ─── worktrees.setup.run ─────────────────────────────────────────────────────

export type WorktreeSetupState = "skipped" | "succeeded" | "failed";

export interface WorktreeSetupStep {
  readonly kind: string;
  readonly label: string;
  readonly ok: boolean;
  readonly exitCode?: number;
  readonly output?: string;
}

export interface WorktreeSetupResult {
  readonly state: WorktreeSetupState;
  readonly steps: readonly WorktreeSetupStep[];
  readonly error?: string;
}

const SETUP_STATES: readonly WorktreeSetupState[] = ["skipped", "succeeded", "failed"];

/** Defensive wire parse for worktrees.setup.run's `setup` object AND the
 * identically-shaped `setup` field persisted per-record on
 * worktrees.snapshot's `records[]`. Null when the answer does not actually
 * carry a setup result — never a fabricated state. */
export function parseWorktreeSetupResult(value: unknown): WorktreeSetupResult | null {
  const record = asRecord(value);
  const state = SETUP_STATES.find((s) => s === record["state"]);
  if (!state) return null;
  const steps = (Array.isArray(record["steps"]) ? record["steps"] : []).map((entry): WorktreeSetupStep => {
    const step = asRecord(entry);
    const output = firstString(step, ["output"]);
    return {
      kind: firstString(step, ["kind"]) || "command",
      label: firstString(step, ["label"]),
      ok: step["ok"] === true,
      ...(typeof step["exitCode"] === "number" ? { exitCode: step["exitCode"] } : {}),
      ...(output ? { output } : {}),
    };
  });
  const error = firstString(record, ["error"]);
  return { state, steps, ...(error ? { error } : {}) };
}

/** Compact row-tag label — "succeeded (N steps)" / "skipped" / "FAILED". A
 * failed setup is a visible persistent row state (never silently absorbed). */
export function formatSetupSummary(result: WorktreeSetupResult): string {
  if (result.state === "succeeded") {
    return `succeeded (${result.steps.length} step${result.steps.length === 1 ? "" : "s"})`;
  }
  if (result.state === "failed") return "FAILED";
  return "skipped";
}

export function failingSetupSteps(result: WorktreeSetupResult): WorktreeSetupStep[] {
  return result.steps.filter((step) => !step.ok);
}

/** Re-run cold-start setup for one worktree by path. */
export function useWorktreeSetupRun() {
  return useMutation({
    mutationFn: (path: string) => gv.worktrees.setupRun({ path }),
  });
}

// ─── worktrees.discard ────────────────────────────────────────────────────────

export interface WorktreeDiscardReceipt {
  readonly path: string;
  readonly ok: boolean;
  readonly branch: string;
  readonly preservedCommit: string;
  readonly detail: string;
}

/** Defensive wire parse for the discard receipt. branch/preservedCommit stay
 * empty strings when the daemon genuinely didn't report one — callers render
 * an honest "(unknown)" / "(none — nothing to preserve)" label for the
 * empty case rather than treating it as a parse failure (crib: goodvibes-tui
 * worktree-runtime.ts's exact wording for the same receipt). */
export function parseDiscardReceipt(value: unknown, fallbackPath: string): WorktreeDiscardReceipt {
  const record = asRecord(value);
  return {
    path: firstString(record, ["path"]) || fallbackPath,
    ok: record["ok"] === true,
    branch: firstString(record, ["branch"]),
    preservedCommit: firstString(record, ["preservedCommit"]),
    detail: firstString(record, ["detail"]),
  };
}

/** Remove a worktree per the eviction-preserving rules — the branch is KEPT,
 * any dirty state is committed onto it first. Confirm-gated client-side; see
 * this module's header comment on why ConfirmMetadata is still forwarded on
 * the wire despite the narrower declared inputSchema. */
export function useWorktreeDiscard() {
  return useMutation({
    mutationFn: ({ path, meta }: { path: string; meta: ConfirmMetadata }) => gv.worktrees.discard({ path, ...meta }),
  });
}
