# @pellux/goodvibes-sdk (v1.3.2) — Codebase Map

Source: `/home/buzzkill/Projects/goodvibes-sdk` (Bun 1.3.10 workspace, TypeScript 6.0.3, pre-1.0-style "moving contract" despite 1.3.2 version — README says pin exact versions and read `CHANGELOG.md`).

---

## 1. Package layout & published exports

Workspace (`package.json` `workspaces: ["packages/*"]`), all packages versioned in lockstep at **1.3.2**:

| Package | Role |
|---|---|
| `packages/sdk` → **`@pellux/goodvibes-sdk`** | Consumer-facing facade; the only package an app should install. Composes all siblings + SDK-owned `platform/*` modules. |
| `packages/contracts` → `@pellux/goodvibes-contracts` | Runtime-neutral generated contract artifacts: operator/peer contracts, method/endpoint IDs, runtime-event domains, zod schemas (`src/generated/*`, `src/zod-schemas/*`). |
| `packages/errors` → `@pellux/goodvibes-errors` | `GoodVibesSdkError`, `SDKErrorKind`, daemon error wire contract (`/daemon-error-contract` subpath). |
| `packages/operator-sdk` → `@pellux/goodvibes-operator-sdk` | Contract-driven HTTP client for operator/control-plane (`createOperatorSdk` in `src/client.ts`). |
| `packages/peer-sdk` → `@pellux/goodvibes-peer-sdk` | HTTP client for distributed-runtime peer APIs (`createPeerSdk`). |
| `packages/transport-core` | `ClientTransport`, direct in-process transport, event envelopes/feeds, middleware (`composeMiddleware`), observer, OTel helpers, UUID. |
| `packages/transport-http` | HTTP JSON transport, auth header resolution, retry/backoff, idempotency keys, SSE stream/parser, reconnect. |
| `packages/transport-realtime` | SSE + WebSocket runtime-event connectors, domain-event feeds. |
| `packages/daemon-sdk` → `@pellux/goodvibes-daemon-sdk` | Embeddable daemon route contracts, dispatchers, server-side handler builders. |

**Rule (docs/exports.md, docs/public-surface.md):** apps import ONLY `@pellux/goodvibes-sdk/...` subpaths; sibling packages' deep subpaths exist to compose the facade and "may change without notice."

### `packages/sdk/package.json` export map (ESM-only, `"import"` conditions only, no CJS; `sideEffects: false`)
- Root `.` — full Bun SDK (`createGoodVibesSdk`).
- Client-safe: `./auth`, `./client-auth`, `./browser`, `./browser/knowledge`, `./browser/homeassistant`, `./browser/agent`, `./web`, `./react-native`, `./expo`, `./workers`, `./observer`, `./errors`, `./contracts`, `./contracts/node`, `./contracts/operator-contract.json`, `./contracts/peer-contract.json`, `./operator`, `./peer`, `./events` + 27 `./events/<domain>` subpaths, `./transport-core`, `./transport-direct`, `./transport-http`, `./transport-realtime`.
- Bun-only: `./daemon` plus ~55 explicit `./platform/<subsystem>` subpaths (full list in section 2). **No wildcard `./platform/*`; unlisted paths throw `ERR_PACKAGE_PATH_NOT_EXPORTED`.**
- Heavy runtime deps are **optionalDependencies** (jsdom, pdfjs-dist, tree-sitter grammars, sql.js/sqlite-vec, openai/@anthropic-ai/sdk, simple-git, node-edge-tts, zustand, cloudflare, `@agentclientprotocol/sdk`, LSP servers…) — only used by the daemon-side platform surface. `expo-secure-store`/`react-native-keychain` are optional peers.

---

## 2. Full public API surface

`etc/goodvibes-sdk.api.md` (16,896 lines) is the API-Extractor report **for the root `.` entry only**; `docs/public-surface.md` is the authoritative subpath list. Generated references: `docs/reference-operator.md` (358 method headings), `docs/reference-peer.md`, `docs/reference-runtime-events.md`. Contract scale from `packages/contracts/src/generated/foundation-metadata.ts`: **327 operator methods, 31 operator events, 6 peer endpoints** (`FOUNDATION_METADATA`).

