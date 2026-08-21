// Pure-logic coverage for src/ui/views/sessions/hosted-sessions.ts.
//
// Every payload below is a VERBATIM capture from a scratch daemon
// (@pellux/goodvibes-daemon 1.28.19 / sdk 2.0.17) driven over its control-plane
// WebSocket, since sessions.hosted.* has no REST binding: create → list →
// attach → detach → kill → kill-again → attach-after-kill, plus the refusals
// the daemon actually returns for a relative workspace path and an unknown id.

import { describe, expect, test } from "bun:test";
import {
  EMPTY_HOSTED_CREATE_DRAFT,
  buildHostedCreateInput,
  describeLeaving,
  effectiveDetachPolicyLabel,
  hostedAttachResultFrom,
  hostedAttachedClientCount,
  hostedLiveMessageFromTurnFrame,
  hostedSessionFrom,
  hostedSessionFromResult,
  hostedSessionIdFromLifecycle,
  hostedSessionIdFromResult,
  otherAttachedClientCount,
  hostedSessionsFromListResponse,
  hostedStatusLabel,
  hostedStatusTone,
  hostedTerminationLabel,
  hostedToolCallFromFrame,
  isTerminalTurnFrame,
  isThisClientAttached,
  isWellFormedHostedListResponse,
  readHostedStreamFrame,
  sortHostedSessionsNewestFirst,
  streamDeltaAccumulated,
  validateHostedCreateDraft,
} from "../src/ui/views/sessions/hosted-sessions.ts";

const LIVE_CREATED = {
  session: {
    id: "hosted-4c8c9703-be43-41be-926f-4b1a0f1832ac",
    workspaceRoot: "/tmp/scratch/ws-root",
    title: "probe session",
    status: "idle",
    detachPolicy: "survive",
    effectiveDetachPolicy: "survive",
    attachedClients: ["probe-client-1"],
    createdAt: 1787273927566,
    updatedAt: 1787273927566,
    turnCount: 0,
    messageCount: 0,
    restoredFromDisk: false,
  },
};

const LIVE_ATTACHED = {
  session: {
    ...LIVE_CREATED.session,
    attachedClients: ["probe-client-1", "probe-client-2"],
    updatedAt: 1787273927612,
  },
  history: [],
};

const LIVE_KILLED = {
  session: {
    ...LIVE_CREATED.session,
    status: "terminated",
    attachedClients: [],
    updatedAt: 1787273927612,
    terminatedAt: 1787273927612,
    terminatedReason: "killed",
  },
};

const LIVE_LIST = { sessions: [LIVE_CREATED.session] };

describe("hostedSessionFrom", () => {
  test("reads the live create payload's record", () => {
    const session = hostedSessionFrom(LIVE_CREATED.session);
    expect(session).not.toBeNull();
    expect(session?.id).toBe("hosted-4c8c9703-be43-41be-926f-4b1a0f1832ac");
    expect(session?.workspaceRoot).toBe("/tmp/scratch/ws-root");
    expect(session?.status).toBe("idle");
    expect(session?.effectiveDetachPolicy).toBe("survive");
    expect(session?.attachedClients).toEqual(["probe-client-1"]);
    expect(session?.turnCount).toBe(0);
    expect(session?.restoredFromDisk).toBe(false);
    // Absent optional facts stay absent rather than becoming 0.
    expect(session?.lastTurnAt).toBeUndefined();
    expect(session?.terminatedAt).toBeUndefined();
    expect(session?.terminatedReason).toBe("");
  });

  test("a value with no id is null, never a stub record", () => {
    expect(hostedSessionFrom({})).toBeNull();
    expect(hostedSessionFrom(null)).toBeNull();
    expect(hostedSessionFrom("hosted-1")).toBeNull();
    expect(hostedSessionFrom({ workspaceRoot: "/tmp" })).toBeNull();
  });

  test("an unmodelled shape does not throw and claims nothing", () => {
    const session = hostedSessionFrom({ id: "hosted-x", attachedClients: "not-an-array", turnCount: "seven" });
    expect(session?.id).toBe("hosted-x");
    expect(session?.attachedClients).toEqual([]);
    expect(session?.turnCount).toBe(0);
    expect(session?.status).toBe("");
  });

  test("create/detach/kill's {session} envelope", () => {
    expect(hostedSessionFromResult(LIVE_KILLED)?.terminatedReason).toBe("killed");
    // The hermetic-mock fallback shape: an empty object is not a session.
    expect(hostedSessionFromResult({})).toBeNull();
  });
});

