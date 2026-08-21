// Pure-logic coverage for src/ui/views/approvals/raise-approval.ts: draft
// validation, the contract-shaped approvals.raise body, and reading the pending
// record back.
//
// The response shape is a VERBATIM capture from a locally spawned daemon
// (@pellux/goodvibes-daemon 1.28.19 / sdk 2.0.17): a real approvals.raise that
// then showed up in approvals.list as a pending record.

import { describe, expect, test } from "bun:test";
import {
  EMPTY_RAISE_DRAFT,
  MAX_TIMEOUT_MINUTES,
  buildRaiseInput,
  describeRaise,
  parseArgs,
  readRaisedApproval,
  splitReasons,
  validateRaiseDraft,
  type RaiseApprovalDraft,
} from "../src/ui/views/approvals/raise-approval.ts";

const VALID: RaiseApprovalDraft = {
  ...EMPTY_RAISE_DRAFT,
  tool: "exec",
  category: "execute",
  riskLevel: "high",
  classification: "shell command",
  summary: "Delete the build directory",
  reasons: "Removes files\nCannot be undone",
};

// Captured live: the pending record approvals.raise handed back.
const LIVE_RAISE_RESULT = {
  approval: {
    id: "approval-a9b20b33",
    callId: "probe-1787270989702",
    status: "pending",
    request: {
      callId: "probe-1787270989702",
      tool: "probe_tool",
      args: { note: "capability probe" },
      category: "read",
      analysis: {
        classification: "capability probe",
        riskLevel: "low",
        summary: "Verifying approvals.raise is served by this daemon.",
        reasons: ["probe"],
      },
    },
    createdAt: 1787270989745,
    updatedAt: 1787270989745,
    metadata: {
      raisedVia: "approvals.raise",
      raisedByPrincipal: "shared-token",
      raisedByPrincipalKind: "token",
      raisedBySurface: "web",
    },
  },
  coalesced: false,
  decided: false,
};

describe("validateRaiseDraft", () => {
  test("a complete draft has no errors", () => {
    expect(validateRaiseDraft(VALID)).toEqual([]);
  });

  test("an empty draft names every missing field", () => {
    const errors = validateRaiseDraft(EMPTY_RAISE_DRAFT);
    expect(errors).toHaveLength(4);
    expect(errors.join(" ")).toContain("tool");
    expect(errors.join(" ")).toContain("Classification");
    expect(errors.join(" ")).toContain("Summary");
    expect(errors.join(" ")).toContain("reason");
  });

  test("whitespace-only reasons do not count as a reason", () => {
    expect(validateRaiseDraft({ ...VALID, reasons: "  \n\n \t " })).toEqual(["Give at least one reason."]);
  });

  test("unparseable arguments are rejected before anything is sent", () => {
    const errors = validateRaiseDraft({ ...VALID, argsJson: "{ not json" });
    expect(errors[0]).toContain("valid JSON");
  });

  test("a JSON array is rejected: the contract types args as a map", () => {
    expect(validateRaiseDraft({ ...VALID, argsJson: "[1,2]" })[0]).toContain("JSON object");
  });

  test("a timeout past the daemon's twelve-hour clamp is rejected here, not silently clamped", () => {
    const errors = validateRaiseDraft({ ...VALID, timeoutMinutes: String(MAX_TIMEOUT_MINUTES + 1) });
    expect(errors[0]).toContain("12 hours");
  });

  test("a non-positive timeout is rejected", () => {
    expect(validateRaiseDraft({ ...VALID, timeoutMinutes: "0" })[0]).toContain("positive");
  });
});

describe("splitReasons / parseArgs", () => {
  test("reasons split on lines and drop blanks", () => {
    expect(splitReasons("one\n\n  two  \n")).toEqual(["one", "two"]);
  });

  test("blank args are an empty object, not an omission", () => {
    expect(parseArgs("   ")).toEqual({ args: {} });
  });

  test("an object parses through", () => {
    expect(parseArgs('{"command":"rm -rf build"}')).toEqual({ args: { command: "rm -rf build" } });
  });
});

describe("buildRaiseInput", () => {
  test("builds exactly the contract's required shape", () => {
    const body = buildRaiseInput(VALID, "app-test-1");
    expect(body).toEqual({
      request: {
        callId: "app-test-1",
        tool: "exec",
        args: {},
        category: "execute",
        analysis: {
          classification: "shell command",
          riskLevel: "high",
          summary: "Delete the build directory",
          reasons: ["Removes files", "Cannot be undone"],
        },
      },
    });
  });

  test("omits an unset session rather than sending an empty string", () => {
    // The input schema is additionalProperties:false and an empty sessionId
    // would scope the ask to a session nothing matches.
    expect(buildRaiseInput(VALID, "c1")).not.toHaveProperty("sessionId");
    expect(buildRaiseInput({ ...VALID, sessionId: " sess-9 " }, "c1")).toMatchObject({ sessionId: "sess-9" });
  });

  test("omits an unset timeout, and converts minutes to milliseconds", () => {
    expect(buildRaiseInput(VALID, "c1")).not.toHaveProperty("timeoutMs");
    expect(buildRaiseInput({ ...VALID, timeoutMinutes: "15" }, "c1")).toMatchObject({ timeoutMs: 900_000 });
  });

  test("clamps a timeout to twelve hours if one slips past validation", () => {
    const body = buildRaiseInput({ ...VALID, timeoutMinutes: "10000" }, "c1");
    expect(body["timeoutMs"]).toBe(MAX_TIMEOUT_MINUTES * 60_000);
  });

  test("trims every free-text field", () => {
    const body = buildRaiseInput({ ...VALID, tool: "  exec  ", summary: "  do it  " }, "c1") as {
      request: { tool: string; analysis: { summary: string } };
    };
    expect(body.request.tool).toBe("exec");
    expect(body.request.analysis.summary).toBe("do it");
  });
});

describe("readRaisedApproval / describeRaise", () => {
  test("reads the live pending record", () => {
    const raised = readRaisedApproval(LIVE_RAISE_RESULT);
    expect(raised).toEqual({ id: "approval-a9b20b33", status: "pending", coalesced: false, decided: false });
  });

  test("a pending raise says the decision will arrive, not that it was decided", () => {
    expect(describeRaise(readRaisedApproval(LIVE_RAISE_RESULT))).toContain("Pending on every surface");
  });

  test("coalesced is a success with its own sentence, never a duplicate", () => {
    const raised = readRaisedApproval({ ...LIVE_RAISE_RESULT, coalesced: true });
    expect(raised.coalesced).toBe(true);
    expect(describeRaise(raised)).toContain("merged onto approval-a9b20b33");
  });

  test("decided:true reports the status the daemon actually reached", () => {
    const raised = readRaisedApproval({
      approval: { ...LIVE_RAISE_RESULT.approval, status: "approved" },
      coalesced: false,
      decided: true,
    });
    expect(describeRaise(raised)).toBe("Already approved.");
  });

  test("an empty payload defaults to pending rather than inventing a decision", () => {
    expect(readRaisedApproval({})).toEqual({ id: "", status: "pending", coalesced: false, decided: false });
  });
});
