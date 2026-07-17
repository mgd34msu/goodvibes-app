// workspaces-model.ts — parse helpers + hooks for the "Registered workspaces"
// panel (WorkspacesPanel.tsx), backing workspaces.registrations.list/add/
// remove and workspaces.resolve. All four are dual http+ws transport
// (operator-contract.json), unlike worktrees.setup.run/discard's ws-only pair
// in worktrees-actions.ts — no isWsBridgeUnavailableError handling needed
// here specifically, but the generic capability-gap check still applies for
// a daemon build old enough not to carry workspaces.* at all.
//
// checkpointEligible distinction (crib: goodvibes-agent's
// config/workspace-registration.ts + cli/workspaces-command.ts): the field
// is a plain optional boolean on the wire. Its ABSENCE means "not eligible",
// not "unknown" — and re-registering the same root without the field must
// never be read as "strip the stamp" by a client that already saw it set.
// Rendered as its own explicit badge (present+true vs. anything else) rather
// than folded into a general status line, per this round's brief.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { asRecord, firstString } from "../../lib/wire.ts";

// ─── workspaces.registrations.list ───────────────────────────────────────────

export interface WorkspaceRegistration {
  readonly root: string;
  readonly registeredAt: string;
  readonly label: string;
  readonly origin: string;
  /** Explicit boolean — undefined (field absent) reads as "not eligible",
   * never as "unknown"/error. See this module's header comment. */
  readonly checkpointEligible: boolean;
}

export interface WorkspaceDecline {
  readonly root: string;
  readonly declinedAt: string;
}

function parseRegistration(value: unknown): WorkspaceRegistration | null {
  const record = asRecord(value);
  const root = firstString(record, ["root"]);
  if (!root) return null;
  return {
    root,
    registeredAt: firstString(record, ["registeredAt"]),
    label: firstString(record, ["label"]),
    origin: firstString(record, ["origin"]),
    checkpointEligible: record["checkpointEligible"] === true,
  };
}

function parseDecline(value: unknown): WorkspaceDecline | null {
  const record = asRecord(value);
  const root = firstString(record, ["root"]);
  if (!root) return null;
  return { root, declinedAt: firstString(record, ["declinedAt"]) };
}

export interface WorkspaceRegistrationsSnapshot {
  readonly workspaces: readonly WorkspaceRegistration[];
  readonly declines: readonly WorkspaceDecline[];
}

export function parseWorkspaceRegistrations(value: unknown): WorkspaceRegistrationsSnapshot {
  const record = asRecord(value);
  const workspaces = (Array.isArray(record["workspaces"]) ? record["workspaces"] : [])
    .map(parseRegistration)
    .filter((w): w is WorkspaceRegistration => w !== null);
  const declines = (Array.isArray(record["declines"]) ? record["declines"] : [])
    .map(parseDecline)
    .filter((d): d is WorkspaceDecline => d !== null);
  return { workspaces, declines };
}

export function useWorkspaceRegistrations() {
  return useQuery({
    queryKey: queryKeys.workspaceRegistrations,
    queryFn: () => gv.workspaces.registrations.list(),
    retry: false,
  });
}

// ─── workspaces.registrations.add / .remove ─────────────────────────────────

export interface AddWorkspaceInput {
  readonly root: string;
  readonly label: string;
  readonly checkpointEligible: boolean;
}

export interface AddWorkspaceResult {
  readonly workspace: WorkspaceRegistration | null;
  readonly alreadyRegistered: boolean;
}

export function parseAddWorkspaceResult(value: unknown): AddWorkspaceResult {
  const record = asRecord(value);
  return {
    workspace: parseRegistration(record["workspace"]),
    alreadyRegistered: record["alreadyRegistered"] === true,
  };
}

export function useAddWorkspaceRegistration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddWorkspaceInput) =>
      gv.workspaces.registrations.add({
        root: input.root,
        ...(input.label ? { label: input.label } : {}),
        // Omit rather than send an explicit false: the field is optional on
        // the wire, and per the eligibility-stamp guarantee (crib:
        // goodvibes-agent's checkpoint-eligibility distinction) a plain
        // re-registration must never strip an existing stamp. Only an
        // explicit, checked request ever sets it true; unchecking the box
        // and re-registering (e.g. just to update the label) leaves whatever
        // the daemon already has alone.
        ...(input.checkpointEligible ? { checkpointEligible: true } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workspaceRegistrations }),
  });
}

export interface RemoveWorkspaceResult {
  readonly root: string;
  readonly removed: boolean;
}

export function parseRemoveWorkspaceResult(value: unknown, fallbackRoot: string): RemoveWorkspaceResult {
  const record = asRecord(value);
  return {
    root: firstString(record, ["root"]) || fallbackRoot,
    removed: record["removed"] === true,
  };
}

export function useRemoveWorkspaceRegistration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (root: string) => gv.workspaces.registrations.remove({ root }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workspaceRegistrations }),
  });
}

// ─── workspaces.resolve ──────────────────────────────────────────────────────

export type WorkspaceResolveStatus = "covered" | "declined" | "unknown";

export interface WorkspaceResolveResult {
  readonly path: string;
  readonly status: WorkspaceResolveStatus;
  readonly coveredBy: string | null;
  readonly declinedRoot: string | null;
  readonly viaWorktreeLink: boolean;
  readonly reason: string;
}

const RESOLVE_STATUSES: readonly WorkspaceResolveStatus[] = ["covered", "declined", "unknown"];

export function parseWorkspaceResolveResult(value: unknown, fallbackPath: string): WorkspaceResolveResult | null {
  const record = asRecord(value);
  const status = RESOLVE_STATUSES.find((s) => s === record["status"]);
  if (!status) return null;
  return {
    path: firstString(record, ["path"]) || fallbackPath,
    status,
    coveredBy: firstString(record, ["coveredBy"]) || null,
    declinedRoot: firstString(record, ["declinedRoot"]) || null,
    viaWorktreeLink: record["viaWorktreeLink"] === true,
    reason: firstString(record, ["reason"]),
  };
}

export function useResolveWorkspacePath() {
  return useMutation({
    mutationFn: (path: string) => gv.workspaces.resolve({ path }),
  });
}
