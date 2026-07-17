// FleetConflicts — merge-conflict rows waiting on a human (fleet.conflicts.*,
// operator contract 1.11): a work item whose integration merge conflicted,
// with the kept worktree path, branch, the STRUCTURED conflicting-file list,
// and the resolution session id once one was spawned.
//
// useFleetConflicts polls alongside the fleet snapshot and degrades to an
// empty list SILENTLY when this daemon has never heard of the verb — an
// older daemon simply predates the feature, not a failure.
//
// Resolve spawns a REAL resolution session inside the kept worktree
// (fleet.conflicts.resolve) — this is the row's one action; the result's
// sessionId is surfaced with a direct link into Sessions.

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Wrench } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { jumpToSession } from "../../lib/approvals.ts";
import { asArray, asRecord, firstString } from "../../lib/wire.ts";
import { FLEET_POLL_INTERVAL_MS } from "./fleet.ts";

export interface FleetConflict {
  readonly workstreamId: string;
  readonly itemId: string;
  readonly title: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly files: readonly string[];
  /** "" when no resolution session has been spawned yet. */
  readonly resolutionSessionId: string;
}

function normalizeConflict(value: unknown): FleetConflict {
  const record = asRecord(value);
  return {
    workstreamId: firstString(record, ["workstreamId"]),
    itemId: firstString(record, ["itemId"]),
    title: firstString(record, ["title"]),
    worktreePath: firstString(record, ["worktreePath"]),
    branch: firstString(record, ["branch"]),
    files: asArray(record["files"]).filter((f): f is string => typeof f === "string"),
    resolutionSessionId: firstString(record, ["resolutionSessionId"]),
  };
}

export function useFleetConflicts(enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.fleetConflicts,
    queryFn: async () => {
      try {
        const raw = asRecord(await gv.fleet.conflicts.list());
        return asArray(raw["conflicts"]).map(normalizeConflict);
      } catch (error) {
        if (isMethodUnavailableError(error)) return [];
        throw error;
      }
    },
    refetchInterval: FLEET_POLL_INTERVAL_MS,
    retry: false,
    enabled,
  });
  return { conflicts: query.data ?? [], query };
}

function ConflictRow({ conflict, onResolved }: { conflict: FleetConflict; onResolved: () => void }) {
  const { toast } = useToast();

  const resolve = useMutation({
    mutationFn: () => gv.fleet.conflicts.resolve({ itemId: conflict.itemId }),
    onSuccess: (result) => {
      const record = asRecord(result);
      const sessionId = firstString(record, ["sessionId"]);
      toast({
        title: "Resolution session started",
        description: sessionId ? `Session ${sessionId} was seeded with the conflicting files.` : undefined,
        tone: "success",
        ...(sessionId ? { action: { label: "Open session", onClick: () => jumpToSession(sessionId) } } : {}),
      });
      onResolved();
    },
    onError: (error: unknown) => toast({ title: "Could not start resolution", description: formatError(error), tone: "danger" }),
  });

  return (
    <li className="fleet-conflict">
      <div className="fleet-conflict__head">
        <AlertTriangle size={14} aria-hidden="true" />
        <span className="fleet-conflict__title" title={conflict.title || conflict.itemId}>
          {conflict.title || conflict.itemId}
        </span>
        <span className="badge warning">Merge conflict waiting on you</span>
      </div>
      <p className="fleet-conflict__files">{conflict.files.length} file{conflict.files.length === 1 ? "" : "s"}: {conflict.files.join(", ")}</p>
      {conflict.branch && <p className="fleet-conflict__meta">Branch {conflict.branch} · {conflict.worktreePath}</p>}
      <div className="fleet-conflict__actions">
        {conflict.resolutionSessionId ? (
          <button
            type="button"
            className="fleet-action"
            onClick={() => jumpToSession(conflict.resolutionSessionId)}
          >
            <ArrowUpRight size={13} aria-hidden="true" /> Open resolution session
          </button>
        ) : (
          <button type="button" className="fleet-action fleet-action--primary" disabled={resolve.isPending} onClick={() => resolve.mutate()}>
            <Wrench size={13} aria-hidden="true" /> {resolve.isPending ? "Starting…" : "Resolve"}
          </button>
        )}
      </div>
    </li>
  );
}

export function FleetConflictsSection({
  conflicts,
  onResolved,
}: {
  conflicts: readonly FleetConflict[];
  onResolved: () => void;
}) {
  if (conflicts.length === 0) return null;
  return (
    <div className="fleet-conflicts">
      <div className="fleet-conflicts__head">
        <AlertTriangle size={13} aria-hidden="true" /> Conflicts <span className="fleet-attempts__count">{conflicts.length}</span>
      </div>
      <ul className="fleet-conflicts__list">
        {conflicts.map((conflict) => (
          <ConflictRow key={conflict.itemId} conflict={conflict} onResolved={onResolved} />
        ))}
      </ul>
    </div>
  );
}
