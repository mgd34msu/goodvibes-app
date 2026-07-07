// Defensive readers for channels.* wire payloads. Shapes follow the pinned
// operator contract (sdk 1.3.1 — see the outputSchema of each method in
// contracts/artifacts/operator-contract.json), read defensively so a 1.0.0
// daemon with slightly older field sets degrades to honest blanks instead of
// crashes. Status/state strings are rendered VERBATIM (presentation-bridge
// classifies tone) — this module never invents vocabulary.

import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

function readBool(value: unknown, key: string, fallback = false): boolean {
  const item = asRecord(value)[key];
  return typeof item === "boolean" ? item : fallback;
}

function readStringArray(value: unknown, key: string): string[] {
  return asArray(asRecord(value)[key]).filter((v): v is string => typeof v === "string");
}

// ── channels.status ──────────────────────────────────────────────────────────

export interface SurfaceStatusRow {
  id: string;
  surface: string;
  label: string;
  state: string;
  enabled: boolean;
  accountId: string;
  metadata: Record<string, unknown>;
}

export function readStatusRows(data: unknown): SurfaceStatusRow[] {
  return asArray(asRecord(data)["channels"]).map((row) => ({
    id: firstString(row, ["id"]) || firstString(row, ["surface"]),
    surface: firstString(row, ["surface"]),
    label: firstString(row, ["label"]) || firstString(row, ["surface"]),
    state: firstString(row, ["state"]) || "unknown",
    enabled: readBool(row, "enabled"),
    accountId: firstString(row, ["accountId"]),
    metadata: asRecord(asRecord(row)["metadata"]),
  }));
}

// ── channels.inbox.list ──────────────────────────────────────────────────────

export interface InboxItem {
  id: string;
  provider: string;
  kind: string;
  from: string;
  fromAddress: string;
  subject: string;
  bodyPreview: string;
  receivedAt: number | undefined;
  unread: boolean;
  routeId: string;
  threadId: string;
  attachmentCount: number;
}

export interface InboxPage {
  items: InboxItem[];
  total: number;
  truncated: boolean;
}

export function readInbox(data: unknown): InboxPage {
  const record = asRecord(data);
  const items = asArray(record["items"]).map((row) => ({
    id: firstString(row, ["id"]),
    provider: firstString(row, ["provider"]),
    kind: firstString(row, ["kind"]),
    from: firstString(row, ["from"]),
    fromAddress: firstString(row, ["fromAddress"]),
    subject: firstString(row, ["subject"]),
    bodyPreview: firstString(row, ["bodyPreview"]),
    receivedAt: firstNumber(row, ["receivedAt"]),
    unread: readBool(row, "unread"),
    routeId: firstString(row, ["routeId"]),
    threadId: firstString(row, ["threadId"]),
    attachmentCount: firstNumber(row, ["attachmentCount"]) ?? 0,
  }));
  return {
    items,
    total: firstNumber(record, ["total"]) ?? items.length,
    truncated: readBool(record, "truncated"),
  };
}

// ── channels.accounts.* ──────────────────────────────────────────────────────

export interface AccountSecret {
  field: string;
  label: string;
  configured: boolean;
  source: string;
}

export interface AccountActionDef {
  id: string;
  label: string;
  kind: string;
  available: boolean;
}

export interface ChannelAccount {
  id: string;
  surface: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  linked: boolean;
  state: string;
  authState: string;
  accountId: string;
  workspaceId: string;
  secrets: AccountSecret[];
  actions: AccountActionDef[];
}

export function readAccount(row: unknown): ChannelAccount {
  return {
    id: firstString(row, ["id"]),
    surface: firstString(row, ["surface"]),
    label: firstString(row, ["label"]) || firstString(row, ["surface"]),
    enabled: readBool(row, "enabled"),
    configured: readBool(row, "configured"),
    linked: readBool(row, "linked"),
    state: firstString(row, ["state"]) || "unknown",
    authState: firstString(row, ["authState"]) || "unknown",
    accountId: firstString(row, ["accountId"]),
    workspaceId: firstString(row, ["workspaceId"]),
    secrets: asArray(asRecord(row)["secrets"]).map((s) => ({
      field: firstString(s, ["field"]),
      label: firstString(s, ["label"]) || firstString(s, ["field"]),
      configured: readBool(s, "configured"),
      source: firstString(s, ["source"]),
    })),
    actions: asArray(asRecord(row)["actions"]).map((a) => ({
      id: firstString(a, ["id"]),
      label: firstString(a, ["label"]) || firstString(a, ["id"]),
      kind: firstString(a, ["kind"]),
      available: readBool(a, "available", true),
    })),
  };
}

export function readAccounts(data: unknown): ChannelAccount[] {
  return asArray(asRecord(data)["accounts"]).map(readAccount);
}

