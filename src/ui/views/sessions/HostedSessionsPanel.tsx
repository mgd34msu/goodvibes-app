// Daemon-hosted sessions (sessions.hosted.*), the "Hosted" tab of the Sessions
// view. This is the capability behind the README's promise that closing the
// window never kills in-flight agent work: a hosted session's loop runs inside
// the daemon, so it outlives this client.
//
// LIST. sessions.hosted.list, with an include-terminated toggle. Terminated
// rows keep their reason (the record is retained until the retention window
// retires it), so a session that stopped can be asked about instead of having
// simply vanished. Freshness is the hosted-session-update stream, with a poll
// that speeds up when that stream is down and recedes to a safety net when it
// is live.
//
// ATTACH. selecting a row calls sessions.hosted.attach with this app's stable
// client id, renders the returned transcript, then renders the LIVE `turn` /
// `tools` frames filtered to that session id. Steering rides the ORDINARY
// SteerComposer (sessions.steer / sessions.followUp): a hosted session is a
// registered session on the shared spine, so there is no hosted-specific steer
// verb and this panel does not invent one.
//
// DETACH. fired on row change and on unmount, and offered explicitly as
// "Leave". The explicit path confirms FIRST and states what leaving will do,
// read from the record's own effectiveDetachPolicy (kill ends it; survive
// leaves it idle and reattachable), never guessed here.
//
// END. sessions.hosted.kill, confirm-gated with danger tone, because it ends
// the session for every attached client regardless of policy, including a
// `survive` session that leaving would not have touched.
//
// HONESTY BAR. every read tolerates an unrecognized shape (./hosted-sessions.ts).
// A list answer that is not `{sessions: [...]}` renders a stated "could not be
// read", never an empty list indistinguishable from "this daemon hosts
// nothing"; an attach that returns no session renders "could not attach", never
// a fabricated one.

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, LogOut, OctagonX, Plus, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { SteerComposer } from "./SteerComposer.tsx";
import { useHostedSessionRealtime } from "./useHostedSessionRealtime.ts";
import {
  EMPTY_HOSTED_CREATE_DRAFT,
  attachResponseAction,
  buildHostedCreateInput,
  describeLeaving,
  ensureHostedClientId,
  hostedAttachResultFrom,
  hostedAttachedClientCount,
  hostedSessionFromResult,
  hostedSessionIdFromResult,
  hostedSessionsFromListResponse,
  hostedStatusLabel,
  hostedLiveMessageFromTurnFrame,
  hostedStatusTone,
  hostedTerminationLabel,
  hostedToolCallFromFrame,
  isTerminalTurnFrame,
  isWellFormedHostedListResponse,
  otherAttachedClientCount,
  sortHostedSessionsNewestFirst,
  streamDeltaAccumulated,
  validateHostedCreateDraft,
  type HostedActiveToolCall,
  type HostedCreateDraft,
  type HostedHistoryMessage,
  type HostedLiveMessage,
  type HostedSessionRecord,
  type HostedStreamFrame,
} from "./hosted-sessions.ts";

/**
 * Poll cadence. When the stream is DOWN this is the honest fallback that makes
 * the paused-stream banner's claim true; when it is LIVE the frames drive
 * freshness and the poll recedes to a safety net.
 */
const FALLBACK_POLL_MS = 15_000;
const SAFETY_POLL_MS = 60_000;

