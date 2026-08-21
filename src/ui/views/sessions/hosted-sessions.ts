// Pure readers, validation and display helpers for sessions.hosted.*: the
// daemon-hosted sessions this app's README promises ("closing the window never
// kills in-flight agent work"). A hosted session's conversation loop runs INSIDE
// the daemon, so it does not end when the client that opened it goes away;
// whether it SURVIVES the last client leaving is a per-session policy
// (`effectiveDetachPolicy`), which is why this module never guesses what
// leaving will do and always reads the record's own field.
//
// All five verbs are ws-only on this contract pin (no REST binding), so they
// ride lib/ws.ts through the /app/ws bridge; gv.sessions.hosted.* marks them.
//
// TOLERANT READS, the sessions-union.ts idiom: `status`, `detachPolicy` and
// `terminatedReason` are read as OPEN strings even though the wire enums are
// closed, so a daemon newer than this pin renders its own vocabulary verbatim
// instead of crashing or silently dropping the row. A response that carries no
// recognizable session comes back null, never a fabricated record: the caller
// renders a stated "could not be read", which is a different sentence from "no
// hosted sessions exist".
//
// LIVE OUTPUT has no verb of its own and needs none. The hosted loop is the
// ordinary orchestrator, so it publishes the same STREAM_DELTA / TURN_* /
// TOOL_* envelopes a local session does, on the control plane's `turn` and
// `tools` domains, stamped with the hosted session's id. The stream readers at
// the bottom of this file decode those envelopes; steering rides the ordinary
// sessions.steer/followUp (SteerComposer), because there is deliberately no
// sessions.hosted.steer.

import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

// ---------------------------------------------------------------------------
// This client's identity
// ---------------------------------------------------------------------------

const CLIENT_ID_STORAGE_KEY = "goodvibes.app.hosted.clientId";

/**
 * A stable per-install client id for attach/detach. It names WHICH ATTACHED
 * CLIENT a hosted session sees, and it has to survive a window reload: an
 * attachment made under one id and released under another would leave this app
 * listed as attached forever, which for a `kill`-policy session means the
 * session never ends.
 */
export function ensureHostedClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const minted = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, minted);
    return minted;
  } catch {
    // Storage unavailable: a per-session id still attaches and detaches
    // correctly, it just cannot recognize itself across a reload.
    return crypto.randomUUID();
  }
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface HostedSessionRecord {
  id: string;
  workspaceRoot: string;
  title: string;
  /** idle | running | terminated on this pin; rendered verbatim if newer. */
  status: string;
  /** The per-session override, "" when the session follows the setting. */
  detachPolicy: string;
  /** What WOULD apply on the next detach: the override, else the setting. */
  effectiveDetachPolicy: string;
  attachedClients: string[];
  providerId: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
  messageCount: number;
  lastTurnAt?: number;
  terminatedAt?: number;
  /** Never empty for a terminated session; "" for a live one. */
  terminatedReason: string;
  /** Back from disk after a daemon restart, loop not rebuilt until first attach. */
  restoredFromDisk: boolean;
}

export interface HostedHistoryMessage {
  role: string;
  content: string;
  at?: number;
}

/** One hosted session record, or null when the value carries no id at all. */
export function hostedSessionFrom(value: unknown): HostedSessionRecord | null {
  const record = asRecord(value);
  const id = firstString(record, ["id"]);
  if (!id) return null;
  const lastTurnAt = firstNumber(record, ["lastTurnAt"]);
  const terminatedAt = firstNumber(record, ["terminatedAt"]);
  return {
    id,
    workspaceRoot: firstString(record, ["workspaceRoot"]),
    title: firstString(record, ["title"]),
    status: firstString(record, ["status"]),
    detachPolicy: firstString(record, ["detachPolicy"]),
    effectiveDetachPolicy: firstString(record, ["effectiveDetachPolicy"]),
    attachedClients: asArray(record["attachedClients"]).filter((c): c is string => typeof c === "string"),
    providerId: firstString(record, ["providerId"]),
    modelId: firstString(record, ["modelId"]),
    createdAt: firstNumber(record, ["createdAt"]) ?? 0,
    updatedAt: firstNumber(record, ["updatedAt"]) ?? 0,
    turnCount: firstNumber(record, ["turnCount"]) ?? 0,
    messageCount: firstNumber(record, ["messageCount"]) ?? 0,
    ...(lastTurnAt === undefined ? {} : { lastTurnAt }),
    ...(terminatedAt === undefined ? {} : { terminatedAt }),
    terminatedReason: firstString(record, ["terminatedReason"]),
    restoredFromDisk: record["restoredFromDisk"] === true,
  };
}

