// GitHub integration model (docs/FEATURES.md §15 row 11, docs/GAPS.md §15 row
// 11): device-flow auth + PR/issue list/create.
//
// GROUNDING: a full-text search of src/ui/lib/generated/operator-routes.ts
// (the pinned ground truth gv.invoke() reads) turns up ZERO "github.*"
// entries — the daemon's operator contract does not declare this surface at
// all, on either the HTTP or WS side. There is also no GitHub REST client
// anywhere under src/bun/. This is a genuine "nothing exists yet" gap, not a
// case of an existing route the UI forgot to wire (contrast intelligence /
// review snapshots, §15 rows 8 & 12, where the route IS declared).
//
// This module still defines the method-id namespace the daemon would need
// (matching FEATURES.md's own description: "app-bun GitHub REST, bundled
// device-flow client id") so GitHubPanel.tsx is ready to light up the moment
// a future daemon build adds these routes — but every call is gated by
// isKnownMethod(), which reads the SAME generated table, client-side, with no
// network round-trip. Today that gate is always false, so the panel renders
// one honest UnavailableState and invokes nothing. If a future SDK bump adds
// these ids to operator-routes.ts, the gated sections light up with no code
// change here.

import { isKnownMethod, gv } from "../../lib/gv.ts";
import { asRecord, firstNumber, firstString, firstArray } from "../../lib/wire.ts";

// ─── candidate method-id namespace (see grounding note above) ───────────────

export const GITHUB_METHOD_IDS = {
  status: "github.status",
  deviceStart: "github.auth.deviceStart",
  devicePoll: "github.auth.devicePoll",
  pullsList: "github.pulls.list",
  pullsCreate: "github.pulls.create",
  issuesList: "github.issues.list",
  issuesCreate: "github.issues.create",
} as const;

export type GitHubMethodKey = keyof typeof GITHUB_METHOD_IDS;

/** Which of the candidate ids this connected client's pinned contract knows about. */
export function knownGitHubMethods(): Partial<Record<GitHubMethodKey, boolean>> {
  const out: Partial<Record<GitHubMethodKey, boolean>> = {};
  for (const key of Object.keys(GITHUB_METHOD_IDS) as GitHubMethodKey[]) {
    out[key] = isKnownMethod(GITHUB_METHOD_IDS[key]);
  }
  return out;
}

export function anyGitHubMethodKnown(): boolean {
  return Object.values(knownGitHubMethods()).some(Boolean);
}

// ─── shapes ──────────────────────────────────────────────────────────────────

export interface GitHubConnectionStatus {
  linked: boolean;
  login: string;
  scopes: string[];
}

export function connectionStatusFromResponse(value: unknown): GitHubConnectionStatus {
  const record = asRecord(value);
  return {
    linked: record["linked"] === true,
    login: firstString(record, ["login", "user", "username"]),
    scopes: firstArray(record, ["scopes"]).filter((s): s is string => typeof s === "string"),
  };
}

export type DeviceFlowStatus = "pending" | "authorized" | "expired" | "denied" | "slow_down" | "unknown";

export interface DeviceStartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export function deviceStartFromResponse(value: unknown): DeviceStartResult {
  const record = asRecord(value);
  return {
    deviceCode: firstString(record, ["deviceCode", "device_code"]),
    userCode: firstString(record, ["userCode", "user_code"]),
    verificationUri: firstString(record, ["verificationUri", "verification_uri"]),
    verificationUriComplete: firstString(record, ["verificationUriComplete", "verification_uri_complete"]),
    expiresInSeconds: firstNumber(record, ["expiresInSeconds", "expires_in"]) ?? 900,
    intervalSeconds: firstNumber(record, ["intervalSeconds", "interval"]) ?? 5,
  };
}

export interface DevicePollResult {
  status: DeviceFlowStatus;
  login: string;
}

const KNOWN_POLL_STATUSES: readonly DeviceFlowStatus[] = ["pending", "authorized", "expired", "denied", "slow_down"];

export function devicePollFromResponse(value: unknown): DevicePollResult {
  const record = asRecord(value);
  const raw = firstString(record, ["status", "state"]);
  const status = (KNOWN_POLL_STATUSES as readonly string[]).includes(raw) ? (raw as DeviceFlowStatus) : "unknown";
  return { status, login: firstString(record, ["login", "user", "username"]) };
}

export interface GitHubIssueLike {
  id: string;
  number: number;
  title: string;
  state: string;
  url: string;
  author: string;
  createdAt: string;
  body: string;
  isPullRequest: boolean;
}

function issueLikeFromRecord(record: unknown, isPullRequest: boolean): GitHubIssueLike {
  const r = asRecord(record);
  return {
    id: firstString(r, ["id", "nodeId"]) || String(firstNumber(r, ["number"]) ?? ""),
    number: firstNumber(r, ["number"]) ?? 0,
    title: firstString(r, ["title"]) || "(untitled)",
    state: firstString(r, ["state"]) || "unknown",
    url: firstString(r, ["url", "htmlUrl", "html_url"]),
    author: firstString(r, ["author", "user", "login"]),
    createdAt: firstString(r, ["createdAt", "created_at"]),
    body: firstString(r, ["body"]),
    isPullRequest,
  };
}

export function pullsFromResponse(value: unknown): GitHubIssueLike[] {
  const record = asRecord(value);
  const rows = firstArray(record, ["pulls", "items", "data"]);
  return rows.map((r) => issueLikeFromRecord(r, true));
}

export function issuesFromResponse(value: unknown): GitHubIssueLike[] {
  const record = asRecord(value);
  const rows = firstArray(record, ["issues", "items", "data"]);
  return rows.map((r) => issueLikeFromRecord(r, false));
}

// ─── calls (each only ever reached from behind an isKnownMethod gate) ────────

export const githubApi = {
  status: () => gv.invoke<unknown>(GITHUB_METHOD_IDS.status),
  deviceStart: () => gv.invoke<unknown>(GITHUB_METHOD_IDS.deviceStart, { body: {} }),
  devicePoll: (deviceCode: string) =>
    gv.invoke<unknown>(GITHUB_METHOD_IDS.devicePoll, { body: { deviceCode } }),
  pullsList: () => gv.invoke<unknown>(GITHUB_METHOD_IDS.pullsList),
  pullsCreate: (body: { title: string; head: string; base: string; body?: string }, meta: ConfirmMeta) =>
    gv.invoke<unknown>(GITHUB_METHOD_IDS.pullsCreate, { body: { ...body, ...meta } }),
  issuesList: () => gv.invoke<unknown>(GITHUB_METHOD_IDS.issuesList),
  issuesCreate: (body: { title: string; body?: string }, meta: ConfirmMeta) =>
    gv.invoke<unknown>(GITHUB_METHOD_IDS.issuesCreate, { body: { ...body, ...meta } }),
};

interface ConfirmMeta {
  confirm: true;
  explicitUserRequest: true;
}
