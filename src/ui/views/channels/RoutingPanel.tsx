// Routing (docs/FEATURES.md §13 "Routing: list / assign / delete"):
// channels.routing.list as a table of profile↔route assignments; assign is a
// modal form and both mutating verbs (dangerous+admin on the wire) run
// through ConfirmSurface. Assign carries confirm metadata in the body
// (additionalProperties: true); delete is a bare DELETE on the path — the
// ConfirmSurface is the gate, its input schema takes nothing else.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Plus, Trash2 } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { channelsKeys } from "./keys.ts";
import { QueryPanel } from "./QueryPanel.tsx";
import { readRouting, type RoutingAssignment } from "./channels-wire.ts";

export function RoutingPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleting, setDeleting] = useState<RoutingAssignment | null>(null);

  const routing = useQuery({
    queryKey: channelsKeys.routing,
    queryFn: () => invoke("channels.routing.list", { query: { limit: 200 } }),
    select: readRouting,
  });

  const remove = useMutation({
    mutationFn: (assignment: RoutingAssignment) =>
      invoke("channels.routing.delete", { params: { assignmentId: assignment.id } }),
    onSuccess: async () => {
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: channelsKeys.all });
      toast({ title: "Routing assignment deleted", tone: "info" });
    },
    onError: (error: unknown) => {
      setDeleting(null);
      toast({ title: "Delete failed", description: formatError(error), tone: "danger" });
    },
  });

  return (
    <div className="channels-routing">
      <div className="channels-filter-row">
        <span className="channels-filter-row__summary">
          {routing.isSuccess ? `${routing.data.routes.length} of ${routing.data.total}` : ""}
        </span>
        <button type="button" className="channels-btn channels-btn--primary" onClick={() => setAssignOpen(true)}>
          <Plus size={13} aria-hidden="true" /> Assign route
        </button>
      </div>

      <QueryPanel
        query={routing}
        capability="channels.routing.list"
        unavailableDescription="profile routing assignments cannot be listed."
        errorTitle="Failed to load routing"
        isEmpty={(page) => page.routes.length === 0}
        emptyIcon={<GitBranch size={28} aria-hidden="true" />}
        emptyTitle="No routing assignments"
        emptyDescription="Assignments bind a channel route to an assistant profile so inbound traffic reaches the right persona."
        skeletonLines={5}
      >
        {(page) => (
          <div className="channels-table-wrap">
            <table className="channels-table" aria-label="Routing assignments">
              <thead>
                <tr>
                  <th scope="col">Surface kind</th>
                  <th scope="col">Route</th>
                  <th scope="col">Profile</th>
                  <th scope="col">Label</th>
                  <th scope="col">Updated</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.routes.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <code>{row.surfaceKind}</code>
                    </td>
                    <td>{row.routeId ? <code>{row.routeId}</code> : <span className="badge neutral">any</span>}</td>
                    <td>
                      <code>{row.profileId}</code>
                    </td>
                    <td>{row.label}</td>
                    <td className="channels-table__detail">{row.updatedAt}</td>
                    <td>
                      <button
                        type="button"
                        className="channels-btn channels-btn--danger"
                        onClick={() => setDeleting(row)}
                        aria-label={`Delete assignment ${row.label || row.id}`}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryPanel>

      <AssignModal open={assignOpen} onClose={() => setAssignOpen(false)} />

      <ConfirmSurface
        open={deleting !== null}
        action="Delete routing assignment"
        target={deleting ? `${deleting.surfaceKind} → ${deleting.profileId}${deleting.label ? ` (${deleting.label})` : ""}` : ""}
        blastRadius="Inbound messages on this route stop reaching the assigned profile and fall back to daemon defaults."
        danger
        confirmLabel="Delete assignment"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function AssignModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [surfaceKind, setSurfaceKind] = useState("");
  const [profileId, setProfileId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [label, setLabel] = useState("");

  const assign = useMutation({
    mutationFn: (meta: ConfirmMetadata) =>
      invoke("channels.routing.assign", {
        body: {
          surfaceKind,
          profileId,
          ...(routeId ? { routeId } : {}),
          ...(channelId ? { channelId } : {}),
          ...(label ? { label } : {}),
          ...meta,
        },
      }),
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: channelsKeys.all });
      toast({ title: `Route assigned to ${profileId}`, tone: "success" });
      setSurfaceKind("");
      setProfileId("");
      setRouteId("");
      setChannelId("");
      setLabel("");
      onClose();
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Assign failed", description: formatError(error), tone: "danger" });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!surfaceKind.trim() || !profileId.trim() || assign.isPending) return;
    setConfirming(true);
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Assign route to profile">
        <form className="channels-policy-form" onSubmit={handleSubmit}>
          <div className="channels-policy-form__grid">
            <label className="channels-field">
              <span>Surface kind (required)</span>
              <input
                type="text"
                value={surfaceKind}
                onChange={(e) => setSurfaceKind(e.target.value)}
                placeholder="e.g. slack"
                spellCheck={false}
              />
            </label>
            <label className="channels-field">
              <span>Profile id (required)</span>
              <input
                type="text"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                spellCheck={false}
              />
            </label>
            <label className="channels-field">
              <span>Route id (optional)</span>
              <input type="text" value={routeId} onChange={(e) => setRouteId(e.target.value)} spellCheck={false} />
            </label>
            <label className="channels-field">
              <span>Channel id (optional)</span>
              <input
                type="text"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                spellCheck={false}
              />
            </label>
            <label className="channels-field">
              <span>Label (optional)</span>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
          </div>
          <div className="channels-invoke__actions">
            <button type="button" className="channels-btn" onClick={onClose} disabled={assign.isPending}>
              Cancel
            </button>
            <button
              type="submit"
              className="channels-btn channels-btn--primary"
              disabled={!surfaceKind.trim() || !profileId.trim() || assign.isPending}
            >
              {assign.isPending ? "Assigning…" : "Assign…"}
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmSurface
        open={confirming}
        action="Assign channel route"
        target={`${surfaceKind}${routeId ? ` route ${routeId}` : ""} → ${profileId}`}
        blastRadius="Inbound messages matching this route are answered by the assigned profile from now on."
        danger
        confirmLabel="Assign route"
        onConfirm={(meta) => assign.mutate(meta)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
