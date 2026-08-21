// Boundary tests for views/settings/devices.ts.
//
// The fixtures are the shapes the daemon actually produced. Every payload here
// was captured from a live goodvibes-daemon 2.0.17 on a scratch port on
// 2026-08-20, including one full capability round trip served by a fake paired
// node, so a parser passing these is a parser that has met the real wire rather
// than the schema's description of it.

import { describe, expect, test } from "bun:test";
import {
  authorityLine,
  availabilityNote,
  buildCapabilityRequest,
  capabilityAvailability,
  capabilityInputFields,
  captureFileName,
  captureRendering,
  decodeCaptureBytes,
  decodeCaptureText,
  decodedLengthMatches,
  expiryLine,
  formatBytes,
  formatWhen,
  housekeepingLine,
  IMAGE_MEDIA_TYPES,
  nodeContractLine,
  readCapabilityOutcome,
  readDeviceArtifactContent,
  readDeviceArtifactList,
  readDeviceGrants,
  readDeviceHousekeepingReport,
  readDeviceNodesSnapshot,
  readDeviceRevokeReceipt,
  refusalLine,
  revokeReportLine,
  safeBlobMediaType,
  type DeviceNode,
} from "../src/ui/views/settings/devices.ts";

// --- fixtures, all captured live ------------------------------------------

const LIVE_NODE = {
  nodeId: "device-946009bc",
  nodeKind: "web-pwa",
  nodeKindLabel: "Web app on the phone",
  label: "scratch fake node",
  platform: "linux-bun",
  appVersion: "0.0.1-fake",
  contractVersion: 1,
  contractCompatible: true,
  supported: ["device.camera.rear.capture", "device.clipboard.read"],
  undeclared: ["device.screen.capture"],
  gatedBySecureContext: [],
  unknownDeclared: [],
};

const LIVE_ARTIFACT = {
  artifactId: "7085b04d-94d0-475a-9106-426ab5351290",
  nodeId: "device-946009bc",
  capabilityId: "device.camera.rear.capture",
  kind: "image",
  mediaType: "image/png",
  byteLength: 1331,
  capturedAt: 1787277512009,
  expiresAt: 1787363912009,
  reason: "verifying the desktop app's device wiring",
  daemonPath: "/home/someone/.goodvibes/tui/devices/captures/7085b04d.png",
};

