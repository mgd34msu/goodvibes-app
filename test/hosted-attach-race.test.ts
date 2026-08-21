// The attach race, reproduced against @tanstack/query-core directly rather than
// argued about.
//
// HostedSessionsPanel drives sessions.hosted.attach through ONE unkeyed
// useMutation. Clicking a slow row and then a fast one leaves two calls in
// flight, and query-core dispatches `options.onSuccess` from the Mutation
// object, not from the observer (mutation.js: `await this.options.onSuccess?.(
// data, variables, …)` inside execute()), so every mutate() builds a new
// Mutation over the SAME options object and the superseded call's callback runs
// too, with its own variables, after the winner's.
//
// Left unguarded, the panel ends split down the middle: selection, SSE filter
// and detach ref on the row that was clicked last, while the attached record,
// transcript, steer target and End-session target belong to the row clicked
// first, whose header the newer session's live frames then append beneath.
//
// The `naive` case below IS that bug, kept as a control so the guarded case is
// measured against a reproduction rather than an assumption. The `guarded` case
// is the panel's actual logic: attachResponseAction, given the resolved session
// id and the CURRENT selection read through a ref.

import { describe, expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/query-core";
import { attachResponseAction, hostedAttachResultFrom } from "../src/ui/views/sessions/hosted-sessions.ts";

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** An attach response shaped exactly like the live daemon's. */
function attachResponse(sessionId: string, title: string) {
  return {
    session: {
      id: sessionId,
      workspaceRoot: "/tmp/ws",
      title,
      status: "idle",
      detachPolicy: null,
      effectiveDetachPolicy: "kill",
      attachedClients: ["app-client"],
      createdAt: 1,
      updatedAt: 2,
      turnCount: 0,
      messageCount: 0,
      restoredFromDisk: false,
    },
    history: [{ role: "assistant", content: `transcript of ${title}` }],
  };
}

/** What the panel holds after the dust settles. */
interface PanelState {
  /** The record the header, steer target and End-session target come from. */
  attachedId: string | null;
  transcript: string;
  /** Sessions released fire-and-forget because their response was dropped. */
  detached: string[];
  /** How many times onSuccess ran at all: the fact the finding turns on. */
  successCallbacks: number;
}

/**
 * Run the two-click sequence. `guard` chooses the panel's onSuccess policy.
 * B (fast, live) is clicked second and resolves FIRST; A (slow, restored)
 * resolves after, which is the completion order the bug needs.
 */
async function runRace(guard: "naive" | "guarded"): Promise<PanelState> {
  const client = new QueryClient();
  const calls: Record<string, Deferred> = { A: deferred(), B: deferred() };

  // The panel's selectedIdRef: mutated synchronously by selectSession before it
  // fires the mutation, so by the time any response lands it names the newest
  // selection rather than the one the in-flight call asked for.
  const selectionRef: { current: string | null } = { current: null };

  const state: PanelState = { attachedId: null, transcript: "", detached: [], successCallbacks: 0 };

  const observer = new MutationObserver<unknown, Error, string>(client, {
    mutationFn: (sessionId: string) => calls[sessionId]!.promise,
    onSuccess: (result: unknown, requestedId: string) => {
      state.successCallbacks += 1;
      const { session, history } = hostedAttachResultFrom(result);

      if (guard === "naive") {
        // What the panel did before this finding: adopt whatever arrives.
        if (!session) return;
        state.attachedId = session.id;
        state.transcript = history[0]?.content ?? "";
        return;
      }

      const action = attachResponseAction(session?.id ?? requestedId, selectionRef.current);
      if (!action.adopt) {
        if (action.detachSessionId) state.detached.push(action.detachSessionId);
        return;
      }
      if (!session) return;
      state.attachedId = session.id;
      state.transcript = history[0]?.content ?? "";
    },
  });

  // Click the slow, restored row.
  selectionRef.current = "A";
  const first = observer.mutate("A").catch(() => undefined);

  // Click the fast, live row before the first one has answered.
  selectionRef.current = "B";
  const second = observer.mutate("B").catch(() => undefined);

  // B answers first; A answers after, which is the whole point.
  calls["B"]!.resolve(attachResponse("B", "live session"));
  await second;
  calls["A"]!.resolve(attachResponse("A", "restored session"));
  await first;
  // Let query-core finish dispatching both callback chains.
  await new Promise((resolve) => setTimeout(resolve, 0));

  return state;
}

describe("two attaches in flight, superseded one completing last", () => {
  test("query-core really does run the superseded call's onSuccess", async () => {
    // If this ever stops being true the guard is unnecessary, and this test
    // says so out loud rather than passing quietly for the wrong reason.
    const state = await runRace("guarded");
    expect(state.successCallbacks).toBe(2);
  });

  test("REPRODUCTION: unguarded, the panel ends showing the superseded session", async () => {
    const naive = await runRace("naive");
    // Selection, SSE filter and detach ref are all on B by this point; the
    // rendered record and transcript are A's.
    expect(naive.attachedId).toBe("A");
    expect(naive.transcript).toBe("transcript of restored session");
    // And nothing ever released the attachment attach() made on A.
    expect(naive.detached).toEqual([]);
  });

  test("guarded, the late response is dropped and the panel stays on the selection", async () => {
    const guarded = await runRace("guarded");
    expect(guarded.attachedId).toBe("B");
    expect(guarded.transcript).toBe("transcript of live session");
  });

  test("guarded, the dropped response's attachment is released", async () => {
    // attach() attached this client to A. Dropping the response without
    // detaching would leave a client attached to a session nobody is watching,
    // which for a kill-policy session is what keeps it alive.
    const guarded = await runRace("guarded");
    expect(guarded.detached).toEqual(["A"]);
  });
});

describe("attachResponseAction", () => {
  test("the response for the current selection is adopted, and detaches nothing", () => {
    expect(attachResponseAction("hosted-1", "hosted-1")).toEqual({ adopt: true, detachSessionId: null });
  });

  test("a superseded response is dropped AND released", () => {
    expect(attachResponseAction("hosted-1", "hosted-2")).toEqual({
      adopt: false,
      detachSessionId: "hosted-1",
    });
  });

  test("a response arriving after the selection cleared is dropped and released", () => {
    // Leaving or switching tabs clears the selection; the attachment is still
    // real and still has to go back.
    expect(attachResponseAction("hosted-1", null)).toEqual({ adopt: false, detachSessionId: "hosted-1" });
  });

  test("an unidentifiable attachment is dropped, and names nothing to detach", () => {
    // Nothing to release by name: the caller falls back on the attachment lease.
    expect(attachResponseAction("", "hosted-2")).toEqual({ adopt: false, detachSessionId: null });
  });
});