// ── channels.actions / channels.tools / agent_tools / capabilities ──────────

export interface ChannelActionRow {
  id: string;
  surface: string;
  label: string;
  description: string;
  dangerous: boolean;
}

export function readActionRows(data: unknown): ChannelActionRow[] {
  return asArray(asRecord(data)["actions"]).map((row) => ({
    id: firstString(row, ["id"]),
    surface: firstString(row, ["surface"]),
    label: firstString(row, ["label"]) || firstString(row, ["id"]),
    description: firstString(row, ["description"]),
    dangerous: readBool(row, "dangerous"),
  }));
}

export interface ChannelToolRow {
  id: string;
  surface: string;
  name: string;
  description: string;
  actionIds: string[];
}

export function readToolRows(data: unknown): ChannelToolRow[] {
  return asArray(asRecord(data)["tools"]).map((row) => ({
    id: firstString(row, ["id"]),
    surface: firstString(row, ["surface"]),
    name: firstString(row, ["name"]) || firstString(row, ["id"]),
    description: firstString(row, ["description"]),
    actionIds: readStringArray(row, "actionIds"),
  }));
}

export interface AgentToolRow {
  name: string;
  description: string;
  sideEffects: string[];
  concurrency: string;
  supportsProgress: boolean;
  supportsStreamingOutput: boolean;
}

export function readAgentToolRows(data: unknown): AgentToolRow[] {
  return asArray(asRecord(data)["tools"]).map((row) => ({
    name: firstString(row, ["name"]),
    description: firstString(row, ["description"]),
    sideEffects: readStringArray(row, "sideEffects"),
    concurrency: firstString(row, ["concurrency"]),
    supportsProgress: readBool(row, "supportsProgress"),
    supportsStreamingOutput: readBool(row, "supportsStreamingOutput"),
  }));
}

export interface CapabilityRow {
  id: string;
  surface: string;
  label: string;
  scope: string;
  supported: boolean;
  detail: string;
}

export function readCapabilityRows(data: unknown): CapabilityRow[] {
  return asArray(asRecord(data)["capabilities"]).map((row) => ({
    id: firstString(row, ["id"]),
    surface: firstString(row, ["surface"]),
    label: firstString(row, ["label"]) || firstString(row, ["id"]),
    scope: firstString(row, ["scope"]),
    supported: readBool(row, "supported"),
    detail: firstString(row, ["detail"]),
  }));
}

// ── channels.directory.query ─────────────────────────────────────────────────

export interface DirectoryEntry {
  id: string;
  surface: string;
  kind: string;
  label: string;
  handle: string;
  memberCount: number | undefined;
  isDirect: boolean;
  isGroupConversation: boolean;
}

export function readDirectoryEntries(data: unknown): DirectoryEntry[] {
  return asArray(asRecord(data)["entries"]).map((row) => ({
    id: firstString(row, ["id"]),
    surface: firstString(row, ["surface"]),
    kind: firstString(row, ["kind"]),
    label: firstString(row, ["label"]) || firstString(row, ["handle", "id"]),
    handle: firstString(row, ["handle"]),
    memberCount: firstNumber(row, ["memberCount"]),
    isDirect: readBool(row, "isDirect"),
    isGroupConversation: readBool(row, "isGroupConversation"),
  }));
}

// ── channels.doctor.get / repairs / setup / lifecycle ────────────────────────

export interface DoctorCheck {
  id: string;
  label: string;
  status: string;
  detail: string;
  repairActionId: string;
}

export interface RepairAction {
  id: string;
  label: string;
  description: string;
  dangerous: boolean;
}

export interface DoctorReport {
  surface: string;
  state: string;
  summary: string;
  checkedAt: number | undefined;
  checks: DoctorCheck[];
  repairActions: RepairAction[];
}

export function readRepairAction(row: unknown): RepairAction {
  return {
    id: firstString(row, ["id"]),
    label: firstString(row, ["label"]) || firstString(row, ["id"]),
    description: firstString(row, ["description"]),
    dangerous: readBool(row, "dangerous"),
  };
}

export function readDoctor(data: unknown): DoctorReport {
  const record = asRecord(data);
  return {
    surface: firstString(record, ["surface"]),
    state: firstString(record, ["state"]) || "unknown",
    summary: firstString(record, ["summary"]),
    checkedAt: firstNumber(record, ["checkedAt"]),
    checks: asArray(record["checks"]).map((row) => ({
      id: firstString(row, ["id"]),
      label: firstString(row, ["label"]) || firstString(row, ["id"]),
      status: firstString(row, ["status"]) || "unknown",
      detail: firstString(row, ["detail"]),
      repairActionId: firstString(row, ["repairActionId"]),
    })),
    repairActions: asArray(record["repairActions"]).map(readRepairAction),
  };
}

export function readRepairActions(data: unknown): RepairAction[] {
  return asArray(asRecord(data)["actions"]).map(readRepairAction);
}