/** create / detach / kill all answer `{ session }`. */
export function hostedSessionFromResult(value: unknown): HostedSessionRecord | null {
  return hostedSessionFrom(asRecord(value)["session"]);
}

/**
 * The session id out of a `{ session }` answer this client could not otherwise
 * read, or "" when there is no id anywhere in it.
 *
 * Distinct from hostedSessionFromResult, which insists on a whole record: a
 * create whose response shape is unrecognized still ATTACHED this client (the
 * verb takes a clientId), so the id alone is enough to release the attachment
 * instead of leaving it to lapse on its lease. Looks in the nested and the two
 * plausible flat positions rather than only `session.id`, which is exactly the
 * one the strict reader already tried and failed on.
 */
export function hostedSessionIdFromResult(value: unknown): string {
  const record = asRecord(value);
  return firstString(record["session"], ["id"]) || firstString(record, ["id", "sessionId"]);
}

/**
 * Whether a sessions.hosted.list answer carried the shape this client expects.
 * Distinct from a genuinely empty list: "the daemon answered something this
 * client cannot read" and "this daemon hosts nothing" are different sentences,
 * and rendering the first as the second is the failure this exists to stop.
 */
export function isWellFormedHostedListResponse(value: unknown): boolean {
  return Array.isArray(asRecord(value)["sessions"]);
}

export function hostedSessionsFromListResponse(value: unknown): HostedSessionRecord[] {
  return asArray(asRecord(value)["sessions"])
    .map(hostedSessionFrom)
    .filter((session): session is HostedSessionRecord => session !== null);
}

export function hostedHistoryFrom(value: unknown): HostedHistoryMessage[] {
  return asArray(value)
    .map((entry) => {
      const record = asRecord(entry);
      const role = firstString(record, ["role"]);
      if (!role) return null;
      const at = firstNumber(record, ["at"]);
      return {
        role,
        content: typeof record["content"] === "string" ? record["content"] : "",
        ...(at === undefined ? {} : { at }),
      };
    })
    .filter((message): message is HostedHistoryMessage => message !== null);
}

export interface HostedAttachResult {
  session: HostedSessionRecord | null;
  history: HostedHistoryMessage[];
}

/** A null `session` means "render an honest could-not-attach", never a stub. */
export function hostedAttachResultFrom(value: unknown): HostedAttachResult {
  const record = asRecord(value);
  return {
    session: hostedSessionFrom(record["session"]),
    history: hostedHistoryFrom(record["history"]),
  };
}

/** The session id a hosted-session-update lifecycle frame is about. */
export function hostedSessionIdFromLifecycle(payload: unknown): string {
  return firstString(asRecord(payload)["session"], ["id"]);
}

/** What to do with an attach response that has just come back. */
export interface AttachResponseAction {
  /** Render this response: it is the session the operator is looking at. */
  adopt: boolean;
  /** Release this attachment, or null when there is nothing to release. */
  detachSessionId: string | null;
}

/**
 * Decide whether an attach response is still the one being waited for.
 *
 * Two attaches can be in flight at once: clicking a slow row and then a fast
 * one leaves the second resolving first, and the first arriving afterwards. A
 * single mutation object dispatches its own callbacks, so the SUPERSEDED call's
 * onSuccess still runs, and adopting it would put the older session's record,
 * transcript, steer target and End-session target on screen under a selection,
 * SSE filter and detach ref that all point at the newer one, with the newer
 * session's live frames appending beneath the older one's header.
 *
 * Dropping the late response is only half the fix. `sessions.hosted.attach`
 * ATTACHED this client to that session, so a dropped response leaves an
 * attachment nothing would otherwise release: for a kill-policy session that is
 * what keeps it alive, and for any session it is a client listed as watching
 * something nobody is looking at. The caller detaches it fire-and-forget.
 */
export function attachResponseAction(
  attachedSessionId: string,
  currentSelectionId: string | null,
): AttachResponseAction {
  if (!attachedSessionId) return { adopt: false, detachSessionId: null };
  if (attachedSessionId === currentSelectionId) return { adopt: true, detachSessionId: null };
  return { adopt: false, detachSessionId: attachedSessionId };
}

