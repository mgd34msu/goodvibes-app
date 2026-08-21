// Boundary tests for views/settings/rewind-hosts.ts.
//
// The fixtures are the shapes a live goodvibes-daemon 2.0.17 produced on a
// scratch port on 2026-08-20 for rewind.conversation.host.register,
// .hosts.list, .requests.take and .host.release.

import { describe, expect, test } from "bun:test";
import {
  APP_HOSTING_POSTURE,
  conversationRewindPosture,
  formatLease,
  hostForSession,
  leaseLapsed,
  readConversationRewindHost,
  readConversationRewindHosts,
} from "../src/ui/views/settings/rewind-hosts.ts";

const LIVE_HOST = {
  hostId: "cvh_71e525f9-e43",
  sessionId: "scratch-session-1",
  label: "probe surface",
  registeredAt: 1787277029722,
  leaseExpiresAt: 1787277089722,
};

describe("readConversationRewindHosts", () => {
  test("reads the live hosts.list envelope", () => {
    const hosts = readConversationRewindHosts({ hosts: [LIVE_HOST] });
    expect(hosts).toHaveLength(1);
    expect(hosts?.[0]?.hostId).toBe("cvh_71e525f9-e43");
    expect(hosts?.[0]?.label).toBe("probe surface");
  });

  test("an empty registry is an empty list, and that is an answer", () => {
    expect(readConversationRewindHosts({ hosts: [] })).toEqual([]);
  });

  test("a body with no hosts array is null, NOT an empty registry", () => {
    // Null is "this app could not check"; an empty list is "nobody is offering
    // anything", and reporting the first as the second turns a failed call into
    // a claim about the world.
    expect(readConversationRewindHosts({})).toBeNull();
    expect(readConversationRewindHosts(null)).toBeNull();
    expect(readConversationRewindHosts(undefined)).toBeNull();
  });

  test("a bare array is accepted too", () => {
    expect(readConversationRewindHosts([LIVE_HOST])).toHaveLength(1);
  });

  test("an entry with no hostId or sessionId is dropped, not half-read", () => {
    const hosts = readConversationRewindHosts({
      hosts: [LIVE_HOST, { hostId: "x" }, { sessionId: "y" }, null],
    });
    expect(hosts).toHaveLength(1);
  });

  test("an unnamed surface is described, never rendered as a blank", () => {
    const host = readConversationRewindHost({ hostId: "h", sessionId: "s" });
    expect(host?.label).toBe("an unnamed surface");
  });
});

describe("lease state", () => {
  test("a lease in the future is live, one in the past has lapsed", () => {
    expect(leaseLapsed(LIVE_HOST, LIVE_HOST.leaseExpiresAt - 1_000)).toBe(false);
    expect(leaseLapsed(LIVE_HOST, LIVE_HOST.leaseExpiresAt + 1_000)).toBe(true);
  });

  test("a host with no lease recorded is not called lapsed", () => {
    expect(leaseLapsed({ ...LIVE_HOST, leaseExpiresAt: 0 })).toBe(false);
    expect(formatLease({ ...LIVE_HOST, leaseExpiresAt: 0 })).toBe("no lease recorded");
  });

  test("formatLease says how long is left", () => {
    const now = LIVE_HOST.leaseExpiresAt - 30_000;
    expect(formatLease(LIVE_HOST, now)).toBe("lease renews within 30s");
    expect(formatLease(LIVE_HOST, LIVE_HOST.leaseExpiresAt - 120_000)).toBe("lease renews within 2 min");
    expect(formatLease(LIVE_HOST, LIVE_HOST.leaseExpiresAt + 1)).toBe("lease lapsed");
  });
});

describe("conversationRewindPosture", () => {
  test("a live host is named as the surface that will be asked", () => {
    const posture = conversationRewindPosture([LIVE_HOST], "scratch-session-1", LIVE_HOST.leaseExpiresAt - 1_000);
    expect(posture.tone).toBe("ok");
    expect(posture.text).toContain("probe surface");
  });

  test("a host that stopped polling is a WARNING, and says the rewind will wait", () => {
    // Measured live: a registered host that never answers turns a 4ms honest
    // "unavailable" into a 20s wait for the same answer.
    const posture = conversationRewindPosture([LIVE_HOST], "scratch-session-1", LIVE_HOST.leaseExpiresAt + 1_000);
    expect(posture.tone).toBe("warning");
    expect(posture.text).toContain("stopped renewing");
    expect(posture.text).toContain("unavailable");
  });

  test("no host at all falls through to the daemon's own store, and says so", () => {
    const posture = conversationRewindPosture([], "some-session");
    expect(posture.tone).toBe("info");
    expect(posture.text).toContain("daemon's own store");
  });

  test("a host for a DIFFERENT session is not read as this one's", () => {
    const posture = conversationRewindPosture([LIVE_HOST], "a-different-session");
    expect(posture.text).toContain("No surface is offering");
    expect(posture.text).not.toContain("probe surface");
  });

  test("an unread registry says this app could not check, never that nobody is offering", () => {
    const posture = conversationRewindPosture(null, "scratch-session-1");
    expect(posture.tone).toBe("info");
    expect(posture.text).toContain("not something this app can check");
  });
});

describe("hostForSession", () => {
  test("finds the surface holding a session, or null", () => {
    expect(hostForSession([LIVE_HOST], "scratch-session-1")?.hostId).toBe("cvh_71e525f9-e43");
    expect(hostForSession([LIVE_HOST], "nope")).toBeNull();
    expect(hostForSession([], "scratch-session-1")).toBeNull();
  });
});

describe("this app's own hosting posture", () => {
  test("states plainly that it offers nothing, and why", () => {
    // This is not computed from the daemon's answer on purpose: whatever the
    // registry says, this process has no message store, so it is never the host
    // of anything.
    expect(APP_HOSTING_POSTURE).toContain("does not offer");
    expect(APP_HOSTING_POSTURE).toContain("only that process can count or drop");
  });
});