### Root client (api.md lines ~1410–1520)
```ts
export interface GoodVibesSdk {
  readonly auth: GoodVibesAuthClient;
  readonly operator: OperatorSdk;
  readonly peer: PeerSdk;
  readonly realtime: GoodVibesRealtime;   // viaSse() / viaWebSocket(impl?)
  use(middleware: TransportMiddleware): void;
}
export interface GoodVibesSdkOptions {
  baseUrl: string;                       // required — only required field
  authToken?: string | null; getAuthToken?: AuthTokenResolver;
  tokenStore?: GoodVibesTokenStore; autoRefresh?: AutoRefreshOptions;
  fetch?: typeof fetch; headers?: HeadersInit; getHeaders?: HeaderResolver;
  middleware?: TransportMiddleware[]; observer?: SDKObserver;
  realtime?: { onError?; sseReconnect?; webSocketReconnect?: StreamReconnectPolicy };
  retry?: HttpRetryPolicy; WebSocketImpl?: typeof WebSocket;
}
```
`OperatorSdk` (api.md:13834) = typed remote client + `transport: HttpTransport`, `getOperation(methodId): OperatorMethodContract`, `dispose()/asyncDispose()` + `Symbol.dispose`/`Symbol.asyncDispose`. `OperatorSdkOptions` adds `validateResponses?: boolean` (zod response validation).

### Operator method groups (`docs/reference-operator.md`, all callable as `sdk.operator.<group>.<method>()` or generically `sdk.operator.invoke('<method.id>', input)`)
`accounts.snapshot` · `approvals.{list,approve,deny,claim,cancel}` · `artifacts.{create,get,list,content.get}` · `local_auth.*` (users, bootstrap, sessions) · `automation.{jobs,schedules,runs,heartbeat,integration}` · `calendar.{events,ics}` · `channels.*` (~35 methods: accounts, actions, agent_tools, allowlist, authorize, capabilities, directory, doctor, drafts, inbox, lifecycle, policies, repairs, routing, setup, status, targets, tools) · `checkpoints.{create,diff,list,restore}` · `companion.chat.{sessions,messages,events.stream}` · `config.{get,set}` / `credentials.get` · `continuity.snapshot` · `control.{snapshot,status,contract,methods,events.catalog,events.stream,clients,messages,auth.login,auth.current,web}` · `deliveries` · `email.{send,draft.create,inbox}` · `fleet.{list,snapshot}` · `health.snapshot` · `intelligence.snapshot` · `homeassistant.homeGraph.*` (~25) · `knowledge.*` (~50: ask/search/map/packet, ingest url/urls/artifact/bookmarks/browserHistory/connector, candidates, extractions, graphql, issues, jobs, projections, refinement, reports, schedules, sources, usage, lint, reindex, status) · `projectPlanning.*` (decisions, language, state, workPlan tasks) · `mcp.{config,servers,tools}` · `media.{analyze,generate,transform,providers}` · `multimodal.*` · `memory.*` (records CRUD/search/semantic-search/links/import/export, vector rebuild/stats, review-queue, doctor, embeddings) · `panels.{list,open}` · `providers.{list,get,usage.get}` · `push.{subscriptions,vapid}` · `remote.*` (pairing requests, peers invoke/token rotate, work) · `review.snapshot` · `routes.{snapshot,bindings}` · `surfaces.list` · `scheduler.capacity` · `services.{install,start,stop,restart,status,uninstall}` · `sessions.{create,get,list,search,close,reopen,delete,detach,register,followUp,steer,messages.create,messages.list,inputs.deliver,inputs.cancel,inputs.list,integration.snapshot}` · `security.settings` · `settings.snapshot` · `tasks.{create,get,list,status,cancel,retry}` · `telemetry.{snapshot,stream,events.list,errors.list,traces.list,metrics.get,otlp.{traces,logs,metrics}}` · `voice.{tts,tts.stream,stt,realtime.session,providers,voices,status}` · `watchers.*` · `web_search.{query,providers.list}` · `worktrees.snapshot`. Streaming method IDs: `OperatorStreamMethodId = 'companion.chat.events.stream' | 'control.events.stream' | 'telemetry.stream'`.