describe("hostedSessionIdFromResult", () => {
  // create() passes a clientId, so an unreadable create response still left this
  // app ATTACHED to whatever was made. The id alone releases that attachment
  // instead of leaving it to lapse on its lease.
  test("finds the id in the shape the strict reader accepts", () => {
    expect(hostedSessionIdFromResult(LIVE_CREATED)).toBe("hosted-4c8c9703-be43-41be-926f-4b1a0f1832ac");
  });

  test("finds an id the strict reader could NOT use", () => {
    // A session object the record reader rejects (missing required shape) but
    // which still names what was created.
    expect(hostedSessionFromResult({ session: { id: "hosted-9", weird: true } })).not.toBeNull();
    // Flat shapes the strict reader never looks at.
    expect(hostedSessionIdFromResult({ id: "hosted-9" })).toBe("hosted-9");
    expect(hostedSessionFromResult({ id: "hosted-9" })).toBeNull();
    expect(hostedSessionIdFromResult({ sessionId: "hosted-9" })).toBe("hosted-9");
    expect(hostedSessionFromResult({ sessionId: "hosted-9" })).toBeNull();
  });

  test("answers '' when there is no id anywhere, so the caller can say so", () => {
    expect(hostedSessionIdFromResult({})).toBe("");
    expect(hostedSessionIdFromResult({ session: {} })).toBe("");
    expect(hostedSessionIdFromResult(null)).toBe("");
  });
});