export interface SetupFieldOption {
  value: string;
  label: string;
}

export interface SetupField {
  id: string;
  label: string;
  kind: string;
  required: boolean;
  detail: string;
  placeholder: string;
  configKey: string;
  secretTargetId: string;
  options: SetupFieldOption[];
}

export interface SetupGuide {
  surface: string;
  label: string;
  setupMode: string;
  description: string;
  fields: SetupField[];
}

export function readSetup(data: unknown): SetupGuide {
  const record = asRecord(data);
  return {
    surface: firstString(record, ["surface"]),
    label: firstString(record, ["label"]),
    setupMode: firstString(record, ["setupMode"]),
    description: firstString(record, ["description"]),
    fields: asArray(record["fields"]).map((row) => ({
      id: firstString(row, ["id"]),
      label: firstString(row, ["label"]) || firstString(row, ["id"]),
      kind: firstString(row, ["kind"]),
      required: readBool(row, "required"),
      detail: firstString(row, ["detail"]),
      placeholder: firstString(row, ["placeholder"]),
      configKey: firstString(row, ["configKey"]),
      secretTargetId: firstString(row, ["secretTargetId"]),
      options: asArray(asRecord(row)["options"]).map((opt) => ({
        value: firstString(opt, ["value"]),
        label: firstString(opt, ["label"]) || firstString(opt, ["value"]),
      })),
    })),
  };
}

export interface LifecycleInfo {
  surface: string;
  accountId: string;
  currentVersion: number | undefined;
  targetVersion: number | undefined;
}

export function readLifecycle(data: unknown): LifecycleInfo {
  const record = asRecord(data);
  return {
    surface: firstString(record, ["surface"]),
    accountId: firstString(record, ["accountId"]),
    currentVersion: firstNumber(record, ["currentVersion"]),
    targetVersion: firstNumber(record, ["targetVersion"]),
  };
}

// ── channels.policies.* ──────────────────────────────────────────────────────

export interface SurfacePolicy {
  surface: string;
  enabled: boolean;
  requireMention: boolean;
  allowDirectMessages: boolean;
  allowGroupMessages: boolean;
  allowThreadMessages: boolean;
  allowTextCommandsWithoutMention: boolean;
  dmPolicy: string;
  groupPolicy: string;
  allowlistUserIds: string[];
  allowlistChannelIds: string[];
  allowlistGroupIds: string[];
  allowedCommands: string[];
  groupPolicyCount: number;
}

export function readPolicies(data: unknown): SurfacePolicy[] {
  return asArray(asRecord(data)["policies"]).map((row) => ({
    surface: firstString(row, ["surface"]),
    enabled: readBool(row, "enabled"),
    requireMention: readBool(row, "requireMention"),
    allowDirectMessages: readBool(row, "allowDirectMessages"),
    allowGroupMessages: readBool(row, "allowGroupMessages"),
    allowThreadMessages: readBool(row, "allowThreadMessages"),
    allowTextCommandsWithoutMention: readBool(row, "allowTextCommandsWithoutMention"),
    dmPolicy: firstString(row, ["dmPolicy"]),
    groupPolicy: firstString(row, ["groupPolicy"]),
    allowlistUserIds: readStringArray(row, "allowlistUserIds"),
    allowlistChannelIds: readStringArray(row, "allowlistChannelIds"),
    allowlistGroupIds: readStringArray(row, "allowlistGroupIds"),
    allowedCommands: readStringArray(row, "allowedCommands"),
    groupPolicyCount: asArray(asRecord(row)["groupPolicies"]).length,
  }));
}

export interface PolicyAuditEntry {
  id: string;
  surface: string;
  createdAt: number | undefined;
  allowed: boolean;
  reason: string;
  userId: string;
  channelId: string;
  conversationKind: string;
  text: string;
}

export function readPolicyAudit(data: unknown): PolicyAuditEntry[] {
  return asArray(asRecord(data)["audit"]).map((row) => ({
    id: firstString(row, ["id"]),
    surface: firstString(row, ["surface"]),
    createdAt: firstNumber(row, ["createdAt"]),
    allowed: readBool(row, "allowed"),
    reason: firstString(row, ["reason"]),
    userId: firstString(row, ["userId"]),
    channelId: firstString(row, ["channelId"]),
    conversationKind: firstString(row, ["conversationKind"]),
    text: firstString(row, ["text"]),
  }));
}

// ── channels.drafts.* ────────────────────────────────────────────────────────

export interface DraftRecord {
  version: number;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  title: string;
  message: string;
  channel: string;
  route: string;
  webhook: string;
  link: string;
  tags: string[];
  sentResponseId: string;
  sendError: string;
}

