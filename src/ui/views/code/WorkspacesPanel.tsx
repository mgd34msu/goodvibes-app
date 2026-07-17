// WorkspacesPanel — "Registered workspaces" section nested in WorktreesView
// (docs brief: workspaces.* has no dedicated view yet; the worktrees domain
// is its natural home since coverage is inherited through a git worktree's
// link to its main repo — see workspaces.resolve's viaWorktreeLink). Three
// wire verbs: registrations.list (read), registrations.add/.remove (write),
// resolve (read-only probe). No wire events for any of them — fetch-once +
// invalidate-on-mutation, no poll (this is registry/config data, not an
// active operation).

import { useEffect, useRef, useState } from "react";
import { FolderTree, Search, Trash2 } from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { isMethodUnavailableError, isMethodNotInvokableError, formatError } from "../../lib/errors.ts";
import { formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import {
  parseAddWorkspaceResult,
  parseRemoveWorkspaceResult,
  parseWorkspaceRegistrations,
  parseWorkspaceResolveResult,
  useAddWorkspaceRegistration,
  useRemoveWorkspaceRegistration,
  useResolveWorkspacePath,
  useWorkspaceRegistrations,
  type WorkspaceRegistration,
} from "./workspaces-model.ts";

function isCapabilityGap(error: unknown): boolean {
  return isMethodUnavailableError(error) || isMethodNotInvokableError(error);
}

export function WorkspacesPanel() {
  const { toast } = useToast();
  const rootInputRef = useRef<HTMLInputElement>(null);

  const list = useWorkspaceRegistrations();
  const snapshot = list.isSuccess ? parseWorkspaceRegistrations(list.data) : null;

  const [rootDraft, setRootDraft] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [eligibleDraft, setEligibleDraft] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WorkspaceRegistration | null>(null);
  const [resolvePath, setResolvePath] = useState("");

  const add = useAddWorkspaceRegistration();
  const remove = useRemoveWorkspaceRegistration();
  const resolve = useResolveWorkspacePath();

  useEffect(() => {
    registerCommand({
      id: "workspaces.registerRoot",
      title: "Register Workspace Root",
      group: "code",
      keywords: ["workspace", "register", "checkpoint", "eligible"],
      run: () => rootInputRef.current?.focus(),
    });
    return () => unregisterCommand("workspaces.registerRoot");
  }, []);

  function submitAdd() {
    const root = rootDraft.trim();
    if (!root) return;
    add.mutate(
      { root, label: labelDraft.trim(), checkpointEligible: eligibleDraft },
      {
        onSuccess: (raw) => {
          const result = parseAddWorkspaceResult(raw);
          if (result.alreadyRegistered) {
            toast({ title: "Already registered", description: root, tone: "info" });
          } else {
            toast({ title: "Workspace registered", description: root, tone: "success" });
          }
          setRootDraft("");
          setLabelDraft("");
          setEligibleDraft(false);
        },
        onError: (error) => {
          toast({ title: "Failed to register workspace", description: formatError(error), tone: "danger" });
        },
      },
    );
  }

  function confirmRemove() {
    if (!removeTarget) return;
    const root = removeTarget.root;
    remove.mutate(root, {
      onSuccess: (raw) => {
        const result = parseRemoveWorkspaceResult(raw, root);
        setRemoveTarget(null);
        if (result.removed) {
          toast({ title: "Workspace unregistered", description: root, tone: "success" });
        } else {
          toast({ title: "Nothing to remove", description: `${root} was not registered.`, tone: "info" });
        }
      },
      onError: (error) => {
        setRemoveTarget(null);
        toast({ title: "Failed to unregister workspace", description: formatError(error), tone: "danger" });
      },
    });
  }

  function submitResolve() {
    const path = resolvePath.trim();
    if (!path) return;
    resolve.mutate(path);
  }

  const listUnavailable = list.isError && isCapabilityGap(list.error);

  return (
    <section className="workspaces-panel" aria-label="Registered workspaces">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <FolderTree size={14} aria-hidden="true" /> Registered workspaces
          {snapshot ? ` · ${snapshot.workspaces.length}` : ""}
        </span>
      </div>

      {list.isPending && <SkeletonBlock variant="text" lines={3} />}

      {listUnavailable && (
        <UnavailableState
          capability="workspaces.registrations.list"
          description="registered workspace roots cannot be read from this daemon."
        />
      )}
      {list.isError && !listUnavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load registered workspaces" />
      )}

      {snapshot && snapshot.workspaces.length === 0 && (
        <EmptyState
          icon={<FolderTree size={24} aria-hidden="true" />}
          title="No workspaces registered"
          description="Register a root below so the daemon's whole subtree awareness (worktrees, checkpoints) covers it."
        />
      )}

      {snapshot && snapshot.workspaces.length > 0 && (
        <ul className="workspaces-rows">
          {snapshot.workspaces.map((workspace) => (
            <li key={workspace.root} className="workspaces-row">
              <div className="workspaces-row__main">
                <code className="workspaces-row__root" title={workspace.root}>
                  {workspace.root}
                </code>
                <span className="workspaces-row__badges">
                  {/* Explicit badge either way — absent-on-the-wire reads as
                      "not eligible", never as unknown, and a plain
                      re-registration never silently strips this stamp. */}
                  {workspace.checkpointEligible ? (
                    <span className="badge ok">checkpoint eligible</span>
                  ) : (
                    <span className="badge neutral">not checkpoint eligible</span>
                  )}
                </span>
                <button
                  type="button"
                  className="workspaces-row__remove"
                  title="Unregister this workspace root"
                  aria-label={`Unregister ${workspace.root}`}
                  onClick={() => setRemoveTarget(workspace)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
              <div className="workspaces-row__meta">
                {workspace.label && <span className="workspaces-row__fact">{workspace.label}</span>}
                {workspace.origin && <span className="workspaces-row__fact">origin: {workspace.origin}</span>}
                <span className="workspaces-row__fact">registered {formatRelative(workspace.registeredAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {snapshot && snapshot.declines.length > 0 && (
        <p className="git-honest-note" role="note">
          {snapshot.declines.length} subtree{snapshot.declines.length === 1 ? "" : "s"} previously declined:{" "}
          {snapshot.declines.map((d) => d.root).join(", ")}
        </p>
      )}

      <form
        className="workspaces-add-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitAdd();
        }}
      >
        <input
          ref={rootInputRef}
          type="text"
          className="workspaces-add-form__root"
          placeholder="Workspace root path"
          value={rootDraft}
          onChange={(e) => setRootDraft(e.target.value)}
          disabled={add.isPending}
          aria-label="Workspace root path"
        />
        <input
          type="text"
          className="workspaces-add-form__label"
          placeholder="Label (optional)"
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          disabled={add.isPending}
          aria-label="Workspace label"
        />
        <label className="workspaces-add-form__checkbox" title="Leave unchecked to re-register an existing root without changing its current eligibility — this never strips an existing stamp.">
          <input
            type="checkbox"
            checked={eligibleDraft}
            onChange={(e) => setEligibleDraft(e.target.checked)}
            disabled={add.isPending}
          />
          Checkpoint eligible
        </label>
        <button type="submit" disabled={add.isPending || rootDraft.trim() === ""}>
          {add.isPending ? "Registering…" : "Register"}
        </button>
      </form>

      <div className="workspaces-resolve">
        <label className="workspaces-resolve__field">
          <span>Resolve a path against the registry</span>
          <div className="workspaces-resolve__row">
            <input
              type="text"
              value={resolvePath}
              onChange={(e) => setResolvePath(e.target.value)}
              placeholder="/path/to/check"
              disabled={resolve.isPending}
              aria-label="Path to resolve"
            />
            <button type="button" onClick={submitResolve} disabled={resolve.isPending || resolvePath.trim() === ""}>
              <Search size={13} aria-hidden="true" /> {resolve.isPending ? "Resolving…" : "Resolve"}
            </button>
          </div>
        </label>

        {resolve.isError && (
          <ErrorState error={resolve.error} title="workspaces.resolve failed" />
        )}

        {resolve.isSuccess &&
          (() => {
            const result = parseWorkspaceResolveResult(resolve.data, resolvePath.trim());
            if (!result) {
              return (
                <p className="git-honest-note" role="note">
                  The daemon answered, but its response did not carry a resolve result.
                </p>
              );
            }
            return (
              <dl className="workspaces-resolve__facts">
                <dt>Path</dt>
                <dd>
                  <code>{result.path}</code>
                </dd>
                <dt>Status</dt>
                <dd>
                  <span className={`badge ${result.status === "covered" ? "ok" : result.status === "declined" ? "bad" : "neutral"}`}>
                    {result.status}
                  </span>
                </dd>
                <dt>Covered by</dt>
                <dd>{result.coveredBy ? <code>{result.coveredBy}</code> : "—"}</dd>
                <dt>Declined root</dt>
                <dd>{result.declinedRoot ? <code>{result.declinedRoot}</code> : "—"}</dd>
                <dt>Via worktree link</dt>
                <dd>{result.viaWorktreeLink ? "yes" : "no"}</dd>
                {result.reason && (
                  <>
                    <dt>Reason</dt>
                    <dd>{result.reason}</dd>
                  </>
                )}
              </dl>
            );
          })()}
      </div>

      <ConfirmSurface
        open={removeTarget !== null}
        action="Unregister workspace"
        target={removeTarget?.root ?? ""}
        blastRadius="Removes daemon coverage (worktree/checkpoint awareness) for this root's subtree. Nothing on disk is touched."
        confirmLabel={remove.isPending ? "Unregistering…" : "Unregister"}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </section>
  );
}
