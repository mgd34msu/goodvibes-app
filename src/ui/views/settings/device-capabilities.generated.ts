// GENERATED FILE: DO NOT EDIT BY HAND.
// Produced by scripts/generate-device-capabilities.ts from the installed
// @pellux/goodvibes-sdk platform/devices capability catalog
// (device capability contract v1, 10 capabilities).
//
// The wire (devices.nodes.list) carries every field here EXCEPT inputFields,
// which is why this snapshot exists: a request form cannot invent the typed
// arguments a capability takes. Regenerate: `bun run generate:device-capabilities`.

export interface DeviceCapabilityInputField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface DeviceCapabilityCatalogEntry {
  id: string;
  family: string;
  title: string;
  purpose: string;
  effect: string;
  artifactKind: string;
  producesArtifact: boolean;
  sensitivity: string;
  secureContextRequired: boolean;
  inputFields: readonly DeviceCapabilityInputField[];
}

export const DEVICE_CAPABILITY_CONTRACT_VERSION = 1;

/** Advisory only: a node kind not listed here still pairs and works. */
export const KNOWN_DEVICE_NODE_KINDS: readonly string[] = ["web-pwa","android-native","ios-native"];

export const DEVICE_CAPABILITY_CATALOG: readonly DeviceCapabilityCatalogEntry[] = [
  {
    id: "device.camera.rear.capture",
    family: "camera",
    title: "Rear camera picture",
    purpose: "Take one still picture with the phone's rear camera and hand it to the agent — for reading a label, a screen, a whiteboard, or a part number in front of you.",
    effect: "capture",
    artifactKind: "image",
    producesArtifact: true,
    sensitivity: "standard",
    secureContextRequired: true,
    inputFields: [
      { name: "reason", type: "string", required: true, description: "Why the picture is needed — shown verbatim on the confirmation prompt." },
      { name: "maxWidth", type: "number", required: false, description: "Longest-edge pixel cap applied on the device before upload." },
    ],
  },
  {
    id: "device.camera.front.capture",
    family: "camera",
    title: "Front camera picture",
    purpose: "Take one still picture with the phone's front (selfie) camera. Points at whoever is holding the phone, so it is treated as elevated — but \"always allow\" is offered here exactly as it is everywhere else.",
    effect: "capture",
    artifactKind: "image",
    producesArtifact: true,
    sensitivity: "elevated",
    secureContextRequired: true,
    inputFields: [
      { name: "reason", type: "string", required: true, description: "Why the picture is needed — shown verbatim on the confirmation prompt." },
      { name: "maxWidth", type: "number", required: false, description: "Longest-edge pixel cap applied on the device before upload." },
    ],
  },
  {
    id: "device.screen.capture",
    family: "screen",
    title: "Screen picture",
    purpose: "Capture what is currently on the phone's screen so the agent can read an app, an error, or a message you are looking at.",
    effect: "capture",
    artifactKind: "image",
    producesArtifact: true,
    sensitivity: "elevated",
    secureContextRequired: true,
    inputFields: [
      { name: "reason", type: "string", required: true, description: "Why the screen image is needed — shown verbatim on the confirmation prompt." },
    ],
  },
  {
    id: "device.location.coarse",
    family: "location",
    title: "Approximate location",
    purpose: "Report roughly where the phone is (city/neighbourhood scale) so the agent can answer \"near me\" questions without a street-level fix.",
    effect: "read",
    artifactKind: "geo",
    producesArtifact: false,
    sensitivity: "standard",
    secureContextRequired: true,
    inputFields: [
      { name: "reason", type: "string", required: true, description: "Why the location is needed — shown verbatim on the confirmation prompt." },
      { name: "maxAgeSeconds", type: "number", required: false, description: "Accept a cached fix no older than this instead of taking a new reading." },
    ],
  },
  {
    id: "device.location.precise",
    family: "location",
    title: "Precise location",
    purpose: "Report the phone's exact position with accuracy, for navigation, arrival checks, and anything that needs a street-level fix.",
    effect: "read",
    artifactKind: "geo",
    producesArtifact: false,
    sensitivity: "elevated",
    secureContextRequired: true,
    inputFields: [
      { name: "reason", type: "string", required: true, description: "Why the location is needed — shown verbatim on the confirmation prompt." },
      { name: "maxAgeSeconds", type: "number", required: false, description: "Accept a cached fix no older than this instead of taking a new reading." },
    ],
  },
  {
    id: "device.clipboard.read",
    family: "clipboard",
    title: "Read the clipboard",
    purpose: "Read whatever text is on the phone's clipboard, so you can copy something on the phone and have the agent work with it without retyping it.",
    effect: "read",
    artifactKind: "text",
    producesArtifact: false,
    sensitivity: "elevated",
    secureContextRequired: true,
    inputFields: [
      { name: "reason", type: "string", required: true, description: "Why the clipboard text is needed — shown verbatim on the confirmation prompt." },
    ],
  },
  {
    id: "device.clipboard.write",
    family: "clipboard",
    title: "Put text on the clipboard",
    purpose: "Place text on the phone's clipboard so you can paste it into another app immediately.",
    effect: "actuate",
    artifactKind: "none",
    producesArtifact: false,
    sensitivity: "standard",
    secureContextRequired: true,
    inputFields: [
      { name: "text", type: "string", required: true, description: "The text to place on the clipboard." },
      { name: "reason", type: "string", required: true, description: "Why the text is being placed — shown verbatim on the confirmation prompt." },
    ],
  },
  {
    id: "device.command.notify",
    family: "command",
    title: "Show a notification",
    purpose: "Show a notification on the phone — how the agent gets your attention on the device you are actually holding.",
    effect: "actuate",
    artifactKind: "none",
    producesArtifact: false,
    sensitivity: "standard",
    secureContextRequired: true,
    inputFields: [
      { name: "title", type: "string", required: true, description: "Notification title." },
      { name: "body", type: "string", required: false, description: "Notification body text." },
      { name: "reason", type: "string", required: true, description: "Why the notification is being sent — shown verbatim on the confirmation prompt." },
    ],
  },
  {
    id: "device.command.open_url",
    family: "command",
    title: "Open a link on the phone",
    purpose: "Open a URL on the phone so a page, map, or ticket lands on the screen in your hand instead of on the desktop.",
    effect: "actuate",
    artifactKind: "none",
    producesArtifact: false,
    sensitivity: "standard",
    secureContextRequired: false,
    inputFields: [
      { name: "url", type: "string", required: true, description: "The http(s) URL to open." },
      { name: "reason", type: "string", required: true, description: "Why the link is being opened — shown verbatim on the confirmation prompt." },
    ],
  },
  {
    id: "device.command.vibrate",
    family: "command",
    title: "Vibrate the phone",
    purpose: "Buzz the phone — a silent nudge when a run finishes or an approval is waiting.",
    effect: "actuate",
    artifactKind: "none",
    producesArtifact: false,
    sensitivity: "standard",
    secureContextRequired: false,
    inputFields: [
      { name: "durationMs", type: "number", required: false, description: "Buzz length in milliseconds (device may clamp it)." },
      { name: "reason", type: "string", required: true, description: "Why the phone is being buzzed — shown verbatim on the confirmation prompt." },
    ],
  },
];
