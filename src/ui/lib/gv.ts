// Typed daemon facade. Every call goes through invoke(), which resolves the
// method's HTTP route from the generated OPERATOR_ROUTES table (path
// {param} substitution + query encoding) and issues it same-origin through
// appFetch — the Bun proxy injects the bearer token. WS-only methods
// ([ws] in docs/FEATURES.md) route through lib/ws.ts. Ported in spirit from
// goodvibes-webui src/lib/goodvibes.ts, minus browser token handling (the
// webview never holds credentials).

import type { CompanionChatMessage, CompanionChatSession } from "@pellux/goodvibes-sdk/contracts";
import { OPERATOR_ROUTES, type OperatorRoute } from "./generated/operator-routes.ts";
import { appFetch, HttpError } from "./http.ts";
import { wsCall } from "./ws.ts";
import { firstArrayAtPath } from "./wire.ts";

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface InvokeOptions {
  /** Values for {param} placeholders in the route path. */
  params?: Record<string, string>;
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
}

/** Look up a method's route row; undefined when this SDK pin doesn't know it. */
export function routeFor(methodId: string): OperatorRoute | undefined {
  return OPERATOR_ROUTES[methodId];
}

/** True when the route exists and is HTTP-reachable or WS-reachable. */
export function isKnownMethod(methodId: string): boolean {
  return routeFor(methodId) !== undefined;
}

function substitutePath(route: OperatorRoute, params?: Record<string, string>): string {
  const template = route.path;
  if (template === null) {
    throw new Error(`Method ${route.id} has no HTTP path`);
  }
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === "") {
      throw new Error(`Missing path param "${name}" for ${route.id}`);
    }
    return encodeURIComponent(value);
  });
}

export function encodeQuery(query?: QueryParams): string {
  if (!query) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function methodNotFoundError(methodId: string): HttpError {
  // Same shape isMethodUnavailableError() classifies — an unknown id in the
  // pinned route table degrades identically to a daemon that never heard of it.
  return new HttpError(
    404,
    `method:${methodId}`,
    JSON.stringify({ error: "Unknown gateway method", code: "METHOD_NOT_FOUND", methodId }),
  );
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await appFetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, path, body);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/**
 * Invoke an operator method by id. HTTP-backed methods hit their route
 * directly; WS-only methods go over the /app/ws bridge.
 */
export async function invoke<T = unknown>(methodId: string, options?: InvokeOptions): Promise<T> {
  const route = routeFor(methodId);
  if (!route) throw methodNotFoundError(methodId);

  if (route.ws || route.path === null) {
    return (await wsCall(methodId, { body: options?.body, query: options?.query })) as T;
  }

  const path = substitutePath(route, options?.params) + encodeQuery(options?.query);
  const method = route.httpMethod ?? "POST";
  const init: RequestInit = { method };
  if (options?.signal) init.signal = options.signal;
  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { "content-type": "application/json" };
  }
  return await requestJson<T>(path, init);
}

/** The SSE path for an HTTP stream method (caller opens it via lib/sse.ts). */
export function streamPath(methodId: string, options?: Pick<InvokeOptions, "params" | "query">): string {
  const route = routeFor(methodId);
  if (!route || route.path === null) throw methodNotFoundError(methodId);
  return substitutePath(route, options?.params) + encodeQuery(options?.query);
}

/**
 * Capability probe: is this method invokable on the CONNECTED daemon (not
 * just known to our pinned contract)? 404/METHOD_NOT_FOUND and 501 both
 * report false; transport failures rethrow.
 */
export async function probeMethod(methodId: string): Promise<boolean> {
  try {
    const detail = await invoke<{ invokable?: boolean }>("control.methods.get", {
      params: { methodId },
    });
    return detail?.invokable !== false;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 501)) return false;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Convenience namespaces — thin, mirroring the webui facade. Payload types are
// `unknown` unless the contracts package gives us one for free; views apply
// the defensive readers in lib/wire.ts.
// ---------------------------------------------------------------------------

