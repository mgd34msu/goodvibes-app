// Wire readers, view types and display helpers for the daemon's seven paired-
// device verbs (devices.nodes.list / .capability.request / .artifacts.list /
// .artifacts.read / .grants.list / .grants.revoke / .housekeeping.run).
//
// WHICH END OF THE CONTRACT THIS IS. A paired phone SERVES capabilities; this
// desktop app CONSUMES them. Nothing here decides whether a capability may run.
// The confirmation prompt, the durable-grant lookup, the retention window and
// the disclosure all belong to the daemon-owned device runtime, and this module
// shapes arguments and reads back the runtime's own outcome.
//
// A REFUSAL IS AN ANSWER. devices.capability.request returns HTTP 200 with
// ok:false when the person holding the phone declines, when the capability is
// turned off by configuration, or when the node cannot serve it. Reading that
// as a failure would make a working system look broken and would throw away the
// one thing the caller needs, which is what they said. So `readCapabilityOutcome`
// treats ok:false as a well-formed result carrying `refusal` and `detail`, and
// reserves null for a body that carried no outcome at all.
//
// ARTIFACT BYTES ARE UNTRUSTED. They came off a phone, through a daemon, and
// they are about to be handed to a renderer running on the app's own origin.
// Two rules follow, and both are enforced here rather than at each call site:
//   1. A blob is only ever built with a media type from IMAGE_MEDIA_TYPES; every
//      other capture becomes application/octet-stream. That is what keeps a
//      capture that claims to be text/html from becoming a same-origin document
//      when its object URL is opened, and what keeps image/svg+xml (XML that can
//      carry script) out of any renderer at all.
//   2. Text is rendered as TEXT. React escapes by default, so the rule is simply
//      that nothing here produces markup and no caller may pass a capture to
//      dangerouslySetInnerHTML.
//
// NODE-KIND NEUTRALITY. The contract's whole point is that a web node and a
// native node are described identically, so nothing here branches on nodeKind.
// `nodeKindLabel` arrives from the daemon already resolved; an unlisted kind is
// rendered as it came rather than being rejected.

import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";
import { safeHref } from "../../lib/safe-href.ts";
import { DEVICE_CAPABILITY_CATALOG, type DeviceCapabilityCatalogEntry } from "./device-capabilities.generated.ts";

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

/** A capability as devices.nodes.list describes it (no inputFields on the wire). */
export interface DeviceCapability {
  id: string;
  family: string;
  title: string;
  purpose: string;
  effect: string;
  sensitivity: string;
  producesArtifact: boolean;
  allowAlwaysOffered: boolean;
}

/** One paired device and what it announced it can do. */
export interface DeviceNode {
  nodeId: string;
  nodeKind: string;
  nodeKindLabel: string;
  label: string;
  platform: string;
  appVersion: string;
  contractVersion: number;
  contractCompatible: boolean;
  /** Catalog capabilities this node declared AND can currently serve. */
  supported: string[];
  /** Catalog capabilities this node did not declare at all. */
  undeclared: string[];
  /** Declared, but unservable right now because the node's context is not secure. */
  gatedBySecureContext: string[];
  /** Ids the node declared that this contract version does not define. */
  unknownDeclared: string[];
}

export interface DeviceNodesSnapshot {
  nodes: DeviceNode[];
  capabilities: DeviceCapability[];
  /** The device policy mode the daemon is running. */
  mode: string;
  /** Whether "always allow" is offered at all on this daemon. */
  allowAlwaysOffer: string;
  captureRetentionHours: number;
}

/** One retained capture, described identically by every verb that returns one. */
export interface DeviceArtifact {
  artifactId: string;
  nodeId: string;
  capabilityId: string;
  kind: string;
  mediaType: string;
  byteLength: number;
  capturedAt: number;
  expiresAt: number;
  /** The reason the request stated, shown verbatim on the phone's prompt. */
  reason: string;
  /** Where the bytes sit on the DAEMON host. Never a path this app can open. */
  daemonPath: string;
}

export interface DeviceArtifactList {
  artifacts: DeviceArtifact[];
  retained: number;
  retentionHours: number;
}

/** devices.artifacts.read: the record plus its bytes, base64 on the wire. */
export interface DeviceArtifactContent {
  artifact: DeviceArtifact;
  dataBase64: string;
}