export function HostedSessionsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const clientId = useMemo(() => ensureHostedClientId(), []);

  const [includeTerminated, setIncludeTerminated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [attachedSession, setAttachedSession] = useState<HostedSessionRecord | null>(null);
  const [attachHistory, setAttachHistory] = useState<HostedHistoryMessage[]>([]);
  const [liveMessages, setLiveMessages] = useState<HostedLiveMessage[]>([]);
  const [liveText, setLiveText] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<HostedActiveToolCall[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);

  const [leaveTarget, setLeaveTarget] = useState<HostedSessionRecord | null>(null);
  const [killTarget, setKillTarget] = useState<HostedSessionRecord | null>(null);

  const onStreamFrame = useCallback(
    (frame: HostedStreamFrame) => {
      const delta = streamDeltaAccumulated(frame);
      if (delta !== null) {
        setLiveText(delta);
        return;
      }
      const message = hostedLiveMessageFromTurnFrame(frame);
      if (message) {
        setLiveMessages((current) => [...current, message]);
        setLiveText("");
      }
      if (isTerminalTurnFrame(frame)) {
        setActiveToolCalls([]);
        // A finished turn moved turnCount/messageCount/lastTurnAt on the row.
        void queryClient.invalidateQueries({ queryKey: queryKeys.hostedSessionsAll });
        return;
      }
      const call = hostedToolCallFromFrame(frame);
      if (call) {
        setActiveToolCalls((current) => {
          const rest = current.filter((entry) => entry.callId !== call.callId);
          return call.state === "executing" ? [...rest, call] : rest;
        });
      }
    },
    [queryClient],
  );

  const onLifecycleUpdate = useCallback((payload: unknown) => {
    const session = hostedSessionFromResult(payload);
    if (session) setAttachedSession(session);
  }, []);

  const realtime = useHostedSessionRealtime({
    enabled: true,
    attachedSessionId: selectedId,
    onStreamFrame,
    onLifecycleUpdate,
  });

  const list = useQuery({
    queryKey: queryKeys.hostedSessions(includeTerminated),
    queryFn: () => gv.sessions.hosted.list(includeTerminated),
    refetchInterval: realtime.connected ? SAFETY_POLL_MS : FALLBACK_POLL_MS,
  });

  const sessions = useMemo(
    () => sortHostedSessionsNewestFirst(hostedSessionsFromListResponse(list.data)),
    [list.data],
  );
  const listReadable = list.isSuccess ? isWellFormedHostedListResponse(list.data) : true;

  // Keeps the ATTACHED record current off the same poll that refreshes the
  // rows. Without it, a session terminated while the stream is down (so no
  // lifecycle frame ever arrives) would keep rendering its composer as if live.
  // Only ever moves STRICTLY FORWARD, to a row the daemon has since confirmed
  // is newer for the same id, so a list read that merely lags the attach
  // response cannot regress what attach already confirmed.
  useEffect(() => {
    if (!attachedSession) return;
    const fresher = sessions.find((session) => session.id === attachedSession.id);
    if (fresher && fresher.updatedAt > attachedSession.updatedAt) setAttachedSession(fresher);
  }, [sessions, attachedSession]);

  // Declared before the mutations because their callbacks release attachments
  // through it (a dropped attach response, an unreadable create).
  const passiveDetach = useCallback(
    (sessionId: string, detachClientId: string) => {
      // Fire-and-forget means this component stops waiting, not that a failure
      // goes unheard: a detach that never lands leaves this app listed as an
      // attached client, which for a kill-policy session holds it open.
      void gv.sessions.hosted.detach(sessionId, detachClientId).catch((error: unknown) => {
        toast({
          title: "Could not detach from a hosted session",
          description: formatError(error),
          tone: "danger",
        });
      });
    },
    [toast],
  );

  // The selection as it stands RIGHT NOW, for the staleness test in attach's
  // callbacks. A ref rather than the state value because those callbacks belong
  // to the mutation, not to a render, so they close over whatever selection was
  // current when the call was made rather than the one on screen when it lands.
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const attach = useMutation({
    mutationFn: (sessionId: string) => gv.sessions.hosted.attach(sessionId, clientId),
    // `requestedId` is the mutation's own variable: the session this particular
    // call asked for, which is what identifies a superseded response even when
    // the body came back in a shape the reader cannot use.
    onSuccess: (result, requestedId) => {
      const { session, history } = hostedAttachResultFrom(result);
      const action = attachResponseAction(session?.id ?? requestedId, selectedIdRef.current);
      if (!action.adopt) {
        // A newer selection has taken over while this call was in flight. Its
        // response is dropped, and the attachment it created is released.
        if (action.detachSessionId) passiveDetach(action.detachSessionId, clientId);
        return;
      }
      if (!session) {
        setAttachError("The daemon did not return a hosted session in a shape this client understands.");
        return;
      }
      setAttachError(null);
      setAttachedSession(session);
      setAttachHistory(history);
      setLiveMessages([]);
      setLiveText("");
      setActiveToolCalls([]);
    },
    // Guarded the same way: a superseded call's failure must not paint an
    // error over the session the operator has since selected.
    onError: (error: unknown, requestedId) => {
      if (requestedId !== selectedIdRef.current) return;
      setAttachError(formatError(error));
    },
  });

  const create = useMutation({
    mutationFn: (draft: HostedCreateDraft) =>
      gv.sessions.hosted.create(buildHostedCreateInput(draft, clientId)),
    onSuccess: (result) => {
      const session = hostedSessionFromResult(result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.hostedSessionsAll });
      setShowCreate(false);
      if (!session) {
        // create() passed a clientId, so this app IS attached to whatever was
        // just made, even though the response cannot be read as a record. The
        // id alone is enough to release that attachment; only when there is no
        // id anywhere does the lease have to be what ends it, and the copy says
        // so rather than leaving it unsaid.
        const strandedId = hostedSessionIdFromResult(result);
        if (strandedId) {
          passiveDetach(strandedId, clientId);
          toast({
            title: "Hosted session created",
            description:
              "The daemon did not return it in a shape this client understands, so this window has detached from it. Refresh the list to find it.",
            tone: "info",
          });
          return;
        }
        toast({
          title: "Hosted session created",
          description:
            "The daemon did not return it in a shape this client understands, not even an id, so this window stays attached until its attachment lapses on its own. Refresh the list to find it.",
          tone: "warning",
        });
        return;
      }
      toast({ title: "Hosted session created", description: session.title || session.id, tone: "success" });
      selectSession(session.id);
    },
    onError: (error: unknown) =>
      toast({ title: "Could not create hosted session", description: formatError(error), tone: "danger" }),
  });

  const kill = useMutation({
    mutationFn: (sessionId: string) => gv.sessions.hosted.kill(sessionId),
    onSuccess: (result) => {
      const updated = hostedSessionFromResult(result);
      if (updated) setAttachedSession(updated);
      toast({ title: "Session ended", tone: "info" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.hostedSessionsAll });
    },
    onError: (error: unknown) =>
      toast({ title: "Could not end session", description: formatError(error), tone: "danger" }),
  });

  // The passive detach paths (switching rows, leaving the view) read through
  // refs so the unmount effect below can have an empty dependency list and fire
  // its cleanup on a REAL unmount only, never merely because a callback's
  // identity moved.
  //
  // Tracks the SELECTED id, not the attached record: create() already attaches
  // this client (it passes clientId), so a create whose follow-up attach fails
  // would otherwise leave the daemon holding an attachment nothing here ever
  // releases. Detaching a client the daemon does not have attached is a
  // harmless 200 no-op (verified live), so the wider net costs nothing.
  const detachRef = useRef<{ sessionId: string; clientId: string } | null>(null);
  useEffect(() => {
    detachRef.current = selectedId ? { sessionId: selectedId, clientId } : null;
  }, [selectedId, clientId]);

  const passiveDetachRef = useRef(passiveDetach);
  useEffect(() => {
    passiveDetachRef.current = passiveDetach;
  }, [passiveDetach]);

  useEffect(
    () => () => {
      const pending = detachRef.current;
      if (pending) passiveDetachRef.current(pending.sessionId, pending.clientId);
    },
    [],
  );

  function clearAttachState(): void {
    setAttachedSession(null);
    setAttachHistory([]);
    setLiveMessages([]);
    setLiveText("");
    setActiveToolCalls([]);
    setAttachError(null);
  }

  function selectSession(sessionId: string): void {
    if (sessionId === selectedId) return;
    const previous = detachRef.current;
    if (previous) passiveDetach(previous.sessionId, previous.clientId);
    setSelectedId(sessionId);
    clearAttachState();
    attach.mutate(sessionId);
  }

  async function leaveSession(session: HostedSessionRecord): Promise<void> {
    try {
      const result = await gv.sessions.hosted.detach(session.id, clientId);
      const updated = hostedSessionFromResult(result);
      // What the record says HAPPENED, not what the policy would have done.
      toast({
        title: updated?.status === "terminated" ? "Session ended" : "Left the session",
        description:
          updated && updated.status !== "terminated"
            ? `Still running, with ${String(updated.attachedClients.length)} client${
                updated.attachedClients.length === 1 ? "" : "s"
              } attached.`
            : undefined,
        tone: "info",
      });
    } catch (error) {
      toast({ title: "Detach failed", description: formatError(error), tone: "danger" });
    }
    setSelectedId(null);
    clearAttachState();
    void queryClient.invalidateQueries({ queryKey: queryKeys.hostedSessionsAll });
  }

  const bridgeDown = list.isError && isWsBridgeUnavailableError(list.error);
  const verbMissing = list.isError && isMethodUnavailableError(list.error);

  return (
    <div className="hosted-sessions">
      <div className="hosted-sessions__toolbar">
        <h2 className="hosted-sessions__title">
          <Boxes size={16} aria-hidden="true" /> Hosted sessions
        </h2>
        <label className="hosted-sessions__toggle">
          <input
            type="checkbox"
            checked={includeTerminated}
            onChange={(event) => setIncludeTerminated(event.target.checked)}
          />
          Include ended
        </label>
        <button
          type="button"
          className="hosted-sessions__icon-button"
          onClick={() => void list.refetch()}
          aria-label="Refresh hosted sessions"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="hosted-sessions__new"
          onClick={() => setShowCreate((open) => !open)}
          aria-expanded={showCreate}
        >
          <Plus size={14} aria-hidden="true" /> New hosted session
        </button>
      </div>

      <p className="hosted-sessions__blurb">
        These run inside the daemon, not in this window. Closing the app does not end them; what happens when
        the last client leaves is each session&apos;s own detach policy.
      </p>

      {showCreate && <CreateHostedSessionForm pending={create.isPending} onCreate={(draft) => create.mutate(draft)} />}

      {realtime.error && (
        <p className="hosted-sessions__stream-note" role="status">
          {realtime.error}
        </p>
      )}

      <div className="hosted-sessions__body">
        <section className="hosted-sessions__list-pane" aria-label="Hosted sessions">
          {list.isLoading && <SkeletonBlock variant="text" lines={4} />}
          {verbMissing && (
            <UnavailableState
              capability="sessions.hosted.list"
              description="the connected daemon build does not host sessions. Everything else keeps working."
            />
          )}
          {bridgeDown && (
            <UnavailableState
              capability="sessions.hosted.* (WS bridge)"
              description="these verbs are WebSocket-only and the app's bridge to the daemon is down. Reconnect and refresh."
              action={{ label: "Retry", onClick: () => void list.refetch() }}
            />
          )}
          {list.isError && !verbMissing && !bridgeDown && (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Could not list hosted sessions" />
          )}
          {list.isSuccess && !listReadable && (
            <ErrorState
              error="The daemon answered sessions.hosted.list with a shape this client does not understand, so this is not a claim that nothing is hosted."
              onRetry={() => void list.refetch()}
              title="Could not read hosted sessions"
            />
          )}
          {list.isSuccess && listReadable && sessions.length === 0 && (
            <EmptyState
              icon={<Boxes size={24} aria-hidden="true" />}
              title={includeTerminated ? "No hosted sessions" : "No live hosted sessions"}
              description={
                includeTerminated
                  ? "This daemon is not hosting any sessions."
                  : 'This daemon is hosting nothing right now. Tick "Include ended" to see sessions that have finished.'
              }
            />
          )}
          {sessions.length > 0 && (
            <ul className="hosted-sessions__list">
              {sessions.map((session) => (
                <HostedSessionRow
                  key={session.id}
                  session={session}
                  selected={session.id === selectedId}
                  onSelect={() => selectSession(session.id)}
                />
              ))}
            </ul>
          )}
        </section>

        {selectedId !== null && (
          <HostedSessionDetail
            session={attachedSession}
            clientId={clientId}
            history={attachHistory}
            liveMessages={liveMessages}
            liveText={liveText}
            activeToolCalls={activeToolCalls}
            attaching={attach.isPending}
            attachError={attachError}
            streamPaused={!realtime.connected}
            killPending={kill.isPending}
            onLeave={() => setLeaveTarget(attachedSession)}
            onKill={() => setKillTarget(attachedSession)}
          />
        )}
      </div>

      {/* Danger tone only when leaving actually ends something: a kill-policy
          session another client is still watching keeps running, so dressing
          that up as destructive would be as wrong as understating it. */}
      <ConfirmSurface
        open={leaveTarget !== null}
        danger={
          leaveTarget?.effectiveDetachPolicy === "kill" &&
          otherAttachedClientCount(leaveTarget, clientId) === 0
        }
        action="Leave hosted session"
        target={leaveTarget ? leaveTarget.title || leaveTarget.id : ""}
        blastRadius={
          leaveTarget
            ? describeLeaving(
                leaveTarget.effectiveDetachPolicy,
                otherAttachedClientCount(leaveTarget, clientId),
              )
            : ""
        }
        confirmLabel="Leave"
        onConfirm={() => {
          const target = leaveTarget;
          setLeaveTarget(null);
          if (target) void leaveSession(target);
        }}
        onCancel={() => setLeaveTarget(null)}
      />

      <ConfirmSurface
        open={killTarget !== null}
        danger
        action="End hosted session"
        target={killTarget ? killTarget.title || killTarget.id : ""}
        blastRadius="Ends the session immediately for every attached client, whatever its detach policy says, including a survive-policy session that leaving would have left running. The in-flight turn is interrupted. This cannot be undone."
        confirmLabel={kill.isPending ? "Ending…" : "End session"}
        onConfirm={() => {
          const target = killTarget;
          setKillTarget(null);
          if (target) kill.mutate(target.id);
        }}
        onCancel={() => setKillTarget(null)}
      />
    </div>
  );
}