/** Unwrap common list envelopes ({items}/{sessions}/{records}/... or bare array). */
export function listFrom(value: unknown, keys: string[] = ["items", "data", "results"]): unknown[] {
  return firstArrayAtPath(value, keys.map((k) => [k]));
}

export const gv = {
  invoke,
  streamPath,
  probeMethod,

  control: {
    status: () => invoke("control.status"),
    snapshot: () => invoke("control.snapshot"),
    contract: () => invoke("control.contract"),
    methods: {
      list: () => invoke("control.methods.list"),
      get: (methodId: string) => invoke("control.methods.get", { params: { methodId } }),
    },
    eventsCatalog: () => invoke("control.events.catalog"),
    clients: () => invoke("control.clients.list"),
    authCurrent: () => invoke("control.auth.current"),
  },

  chat: {
    sessions: {
      list: (query?: QueryParams) =>
        invoke<{ sessions?: CompanionChatSession[] }>("companion.chat.sessions.list", { query }),
      get: (sessionId: string) => invoke("companion.chat.sessions.get", { params: { sessionId } }),
      create: (body?: unknown) => invoke("companion.chat.sessions.create", { body }),
      update: (sessionId: string, body: unknown) =>
        invoke("companion.chat.sessions.update", { params: { sessionId }, body }),
      close: (sessionId: string) => invoke("companion.chat.sessions.close", { params: { sessionId } }),
      delete: (sessionId: string) => invoke("companion.chat.sessions.delete", { params: { sessionId } }),
    },
    messages: {
      list: (sessionId: string, query?: QueryParams) =>
        invoke<{ messages?: CompanionChatMessage[] }>("companion.chat.messages.list", {
          params: { sessionId },
          query,
        }),
      create: (sessionId: string, body: unknown) =>
        invoke("companion.chat.messages.create", { params: { sessionId }, body }),
      retry: (sessionId: string, body?: unknown) =>
        invoke("companion.chat.messages.retry", { params: { sessionId }, body }),
      edit: (sessionId: string, body: unknown) =>
        invoke("companion.chat.messages.edit", { params: { sessionId }, body }),
      /** Interrupt-and-send (daemon >= 1.11): cancels the in-flight turn through
       * the same finalization path as turns.cancel, then runs this message
       * immediately; plain sends during a turn queue behind it instead. */
      steer: (sessionId: string, body: unknown) =>
        invoke("companion.chat.messages.steer", { params: { sessionId }, body }),
    },
    turns: {
      /** True server-side stop (daemon >= 1.11): aborts the provider stream,
       * persists any partial with deliveryState "cancelled", closes dangling
       * tool calls, and publishes terminal turn.cancelled to every subscriber.
       * Benign 404 NO_ACTIVE_TURN when the turn already finished; optional
       * turnId guard 409s (TURN_MISMATCH) instead of cancelling a newer turn. */
      cancel: (sessionId: string, body?: { turnId?: string }) =>
        invoke("companion.chat.turns.cancel", { params: { sessionId }, body }),
    },
    events: {
      /** Per-session SSE stream path — open with lib/sse.ts (token streaming
       * is the sanctioned render-from-frames exception). */
      streamPath: (sessionId: string) => streamPath("companion.chat.events.stream", { params: { sessionId } }),
    },
  },

  sessions: {
    list: (query?: QueryParams) => invoke("sessions.list", { query }),
    get: (sessionId: string) => invoke("sessions.get", { params: { sessionId } }),
    create: (body?: unknown) => invoke("sessions.create", { body }),
    messages: (sessionId: string, query?: QueryParams) =>
      invoke("sessions.messages.list", { params: { sessionId }, query }),
    steer: (sessionId: string, body: unknown) => invoke("sessions.steer", { params: { sessionId }, body }),
    followUp: (sessionId: string, body: unknown) => invoke("sessions.followUp", { params: { sessionId }, body }),
    close: (sessionId: string) => invoke("sessions.close", { params: { sessionId } }),
    reopen: (sessionId: string) => invoke("sessions.reopen", { params: { sessionId } }),
    delete: (sessionId: string) => invoke("sessions.delete", { params: { sessionId } }),
    detach: (sessionId: string) => invoke("sessions.detach", { params: { sessionId } }),
    search: (body: unknown) => invoke("sessions.search", { body }), // [ws]
    inputs: {
      list: (sessionId: string) => invoke("sessions.inputs.list", { params: { sessionId } }),
      deliver: (sessionId: string, inputId: string, body?: unknown) =>
        invoke("sessions.inputs.deliver", { params: { sessionId, inputId }, body }),
      cancel: (sessionId: string, inputId: string) =>
        invoke("sessions.inputs.cancel", { params: { sessionId, inputId } }),
    },
    integrationSnapshot: () => invoke("sessions.integration.snapshot"),
    // Contract 1.11 granular session verbs. permissionMode/contextUsage answer
    // ONLY for the daemon's live local runtime — any other sessionId is an
    // honest 404 SESSION_NOT_LOCAL (surface as unavailable, never fall back
    // daemon-wide). permissionMode speaks operator vocabulary
    // (plan|normal|accept-edits|auto, read-only custom); the
    // PERMISSION_MODE_CHANGED event carries CONFIG vocabulary instead.
    changes: (body: unknown) => invoke("sessions.changes.get", { body }), // [ws]
    contextUsage: (sessionId: string) =>
      invoke("sessions.contextUsage.get", { params: { sessionId } }), // estimated:true always
    permissionMode: {
      get: (sessionId: string) => invoke("sessions.permissionMode.get", { params: { sessionId } }),
      set: (sessionId: string, body: unknown) =>
        invoke("sessions.permissionMode.set", { params: { sessionId }, body }),
    },
    queuedMessages: {
      list: (sessionId: string) => invoke("sessions.queuedMessages.list", { params: { sessionId } }),
      edit: (sessionId: string, messageId: string, body: unknown) =>
        invoke("sessions.queuedMessages.edit", { params: { sessionId, messageId }, body }),
      delete: (sessionId: string, messageId: string) =>
        invoke("sessions.queuedMessages.delete", { params: { sessionId, messageId } }),
    },
    toolCalls: {
      // Cancels ONE in-flight tool call without killing the turn; the call
      // truly ends when its tool_result SSE frame arrives.
      cancel: (sessionId: string, callId: string) =>
        invoke("sessions.toolCalls.cancel", { params: { sessionId, callId } }),
    },
  },

  fleet: {
    snapshot: (body?: unknown) => invoke("fleet.snapshot", { body }), // [ws]
    list: (body?: unknown) => invoke("fleet.list", { body }), // [ws]
    // Fleet archive (daemon ≥ operator contract 1.6): session-scoped — archived
    // subtrees leave the live snapshot but stay fully inspectable via archived.list.
    // archive() refuses honestly ({archived:false, reason}) unless the whole
    // subtree is terminal (done/failed/killed/interrupted).
    archive: (id: string) => invoke("fleet.archive", { body: { id } }), // [ws]
    unarchive: (id: string) => invoke("fleet.unarchive", { body: { id } }), // [ws]
    archiveFinished: () => invoke("fleet.archiveFinished", { body: {} }), // [ws]
    archived: {
      list: () => invoke("fleet.archived.list", { body: {} }), // [ws]
    },
    // Best-of-N attempts (contract 1.11): passing siblings park held-merge; a
    // human (or autoAcceptWinner) picks. judge() is a PROPOSAL, never a decision.
    attempts: {
      list: (body?: unknown) => invoke("fleet.attempts.list", { body: body ?? {} }), // [ws]
      judge: (body: unknown) => invoke("fleet.attempts.judge", { body }), // [ws]
      pick: (body: unknown) => invoke("fleet.attempts.pick", { body }), // [ws] dangerous — check result.applied, not just HTTP ok
    },
    conflicts: {
      list: (body?: unknown) => invoke("fleet.conflicts.list", { body: body ?? {} }), // [ws]
      resolve: (body: unknown) => invoke("fleet.conflicts.resolve", { body }), // [ws] spawns a real resolution session
    },
    graph: {
      get: (workstreamId: string) => invoke("fleet.graph.get", { params: { workstreamId } }),
    },
    observed: {
      // Steer an externally-launched agent goodvibes did not spawn; honest
      // refusal (reason verbatim) when it exposes no steer channel.
      steer: (body: unknown) => invoke("fleet.observed.steer", { body }), // [ws]
    },
  },

  checkpoints: {
    list: (body?: unknown) => invoke("checkpoints.list", { body }), // [ws]
    create: (body?: unknown) => invoke("checkpoints.create", { body }), // [ws]
    diff: (body?: unknown) => invoke("checkpoints.diff", { body }), // [ws]
    // restore is confirm-gated server-side: pass confirm:true or a confirmToken
    // minted by restorePreview. Refusal is a 200 {result:null, refused:true,
    // refusal} — check `refused`, never truthiness of `result`.
    restore: (body?: unknown) => invoke("checkpoints.restore", { body }), // [ws] dangerous
    restorePreview: (body: unknown) => invoke("checkpoints.restorePreview", { body }), // [ws]
    // Single-hunk revert, same preview→token→apply idiom. Preview's
    // applies:false + conflict text is an honest answer, not an error.
    revertHunk: (body: unknown) => invoke("checkpoints.revertHunk", { body }), // [ws] dangerous
    revertHunkPreview: (body: unknown) => invoke("checkpoints.revertHunkPreview", { body }), // [ws]
  },

  // Message-anchored rewind over checkpoints+conversation+file-undo (contract
  // 1.11). plan() is read-only and mints the confirmToken apply() consumes;
  // apply refusal is a 200 {receipt:null, refused:true, refusal}.
  rewind: {
    plan: (body: unknown) => invoke("rewind.plan", { body }), // [ws]
    apply: (body: unknown) => invoke("rewind.apply", { body }), // [ws] dangerous
  },

  ci: {
    status: (body: unknown) => invoke("ci.status", { body }),
    watches: {
      list: () => invoke("ci.watches.list"),
      create: (body: unknown) => invoke("ci.watches.create", { body }),
      delete: (watchId: string) => invoke("ci.watches.delete", { params: { watchId } }), // dangerous
      run: (watchId: string) => invoke("ci.watches.run", { params: { watchId } }),
    },
  },

  skills: {
    // Daemon-canonical skills CRUD (progressive disclosure: list is cheap
    // index lines without bodies; get returns the full markdown body).
    list: () => invoke("skills.list"),
    get: (name: string) => invoke("skills.get", { params: { name } }),
    create: (body: unknown) => invoke("skills.create", { body }), // 409 on name conflict
    update: (name: string, body: unknown) => invoke("skills.update", { params: { name }, body }),
    delete: (name: string) => invoke("skills.delete", { params: { name } }), // {deleted:false} for phantom, not an error
  },

  principals: {
    list: () => invoke("principals.list"),
    get: (principalId: string) => invoke("principals.get", { params: { principalId } }),
    create: (body: unknown) => invoke("principals.create", { body }),
    update: (principalId: string, body: unknown) =>
      invoke("principals.update", { params: { principalId }, body }),
    delete: (principalId: string) => invoke("principals.delete", { params: { principalId } }), // dangerous
    resolve: (body: unknown) => invoke("principals.resolve", { body }),
  },

  checkin: {
    config: {
      get: () => invoke("checkin.config.get"),
      set: (body: unknown) => invoke("checkin.config.set", { body }), // admin
    },
    receipts: (query?: QueryParams) => invoke("checkin.receipts.list", { query }),
    run: () => invoke("checkin.run", { body: {} }),
  },

  pairing: {
    posture: () => invoke("pairing.posture.get", { body: {} }), // [ws]
    tokens: {
      list: () => invoke("pairing.tokens.list", { body: {} }), // [ws]
      create: (body: unknown) => invoke("pairing.tokens.create", { body }), // [ws]
      rename: (body: unknown) => invoke("pairing.tokens.rename", { body }), // [ws]
      delete: (body: unknown) => invoke("pairing.tokens.delete", { body }), // [ws]
      migrate: (body?: unknown) => invoke("pairing.tokens.migrate", { body: body ?? {} }), // [ws]
      revokeShared: () => invoke("pairing.tokens.revokeShared", { body: {} }), // [ws]
    },
    handoff: {
      create: (body: unknown) => invoke("pairing.handoff.create", { body }), // [ws]
      complete: (body: unknown) => invoke("pairing.handoff.complete", { body }), // [ws]
    },
  },

  permissions: {
    rules: {
      list: () => invoke("permissions.rules.list", { body: {} }), // [ws]
      delete: (body: unknown) => invoke("permissions.rules.delete", { body }), // [ws] — {deleted:false} = already gone (info, not error)
    },
  },

  power: {
    status: () => invoke("power.status.get"),
    keepAwake: (enabled: boolean) => invoke("power.keepAwake.set", { body: { enabled } }),
  },

  quota: {
    snapshot: (body: unknown) => invoke("quota.snapshot.get", { body }), // [ws] — hasSignal:false is honest absence, never render 0
    fanout: (body: unknown) => invoke("quota.fanout.get", { body }), // [ws] pre-flight advisory
  },

  cost: {
    // costSource/pricingAsOf absent on pre-1.7 records — honest absence.
    attribution: (body: unknown) => invoke("cost.attribution.get", { body }), // [ws]
  },

  flags: {
    graduationReport: () => invoke("flags.graduation.report", { body: {} }), // [ws]
  },

  ops: {
    memory: () => invoke("ops.memory.get"), // invalidate on OPS_MEMORY_PRESSURE event, don't poll
  },

  runtime: {
    metrics: () => invoke("runtime.metrics.get"),
  },

  tailscale: {
    get: () => invoke("tailscale.get", { body: {} }), // [ws] strictly read-only detection
    serveRun: () => invoke("tailscale.serve.run", { body: {} }), // [ws] the ONE state-changing action; confirm-gate it
  },

  workspaces: {
    registrations: {
      list: () => invoke("workspaces.registrations.list"),
      add: (body: unknown) => invoke("workspaces.registrations.add", { body }),
      remove: (body: unknown) => invoke("workspaces.registrations.remove", { body }),
    },
    resolve: (body: unknown) => invoke("workspaces.resolve", { body }),
  },

  worktrees: {
    // discard preserves work: dirty state committed onto the KEPT branch
    // first — surface receipt.branch/preservedCommit, not a bare "discarded".
    discard: (body: unknown) => invoke("worktrees.discard", { body }), // [ws] dangerous
    setupRun: (body: unknown) => invoke("worktrees.setup.run", { body }), // [ws]
  },

  acp: {
    // Daemon-as-ACP-client: host Claude Code / Codex / opencode as fleet rows.
    agents: { list: () => invoke("acp.agents.list", { body: {} }) }, // [ws]
    sessions: { create: (body: unknown) => invoke("acp.sessions.create", { body }) }, // [ws]
  },

  channelProfiles: {
    // Per-channel intake defaults (model/provider/permission-mode) applied to
    // sessions a channel originates. set() is an upsert on the composite
    // (surfaceKind, channelId?) key.
    list: () => invoke("channels.profiles.list"),
    get: (surfaceKind: string, query?: QueryParams) =>
      invoke("channels.profiles.get", { params: { surfaceKind }, query }),
    set: (body: unknown) => invoke("channels.profiles.set", { body }), // admin
    delete: (surfaceKind: string, query?: QueryParams) =>
      invoke("channels.profiles.delete", { params: { surfaceKind }, query }), // admin, dangerous
  },

  channelTest: {
    // Live probe through the REAL delivery router. delivered:false + error in
    // a 200 body is the normal failure path — do NOT wrap expecting a throw.
    send: (body: unknown) => invoke("channels.test.send", { body }), // [ws]
  },

  approvals: {
    list: (query?: QueryParams) => invoke("approvals.list", { query }),
    approve: (approvalId: string, body?: unknown) =>
      invoke("approvals.approve", { params: { approvalId }, body }),
    deny: (approvalId: string, body: unknown) => invoke("approvals.deny", { params: { approvalId }, body }),
    claim: (approvalId: string) => invoke("approvals.claim", { params: { approvalId } }),
    cancel: (approvalId: string) => invoke("approvals.cancel", { params: { approvalId } }),
  },

  tasks: {
    list: (query?: QueryParams) => invoke("tasks.list", { query }),
    get: (taskId: string) => invoke("tasks.get", { params: { taskId } }),
    create: (body: unknown) => invoke("tasks.create", { body }),
    cancel: (taskId: string) => invoke("tasks.cancel", { params: { taskId } }),
    retry: (taskId: string) => invoke("tasks.retry", { params: { taskId } }),
  },

  providers: {
    list: () => invoke("providers.list"),
    get: (providerId: string) => invoke("providers.get", { params: { providerId } }),
    usage: (providerId: string) => invoke("providers.usage.get", { params: { providerId } }),
  },

  accounts: {
    snapshot: () => invoke("accounts.snapshot"),
  },

  config: {
    get: (query?: QueryParams) => invoke("config.get", { query }),
    set: (body: unknown) => invoke("config.set", { body }),
    credentials: () => invoke("credentials.get"),
  },

  artifacts: {
    list: (query?: QueryParams) => invoke("artifacts.list", { query }),
    get: (artifactId: string) => invoke("artifacts.get", { params: { artifactId } }),
    contentPath: (artifactId: string) => streamPath("artifacts.content.get", { params: { artifactId } }),
    create: (body: unknown) => invoke("artifacts.create", { body }),
  },

  memory: {
    records: {
      list: (body?: unknown) => invoke("memory.records.list", { body }),
      get: (id: string) => invoke("memory.records.get", { params: { id } }),
      add: (body: unknown) => invoke("memory.records.add", { body }),
      update: (id: string, body: unknown) => invoke("memory.records.update", { params: { id }, body }),
      delete: (id: string) => invoke("memory.records.delete", { params: { id } }),
      search: (body: unknown) => invoke("memory.records.search", { body }),
      searchSemantic: (body: unknown) => invoke("memory.records.search-semantic", { body }),
      updateReview: (id: string, body: unknown) =>
        invoke("memory.records.update-review", { params: { id }, body }),
    },
    reviewQueue: (query?: QueryParams) => invoke("memory.review-queue", { query }),
    doctor: () => invoke("memory.doctor"),
    vectorStats: () => invoke("memory.vector.stats"),
    // Consolidation runs leave receipts (merges/decay) + human-review proposals.
    consolidationReceipts: (query?: QueryParams) =>
      invoke("memory.consolidation.receipts", { query }),
    // Live markdown projections of standing memory — computed from the store
    // each call, never stale disk.
    projections: {
      list: () => invoke("memory.projections.list"),
      get: (id: string) => invoke("memory.projections.get", { params: { id } }),
    },
  },

  knowledge: {
    status: () => invoke("knowledge.status"),
    ask: (body: unknown) => invoke("knowledge.ask", { body }),
    search: (body: unknown) => invoke("knowledge.search", { body }),
  },

  voice: {
    status: () => invoke("voice.status"),
    stt: (body: unknown) => invoke("voice.stt", { body }),
    tts: (body: unknown) => invoke("voice.tts", { body }),
    ttsStreamPath: () => streamPath("voice.tts.stream"),
    voices: () => invoke("voice.voices.list"),
    providers: () => invoke("voice.providers.list"),
    // One-act managed local TTS/STT install (download+checksum+atomic install,
    // no manual paths). install() is single-flight server-side; there is NO
    // progress stream — poll status() while installInProgress is present.
    local: {
      status: () => invoke("voice.local.status"),
      install: () => invoke("voice.local.install", { body: {} }),
    },
  },

  telemetry: {
    snapshot: (query?: QueryParams) => invoke("telemetry.snapshot", { query }),
    events: (query?: QueryParams) => invoke("telemetry.events.list", { query }),
    errors: (query?: QueryParams) => invoke("telemetry.errors.list", { query }),
    metrics: (query?: QueryParams) => invoke("telemetry.metrics.get", { query }),
  },

  health: {
    snapshot: () => invoke("health.snapshot"),
  },
} as const;

export type Gv = typeof gv;