/** One durable "always allow" grant. */
export interface DeviceGrant {
  grantId: string;
  nodeId: string;
  nodeKind: string;
  capabilityId: string;
  capabilityTitle: string;
  scope: string;
  grantedAt: number;
  expiresAt: number;
  /** Null when the grant has never been used. Never rendered as a date. */
  lastUsedAt: number | null;
  useCount: number;
  grantedBy: string;
}

/** One line of the grant ledger: given, used, revoked, expired. */
export interface DeviceGrantAudit {
  id: string;
  action: string;
  grantId: string;
  nodeId: string;
  capabilityId: string;
  at: number;
  actor: string;
  reason: string;
}

export interface DeviceGrantsSnapshot {
  grants: DeviceGrant[];
  audit: DeviceGrantAudit[];
}

/** One grant the daemon removed, with the reason it gives. */
export interface DeviceGrantRemoval {
  grantId: string;
  nodeId: string;
  capabilityId: string;
  scope: string;
  reason: string;
  removedAt: number;
}

/** One capture housekeeping deleted. */
export interface DeviceCaptureRemoval {
  artifactId: string;
  nodeId: string;
  capabilityId: string;
  fileName: string;
  reason: string;
  removedAt: number;
  byteLength: number;
}

export interface DeviceRevokeReceipt {
  revoked: number;
  removals: DeviceGrantRemoval[];
}

export interface DeviceHousekeepingReport {
  summary: string;
  sweptAt: number;
  grantsRemoved: DeviceGrantRemoval[];
  grantsRetained: number;
  capturesRemoved: DeviceCaptureRemoval[];
  capturesRetained: number;
  bytesReclaimed: number;
}

/**
 * What devices.capability.request answered.
 *
 * `ok:false` is a real answer, not an error: the request ran, was put to the
 * person holding the phone (or matched against configuration), and this is what
 * came back. `authority` is empty on a refusal and otherwise says WHY it was
 * allowed, which is the field that makes an allowed capture auditable.
 */
