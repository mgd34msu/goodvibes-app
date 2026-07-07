// Agent Control — the real control surface over a running session-backed
// fleet node (docs/GAPS.md §3 row 7, was "EXCLUDED: interrupt / kill / pause
// / resume — no such wire method exists"). That exclusion was accurate for
// the fleet node's OWN capability flags (interruptible/killable/pausable/
// resumable describe internal daemon mechanics, not a wire verb) — but every
// node with a live sessionRef.sessionId sits on top of the shared-session
// wire surface, which DOES expose a real, if differently-shaped, set of
// controls:
//   - steer / follow-up : sessions.steer / sessions.followUp
//   - interrupt          : sessions.inputs.list + sessions.inputs.cancel
//   - stop                : sessions.close (ends it) / sessions.detach (gentler)
//   - resume              : sessions.reopen, once status is 'closed'
// There is still NO wire verb for a true freeze-and-thaw pause anywhere —
// this panel says so plainly and never labels a control "Pause".
//
// Exposes an imperative handle so FleetView's palette commands (steer/stop/
// resume) can drive this panel from outside without lifting all of its
// mutation state up into FleetDetail.

import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OctagonX, PlayCircle, SendHorizontal, Unlink, XCircle } from "lucide-react";
import { gv, invoke } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isSessionClosedError } from "../../lib/errors.ts";
import { readPath } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import {
  APP_SURFACE_ID,
  APP_SURFACE_KIND,
  canSteer as sessionCanSteer,
  isClosedStatus,
  isPendingInputState,
  sessionInputsFromResponse,
  unionSessionFromRecord,
  type SessionQueuedInput,
} from "../sessions/sessions-union.ts";
import { fleetControlKeys, type FleetNode } from "./fleet.ts";

export interface FleetAgentControlHandle {
  readonly canSteer: boolean;
  readonly canStop: boolean;
  readonly canResume: boolean;
  focusDispatch: () => void;
  requestStop: () => void;
  resume: () => void;
}

/** One queued/delivered input row: cancellable always, "deliver" only while
 * still queued — once delivered, re-delivering is a no-op the daemon itself
 * would reject, so the button simply stops rendering rather than 404ing. */
