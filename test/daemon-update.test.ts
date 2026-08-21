// Pure-logic coverage for src/ui/views/settings/daemon-update.ts: reading
// update.status / update.check payloads and picking the ONE posture to render.
//
// The base payload is a VERBATIM capture from a locally spawned daemon
// (@pellux/goodvibes-daemon 1.28.19 / sdk 2.0.17), which reported an unarmed
// loop with the reason it gave; the staged/rolled-back/failing variants are the
// same shape with the fields the contract declares for those states.

import { describe, expect, test } from "bun:test";
import { describeUpdatePosture, formatInterval, parseUpdateStatus } from "../src/ui/views/settings/daemon-update.ts";

const LIVE_UNARMED = {
  armed: false,
  offReason:
    "this host manages its own updates: no artifact identity was provided, and the SDK package version is never assumed to be the shipped one",
  currentVersion: null,
  releasesUrl: "https://github.com/mgd34msu/goodvibes-daemon/releases/latest",
  checkIntervalMs: null,
  firstCheckDelayMs: null,
  failedCheckCount: 0,
  lastCheckFailure: null,
  pendingVersion: null,
  rejectedVersion: null,
};

const ARMED_AND_CURRENT = {
  ...LIVE_UNARMED,
  armed: true,
  offReason: "",
  currentVersion: "2.0.17",
  checkIntervalMs: 3_600_000,
  firstCheckDelayMs: 60_000,
};

describe("parseUpdateStatus", () => {
  test("reads the live unarmed payload, nulls included", () => {
    const status = parseUpdateStatus(LIVE_UNARMED);
    expect(status.armed).toBe(false);
    expect(status.offReason).toContain("manages its own updates");
    // null currentVersion is an absent fact, read as "" rather than "null".
    expect(status.currentVersion).toBe("");
    expect(status.checkIntervalMs).toBeUndefined();
    expect(status.failedCheckCount).toBe(0);
    expect(status.pendingVersion).toBe("");
    expect(status.rejectedVersion).toBe("");
    expect(status.releasesUrl).toContain("releases/latest");
  });

  test("an empty payload does not throw and claims nothing", () => {
    const status = parseUpdateStatus({});
    expect(status.armed).toBe(false);
    expect(status.failedCheckCount).toBe(0);
    expect(status.currentVersion).toBe("");
  });
});

describe("formatInterval", () => {
  test("hours, minutes, and absence", () => {
    expect(formatInterval(3_600_000)).toBe("every 1h");
    expect(formatInterval(1_800_000)).toBe("every 30m");
    expect(formatInterval(5_400_000)).toBe("every 1.5h");
    expect(formatInterval(undefined)).toBe("");
    expect(formatInterval(0)).toBe("");
  });
});

describe("describeUpdatePosture", () => {
  test("the live unarmed daemon reads as off, with its own reason", () => {
    const posture = describeUpdatePosture(parseUpdateStatus(LIVE_UNARMED));
    expect(posture.kind).toBe("off");
    expect(posture.tone).toBe("warning");
    expect(posture.detail).toContain("manages its own updates");
  });

  test("an armed daemon with nothing staged reads as current", () => {
    const posture = describeUpdatePosture(parseUpdateStatus(ARMED_AND_CURRENT));
    expect(posture.kind).toBe("current");
    expect(posture.tone).toBe("ok");
    expect(posture.headline).toContain("2.0.17");
    expect(posture.detail).toBe("Checking for releases every 1h.");
  });

  test("a staged release says it is downloaded and NOT installed", () => {
    const posture = describeUpdatePosture(parseUpdateStatus({ ...ARMED_AND_CURRENT, pendingVersion: "2.1.0" }));
    expect(posture.kind).toBe("staged");
    expect(posture.headline).toBe("2.1.0 is staged");
    expect(posture.detail).toContain("Nothing has been installed yet");
    expect(posture.detail).toContain("2.0.17");
  });

  test("a rolled-back release outranks a staged one and says it is not reinstalled", () => {
    const posture = describeUpdatePosture(
      parseUpdateStatus({ ...ARMED_AND_CURRENT, pendingVersion: "2.1.0", rejectedVersion: "2.0.99" }),
    );
    expect(posture.kind).toBe("rolled-back");
    expect(posture.tone).toBe("danger");
    expect(posture.detail).toContain("not reinstalled");
  });

  test("checks failing on schedule is its own state, never 'up to date'", () => {
    const posture = describeUpdatePosture(
      parseUpdateStatus({ ...ARMED_AND_CURRENT, failedCheckCount: 4, lastCheckFailure: "getaddrinfo ENOTFOUND" }),
    );
    expect(posture.kind).toBe("failing");
    expect(posture.headline).toBe("4 update checks failed");
    expect(posture.detail).toContain("ENOTFOUND");
  });

  test("one failure is singular", () => {
    const posture = describeUpdatePosture(parseUpdateStatus({ ...ARMED_AND_CURRENT, failedCheckCount: 1 }));
    expect(posture.headline).toBe("1 update check failed");
  });

  test("a staged release still reports as staged on an unarmed daemon", () => {
    // An unarmed loop with a release already staged still has a release staged;
    // reporting "not keeping itself current" would drop the more urgent fact.
    const posture = describeUpdatePosture(parseUpdateStatus({ ...LIVE_UNARMED, pendingVersion: "2.1.0" }));
    expect(posture.kind).toBe("staged");
  });

  test("an unreported version is named as unreported, never blank or 'null'", () => {
    const posture = describeUpdatePosture(parseUpdateStatus({ ...LIVE_UNARMED, pendingVersion: "2.1.0" }));
    expect(posture.detail).toContain("an unreported version");
  });
});