// ─── Create form ─────────────────────────────────────────────────────────────

function CreateHostedSessionForm({
  pending,
  onCreate,
}: {
  pending: boolean;
  onCreate: (draft: HostedCreateDraft) => void;
}) {
  const [draft, setDraft] = useState<HostedCreateDraft>(EMPTY_HOSTED_CREATE_DRAFT);
  const [errors, setErrors] = useState<string[]>([]);

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const found = validateHostedCreateDraft(draft);
    setErrors(found);
    if (found.length > 0 || pending) return;
    onCreate(draft);
    setDraft(EMPTY_HOSTED_CREATE_DRAFT);
  }

  return (
    <form className="hosted-sessions__create" onSubmit={submit}>
      <label className="hosted-sessions__field">
        <span>Workspace path</span>
        <input
          type="text"
          value={draft.workspaceRoot}
          onChange={(event) => setDraft({ ...draft, workspaceRoot: event.target.value })}
          placeholder="/home/you/projects/thing"
          disabled={pending}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="hosted-sessions__field">
        <span>Title (optional)</span>
        <input
          type="text"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="Taken from the first message when blank"
          disabled={pending}
        />
      </label>
      <label className="hosted-sessions__field">
        <span>When the last client leaves</span>
        <select
          value={draft.detachPolicy}
          onChange={(event) =>
            setDraft({ ...draft, detachPolicy: event.target.value as HostedCreateDraft["detachPolicy"] })
          }
          disabled={pending}
        >
          {/* Sent as an ABSENT key, not an empty string: an omitted detachPolicy
              is what makes the daemon apply its own hostedSessions.detachPolicy
              setting, so this option never has to know that setting's value. */}
          <option value="">Use the daemon&apos;s setting</option>
          <option value="kill">End the session</option>
          <option value="survive">Keep it running</option>
        </select>
      </label>
      {errors.length > 0 && (
        <ul className="hosted-sessions__errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <button type="submit" className="hosted-sessions__create-submit" disabled={pending}>
        <Plus size={14} aria-hidden="true" /> {pending ? "Creating…" : "Create"}
      </button>
    </form>
  );
}

// ─── List row ────────────────────────────────────────────────────────────────

function HostedSessionRow({
  session,
  selected,
  onSelect,
}: {
  session: HostedSessionRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const termination = hostedTerminationLabel(session);
  return (
    <li>
      <button
        type="button"
        className={`hosted-session-row${selected ? " hosted-session-row--selected" : ""}`}
        onClick={onSelect}
      >
        <span className="hosted-session-row__top">
          <span className="hosted-session-row__title">{session.title || session.id}</span>
          <span className={`badge ${hostedStatusTone(session.status)}`}>{hostedStatusLabel(session.status)}</span>
          {session.restoredFromDisk && (
            <span className="badge warning" title="Came back from disk after a daemon restart">
              restored
            </span>
          )}
        </span>
        <span className="hosted-session-row__workspace" title={session.workspaceRoot}>
          {session.workspaceRoot}
        </span>
        <span className="hosted-session-row__meta">
          <span>on leave: {session.effectiveDetachPolicy || "unknown"}</span>
          <span>
            {session.turnCount} turn{session.turnCount === 1 ? "" : "s"}
          </span>
          <span>
            {session.messageCount} message{session.messageCount === 1 ? "" : "s"}
          </span>
          <span>
            {hostedAttachedClientCount(session)} attached client
            {hostedAttachedClientCount(session) === 1 ? "" : "s"}
          </span>
          <span>updated {formatRelative(session.updatedAt || session.createdAt)}</span>
        </span>
        {termination && <span className="hosted-session-row__termination">{termination}</span>}
      </button>
    </li>
  );
}

// ─── Detail / attached view ──────────────────────────────────────────────────

function HostedSessionDetail({
  session,
  clientId,
  history,
  liveMessages,
  liveText,
  activeToolCalls,
  attaching,
  attachError,
  streamPaused,
  killPending,
  onLeave,
  onKill,
}: {
  session: HostedSessionRecord | null;
  clientId: string;
  history: readonly HostedHistoryMessage[];
  liveMessages: readonly HostedLiveMessage[];
  liveText: string;
  activeToolCalls: readonly HostedActiveToolCall[];
  attaching: boolean;
  attachError: string | null;
  streamPaused: boolean;
  killPending: boolean;
  onLeave: () => void;
  onKill: () => void;
}) {
  if (attaching) {
    return (
      <section className="hosted-session-detail">
        <SkeletonBlock variant="text" lines={5} />
      </section>
    );
  }

  if (attachError !== null || !session) {
    return (
      <section className="hosted-session-detail">
        <ErrorState error={attachError ?? "Could not attach to this session."} title="Could not attach" />
      </section>
    );
  }

  const ended = session.status === "terminated";

  return (
    <section className="hosted-session-detail">
      <header className="hosted-session-detail__header">
        <div>
          <h3>{session.title || session.id}</h3>
          <p className="hosted-session-detail__workspace">{session.workspaceRoot}</p>
        </div>
        <div className="hosted-session-detail__actions">
          {!ended && (
            <button type="button" className="hosted-session-detail__kill" onClick={onKill} disabled={killPending}>
              <OctagonX size={14} aria-hidden="true" /> {killPending ? "Ending…" : "End session"}
            </button>
          )}
          <button type="button" className="hosted-session-detail__leave" onClick={onLeave}>
            <LogOut size={14} aria-hidden="true" /> Leave
          </button>
        </div>
      </header>

      <p className="hosted-session-detail__policy">
        {describeLeaving(session.effectiveDetachPolicy, otherAttachedClientCount(session, clientId))}
      </p>

      {session.restoredFromDisk && (
        <p className="hosted-session-detail__restored" role="status">
          This session came back from disk after a daemon restart. Its loop is rebuilt on attach, and any turn that
          was in flight at the restart did not survive it.
        </p>
      )}

      {ended && (
        <p className="hosted-session-detail__ended" role="status">
          {hostedTerminationLabel(session) ?? "terminated"}
        </p>
      )}

      <ul className="hosted-session-transcript" aria-label="Transcript">
        {history.map((message, index) => (
          <li key={`history-${String(index)}`} className={`hosted-session-message hosted-session-message--${message.role}`}>
            <span className="hosted-session-message__role">{message.role}</span>
            <p className="hosted-session-message__content">{message.content}</p>
          </li>
        ))}
        {liveMessages.map((message, index) => (
          <li key={`live-${String(index)}`} className={`hosted-session-message hosted-session-message--${message.role}`}>
            <span className="hosted-session-message__role">{message.role}</span>
            <p className="hosted-session-message__content">{message.content}</p>
          </li>
        ))}
        {liveText && (
          <li className="hosted-session-message hosted-session-message--assistant hosted-session-message--streaming">
            <span className="hosted-session-message__role">assistant · streaming</span>
            <p className="hosted-session-message__content">{liveText}</p>
          </li>
        )}
        {history.length === 0 && liveMessages.length === 0 && !liveText && (
          <li className="hosted-session-transcript__empty">Nothing has been said in this session yet.</li>
        )}
      </ul>

      {activeToolCalls.length > 0 && (
        <ul className="hosted-session-tools" aria-label="Running tools">
          {activeToolCalls.map((call) => (
            <li key={call.callId}>Running: {call.tool}</li>
          ))}
        </ul>
      )}

      <SteerComposer sessionId={session.id} canSteer={!ended} closed={ended} streamPaused={streamPaused} />
    </section>
  );
}
