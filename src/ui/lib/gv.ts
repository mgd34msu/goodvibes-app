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
  },

  checkpoints: {
    list: (body?: unknown) => invoke("checkpoints.list", { body }), // [ws]
    create: (body?: unknown) => invoke("checkpoints.create", { body }), // [ws]
    diff: (body?: unknown) => invoke("checkpoints.diff", { body }), // [ws]
    restore: (body?: unknown) => invoke("checkpoints.restore", { body }), // [ws] dangerous
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