export function sortHostedSessionsNewestFirst(
  sessions: readonly HostedSessionRecord[],
): HostedSessionRecord[] {
  return [...sessions].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function hostedStatusTone(status: string): "ok" | "neutral" | "bad" | "warning" {
  switch (status) {
    case "running":
      return "ok";
    case "idle":
      return "neutral";
    case "terminated":
      return "bad";
    default:
      // A status this pin has never seen is flagged rather than dressed up as
      // one of the three we know.
      return "warning";
  }
}

export function hostedStatusLabel(status: string): string {
  return status.trim() || "unknown";
}

/**
 * The policy itself, stated unconditionally, read from the record's own
 * effectiveDetachPolicy. The daemon computes that field from the session's
 * override and the hostedSessions.detachPolicy setting, so this client never has
 * to know the setting's value and never guesses.
 */
export function effectiveDetachPolicyLabel(policy: string): string {
  switch (policy) {
    case "kill":
      return "When the last client leaves, this session ends (detach policy: kill).";
    case "survive":
      return "When the last client leaves, this session stays running, idle and reattachable (detach policy: survive).";
    default:
      return `When the last client leaves, the "${policy || "unknown"}" detach policy applies.`;
  }
}

/**
 * What leaving RIGHT NOW does, which is not the same sentence as the policy.
 *
 * The detach policy applies only when the LAST client detaches, and the record
 * carries the attached-client list, so telling someone that leaving will end a
 * session another client is still watching would be plainly false. The count is
 * of clients OTHER than this one, taken from the record rather than inferred
 * from the list length, so this app's own attachment is never counted as
 * somebody else.
 */
export function describeLeaving(policy: string, otherClientsAttached: number): string {
  if (otherClientsAttached > 0) {
    const others =
      otherClientsAttached === 1 ? "one other client is" : `${otherClientsAttached} other clients are`;
    return `${others} still attached, so this session keeps running for them. ${effectiveDetachPolicyLabel(policy)}`;
  }
  switch (policy) {
    case "kill":
      return "You are the last client attached, so leaving ends this session (detach policy: kill).";
    case "survive":
      return "You are the last client attached; leaving keeps this session running, idle and reattachable (detach policy: survive).";
    default:
      return `You are the last client attached, so leaving applies the "${policy || "unknown"}" detach policy.`;
  }
}

/** Why a terminated session ended, in one line. An unknown reason falls
 *  through to the daemon's own string rather than being reworded. */
export function hostedTerminationLabel(
  record: Pick<HostedSessionRecord, "status" | "terminatedReason">,
): string | null {
  if (record.status !== "terminated") return null;
  const reason = record.terminatedReason;
  if (!reason) return "terminated (no reason recorded)";
  switch (reason) {
    case "detached":
      return "terminated: the last client left and its detach policy was kill";
    case "killed":
      return "terminated: ended explicitly";
    case "daemon-shutdown":
      return "terminated: the daemon shut down while hosting it";
    case "restart-unresumable":
      return "terminated: restored from disk, but its loop could not be rebuilt";
    case "retired":
      return "terminated: retired after the retention window";
    case "evicted":
      return "terminated: the daemon could not keep it (a bound was exceeded, or its workspace went away)";
    default:
      return `terminated: ${reason}`;
  }
}

export function hostedAttachedClientCount(record: Pick<HostedSessionRecord, "attachedClients">): number {
  return record.attachedClients.length;
}

/** Whether THIS app (by its persisted client id) is currently attached. */
export function isThisClientAttached(
  record: Pick<HostedSessionRecord, "attachedClients">,
  clientId: string,
): boolean {
  return record.attachedClients.includes(clientId);
}

/** Attached clients OTHER than this one: what decides whether leaving is the
 *  last departure, and so whether the detach policy is about to apply. */
export function otherAttachedClientCount(
  record: Pick<HostedSessionRecord, "attachedClients">,
  clientId: string,
): number {
  return record.attachedClients.filter((id) => id !== clientId).length;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const HOSTED_DETACH_POLICIES = ["kill", "survive"] as const;
export type HostedDetachPolicyChoice = "" | (typeof HOSTED_DETACH_POLICIES)[number];

export interface HostedCreateDraft {
  workspaceRoot: string;
  title: string;
  /** "" means "use the daemon's own hostedSessions.detachPolicy setting". */
  detachPolicy: HostedDetachPolicyChoice;
}

export const EMPTY_HOSTED_CREATE_DRAFT: HostedCreateDraft = {
  workspaceRoot: "",
  title: "",
  detachPolicy: "",
};

/**
 * Everything wrong with a create draft, in field order.
 *
 * The absolute-path rule is checked here as well as on the daemon because the
 * daemon's refusal is correct but late: a relative path would resolve against
 * the DAEMON's own working directory, which is never the directory the operator
 * was looking at, and saying so before the round trip is the difference between
 * a typo and a mystery.
 */
export function validateHostedCreateDraft(draft: HostedCreateDraft): string[] {
  const errors: string[] = [];
  const workspaceRoot = draft.workspaceRoot.trim();
  if (!workspaceRoot) {
    errors.push("Name the workspace this session's tools should operate in.");
  } else if (!workspaceRoot.startsWith("/")) {
    errors.push(
      "The workspace path must be absolute. A relative path resolves against the daemon's own directory, not yours.",
    );
  }
  return errors;
}

/**
 * The sessions.hosted.create body. Optional fields are OMITTED rather than sent
 * empty: an absent detachPolicy is what makes the daemon apply its own
 * hostedSessions.detachPolicy setting, so this client offers "use the daemon
 * default" without ever having to know or guess that value.
 */
export function buildHostedCreateInput(
  draft: HostedCreateDraft,
  clientId: string,
): Record<string, unknown> {
  const title = draft.title.trim();
  return {
    workspaceRoot: draft.workspaceRoot.trim(),
    ...(title ? { title } : {}),
    ...(draft.detachPolicy ? { detachPolicy: draft.detachPolicy } : {}),
    clientId,
  };
}

// ---------------------------------------------------------------------------
// Live output: `turn` / `tools` envelopes, filtered to the attached session
// ---------------------------------------------------------------------------

/** One decoded control-plane envelope: `{type, ts, traceId, sessionId, source, payload}`. */
export interface HostedStreamFrame {
  /** The runtime event's discriminant: STREAM_DELTA, TURN_COMPLETED, TOOL_EXECUTING, … */
  type: string;
  sessionId: string;
  payload: Record<string, unknown>;
}

/** Null for a frame that names no session: it cannot be attributed, so it is
 *  never rendered against one. */
export function readHostedStreamFrame(raw: unknown): HostedStreamFrame | null {
  const record = asRecord(raw);
  const sessionId = firstString(record, ["sessionId"]);
  if (!sessionId) return null;
  return {
    type: firstString(record, ["type"]),
    sessionId,
    payload: asRecord(record["payload"]),
  };
}

export interface HostedLiveMessage {
  role: "assistant" | "system";
  content: string;
  at: number;
}

export interface HostedActiveToolCall {
  callId: string;
  turnId: string;
  tool: string;
  state: "executing" | "succeeded" | "failed";
  error?: string;
}

/** STREAM_DELTA's running text for this turn, or null for any other frame. */
export function streamDeltaAccumulated(frame: HostedStreamFrame): string | null {
  if (frame.type !== "STREAM_DELTA") return null;
  const value = frame.payload["accumulated"];
  return typeof value === "string" ? value : "";
}

/** A finished turn as one appended message, or null when the turn is still running. */
export function hostedLiveMessageFromTurnFrame(
  frame: HostedStreamFrame,
  now: () => number = Date.now,
): HostedLiveMessage | null {
  switch (frame.type) {
    case "TURN_COMPLETED": {
      const response = frame.payload["response"];
      return { role: "assistant", content: typeof response === "string" ? response : "", at: now() };
    }
    case "TURN_ERROR": {
      const error = frame.payload["error"];
      return {
        role: "system",
        content: `Turn failed: ${typeof error === "string" ? error : "unknown error"}`,
        at: now(),
      };
    }
    case "TURN_CANCEL":
      return { role: "system", content: "Turn cancelled.", at: now() };
    default:
      return null;
  }
}

/** True once the turn is no longer in flight: the streaming line clears. */
export function isTerminalTurnFrame(frame: HostedStreamFrame): boolean {
  return frame.type === "TURN_COMPLETED" || frame.type === "TURN_ERROR" || frame.type === "TURN_CANCEL";
}

/** A `tools` frame as an active-call transition, or null for a lifecycle stage
 *  this view does not render (TOOL_RECEIVED / TOOL_VALIDATED / …). */
export function hostedToolCallFromFrame(frame: HostedStreamFrame): HostedActiveToolCall | null {
  const callId = firstString(frame.payload, ["callId"]);
  const turnId = firstString(frame.payload, ["turnId"]);
  const tool = firstString(frame.payload, ["tool"]);
  if (!callId || !tool) return null;
  switch (frame.type) {
    case "TOOL_EXECUTING":
      return { callId, turnId, tool, state: "executing" };
    case "TOOL_SUCCEEDED":
      return { callId, turnId, tool, state: "succeeded" };
    case "TOOL_FAILED": {
      const error = frame.payload["error"];
      return {
        callId,
        turnId,
        tool,
        state: "failed",
        ...(typeof error === "string" ? { error } : {}),
      };
    }
    default:
      return null;
  }
}