### Peer client (`./peer`, capability-oriented by design)
Endpoints: `pair.request`, `pair.verify`, `peer.heartbeat`, `work.pull`, `work.complete`, `operator.snapshot` (`docs/reference-peer.md`). Factory `createPeerSdk`.

### Auth (`./auth`, `./client-auth`)
- `createGoodVibesAuthClient(operator, tokenStore, getAuthToken?, observer?, autoRefreshOptions?)`; `sdk.auth.{login, current, getToken, setToken, clearToken}`.
- Token stores: `createMemoryTokenStore()`, `createBrowserTokenStore()` (localStorage); `./client-auth` adds platform stores (iOS Keychain, Android Keystore, Expo SecureStore), `AutoRefreshCoordinator`, `PermissionResolver`, OAuth payload types (`OAuthStartState`, `OAuthTokenPayload`). OAuth handshake itself is daemon-side, not client (docs/authentication.md).
- Auth precedence: `tokenStore` > `getAuthToken` > `authToken`. Auto-refresh on by default when `tokenStore` present: proactive (`refreshLeewayMs` default 60 s before `expiresAt`, requires a `refresh` callback) + reactive single 401-refresh-retry.
- Two daemon auth modes: `shared-bearer` (`Authorization: Bearer`) and `session-login` (`POST /login`, cookie `goodvibes_session`, HttpOnly, SameSite=Lax; current auth at `GET /api/control-plane/auth`).

### Realtime (`./transport-realtime`, `./events/*`)
- `sdk.realtime.viaSse()` / `viaWebSocket()` → `RemoteRuntimeEvents<AnyRuntimeEvent>` with 27 per-domain feeds: `agents, automation, communication, compaction, control-plane, deliveries, forensics, knowledge, mcp, ops, orchestration, permissions, planner, plugins, providers, routes, security, session, surfaces, tasks, tools, transport, turn, ui, watchers, workflows, workspace`. Subscription API: `events.<domain>.on('EVENT_TYPE', cb)` and `.onEnvelope('EVENT_TYPE', cb)` (envelope has `sessionId`, `payload`); both return unsubscribe fns.
- `forSession(events, sessionId)` / `forSessionRuntime(...)` — pre-filtered per-session views (root re-export; see `examples/submit-turn-quickstart.mjs`).
- Low-level: `createEventSourceConnector(baseUrl, token, fetch, opts?)` (SSE; `Last-Event-ID` resume, reconnect, dynamic token re-resolution) and `createWebSocketConnector(baseUrl, token, WebSocket, opts?)` with lifecycle hooks `onConnectionStateChange('connecting'|'connected'|'reconnecting'|'disconnected'|'failed')`, `onReconnectAttempt({attempt,maxAttempts,delayMs,reason})`, `onOpen`, `onBackpressure` (bounded drop-oldest outbound queue: 1,024 msgs / 16 MiB, >1 MiB single message rejected). Wrap with `createRemoteRuntimeEvents(connector)`; `createRemoteDomainEvents(domains, connector)` for multi-domain feeds. Guard: refuses auth over non-loopback `ws://` (`ConfigurationError`) — requires `wss://`.

### Transports
- `transport-core`: `ClientTransport`, `TransportMiddleware`/`TransportContext` (Koa-style, wraps every operator/peer HTTP cycle; `ctx.headers/body/signal/response/durationMs/error`), `composeMiddleware`, event envelopes, OTel.
- `transport-direct` (facade over transport-core): `createDirectClientTransport(operatorImpl, peerImpl)` — zero-latency in-process transport (`examples/direct-transport-quickstart.ts`).
- `transport-http`: HTTP client construction, retry (`{maxAttempts, baseDelayMs, maxDelayMs}`), backoff, SSE. **No built-in request timeout — cancellation is caller-driven via AbortSignal** (docs/semver-policy.md).

### Telemetry / observability
- Operator telemetry API: `sdk.operator.telemetry.snapshot({limit, since, until, domains, types, severity, traceId, sessionId, turnId, agentId, taskId, cursor, view})`, `.errors({severity})`, `.otlp.{traces,logs,metrics}()` (JSON-encoded OTLP, not protobuf) (docs/realtime-and-telemetry.md).
- `SDKObserver` interface + `createConsoleObserver()`, `createOpenTelemetryObserver()` from `./observer` (also re-exported from root).

