// FleetObservedDetail — the row badge + drill-in detail for an
// 'observed-external' fleet node: a foreign coding-agent session goodvibes
// did NOT spawn or host (Claude Code / Codex / opencode / unknown), detected
// read-only from OS signals (operator contract 1.11).
//
// This is visibility only — the detail states plainly that the session is
// externally launched and never stoppable from here. Steer is offered ONLY
// when the node reports a genuine channel (steer.kind === 'tmux'); a
// channel-less row ('none') renders the daemon's own reason verbatim, never
// a dead button.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { asRecord, firstString } from "../../lib/wire.ts";
import type { FleetNode, FleetObserved } from "./fleet.ts";

const EXTERNAL_KIND_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "opencode",
};

function externalKindLabel(kind: string): string {
  return EXTERNAL_KIND_LABELS[kind] ?? (kind.trim() || "unknown agent");
}

/** Active/Quiet badge from the node's observed liveness verbatim — 'quiet'
 * does NOT mean idle (it may be blocked on the network or a human); the
 * daemon's own `detail` states that distinction, never a client gloss. */
export function ObservedBadge({ observed }: { observed: FleetObserved }) {
  const active = observed.liveness.state === "active";
  return (
    <span className={`badge ${active ? "ok" : "neutral"}`} title={observed.liveness.detail || undefined}>
      {active ? "Active" : observed.liveness.state === "quiet" ? "Quiet" : observed.liveness.state || "unknown"}
    </span>
  );
}

export function FleetObservedDetail({ node, observed }: { node: FleetNode; observed: FleetObserved }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");

  const steer = useMutation({
    mutationFn: (text: string) => gv.fleet.observed.steer({ id: node.id, text }),
    onSuccess: (result) => {
      const record = asRecord(result);
      if (record["queued"] === true) {
        toast({ title: "Sent", description: "Delivered over the external session's own channel.", tone: "success" });
        setDraft("");
      } else {
        toast({ title: "Not delivered", description: firstString(record, ["reason"]) || "The daemon could not deliver this message.", tone: "danger" });
      }
    },
    onError: (error: unknown) => toast({ title: "Steer failed", description: formatError(error), tone: "danger" }),
  });

  const channel = observed.steer;

  return (
    <div className="fleet-detail__observed" aria-label="Observed foreign agent">
      <p className="fleet-detail__observed-note" role="note">
        This is an externally-launched {externalKindLabel(observed.externalKind)} session goodvibes did not spawn —
        visibility only. It is never stoppable or interruptible from here.
      </p>
      <dl className="fleet-detail__observed-facts">
        <div>
          <dt>PID</dt>
          <dd>{observed.pid || "unknown"}</dd>
        </div>
        {observed.cwd && (
          <div>
            <dt>Directory</dt>
            <dd>{observed.cwd}</dd>
          </div>
        )}
        <div>
          <dt>Liveness</dt>
          <dd>{observed.liveness.detail || (observed.liveness.state || "unknown")}</dd>
        </div>
      </dl>

      {channel.kind === "tmux" ? (
        <form
          className="fleet-detail__observed-steer"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = draft.trim();
            if (trimmed) steer.mutate(trimmed);
          }}
        >
          <label>
            Send to this session (tmux pane {channel.paneId})
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Message to send over this session's terminal"
              rows={2}
            />
          </label>
          <button type="submit" className="fleet-action fleet-action--primary" disabled={steer.isPending || !draft.trim()}>
            {steer.isPending ? "Sending…" : "Send"}
          </button>
        </form>
      ) : (
        <p className="fleet-detail__observed-no-channel" role="note">
          {channel.reason || "No steer channel available for this session."}
        </p>
      )}
    </div>
  );
}