export interface DeviceCapabilityOutcome {
  ok: boolean;
  nodeId: string;
  capabilityId: string;
  capabilityTitle: string;
  /** existing-grant | confirmed-once | confirmed-always. Empty on a refusal. */
  authority: string;
  grantId: string | null;
  /** Non-artifact payload (a location fix, clipboard text). Absent when none. */
  data?: unknown;
  /** A REFERENCE to the retained capture; the bytes come from artifacts.read. */
  artifact: DeviceArtifact | null;
  /** The machine-readable refusal code. Empty when ok. */
  refusal: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Wire readers
// ---------------------------------------------------------------------------

function readStringList(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

function readCapability(value: unknown): DeviceCapability | null {
  const record = asRecord(value);
  const id = firstString(record, ["id"]);
  if (!id) return null;
  return {
    id,
    family: firstString(record, ["family"]),
    title: firstString(record, ["title"]) || id,
    purpose: firstString(record, ["purpose"]),
    effect: firstString(record, ["effect"]),
    sensitivity: firstString(record, ["sensitivity"]),
    producesArtifact: record["producesArtifact"] === true,
    allowAlwaysOffered: record["allowAlwaysOffered"] === true,
  };
}

function readNode(value: unknown): DeviceNode | null {
  const record = asRecord(value);
  const nodeId = firstString(record, ["nodeId"]);
  if (!nodeId) return null;
  const nodeKind = firstString(record, ["nodeKind"]);
  return {
    nodeId,
    nodeKind,
    // The daemon resolves the friendly label; an unlisted kind still gets one.
    nodeKindLabel: firstString(record, ["nodeKindLabel"]) || nodeKind,
    label: firstString(record, ["label"]) || nodeId,
    platform: firstString(record, ["platform"]),
    appVersion: firstString(record, ["appVersion"]),
    contractVersion: firstNumber(record, ["contractVersion"]) ?? 0,
    // Absent is NOT treated as compatible: an unstated answer to "can this app
    // and this phone speak the same contract" is not a yes.
    contractCompatible: record["contractCompatible"] === true,
    supported: readStringList(record["supported"]),
    undeclared: readStringList(record["undeclared"]),
    gatedBySecureContext: readStringList(record["gatedBySecureContext"]),
    unknownDeclared: readStringList(record["unknownDeclared"]),
  };
}

/**
 * devices.nodes.list, or null when the body carried no node list at all.
 *
 * Null and "zero nodes" are two different sentences: nothing is paired is a
 * fact about the world, and the daemon did not answer is a fact about the call.
 */
export function readDeviceNodesSnapshot(value: unknown): DeviceNodesSnapshot | null {
  const record = asRecord(value);
  if (!Array.isArray(record["nodes"])) return null;
  return {
    nodes: asArray(record["nodes"])
      .map(readNode)
      .filter((node): node is DeviceNode => node !== null),
    capabilities: asArray(record["capabilities"])
      .map(readCapability)
      .filter((capability): capability is DeviceCapability => capability !== null),
    mode: firstString(record, ["mode"]),
    allowAlwaysOffer: firstString(record, ["allowAlwaysOffer"]),
    captureRetentionHours: firstNumber(record, ["captureRetentionHours"]) ?? 0,
  };
}

export function readDeviceArtifact(value: unknown): DeviceArtifact | null {
  const record = asRecord(value);
  const artifactId = firstString(record, ["artifactId"]);
  if (!artifactId) return null;
  return {
    artifactId,
    nodeId: firstString(record, ["nodeId"]),
    capabilityId: firstString(record, ["capabilityId"]),
    kind: firstString(record, ["kind"]),
    mediaType: firstString(record, ["mediaType"]),
    byteLength: firstNumber(record, ["byteLength"]) ?? 0,
    capturedAt: firstNumber(record, ["capturedAt"]) ?? 0,
    expiresAt: firstNumber(record, ["expiresAt"]) ?? 0,
    reason: firstString(record, ["reason"]),
    daemonPath: firstString(record, ["daemonPath"]),
  };
}

export function readDeviceArtifactList(value: unknown): DeviceArtifactList | null {
  const record = asRecord(value);
  if (!Array.isArray(record["artifacts"])) return null;
  const artifacts = asArray(record["artifacts"])
    .map(readDeviceArtifact)
    .filter((artifact): artifact is DeviceArtifact => artifact !== null);
  return {
    artifacts,
    // `retained` is the store's own count BEFORE the limit was applied, so it
    // can legitimately exceed artifacts.length; it is not derived from it.
    retained: firstNumber(record, ["retained"]) ?? artifacts.length,
    retentionHours: firstNumber(record, ["retentionHours"]) ?? 0,
  };
}

/**
 * devices.artifacts.read, or null when the body carried no bytes.
 *
 * A record with no `dataBase64` is null rather than an empty capture: the
 * daemon re-hashes before serving and 404s a mismatch, so a missing payload
 * here is a malformed answer and must never render as a zero-byte picture.
 */
export function readDeviceArtifactContent(value: unknown): DeviceArtifactContent | null {
  const record = asRecord(value);
  const artifact = readDeviceArtifact(record["artifact"]);
  const dataBase64 = record["dataBase64"];
  if (!artifact || typeof dataBase64 !== "string") return null;
  return { artifact, dataBase64 };
}

function readGrant(value: unknown): DeviceGrant | null {
  const record = asRecord(value);
  const grantId = firstString(record, ["grantId"]);
  if (!grantId) return null;
  const capabilityId = firstString(record, ["capabilityId"]);
  const lastUsedAt = record["lastUsedAt"];
  return {
    grantId,
    nodeId: firstString(record, ["nodeId"]),
    nodeKind: firstString(record, ["nodeKind"]),
    capabilityId,
    capabilityTitle: firstString(record, ["capabilityTitle"]) || capabilityId,
    scope: firstString(record, ["scope"]),
    grantedAt: firstNumber(record, ["grantedAt"]) ?? 0,
    expiresAt: firstNumber(record, ["expiresAt"]) ?? 0,
    // Explicitly nullable on the wire and meaningful: never used is not a date.
    lastUsedAt: typeof lastUsedAt === "number" && Number.isFinite(lastUsedAt) ? lastUsedAt : null,
    useCount: firstNumber(record, ["useCount"]) ?? 0,
    grantedBy: firstString(record, ["grantedBy"]),
  };
}

function readGrantAudit(value: unknown): DeviceGrantAudit | null {
  const record = asRecord(value);
  const id = firstString(record, ["id"]);
  if (!id) return null;
  return {
    id,
    action: firstString(record, ["action"]),
    grantId: firstString(record, ["grantId"]),
    nodeId: firstString(record, ["nodeId"]),
    capabilityId: firstString(record, ["capabilityId"]),
    at: firstNumber(record, ["at"]) ?? 0,
    actor: firstString(record, ["actor"]),
    reason: firstString(record, ["reason"]),
  };
}

export function readDeviceGrants(value: unknown): DeviceGrantsSnapshot | null {
  const record = asRecord(value);
  if (!Array.isArray(record["grants"])) return null;
  return {
    grants: asArray(record["grants"])
      .map(readGrant)
      .filter((grant): grant is DeviceGrant => grant !== null),
    audit: asArray(record["audit"])
      .map(readGrantAudit)
      .filter((entry): entry is DeviceGrantAudit => entry !== null),
  };
}

function readGrantRemoval(value: unknown): DeviceGrantRemoval | null {
  const record = asRecord(value);
  const grantId = firstString(record, ["grantId"]);
  if (!grantId) return null;
  return {
    grantId,
    nodeId: firstString(record, ["nodeId"]),
    capabilityId: firstString(record, ["capabilityId"]),
    scope: firstString(record, ["scope"]),
    reason: firstString(record, ["reason"]),
    removedAt: firstNumber(record, ["removedAt"]) ?? 0,
  };
}

function readCaptureRemoval(value: unknown): DeviceCaptureRemoval | null {
  const record = asRecord(value);
  const artifactId = firstString(record, ["artifactId"]);
  if (!artifactId) return null;
  return {
    artifactId,
    nodeId: firstString(record, ["nodeId"]),
    capabilityId: firstString(record, ["capabilityId"]),
    fileName: firstString(record, ["fileName"]),
    reason: firstString(record, ["reason"]),
    removedAt: firstNumber(record, ["removedAt"]) ?? 0,
    byteLength: firstNumber(record, ["byteLength"]) ?? 0,
  };
}

/**
 * devices.grants.revoke, or null when the body did not say how many went.
 *
 * `revoked` is required by the contract, and its absence is a malformed answer
 * rather than a revocation of nothing. A daemon that did not say it removed a
 * grant has not told us the grant is gone, and a surface that reported success
 * anyway would leave a live "always allow" on a phone the owner believes
 * was just revoked.
 */
export function readDeviceRevokeReceipt(value: unknown): DeviceRevokeReceipt | null {
  const record = asRecord(value);
  const revoked = firstNumber(record, ["revoked"]);
  if (revoked === undefined) return null;
  return {
    revoked,
    removals: asArray(record["removals"])
      .map(readGrantRemoval)
      .filter((removal): removal is DeviceGrantRemoval => removal !== null),
  };
}

export function readDeviceHousekeepingReport(value: unknown): DeviceHousekeepingReport | null {
  const record = asRecord(value);
  const summary = firstString(record, ["summary"]);
  if (!summary) return null;
  return {
    summary,
    sweptAt: firstNumber(record, ["sweptAt"]) ?? 0,
    grantsRemoved: asArray(record["grantsRemoved"])
      .map(readGrantRemoval)
      .filter((removal): removal is DeviceGrantRemoval => removal !== null),
    grantsRetained: firstNumber(record, ["grantsRetained"]) ?? 0,
    capturesRemoved: asArray(record["capturesRemoved"])
      .map(readCaptureRemoval)
      .filter((removal): removal is DeviceCaptureRemoval => removal !== null),
    capturesRetained: firstNumber(record, ["capturesRetained"]) ?? 0,
    bytesReclaimed: firstNumber(record, ["bytesReclaimed"]) ?? 0,
  };
}

/**
 * devices.capability.request, or null when the body carried no outcome.
 *
 * `ok` is required by the contract, so its absence is a MALFORMED answer rather
 * than a refusal, and the two are reported differently: a refusal names what the
 * person said, and a malformed answer says the daemon did not tell us what
 * happened, which for an actuate capability (a notification, a buzz, a link
 * opened on someone's phone) is the difference between "they declined" and "it
 * may well have run".
 */
export function readCapabilityOutcome(value: unknown): DeviceCapabilityOutcome | null {
  const record = asRecord(value);
  if (typeof record["ok"] !== "boolean") return null;
  const grantId = record["grantId"];
  const capabilityId = firstString(record, ["capabilityId"]);
  return {
    ok: record["ok"],
    nodeId: firstString(record, ["nodeId"]),
    capabilityId,
    capabilityTitle: firstString(record, ["capabilityTitle"]) || capabilityId,
    authority: firstString(record, ["authority"]),
    grantId: typeof grantId === "string" && grantId ? grantId : null,
    ...(record["data"] === undefined ? {} : { data: record["data"] }),
    artifact: readDeviceArtifact(record["artifact"]),
    refusal: firstString(record, ["refusal"]),
    detail: firstString(record, ["detail"]),
  };
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

/**
 * `reason` is a top-level required argument of devices.capability.request AND
 * appears in every capability's inputFields, because the node contract mirrors
 * it down to the device. Sending it twice would let the two disagree, and the
 * one the person actually reads is the top-level one, so the form renders and
 * sends exactly one: this name is filtered out of the typed input fields.
 */
export const REASON_FIELD_NAME = "reason";

/** The typed arguments a capability takes, minus the reason handled above. */
export function capabilityInputFields(capabilityId: string): DeviceCapabilityCatalogEntry["inputFields"] {
  const entry = DEVICE_CAPABILITY_CATALOG.find((candidate) => candidate.id === capabilityId);
  if (!entry) return [];
  return entry.inputFields.filter((field) => field.name !== REASON_FIELD_NAME);
}

/** The pinned catalog entry for a capability, or null for an id it predates. */
export function capabilityCatalogEntry(capabilityId: string): DeviceCapabilityCatalogEntry | null {
  return DEVICE_CAPABILITY_CATALOG.find((candidate) => candidate.id === capabilityId) ?? null;
}

export interface CapabilityRequestDraft {
  nodeId: string;
  capabilityId: string;
  reason: string;
  /** Raw text per input field, exactly as typed. Coerced on build. */
  inputs: Record<string, string>;
}

export type CapabilityRequestBuild =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; problem: string };

/**
 * Turn a draft into the request body, or say what is missing.
 *
 * Number fields are coerced here and a value that is not a number is REFUSED
 * rather than dropped or sent as a string: a maxWidth of "big" silently omitted
 * would take a full-resolution photo the owner did not ask for, and sent as a
 * string would be a 400 whose message is about types rather than about what the owner
 * typed. Empty optional fields are omitted entirely, which is what lets the
 * device apply its own default.
 */
export function buildCapabilityRequest(draft: CapabilityRequestDraft): CapabilityRequestBuild {
  if (!draft.nodeId) return { ok: false, problem: "Choose which paired device to ask." };
  if (!draft.capabilityId) return { ok: false, problem: "Choose which capability to request." };
  const reason = draft.reason.trim();
  if (!reason) {
    return {
      ok: false,
      problem: "Say why you need it. The reason is shown word for word on the phone's prompt.",
    };
  }

  const input: Record<string, unknown> = {};
  for (const field of capabilityInputFields(draft.capabilityId)) {
    const raw = (draft.inputs[field.name] ?? "").trim();
    if (!raw) {
      if (field.required) return { ok: false, problem: `${field.name} is required: ${field.description}` };
      continue;
    }
    if (field.type === "number") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return { ok: false, problem: `${field.name} must be a number, not "${raw}".` };
      }
      input[field.name] = parsed;
      continue;
    }
    if (field.type === "boolean") {
      input[field.name] = raw === "true";
      continue;
    }
    // The phone-side web node refuses non-http(s) links itself, but a native
    // node is a separate implementation with no such guarantee, so the scheme
    // is gated on this side of the wire too.
    if (draft.capabilityId === "device.command.open_url" && field.name === "url" && safeHref(raw) === undefined) {
      return { ok: false, problem: `url must be an http or https link, not "${raw}".` };
    }
    input[field.name] = raw;
  }