describe("readDeviceNodesSnapshot", () => {
  test("reads the live nodes.list shape", () => {
    const snapshot = readDeviceNodesSnapshot({
      nodes: [LIVE_NODE],
      capabilities: [
        {
          id: "device.camera.rear.capture",
          family: "camera",
          title: "Rear camera picture",
          purpose: "Take one still picture.",
          effect: "capture",
          sensitivity: "standard",
          producesArtifact: true,
          allowAlwaysOffered: true,
        },
      ],
      mode: "honor-grants",
      allowAlwaysOffer: "offered",
      captureRetentionHours: 24,
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.nodes[0]?.label).toBe("scratch fake node");
    expect(snapshot?.nodes[0]?.supported).toEqual([
      "device.camera.rear.capture",
      "device.clipboard.read",
    ]);
    expect(snapshot?.capabilities[0]?.producesArtifact).toBe(true);
    expect(snapshot?.captureRetentionHours).toBe(24);
  });

  test("a body with no nodes array is null, NOT an empty device list", () => {
    // The two are different claims: null is "the daemon did not answer that",
    // and zero nodes is "nothing is paired".
    expect(readDeviceNodesSnapshot({ capabilities: [] })).toBeNull();
    expect(readDeviceNodesSnapshot(null)).toBeNull();
    expect(readDeviceNodesSnapshot({ nodes: [] })?.nodes).toEqual([]);
  });

  test("an absent contractCompatible is not read as compatible", () => {
    const snapshot = readDeviceNodesSnapshot({ nodes: [{ nodeId: "n1" }] });
    expect(snapshot?.nodes[0]?.contractCompatible).toBe(false);
  });

  test("a node kind the app has never heard of still reads", () => {
    const snapshot = readDeviceNodesSnapshot({
      nodes: [{ nodeId: "n1", nodeKind: "fridge-native", nodeKindLabel: "Fridge", label: "The fridge" }],
    });
    expect(snapshot?.nodes[0]?.nodeKind).toBe("fridge-native");
    expect(snapshot?.nodes[0]?.nodeKindLabel).toBe("Fridge");
  });

  test("a node with no nodeKindLabel falls back to its raw kind", () => {
    const snapshot = readDeviceNodesSnapshot({ nodes: [{ nodeId: "n1", nodeKind: "android-native" }] });
    expect(snapshot?.nodes[0]?.nodeKindLabel).toBe("android-native");
  });
});

describe("capabilityAvailability", () => {
  const node = readDeviceNodesSnapshot({ nodes: [LIVE_NODE] })?.nodes[0] as DeviceNode;

  test("classifies against the three wire lists", () => {
    expect(capabilityAvailability(node, "device.camera.rear.capture")).toBe("supported");
    expect(capabilityAvailability(node, "device.screen.capture")).toBe("undeclared");
    expect(capabilityAvailability(node, "device.command.vibrate")).toBe("unknown");
  });

  test("gated wins over undeclared so the reason survives", () => {
    const gated = readDeviceNodesSnapshot({
      nodes: [{ ...LIVE_NODE, gatedBySecureContext: ["device.screen.capture"] }],
    })?.nodes[0] as DeviceNode;
    expect(capabilityAvailability(gated, "device.screen.capture")).toBe("gated");
    expect(availabilityNote("gated", gated)).toContain("secure context");
  });

  test("an unknown capability is never reported as simply not offered", () => {
    expect(availabilityNote("unknown", node)).toContain("did not say either way");
  });
});

describe("buildCapabilityRequest", () => {
  test("builds the live request body", () => {
    const built = buildCapabilityRequest({
      nodeId: "device-946009bc",
      capabilityId: "device.camera.rear.capture",
      reason: "verifying the desktop app's device wiring",
      inputs: {},
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body).toEqual({
      nodeId: "device-946009bc",
      capabilityId: "device.camera.rear.capture",
      reason: "verifying the desktop app's device wiring",
    });
  });

  test("refuses a blank reason, which the person on the phone would read", () => {
    const built = buildCapabilityRequest({
      nodeId: "n1",
      capabilityId: "device.camera.rear.capture",
      reason: "   ",
      inputs: {},
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.problem).toContain("word for word");
  });

  test("the reason is sent once, at the top level, and never inside input", () => {
    // It is BOTH a required argument of the verb and a field in every
    // capability's inputFields; sending both would let the two disagree, and the
    // one shown on the prompt is the top-level one.
    expect(capabilityInputFields("device.camera.rear.capture").map((f) => f.name)).not.toContain("reason");
    const built = buildCapabilityRequest({
      nodeId: "n1",
      capabilityId: "device.camera.rear.capture",
      reason: "a reason",
      inputs: { reason: "a DIFFERENT reason" },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body["input"]).toBeUndefined();
    expect(built.body["reason"]).toBe("a reason");
  });

  test("coerces a number field and refuses one that is not a number", () => {
    const good = buildCapabilityRequest({
      nodeId: "n1",
      capabilityId: "device.camera.rear.capture",
      reason: "a reason",
      inputs: { maxWidth: "1024" },
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.body["input"]).toEqual({ maxWidth: 1024 });

    const bad = buildCapabilityRequest({
      nodeId: "n1",
      capabilityId: "device.camera.rear.capture",
      reason: "a reason",
      inputs: { maxWidth: "big" },
    });
    // Dropped silently it would take a full-resolution photo nobody asked for.
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problem).toContain("must be a number");
  });

  test("names a missing required field of an actuate capability", () => {
    const built = buildCapabilityRequest({
      nodeId: "n1",
      capabilityId: "device.command.notify",
      reason: "a reason",
      inputs: {},
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.problem).toContain("title");
  });

  test("omits empty optional fields so the device applies its own default", () => {
    const built = buildCapabilityRequest({
      nodeId: "n1",
      capabilityId: "device.command.notify",
      reason: "a reason",
      inputs: { title: "Hello", body: "  " },
    });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.body["input"]).toEqual({ title: "Hello" });
  });

  test("a capability this pinned catalog does not know sends no typed input", () => {
    const built = buildCapabilityRequest({
      nodeId: "n1",
      capabilityId: "device.future.thing",
      reason: "a reason",
      inputs: { whatever: "x" },
    });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.body["input"]).toBeUndefined();
  });
});

describe("readCapabilityOutcome", () => {
  test("reads the live allowed answer, artifact reference and all", () => {
    const outcome = readCapabilityOutcome({
      ok: true,
      nodeId: "device-946009bc",
      capabilityId: "device.camera.rear.capture",
      capabilityTitle: "Rear camera picture",
      authority: "confirmed-once",
      grantId: null,
      artifact: LIVE_ARTIFACT,
      refusal: "",
      detail: "",
    });
    expect(outcome?.ok).toBe(true);
    expect(outcome?.grantId).toBeNull();
    expect(outcome?.artifact?.byteLength).toBe(1331);
    expect(authorityLine("confirmed-once")).toContain("this once");
  });

  test("reads the live refusal as an ANSWER, not an error", () => {
    const outcome = readCapabilityOutcome({
      ok: false,
      nodeId: "no-such-node",
      capabilityId: "device.camera.rear.capture",
      capabilityTitle: "Rear camera picture",
      authority: "",
      grantId: null,
      artifact: null,
      refusal: "node-unknown",
      detail: 'No paired device node with id "no-such-node".',
    });
    expect(outcome).not.toBeNull();
    expect(outcome?.ok).toBe(false);
    expect(refusalLine(outcome!)).toContain("not paired");
    expect(refusalLine(outcome!)).toContain("no-such-node");
  });

  test("a body with no ok is MALFORMED, which is not the same as a refusal", () => {
    // For an actuate capability this is the difference between "they declined"
    // and "it may well have run on someone's phone".
    expect(readCapabilityOutcome({ nodeId: "n1", refusal: "denied-by-person" })).toBeNull();
  });

  test("an unrecognised refusal code still renders with the daemon's detail", () => {
    const outcome = readCapabilityOutcome({
      ok: false,
      refusal: "some-code-from-a-newer-daemon",
      detail: "the daemon's own words",
    });
    expect(refusalLine(outcome!)).toContain("the daemon's own words");
  });

  test("an unknown capability echoes its id back as the title, and that is kept", () => {
    // Measured live: capabilityTitle is the raw input string for an id the
    // catalog does not define. Rendering it is more honest than blanking it.
    const outcome = readCapabilityOutcome({
      ok: false,
      capabilityId: "device.not.a.capability",
      capabilityTitle: "device.not.a.capability",
      refusal: "capability-unknown",
      detail: "",
    });
    expect(outcome?.capabilityTitle).toBe("device.not.a.capability");
  });

  test("keeps a non-artifact data payload, including a falsy one", () => {
    const outcome = readCapabilityOutcome({ ok: true, data: { latitude: 0, longitude: 0 }, artifact: null });
    expect(outcome?.data).toEqual({ latitude: 0, longitude: 0 });
    const empty = readCapabilityOutcome({ ok: true, data: "", artifact: null });
    expect(empty?.data).toBe("");
  });
});

describe("readDeviceGrants and revoke", () => {
  test("reads the live grant, keeping lastUsedAt's null distinct from a date", () => {
    const parsed = readDeviceGrants({
      grants: [
        {
          grantId: "ba431063-823c-4940-bae7-2aed0acf4e98",
          nodeId: "device-946009bc",
          nodeKind: "web-pwa",
          capabilityId: "device.clipboard.read",
          capabilityTitle: "Read the clipboard",
          scope: "always",
          grantedAt: 1787277512243,
          expiresAt: 1795053512243,
          lastUsedAt: null,
          useCount: 0,
          grantedBy: "operator",
        },
      ],
      audit: [
        {
          id: "a1",
          action: "granted",
          grantId: "ba431063-823c-4940-bae7-2aed0acf4e98",
          nodeId: "device-946009bc",
          capabilityId: "device.clipboard.read",
          at: 1787277512243,
          actor: "operator",
          reason: "",
        },
      ],
    });
    expect(parsed?.grants[0]?.lastUsedAt).toBeNull();
    expect(formatWhen(parsed?.grants[0]?.lastUsedAt ?? null)).toBe("never");
    expect(parsed?.audit[0]?.action).toBe("granted");
  });

  test("a body with no grants array is null, not an empty grant list", () => {
    expect(readDeviceGrants({ audit: [] })).toBeNull();
  });

  test("revoked:0 is reported as nothing happening, never as a success", () => {
    const report = revokeReportLine(readDeviceRevokeReceipt({ revoked: 0, removals: [] }), "Read the clipboard");
    expect(report.tone).toBe("info");
    expect(report.text).toContain("Nothing was revoked");
  });

  test("a missing revoked count is a warning, not a silent success", () => {
    const report = revokeReportLine(readDeviceRevokeReceipt({ removals: [] }), "Read the clipboard");
    expect(report.tone).toBe("warning");
    expect(report.text).toContain("did not say");
  });

  test("a real revoke reports the count the daemon gave", () => {
    const report = revokeReportLine(
      readDeviceRevokeReceipt({
        revoked: 1,
        removals: [
          {
            grantId: "g1",
            nodeId: "device-946009bc",
            capabilityId: "device.clipboard.read",
            scope: "always",
            reason: "revoked by operator",
            removedAt: 1787277512243,
          },
        ],
      }),
      "Read the clipboard",
    );
    expect(report.tone).toBe("ok");
    expect(report.text).toContain("Revoked 1 grant.");
  });
});

describe("readDeviceHousekeepingReport", () => {
  test("reads the live sweep summary", () => {
    const report = readDeviceHousekeepingReport({
      summary: "Device housekeeping: nothing to reap (1 grant(s), 1 capture(s) retained).",
      sweptAt: 1787276982911,
      grantsRemoved: [],
      grantsRetained: 1,
      capturesRemoved: [],
      capturesRetained: 1,
      bytesReclaimed: 0,
    });
    expect(report?.grantsRetained).toBe(1);
    expect(housekeepingLine(report!)).toBe(report!.summary);
  });

  test("a sweep that removed things is itemised beyond the summary", () => {
    const report = readDeviceHousekeepingReport({
      summary: "Device housekeeping: reaped 1 capture.",
      sweptAt: 1,
      grantsRemoved: [],
      grantsRetained: 0,
      capturesRemoved: [
        {
          artifactId: "a1",
          nodeId: "n1",
          capabilityId: "device.camera.rear.capture",
          fileName: "a1.png",
          reason: "past retention",
          removedAt: 2,
          byteLength: 1331,
        },
      ],
      capturesRetained: 0,
      bytesReclaimed: 1331,
    });
    expect(housekeepingLine(report!)).toContain("1 capture(s)");
    expect(housekeepingLine(report!)).toContain("1.3 KB");
  });

  test("a body with no summary is null", () => {
    expect(readDeviceHousekeepingReport({ sweptAt: 1 })).toBeNull();
  });
});

describe("readDeviceArtifactList", () => {
  test("reads the live list and keeps retained as the store's own count", () => {
    const list = readDeviceArtifactList({ artifacts: [LIVE_ARTIFACT], retained: 3, retentionHours: 24 });
    expect(list?.artifacts).toHaveLength(1);
    // `retained` is the count before the limit was applied, so it may exceed
    // the rows returned and is never derived from them.
    expect(list?.retained).toBe(3);
  });

  test("a body with no artifacts array is null", () => {
    expect(readDeviceArtifactList({ retained: 0 })).toBeNull();
  });
});

describe("readDeviceArtifactContent", () => {
  test("reads the live read answer", () => {
    const content = readDeviceArtifactContent({ artifact: LIVE_ARTIFACT, dataBase64: "aGk=" });
    expect(content?.artifact.artifactId).toBe(LIVE_ARTIFACT.artifactId);
    expect(content?.dataBase64).toBe("aGk=");
  });

  test("a record with no bytes is null, never a zero-byte picture", () => {
    expect(readDeviceArtifactContent({ artifact: LIVE_ARTIFACT })).toBeNull();
    expect(readDeviceArtifactContent({ dataBase64: "aGk=" })).toBeNull();
  });
});

describe("capture bytes are treated as untrusted content", () => {
  test("only allowlisted raster types are ever rendered as an image", () => {
    expect(captureRendering("image/png")).toBe("image");
    expect(captureRendering("image/jpeg")).toBe("image");
    // XML that can carry script. Never rendered, never given its own blob type.
    expect(captureRendering("image/svg+xml")).toBe("binary");
    expect(safeBlobMediaType("image/svg+xml")).toBe("application/octet-stream");
    expect(IMAGE_MEDIA_TYPES.has("image/svg+xml")).toBe(false);
  });

  test("html is rendered through the plain path and downloaded as a stream", () => {
    // A blob typed text/html on this app's own origin is one middle-click from
    // being a same-origin document.
    expect(captureRendering("text/html")).toBe("binary");
    expect(safeBlobMediaType("text/html")).toBe("application/octet-stream");
  });

  test("a media type parameter cannot smuggle past the allowlist", () => {
    expect(captureRendering("image/png; charset=binary")).toBe("image");
    expect(safeBlobMediaType("image/png; charset=binary")).toBe("image/png");
    expect(captureRendering("TEXT/PLAIN")).toBe("text");
    expect(safeBlobMediaType("text/html; charset=utf-8")).toBe("application/octet-stream");
  });

  test("text types render as text", () => {
    expect(captureRendering("text/plain")).toBe("text");
    expect(captureRendering("application/json")).toBe("text");
    expect(captureRendering("application/geo+json")).toBe("text");
  });

  test("an unreported media type is binary, never guessed at", () => {
    expect(captureRendering("")).toBe("binary");
    expect(safeBlobMediaType("")).toBe("application/octet-stream");
  });

  test("the download filename comes from ids, never from the daemon's path", () => {
    // daemonPath names a file on ANOTHER machine.
    const name = captureFileName({ ...LIVE_ARTIFACT, mediaType: "image/png" });
    expect(name).toBe("device.camera.rear.capture-7085b04d-94d0-475a-9106-426ab5351290.png");
    expect(name).not.toContain("/");
    expect(captureFileName({ ...LIVE_ARTIFACT, mediaType: "image/svg+xml" })).toEndWith(".bin");
    expect(captureFileName({ ...LIVE_ARTIFACT, mediaType: "application/json" })).toEndWith(".bin");
  });

  test("decodes real base64 and reports a payload that will not decode", () => {
    const bytes = decodeCaptureBytes("aGVsbG8=");
    expect(bytes).not.toBeNull();
    expect(decodeCaptureText(bytes!)).toBe("hello");
    expect(decodeCaptureBytes("!!!not base64!!!")).toBeNull();
  });

  test("decodes the first bytes of a real PNG to its signature", () => {
    // The head of the PNG the fake node actually sent through the daemon.
    const bytes = decodeCaptureBytes("iVBORw0KGgoAAAANSUhEUg==");
    expect(bytes).not.toBeNull();
    expect(Array.from(bytes!.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test("a short payload is caught against the length the record claims", () => {
    const bytes = decodeCaptureBytes("aGVsbG8=")!;
    expect(decodedLengthMatches({ ...LIVE_ARTIFACT, byteLength: 5 }, bytes)).toBe(true);
    expect(decodedLengthMatches({ ...LIVE_ARTIFACT, byteLength: 1331 }, bytes)).toBe(false);
    // An unreported length cannot contradict anything, so it does not.
    expect(decodedLengthMatches({ ...LIVE_ARTIFACT, byteLength: 0 }, bytes)).toBe(true);
  });
});

describe("display helpers", () => {
  test("formatWhen keeps never distinct from a date", () => {
    expect(formatWhen(null)).toBe("never");
    expect(formatWhen(0)).toBe("never");
    expect(formatWhen(1787277512009)).not.toBe("never");
  });

  test("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1331)).toBe("1.3 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  test("expiryLine says how long is left, or that it lapsed", () => {
    const now = 1_000_000_000;
    expect(expiryLine(now + 30 * 60_000, now)).toBe("deleted in 30 min");
    expect(expiryLine(now + 5 * 3_600_000, now)).toBe("deleted in 5h");
    expect(expiryLine(now + 48 * 3_600_000, now)).toBe("deleted in 2d");
    expect(expiryLine(now - 1, now)).toBe("past its retention window");
    expect(expiryLine(0, now)).toBe("no expiry recorded");
  });

  test("an incompatible contract says so and says what to do", () => {
    const node = readDeviceNodesSnapshot({
      nodes: [{ ...LIVE_NODE, contractVersion: 9, contractCompatible: false }],
    })?.nodes[0] as DeviceNode;
    expect(nodeContractLine(node)).toContain("cannot speak");
    expect(nodeContractLine(node)).toContain("Update");
  });

  test("an unstated authority is not dressed up as a reason", () => {
    expect(authorityLine("")).toContain("did not say");
    expect(authorityLine("existing-grant")).toContain("durable grant");
    expect(authorityLine("confirmed-always")).toContain("always allow");
  });
});