export function readDraft(row: unknown): DraftRecord {
  return {
    version: firstNumber(row, ["version"]) ?? 1,
    id: firstString(row, ["id"]),
    createdAt: firstString(row, ["createdAt"]),
    updatedAt: firstString(row, ["updatedAt"]),
    status: firstString(row, ["status"]) || "draft",
    title: firstString(row, ["title"]),
    message: firstString(row, ["message"]),
    channel: firstString(row, ["channel"]),
    route: firstString(row, ["route"]),
    webhook: firstString(row, ["webhook"]),
    link: firstString(row, ["link"]),
    tags: readStringArray(row, "tags"),
    sentResponseId: firstString(row, ["sentResponseId"]),
    sendError: firstString(row, ["sendError"]),
  };
}

export function readDrafts(data: unknown): { drafts: DraftRecord[]; total: number } {
  const record = asRecord(data);
  const drafts = asArray(record["drafts"]).map(readDraft);
  return { drafts, total: firstNumber(record, ["total"]) ?? drafts.length };
}

/** drafts.get returns either the record or a {draft} envelope across pins. */
export function readDraftDetail(data: unknown): DraftRecord {
  const record = asRecord(data);
  return readDraft(record["draft"] !== undefined ? record["draft"] : record);
}

// ── channels.allowlist.* / authorize / targets.resolve ──────────────────────

export interface AllowlistResolvedEntry {
  kind: string;
  input: string;
  id: string;
  label: string;
}

export interface AllowlistResolution {
  surface: string;
  resolved: AllowlistResolvedEntry[];
  unresolved: string[];
}

export function readAllowlistResolution(data: unknown): AllowlistResolution {
  const record = asRecord(data);
  return {
    surface: firstString(record, ["surface"]),
    resolved: asArray(record["resolved"]).map((row) => ({
      kind: firstString(row, ["kind"]),
      input: firstString(row, ["input"]),
      id: firstString(row, ["id"]),
      label: firstString(row, ["label"]) || firstString(row, ["id"]),
    })),
    unresolved: readStringArray(record, "unresolved"),
  };
}

/** allowlist.edit echoes the updated policy — surface the new allowlist sizes. */
export interface AllowlistEditResult {
  surface: string;
  userCount: number;
  channelCount: number;
  groupCount: number;
}

export function readAllowlistEditResult(data: unknown): AllowlistEditResult {
  const record = asRecord(data);
  const policy = asRecord(record["updatedPolicy"]);
  return {
    surface: firstString(record, ["surface"]),
    userCount: asArray(policy["allowlistUserIds"]).length,
    channelCount: asArray(policy["allowlistChannelIds"]).length,
    groupCount: asArray(policy["allowlistGroupIds"]).length,
  };
}

export interface AuthorizeResult {
  surface: string;
  allowed: boolean;
  reason: string;
  accountLabel: string;
}

export function readAuthorizeResult(data: unknown): AuthorizeResult {
  const record = asRecord(data);
  const result = asRecord(record["result"]);
  return {
    surface: firstString(record, ["surface"]),
    allowed: readBool(result, "allowed"),
    reason: firstString(result, ["reason"]),
    accountLabel: firstString(asRecord(result["account"]), ["label", "id"]),
  };
}

export interface ResolvedTarget {
  surface: string;
  input: string;
  normalized: string;
  kind: string;
  to: string;
  display: string;
  accountId: string;
  channelId: string;
  threadId: string;
  source: string;
}

export function readResolvedTarget(data: unknown): ResolvedTarget {
  const record = asRecord(data);
  const target = asRecord(record["target"]);
  return {
    surface: firstString(record, ["surface"]) || firstString(target, ["surface"]),
    input: firstString(target, ["input"]),
    normalized: firstString(target, ["normalized"]),
    kind: firstString(target, ["kind"]),
    to: firstString(target, ["to"]),
    display: firstString(target, ["display"]),
    accountId: firstString(target, ["accountId"]),
    channelId: firstString(target, ["channelId"]),
    threadId: firstString(target, ["threadId"]),
    source: firstString(target, ["source"]),
  };
}

// ── channels.routing.* ───────────────────────────────────────────────────────

export interface RoutingAssignment {
  id: string;
  surfaceKind: string;
  routeId: string;
  profileId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export function readRouting(data: unknown): { routes: RoutingAssignment[]; total: number } {
  const record = asRecord(data);
  const routes = asArray(record["routes"]).map((row) => ({
    id: firstString(row, ["id", "assignmentId"]),
    surfaceKind: firstString(row, ["surfaceKind"]),
    routeId: firstString(row, ["routeId"]),
    profileId: firstString(row, ["profileId"]),
    label: firstString(row, ["label"]),
    createdAt: firstString(row, ["createdAt"]),
    updatedAt: firstString(row, ["updatedAt"]),
  }));
  return { routes, total: firstNumber(record, ["total"]) ?? routes.length };
}