  return {
    ok: true,
    body: {
      nodeId: draft.nodeId,
      capabilityId: draft.capabilityId,
      reason,
      ...(Object.keys(input).length > 0 ? { input } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Capability availability, per node
// ---------------------------------------------------------------------------

export type CapabilityAvailability = "supported" | "gated" | "undeclared" | "unknown";

/**
 * Whether this node can serve this capability right now, and why not.
 *
 * The three wire lists are checked in the order that makes the answer specific:
 * a capability the node declared but cannot serve is GATED and gets a sentence
 * naming the reason, which is the whole point of the daemon reporting the list
 * separately instead of folding it into "not supported".
 */
export function capabilityAvailability(node: DeviceNode, capabilityId: string): CapabilityAvailability {
  if (node.supported.includes(capabilityId)) return "supported";
  if (node.gatedBySecureContext.includes(capabilityId)) return "gated";
  if (node.undeclared.includes(capabilityId)) return "undeclared";
  return "unknown";
}

export function availabilityNote(availability: CapabilityAvailability, node: DeviceNode): string {
  switch (availability) {
    case "supported":
      return "";
    case "gated":
      return `${node.label} offers this, but its connection is not a secure context right now, so it cannot serve it. Reach it over https (or loopback) and it will.`;
    case "undeclared":
      return `${node.label} does not offer this capability at all.`;
    case "unknown":
      return `${node.label} did not say either way about this capability, so this app cannot promise it will work.`;
  }
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * The daemon's refusal codes, in the words a person would use.
 *
 * The daemon's own `detail` is always shown alongside and is the authority; this
 * only supplies the sentence around it, so an unrecognised code still renders as
 * a refusal with its detail rather than as a blank.
 */
const REFUSAL_LINES: Readonly<Record<string, string>> = {
  "node-unknown": "That device is not paired with this daemon any more.",
  "capability-unknown": "This daemon does not know that capability.",
  "capability-unsupported": "That device does not offer this capability.",
  "capability-gated-by-secure-context":
    "That device offers this, but its connection is not a secure context, so it cannot serve it.",
  "disabled-by-config": "This capability is turned off by configuration on this daemon.",
  "denied-by-person": "The person holding the device said no.",
  "dispatch-failed": "The request never reached the device.",
  "invalid-input": "The daemon rejected the request's arguments.",
};

export function refusalLine(outcome: DeviceCapabilityOutcome): string {
  const head = REFUSAL_LINES[outcome.refusal] ?? "The daemon refused that request.";
  return outcome.detail ? `${head} ${outcome.detail}` : head;
}

/** Why an allowed capability was allowed, said plainly. */
export function authorityLine(authority: string): string {
  switch (authority) {
    case "existing-grant":
      return "Allowed by a durable grant that was already in place.";
    case "confirmed-once":
      return "The person holding the device allowed it this once.";
    case "confirmed-always":
      return "The person holding the device chose always allow, so this wrote a durable grant.";
    default:
      return authority ? `Allowed: ${authority}.` : "The daemon did not say what allowed this.";
  }
}

// ---------------------------------------------------------------------------
// Capture bytes: decoding and safe rendering
// ---------------------------------------------------------------------------

/**
 * Media types a capture may be handed to an <img> as.
 *
 * Raster formats only. image/svg+xml is deliberately absent: it is XML that can
 * carry script, and while an <img> will not run that script, an object URL for
 * it is a same-origin document one middle-click away. A capture that claims to
 * be an SVG is treated as an unrenderable binary and offered as a download.
 */
export const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
]);

/**
 * Media types rendered as text, in a text node.
 *
 * text/html is NOT here, and that is not an oversight: a capture claiming to be
 * HTML is still just bytes off a phone, so it renders through the plain-text
 * path like anything else unrecognised, and never as markup.
 */
export const TEXT_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/geo+json",
]);

export type CaptureRendering = "image" | "text" | "binary";

function normalizeMediaType(mediaType: string): string {
  // A wire media type may carry parameters ("text/plain; charset=utf-8"); the
  // decision is made on the type alone so a parameter cannot smuggle past the
  // allowlist by making the string unequal.
  return mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function captureRendering(mediaType: string): CaptureRendering {
  const base = normalizeMediaType(mediaType);
  if (IMAGE_MEDIA_TYPES.has(base)) return "image";
  if (TEXT_MEDIA_TYPES.has(base)) return "text";
  return "binary";
}

/**
 * The media type a Blob for this capture may be built with.
 *
 * Anything not on the image allowlist becomes application/octet-stream, so an
 * object URL made from it can only ever be downloaded, never rendered as a
 * document on this app's origin. This is the single chokepoint: no call site
 * builds a Blob from a daemon-supplied media type directly.
 */
export function safeBlobMediaType(mediaType: string): string {
  const base = normalizeMediaType(mediaType);
  return IMAGE_MEDIA_TYPES.has(base) ? base : "application/octet-stream";
}

/** A filename for a downloaded capture. The ids are daemon-supplied too, so
 *  they are reduced to a safe character set here rather than trusted; the
 *  extension comes only from the render allowlist, never from an arbitrary
 *  media-type token (image/html would otherwise name the file .html). */
export function captureFileName(artifact: DeviceArtifact): string {
  const base = normalizeMediaType(artifact.mediaType);
  const extension = IMAGE_MEDIA_TYPES.has(base) ? base.slice("image/".length) : "bin";
  const safePart = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${safePart(artifact.capabilityId)}-${safePart(artifact.artifactId)}.${extension}`;
}

/**
 * Decode a capture's base64 payload, or null when it is not valid base64.
 *
 * Null is reported to the operator rather than swallowed: the daemon re-hashes
 * the bytes before serving them, so a payload that will not decode means the
 * answer was mangled between there and here, and showing a blank picture would
 * hide that.
 */
export function decodeCaptureBytes(dataBase64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(dataBase64);
    // Backed by a plain ArrayBuffer rather than the ArrayBufferLike the bare
    // Uint8Array type implies, so the result is a legal BlobPart: a Blob cannot
    // be built from a view onto a SharedArrayBuffer.
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Decode a text capture. Invalid UTF-8 is replaced, never thrown on. */
export function decodeCaptureText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Whether the decoded payload is the length the record claims.
 *
 * The daemon's digest check already refuses a torn file, so a mismatch here is
 * about the answer rather than the capture, and it is worth saying out loud
 * instead of rendering a truncated picture as if it were the whole one.
 */
export function decodedLengthMatches(artifact: DeviceArtifact, bytes: Uint8Array): boolean {
  return artifact.byteLength === 0 || artifact.byteLength === bytes.byteLength;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function formatWhen(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "never";
  return new Date(value).toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** How long until a capture is deleted, or that it already lapsed. */
export function expiryLine(expiresAt: number, nowMs = Date.now()): string {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return "no expiry recorded";
  const remaining = expiresAt - nowMs;
  if (remaining <= 0) return "past its retention window";
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 60) return `deleted in ${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `deleted in ${hours}h`;
  return `deleted in ${Math.floor(hours / 24)}d`;
}

/** One line describing a node's contract posture. */
export function nodeContractLine(node: DeviceNode): string {
  return node.contractCompatible
    ? `${node.nodeKindLabel} · contract v${node.contractVersion}`
    : `${node.nodeKindLabel} · contract v${node.contractVersion}, which this daemon cannot speak. Update the device's app.`;
}

/** What the sweep did, from the daemon's own itemised report. */
export function housekeepingLine(report: DeviceHousekeepingReport): string {
  const removed = report.grantsRemoved.length + report.capturesRemoved.length;
  if (removed === 0) return report.summary;
  return `${report.summary} (${report.grantsRemoved.length} grant(s), ${report.capturesRemoved.length} capture(s), ${formatBytes(report.bytesReclaimed)} reclaimed)`;
}

export interface DeviceReport {
  tone: "ok" | "info" | "warning";
  text: string;
}

/**
 * What a revoke actually did, in one line.
 *
 * `revoked: 0` is reported as an INFO rather than a success: the grant this page
 * rendered is not there any more, which usually means another surface revoked it
 * or it expired between the read and the click, and saying "revoked" would tell
 * the owner that something happened that did not.
 */
export function revokeReportLine(receipt: DeviceRevokeReceipt | null, label: string): DeviceReport {
  if (receipt === null) {
    return {
      tone: "warning",
      text: `The daemon answered, but did not say whether ${label} was revoked. Check the list below before assuming the grant is gone.`,
    };
  }
  if (receipt.revoked === 0) {
    return {
      tone: "info",
      text: `Nothing was revoked: ${label} was already gone. The list is being re-read.`,
    };
  }
  return {
    tone: "ok",
    text: `Revoked ${receipt.revoked} grant${receipt.revoked === 1 ? "" : "s"}. The next request for it asks again.`,
  };
}