function InputRow({
  input,
  sessionId,
  onCancelRequested,
}: {
  input: SessionQueuedInput;
  sessionId: string;
  onCancelRequested: (input: SessionQueuedInput) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deliver = useMutation({
    mutationFn: () => gv.sessions.inputs.deliver(sessionId, input.id),
    onSuccess: async () => {
      toast({ title: "Input marked delivered", tone: "info" });
      await queryClient.invalidateQueries({ queryKey: fleetControlKeys.inputs(sessionId) });
    },
    onError: (error: unknown) => toast({ title: "Deliver failed", description: formatError(error), tone: "danger" }),
  });

  return (
    <li className="fleet-agent-input">
      <div className="fleet-agent-input__body">
        <span className="badge neutral">{input.intent}</span>
        <span className="badge warning">{input.state}</span>
        <span className="fleet-agent-input__text">{input.body || "(no body)"}</span>
      </div>
      <div className="fleet-agent-input__actions">
        {input.state === "queued" && (
          <button type="button" className="fleet-action" disabled={deliver.isPending} onClick={() => deliver.mutate()}>
            {deliver.isPending ? "Delivering…" : "Mark delivered"}
          </button>
        )}
        <button type="button" className="fleet-action fleet-action--danger" onClick={() => onCancelRequested(input)}>
          <XCircle size={13} aria-hidden="true" /> Cancel
        </button>
      </div>
    </li>
  );
}

export const FleetAgentControl = forwardRef<FleetAgentControlHandle, { node: FleetNode }>(function FleetAgentControl(
  { node },
  ref,
) {
  const sessionId = node.sessionId;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const dispatchInputRef = useRef<HTMLInputElement>(null);
  const [dispatchText, setDispatchText] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<SessionQueuedInput | null>(null);

  const invalidateFleetAndSessions = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    await queryClient.invalidateQueries({ queryKey: fleetControlKeys.session(sessionId) });
  };

  const session = useQuery({
    queryKey: fleetControlKeys.session(sessionId),
    queryFn: async () => unionSessionFromRecord(readPath(await gv.sessions.get(sessionId), ["session"])),
    enabled: Boolean(sessionId),
  });

  const closed = session.data ? isClosedStatus(session.data.status) : false;
  const canSteerNow = session.data ? !closed && sessionCanSteer(session.data) : false;

  const inputs = useQuery({
    queryKey: fleetControlKeys.inputs(sessionId),
    queryFn: () => gv.sessions.inputs.list(sessionId),
    enabled: Boolean(sessionId),
  });
  const pendingInputs = useMemo(
    () => sessionInputsFromResponse(inputs.data).filter((i) => isPendingInputState(i.state)),
    [inputs.data],
  );

  const dispatch = useMutation({
    mutationFn: (body: string) => {
      const payload = { body, surfaceKind: APP_SURFACE_KIND, surfaceId: APP_SURFACE_ID };
      return canSteerNow ? gv.sessions.steer(sessionId, payload) : gv.sessions.followUp(sessionId, payload);
    },
    onSuccess: async () => {
      setDispatchText("");
      toast({ title: canSteerNow ? "Steer sent" : "Follow-up queued", tone: "success" });
      await invalidateFleetAndSessions();
    },
    onError: (error: unknown) => {
      if (isSessionClosedError(error)) {
        toast({ title: "Session is closed", description: "Reopen it before sending.", tone: "danger" });
        void invalidateFleetAndSessions();
        return;
      }
      toast({ title: "Send failed", description: formatError(error), tone: "danger" });
    },
  });

  const close = useMutation({
    mutationFn: () => gv.sessions.close(sessionId),
    onSuccess: async () => {
      toast({ title: "Session closed", tone: "info" });
      await invalidateFleetAndSessions();
    },
    onError: (error: unknown) => toast({ title: "Stop failed", description: formatError(error), tone: "danger" }),
  });

  const detach = useMutation({
    mutationFn: () => invoke("sessions.detach", { params: { sessionId }, body: { sessionId, surfaceId: APP_SURFACE_ID } }),
    onSuccess: async () => {
      toast({ title: "Detached — this app stops following the session; the process keeps running", tone: "info" });
      await invalidateFleetAndSessions();
    },
    onError: (error: unknown) => toast({ title: "Detach failed", description: formatError(error), tone: "danger" }),
  });

  const reopen = useMutation({
    mutationFn: () => gv.sessions.reopen(sessionId),
    onSuccess: async () => {
      toast({ title: "Session reopened", tone: "success" });
      await invalidateFleetAndSessions();
    },
    onError: (error: unknown) => toast({ title: "Resume failed", description: formatError(error), tone: "danger" }),
  });

  const cancelInput = useMutation({
    mutationFn: (inputId: string) => gv.sessions.inputs.cancel(sessionId, inputId),
    onSuccess: async () => {
      setCancelTarget(null);
      toast({ title: "Input cancelled", tone: "info" });
      await queryClient.invalidateQueries({ queryKey: fleetControlKeys.inputs(sessionId) });
    },
    onError: (error: unknown) => toast({ title: "Cancel failed", description: formatError(error), tone: "danger" }),
  });

  useImperativeHandle(
    ref,
    () => ({
      canSteer: canSteerNow,
      canStop: Boolean(session.data) && !closed,
      canResume: closed,
      focusDispatch: () => dispatchInputRef.current?.focus(),
      requestStop: () => setConfirmStop(true),
      resume: () => reopen.mutate(),
    }),
    [canSteerNow, session.data, closed, reopen],
  );

  function submitDispatch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = dispatchText.trim();
    if (!body || dispatch.isPending || closed) return;
    dispatch.mutate(body);
  }

  return (
    <div className="fleet-agent-control">
      <div className="fleet-agent-control__mode">
        {closed ? (
          <span className="badge neutral">Session closed — resume to send</span>
        ) : canSteerNow ? (
          <span className="badge ok">Steer · agent bound</span>
        ) : (
          <span className="badge warning">Follow-up · queues the next turn</span>
        )}
      </div>

      <form className="fleet-steer" onSubmit={submitDispatch}>
        <input
          ref={dispatchInputRef}
          type="text"
          className="fleet-steer__input"
          value={dispatchText}
          onChange={(e) => setDispatchText(e.target.value)}
          placeholder={closed ? "Session closed." : canSteerNow ? "Steer this agent…" : "Queue a follow-up instruction…"}
          aria-label={canSteerNow ? "Steer message" : "Follow-up message"}
          disabled={dispatch.isPending || closed}
        />
        <button
          type="submit"
          className="fleet-action fleet-action--primary"
          disabled={!dispatchText.trim() || dispatch.isPending || closed}
        >
          <SendHorizontal size={14} aria-hidden="true" />
          {dispatch.isPending ? "Sending…" : canSteerNow ? "Steer" : "Queue"}
        </button>
      </form>

      {pendingInputs.length > 0 && (
        <div className="fleet-agent-control__interrupt">
          <strong>Pending inputs ({pendingInputs.length})</strong>
          <ul className="fleet-agent-inputs">
            {pendingInputs.map((input) => (
              <InputRow key={input.id} input={input} sessionId={sessionId} onCancelRequested={setCancelTarget} />
            ))}
          </ul>
        </div>
      )}

      <div className="fleet-detail__actions">
        {!closed && (
          <button
            type="button"
            className="fleet-action fleet-action--danger"
            disabled={close.isPending}
            onClick={() => setConfirmStop(true)}
          >
            <OctagonX size={14} aria-hidden="true" /> {close.isPending ? "Stopping…" : "Stop"}
          </button>
        )}
        {!closed && (
          <button
            type="button"
            className="fleet-action"
            disabled={detach.isPending}
            title="Stop this app from following this session — never stops the process; other surfaces are unaffected"
            onClick={() => detach.mutate()}
          >
            <Unlink size={13} aria-hidden="true" /> {detach.isPending ? "Detaching…" : "Detach"}
          </button>
        )}
        {closed && (
          <button type="button" className="fleet-action" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
            <PlayCircle size={13} aria-hidden="true" /> {reopen.isPending ? "Resuming…" : "Resume"}
          </button>
        )}
      </div>

      <p className="fleet-agent-control__note" role="note">
        No true freeze-and-thaw pause exists on the operator wire yet — steer, interrupt (cancel a queued input),
        stop, and resume are the real control surface here. Nothing in this panel is ever labeled "Pause".
      </p>

      <ConfirmSurface
        open={confirmStop}
        action="Stop session"
        target={`${node.label} (${sessionId})`}
        blastRadius="The session closes: its history is kept and it can be resumed later, but the running agent stops working right now."
        danger
        confirmLabel="Stop session"
        onConfirm={() => {
          setConfirmStop(false);
          close.mutate();
        }}
        onCancel={() => setConfirmStop(false)}
      />
      <ConfirmSurface
        open={cancelTarget !== null}
        action="Cancel input"
        target={cancelTarget?.body || cancelTarget?.id || ""}
        blastRadius="This queued instruction is aborted before it is ever delivered to the agent. In-flight work already underway from an earlier input is not affected."
        danger
        confirmLabel="Cancel input"
        onConfirm={() => {
          const target = cancelTarget;
          setCancelTarget(null);
          if (target) cancelInput.mutate(target.id);
        }}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
});