### Platform surface (Bun-only, status **beta**) — the daemon-side feature set the new app inherits from goodvibes-tui/agent
Explicit subpaths (docs/public-surface.md table): `platform/acp` (Agent Control Protocol connections), `platform/adapters`, `platform/agents` (agent orchestration, WRFC, sessions, messaging), `platform/artifacts`, `platform/automation`, `platform/batch`, `platform/bookmarks`, `platform/channels` (channel runtime/routing/policy/plugins), `platform/cloudflare`, `platform/companion`, `platform/config` (config manager, secrets, subscriptions), `platform/control-plane` (gateway, method catalog, session broker), `platform/core` (orchestrator, transcript events, execution plan), `platform/daemon` (HTTP server, port-in-use checks), `platform/discovery`, `platform/export`, `platform/git`, `platform/hooks`, `platform/integrations`, `platform/intelligence` (LSP, tree-sitter, import graph), `platform/knowledge` (+`/extensions`, `/home-graph`), `platform/media`, `platform/mcp` (MCP config/registry/client/sandbox bridge), `platform/multimodal`, `platform/node` (+`/runtime-boundary` — client-safe runtime detection), `platform/pairing` (QR, companion tokens), `platform/permissions`, `platform/plugins`, `platform/profiles`, `platform/providers` (LLM provider registry/catalog/capabilities), `platform/runtime` (+`/observability`, `/sandbox`, `/settings`, `/state`, `/store`, `/ui`, `/memory-spine`, `/session-spine`, `/fleet` — last three in package.json exports though not all in the public-surface table), `platform/scheduler`, `platform/security`, `platform/sessions`, `platform/state`, `platform/templates`, `platform/tools` (tool registry, exec/fetch/read/write/edit/agent), `platform/types`, `platform/utils`, `platform/voice`, `platform/watchers`, `platform/web-search`, `platform/workflow`, `platform/workspace`.

Key bootstrap: **`startHostServices`** (`packages/sdk/src/platform/runtime/bootstrap.ts`, `bootstrap-services.ts`) — connect-or-start daemon logic; returns `daemonStatus.mode: 'embedded' | 'external' | 'blocked' | 'unavailable'` (+ disabled), probing `GET /status` with the shared daemon token when the configured `controlPlane.host:port` is occupied (docs/daemon-embedding.md). This is exactly how the TUI starts, and how the new desktop app should own its daemon.

### Errors (`./errors`)
- Base `GoodVibesSdkError` with discriminants `kind: SDKErrorKind` = `'auth' | 'config' | 'contract' | 'network' | 'not-found' | 'protocol' | 'rate-limit' | 'service' | 'internal' | 'tool' | 'validation' | 'unknown'` (12 values; `packages/errors/src/index.ts:37-49`) and `code: SDKErrorCode`; fields `status, category, source, hint, url, method, retryAfterMs, provider/operation/phase/requestId/providerCode/providerType`; `toJSON()`.
- Subclasses `ConfigurationError`, `ContractError`, `HttpStatusError` + `createHttpStatusError(status, url, method, body)` which honors daemon `StructuredDaemonErrorBody`. `instanceof` is realm-safe (brand + `Symbol.hasInstance`). **Semver-covered contract is `err.kind`/`err.code`, NOT `.message` strings or subclass identity.**
- `RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504]` defined once in `@pellux/goodvibes-errors`; `recoverable` derived from it.

---

## 3. How a new app consumes it

### Construct + first call (Bun full surface — the new desktop app's main process)
```ts
import { createGoodVibesSdk, createConsoleObserver, forSession } from '@pellux/goodvibes-sdk';
import { createMemoryTokenStore } from '@pellux/goodvibes-sdk/auth';

const sdk = createGoodVibesSdk({
  baseUrl: process.env.GOODVIBES_BASE_URL ?? 'http://127.0.0.1:3421',
  tokenStore: createMemoryTokenStore(process.env.GOODVIBES_TOKEN ?? null),
  observer: createConsoleObserver(),
});
const snapshot = await sdk.operator.control.snapshot();
```