describe("list responses", () => {
  test("the live list payload", () => {
    expect(isWellFormedHostedListResponse(LIVE_LIST)).toBe(true);
    expect(hostedSessionsFromListResponse(LIVE_LIST)).toHaveLength(1);
  });

  test("an empty list is well formed and empty", () => {
    expect(isWellFormedHostedListResponse({ sessions: [] })).toBe(true);
    expect(hostedSessionsFromListResponse({ sessions: [] })).toEqual([]);
  });

  test("an UNREADABLE answer is distinguishable from an empty one", () => {
    // Both produce zero rows; only the well-formed flag tells the view which
    // sentence to render, and that distinction is the whole point.
    expect(isWellFormedHostedListResponse({})).toBe(false);
    expect(isWellFormedHostedListResponse({ sessions: "later" })).toBe(false);
    expect(hostedSessionsFromListResponse({})).toEqual([]);
  });

  test("rows without an id are dropped, the rest survive", () => {
    const rows = hostedSessionsFromListResponse({ sessions: [{}, LIVE_CREATED.session] });
    expect(rows).toHaveLength(1);
  });

  test("newest first, falling back to createdAt when updatedAt is absent", () => {
    const older = { ...LIVE_CREATED.session, id: "a", updatedAt: 0, createdAt: 10 };
    const newer = { ...LIVE_CREATED.session, id: "b", updatedAt: 50, createdAt: 5 };
    const sorted = sortHostedSessionsNewestFirst(hostedSessionsFromListResponse({ sessions: [older, newer] }));
    expect(sorted.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("attach", () => {
  test("the live attach payload carries the session and its transcript", () => {
    const result = hostedAttachResultFrom(LIVE_ATTACHED);
    expect(result.session?.attachedClients).toEqual(["probe-client-1", "probe-client-2"]);
    expect(result.history).toEqual([]);
  });

  test("history entries are read defensively", () => {
    const result = hostedAttachResultFrom({
      session: LIVE_CREATED.session,
      history: [
        { role: "user", content: "hello", at: 1787273927570 },
        { role: "assistant", content: "hi" },
        { content: "no role, dropped" },
      ],
    });
    expect(result.history).toHaveLength(2);
    expect(result.history[0]?.at).toBe(1787273927570);
    expect(result.history[1]?.at).toBeUndefined();
  });

  test("a body with no session means could-not-attach, not an empty session", () => {
    expect(hostedAttachResultFrom({}).session).toBeNull();
    expect(hostedAttachResultFrom({ history: [] }).session).toBeNull();
  });

  test("attached-client helpers", () => {
    const session = hostedSessionFrom(LIVE_ATTACHED.session);
    expect(session && hostedAttachedClientCount(session)).toBe(2);
    expect(session && isThisClientAttached(session, "probe-client-2")).toBe(true);
    expect(session && isThisClientAttached(session, "someone-else")).toBe(false);
  });

  test("otherAttachedClientCount never counts this app as somebody else", () => {
    const session = hostedSessionFrom(LIVE_ATTACHED.session);
    expect(session && otherAttachedClientCount(session, "probe-client-2")).toBe(1);
    // Sole client: nobody else is watching, so leaving IS the last departure.
    const alone = hostedSessionFrom(LIVE_CREATED.session);
    expect(alone && otherAttachedClientCount(alone, "probe-client-1")).toBe(0);
    // A client that is not attached at all still counts everyone it can see.
    expect(alone && otherAttachedClientCount(alone, "stranger")).toBe(1);
  });
});

describe("describeLeaving: what leaving RIGHT NOW does", () => {
  // The detach policy applies only when the LAST client detaches, and the
  // record carries the attached list, so a blanket "leaving ends this session"
  // is false whenever somebody else is still watching.
  test("with others attached, the session keeps running for them", () => {
    const line = describeLeaving("kill", 1);
    expect(line).toContain("one other client is still attached");
    expect(line).toContain("keeps running for them");
    // The policy is still stated, just as the thing that happens LATER.
    expect(line).toContain("When the last client leaves");
    // What it must NOT say.
    expect(line).not.toContain("leaving ends this session");
  });

  test("plural others", () => {
    expect(describeLeaving("survive", 3)).toContain("3 other clients are still attached");
  });

  test("as the last client, a kill policy says leaving ends it", () => {
    const line = describeLeaving("kill", 0);
    expect(line).toContain("You are the last client attached");
    expect(line).toContain("leaving ends this session");
  });

  test("as the last client, a survive policy says it stays reattachable", () => {
    const line = describeLeaving("survive", 0);
    expect(line).toContain("You are the last client attached");
    expect(line).toContain("reattachable");
  });

  test("an unknown policy is still not invented, in either phrasing", () => {
    expect(describeLeaving("park", 0)).toContain('"park" detach policy');
    expect(describeLeaving("park", 2)).toContain('"park" detach policy');
    expect(describeLeaving("", 0)).toContain("unknown");
  });
});

describe("lifecycle frames", () => {
  test("the session id a hosted-session-update names", () => {
    expect(
      hostedSessionIdFromLifecycle({ event: "hosted-session-attached", session: LIVE_CREATED.session }),
    ).toBe("hosted-4c8c9703-be43-41be-926f-4b1a0f1832ac");
    expect(hostedSessionIdFromLifecycle({ event: "hosted-session-attached" })).toBe("");
    expect(hostedSessionIdFromLifecycle(null)).toBe("");
  });
});

describe("display", () => {
  test("status tone and label", () => {
    expect(hostedStatusTone("running")).toBe("ok");
    expect(hostedStatusTone("idle")).toBe("neutral");
    expect(hostedStatusTone("terminated")).toBe("bad");
    // A status this pin has never seen is flagged, not silently normalized.
    expect(hostedStatusTone("hibernating")).toBe("warning");
    expect(hostedStatusLabel("hibernating")).toBe("hibernating");
    expect(hostedStatusLabel("  ")).toBe("unknown");
  });

  test("the policy line states the policy, conditioned on the LAST client", () => {
    // The policy applies when the last client detaches, and the sentence says
    // so rather than implying every departure triggers it.
    expect(effectiveDetachPolicyLabel("kill")).toBe(
      "When the last client leaves, this session ends (detach policy: kill).",
    );
    expect(effectiveDetachPolicyLabel("survive")).toContain("stays running, idle and reattachable");
    // Never invents a behavior for a policy it does not know.
    expect(effectiveDetachPolicyLabel("park")).toBe(
      'When the last client leaves, the "park" detach policy applies.',
    );
    expect(effectiveDetachPolicyLabel("")).toContain("unknown");
  });

  test("termination reasons, including one this client has never seen", () => {
    const killed = hostedSessionFrom(LIVE_KILLED.session);
    expect(killed && hostedTerminationLabel(killed)).toBe("terminated: ended explicitly");
    expect(hostedTerminationLabel({ status: "idle", terminatedReason: "" })).toBeNull();
    expect(hostedTerminationLabel({ status: "terminated", terminatedReason: "" })).toBe(
      "terminated (no reason recorded)",
    );
    expect(hostedTerminationLabel({ status: "terminated", terminatedReason: "detached" })).toContain(
      "detach policy was kill",
    );
    expect(hostedTerminationLabel({ status: "terminated", terminatedReason: "swallowed" })).toBe(
      "terminated: swallowed",
    );
  });
});

describe("create draft", () => {
  test("a workspace path is required", () => {
    expect(validateHostedCreateDraft(EMPTY_HOSTED_CREATE_DRAFT)).toEqual([
      "Name the workspace this session's tools should operate in.",
    ]);
  });

  test("a relative path is refused here, with the daemon's own reason", () => {
    const errors = validateHostedCreateDraft({ ...EMPTY_HOSTED_CREATE_DRAFT, workspaceRoot: "relative/path" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("absolute");
    expect(errors[0]).toContain("daemon's own directory");
  });

  test("an absolute path is accepted", () => {
    expect(validateHostedCreateDraft({ ...EMPTY_HOSTED_CREATE_DRAFT, workspaceRoot: " /tmp/ws " })).toEqual([]);
  });

  test("optional fields are OMITTED, never sent empty", () => {
    const input = buildHostedCreateInput(
      { workspaceRoot: " /tmp/ws ", title: "  ", detachPolicy: "" },
      "client-abc",
    );
    expect(input).toEqual({ workspaceRoot: "/tmp/ws", clientId: "client-abc" });
    // An absent detachPolicy is what makes the daemon apply its own setting.
    expect("detachPolicy" in input).toBe(false);
    expect("title" in input).toBe(false);
  });

  test("stated fields are sent", () => {
    expect(
      buildHostedCreateInput({ workspaceRoot: "/tmp/ws", title: "probe session", detachPolicy: "survive" }, "c1"),
    ).toEqual({
      workspaceRoot: "/tmp/ws",
      title: "probe session",
      detachPolicy: "survive",
      clientId: "c1",
    });
  });
});

describe("live turn/tools frames", () => {
  const DELTA = { type: "STREAM_DELTA", sessionId: "hosted-1", payload: { accumulated: "Hel" } };
  const COMPLETED = { type: "TURN_COMPLETED", sessionId: "hosted-1", payload: { response: "Hello." } };

  test("a frame that names no session is not rendered against one", () => {
    expect(readHostedStreamFrame({ type: "STREAM_DELTA", payload: {} })).toBeNull();
    expect(readHostedStreamFrame(null)).toBeNull();
  });

  test("stream deltas carry the running text", () => {
    const frame = readHostedStreamFrame(DELTA);
    expect(frame?.sessionId).toBe("hosted-1");
    expect(frame && streamDeltaAccumulated(frame)).toBe("Hel");
    // A delta with no accumulated text is "" (the turn so far), not null.
    const bare = readHostedStreamFrame({ type: "STREAM_DELTA", sessionId: "hosted-1", payload: {} });
    expect(bare && streamDeltaAccumulated(bare)).toBe("");
    // Any other frame is not a delta at all.
    const completed = readHostedStreamFrame(COMPLETED);
    expect(completed && streamDeltaAccumulated(completed)).toBeNull();
  });

  test("terminal turn frames become one appended message", () => {
    const completed = readHostedStreamFrame(COMPLETED);
    expect(completed && hostedLiveMessageFromTurnFrame(completed, () => 42)).toEqual({
      role: "assistant",
      content: "Hello.",
      at: 42,
    });
    const failed = readHostedStreamFrame({
      type: "TURN_ERROR",
      sessionId: "hosted-1",
      payload: { error: "provider refused" },
    });
    expect(failed && hostedLiveMessageFromTurnFrame(failed, () => 42)?.content).toBe("Turn failed: provider refused");
    const cancelled = readHostedStreamFrame({ type: "TURN_CANCEL", sessionId: "hosted-1", payload: {} });
    expect(cancelled && hostedLiveMessageFromTurnFrame(cancelled, () => 42)?.role).toBe("system");
    // A mid-turn frame appends nothing.
    const delta = readHostedStreamFrame(DELTA);
    expect(delta && hostedLiveMessageFromTurnFrame(delta)).toBeNull();
  });

  test("terminal detection", () => {
    const completed = readHostedStreamFrame(COMPLETED);
    const delta = readHostedStreamFrame(DELTA);
    expect(completed && isTerminalTurnFrame(completed)).toBe(true);
    expect(delta && isTerminalTurnFrame(delta)).toBe(false);
  });

  test("tool frames the panel renders, and the stages it does not", () => {
    const executing = readHostedStreamFrame({
      type: "TOOL_EXECUTING",
      sessionId: "hosted-1",
      payload: { callId: "call-1", turnId: "turn-1", tool: "bash" },
    });
    expect(executing && hostedToolCallFromFrame(executing)).toEqual({
      callId: "call-1",
      turnId: "turn-1",
      tool: "bash",
      state: "executing",
    });
    const failed = readHostedStreamFrame({
      type: "TOOL_FAILED",
      sessionId: "hosted-1",
      payload: { callId: "call-1", turnId: "turn-1", tool: "bash", error: "exit 1" },
    });
    expect(failed && hostedToolCallFromFrame(failed)?.state).toBe("failed");
    expect(failed && hostedToolCallFromFrame(failed)?.error).toBe("exit 1");
    const received = readHostedStreamFrame({
      type: "TOOL_RECEIVED",
      sessionId: "hosted-1",
      payload: { callId: "call-1", tool: "bash" },
    });
    expect(received && hostedToolCallFromFrame(received)).toBeNull();
    const nameless = readHostedStreamFrame({ type: "TOOL_EXECUTING", sessionId: "hosted-1", payload: {} });
    expect(nameless && hostedToolCallFromFrame(nameless)).toBeNull();
  });
});