### Auth handshake
```ts
await sdk.auth.login({ username, password });     // persists via tokenStore
const me = await sdk.auth.current();               // principalId etc.
```
Auto-refresh via `autoRefresh: { refreshLeewayMs: 60_000, refresh: async (store) => store.setToken(await myRefresh()) }`.

### The canonical chat/turn loop (`examples/submit-turn-quickstart.mjs`)
```ts
const { session } = await sdk.operator.sessions.create({ title: 'quickstart demo' });
const events = forSession(sdk.realtime.viaSse(), session.id);   // subscribe BEFORE submitting
const unsub = events.turn.onEnvelope('STREAM_DELTA', (e) => write(e.payload.content));
events.turn.onEnvelope('TURN_COMPLETED', (e) => done(e.payload.stopReason));
events.turn.onEnvelope('TURN_ERROR', (e) => fail(e.payload.error));
events.turn.onEnvelope('TURN_CANCEL', () => cancelled());
await sdk.operator.sessions.messages.create(session.id, { body: 'Say hello.' });
```
Companion chat (separate from operator sessions; `docs/web-ui-integration.md`): `sdk.chat.sessions.create({title, provider: 'openai-subscriber', model: 'gpt-5.5'})` → `sdk.chat.events.stream(sessionId, {onEvent})` (`companion-chat.turn.delta/completed/error`) → `sdk.chat.messages.create(sessionId, {body, attachments: [{artifactId, label}]})`; attachments upload via `sdk.artifacts.create({filename, mimeType, dataBase64, metadata})` first.

### Realtime subscription patterns
```ts
const stop = sdk.realtime.viaSse().agents.on('AGENT_COMPLETED', ev => refreshApprovals());
const stopWs = sdk.realtime.viaWebSocket().agents.on('AGENT_COMPLETED', ev => {...});
```
Recommended UI pattern (docs/web-ui-integration.md): load snapshot via HTTP → subscribe to events → refresh read models on events → keep mutations on HTTP.

### Embedding/starting the daemon (Bun host — the desktop app should do this)
```ts
import { dispatchDaemonApiRoutes } from '@pellux/goodvibes-sdk/daemon';
Bun.serve({ async fetch(req) {
  const res = await dispatchDaemonApiRoutes(req, handlers); // Promise<Response|null>
  return res ?? new Response('Not found', { status: 404 });
}});
```
Plus granular dispatchers `dispatchAutomationRoutes / dispatchSessionRoutes / dispatchTaskRoutes / dispatchOperatorRoutes / dispatchRemoteRoutes`, `createDaemonControlRouteHandlers`, `createDaemonTelemetryRouteHandlers` (docs/daemon-embedding.md; `examples/daemon-fetch-handler-quickstart.ts`). Or use `startHostServices` (platform/runtime) for the TUI-style connect-or-start flow. For a same-process client against an embedded daemon, use `createDirectClientTransport(operator, peer)` from `./transport-direct` — zero-latency, no HTTP.

### Middleware
`sdk.use(async (ctx, next) => { await next(); log(ctx.response?.status, ctx.durationMs, ctx.error); })` — wraps every operator/peer HTTP call.

---

## 4. Environment support & transports

Two-tier surface model (docs/surfaces.md):
- **Full surface (Bun-only):** root platform/daemon subpaths use `Bun.spawn/file/Glob/which/CryptoHasher/Transpiler/serve` — fails at runtime in browser/Hermes/Node. Provides the agentic harness: tool execution, LSP/tree-sitter, MCP, workflows, daemon HTTP server, artifact store, git, ACP, pairing, all channel surfaces (Slack, Discord, ntfy, Telegram, Google Chat, Signal, WhatsApp, iMessage, MSTeams, BlueBubbles, Mattermost, Matrix, Home Assistant, webhooks).
- **Companion surface (multi-runtime):** root client, `/browser*`, `/web`, `/react-native`, `/expo`, `/workers`, `/auth`, `/errors`, `/events*`, `/contracts`, `/operator`, `/peer`, `/observer`, `/transport-*` — no Bun globals, no `node:*` imports; CI job `platform-matrix` (`test/rn-bundle-node-imports.test.ts`) enforces this on dist bundles.
- Supported runtimes: **Bun (full+companion), Hermes/RN/Expo (companion), browser (companion), Cloudflare Workers/workerd/Miniflare 4 (companion)**. **Node.js is explicitly NOT a supported consumer runtime** (`engines.node >=22` is a build-host requirement only). Native iOS/Android consume the raw JSON contracts (`/contracts/*-contract.json`).
- **Transports: HTTP(S) JSON, SSE, WebSocket, and in-process direct. There is NO unix-socket transport** — the daemon is reached at an HTTP `baseUrl` (default `http://127.0.0.1:3421`), loopback-only until webui serve/CORS/tailscale-serve is enabled (docs/web-ui-integration.md deployment topology: same-origin bundle serving via `controlPlane.webui.serve`+`bundleDir`, or CORS via `controlPlane.cors.enabled`+`allowedOrigins`).
- Recommended defaults: Bun TUI/daemon → SSE; browser → SSE; RN/Expo → WebSocket. For the new Bun desktop app: root entry in the main process (embed daemon via `startHostServices` or `dispatchDaemonApiRoutes`) and `/browser` or `/web` + SSE inside the webview UI.

---

## 5. Version/compat notes an integrating app must respect

- **Contract artifacts & versioning:** generated contracts embed `"version": 1` (artifact format) and product version `"1.3.2"` (`packages/contracts/src/generated/operator-contract.ts:4,8`); `FOUNDATION_METADATA` gives counts. Daemon exposes `control.contract` / `control.methods.list` / `control.events.catalog` for runtime contract introspection; `sdk.operator.getOperation(methodId)` returns the typed `OperatorMethodContract`. Raw JSON contracts are exported for tooling/native clients. Regeneration recipe in `docs/contract-regeneration-recipe.md`; drift gated by `contracts:check`/`api:check`.
- **Semver policy (docs/semver-policy.md):** breaking = removing exports, narrowing types, renaming `SDKErrorKind` members or factories, changing subpath resolution, changing transport defaults (e.g., the 30 s realtime reconnect backoff cap), removing a runtime, adding required config fields. NOT covered: repo/dist file paths, error `.message` strings, error subclass identity — **use `err.kind`/`err.code` only**. Min TypeScript 6.0. Pre-1.0-style removals allowed with CHANGELOG entry.
- **Error contract:** all failures are `GoodVibesSdkError` (12-kind union above); transport errors carry `source: 'transport'`; daemon structured error bodies (`StructuredDaemonErrorBody` from `@pellux/goodvibes-errors/daemon-error-contract`) map onto SDK codes; never parse messages.
- **Auth/scopes:** scope failures surface structured (`status/category/source/hint`); session cookie `goodvibes_session` for same-origin, bearer everywhere else; WebSocket auth refused over remote `ws://`.
- **Import discipline:** only export-map subpaths; no root `./platform` entry; sealed paths error. `etc/goodvibes-sdk.api.md` covers root only — treat `docs/public-surface.md` as the subpath contract; platform surface is **beta**, `./workers` is **preview**.
- **Reconnect/retry defaults:** SSE resume via `Last-Event-ID`; reconnect policies via `realtime.sseReconnect` / `realtime.webSocketReconnect` (`{enabled, baseDelayMs, maxDelayMs}`); HTTP retry via `retry: {maxAttempts, baseDelayMs, maxDelayMs}`; no default HTTP timeout (bring your own `AbortSignal`).
- **Engines:** `bun 1.3.10` pinned exactly, ESM-only package. The new app's Bun runtime should match or exceed 1.3.10.

Key files: `packages/sdk/package.json` (export map), `etc/goodvibes-sdk.api.md` (root API), `docs/public-surface.md`, `docs/surfaces.md`, `docs/getting-started.md`, `docs/reference-operator.md`, `docs/daemon-embedding.md`, `docs/web-ui-integration.md`, `docs/semver-policy.md`, `examples/submit-turn-quickstart.mjs`, `packages/sdk/src/platform/runtime/bootstrap.ts`.