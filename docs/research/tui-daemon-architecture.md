# goodvibes-tui — Architecture Brief: Daemon / Control Plane

Repo: `/home/buzzkill/Projects/goodvibes-tui` (`@pellux/goodvibes-tui` v1.10.0, Bun ≥1.3.10, TypeScript ESM, `main: src/main.ts`). Depends on `@pellux/goodvibes-sdk@1.3.2` (installed: 1.3.1), which itself vendors a family of sibling packages that ship inside its node_modules: `@pellux/goodvibes-contracts`, `@pellux/goodvibes-daemon-sdk`, `@pellux/goodvibes-operator-sdk`, `@pellux/goodvibes-peer-sdk`, `@pellux/goodvibes-errors`, `@pellux/goodvibes-transport-{core,http,realtime}`.

**Headline finding:** The "daemon" is not a separate codebase — it is the SDK's `DaemonServer` (an HTTP/SSE/WS control-plane server built on `Bun.serve`) wrapped around the exact same `createRuntimeServices()` composition root (`src/runtime/services.ts`) that the TUI itself uses. The TUI and the headless daemon are two hosts of one shared runtime. **Everything a GUI needs (agent engine, providers, tools, knowledge, sessions, channels) is available two ways: (a) embed the SDK runtime in-process exactly like the TUI does, or (b) connect as an operator client to a running daemon over HTTP/SSE/WS using `createGoodVibesSdk()` / `createOperatorSdk()` and the 327-method typed contract.**

---

## 1. Process architecture

### What the daemon is
- Entry: `src/daemon/cli.ts` (bin `goodvibes-daemon`; `bun run daemon`). It: parses CLI flags (`--daemon-home`, `--working-dir`, `--port`, `--hostname`, `--provider/--model`, `--config k=v`, feature-flag flags), constructs `ConfigManager` (SDK), builds the full `createRuntimeServices()` (same as the TUI — provider registry, agent orchestrator, knowledge, channels, everything; `src/runtime/services.ts`), loads persisted providers + runs a background LAN provider scan (`scan()` from `@pellux/goodvibes-sdk/platform/discovery`), then starts:
  - `DaemonServer` (`@pellux/goodvibes-sdk/platform/daemon`) — the control plane (default port **3421**);
  - `HttpListener` (same module) — the webhook/event listener (default port **3422**), only when `danger.httpListener` is enabled.
  - Both use `createSafeHostServeFactory` (`src/daemon/safe-serve.ts`) — a thin wrapper over `Bun.serve` that converts handler throws into JSON 500s (`code: HOST_REQUEST_HANDLER_FAILED`).
- Transport is **HTTP JSON + SSE + WebSocket over TCP** (no unix socket anywhere). TLS optional: `controlPlane.tls.mode = off | proxy | direct` (direct uses Bun native TLS with certs at `~/.goodvibes/tui/certs/{fullchain,privkey}.pem`); `trustProxy` for reverse-proxy/Cloudflare deployments with CF-Connecting-IP validation against Cloudflare IP ranges (`docs/deployment-and-services.md`).
- Service lifecycle subcommands `install-service | uninstall-service | service-status | migrate-service` manage a **systemd user unit** (`src/daemon/service-commands.ts`), and are also invocable remotely via `services.*` gateway methods (`POST /api/service/install` etc.).

### Daemon topologies (how the TUI talks to it)
`startHostServices` (SDK `platform/runtime/bootstrap-services`, re-exported as `startExternalServices` in `src/runtime/bootstrap.ts:104`) computes an authoritative `HostServiceMode`: `'disabled' | 'embedded' | 'external' | 'blocked' | 'incompatible' | 'unavailable'`:
1. **Probe** the configured `controlPlane.host:port` (`/status` identity probe → `{kind: 'goodvibes'|'unauthorized'|'unknown', version}`).
2. **Adopt** (`external`) if a compatible GoodVibes daemon already listens there. Compatibility band check (`daemon-version-compat`): for `0.y.z` versions minor must match; for `>=1.0.0` major must match; unparseable = incompatible → mode `incompatible`, refuse to adopt, never start a competing daemon on the occupied port.
3. **Spawn detached** (the default "Layer 2"): spawn `goodvibes-daemon` (env `GOODVIBES_DAEMON_BINARY` override) with `detached: true` + `unref()`, record pid/port in `<home>/.goodvibes/daemon/detached-daemon.json` + log, poll until identity probe passes, then adopt it. A one-time hint suggests `POST /api/service/install`.
4. **Embed in-process** (`daemon.embedInProcess=true`, mode `embedded`): the TUI constructs `DaemonServer` around its own already-live runtime services (`src/runtime/bootstrap.ts:480-494`).

This mode branch is a **permanent design** (`docs/decisions/2026-07-06-session-spine-mode-branch-is-permanent.md`): `embedded` means "this process's brokers ARE the daemon's brokers" (no wire hop); only `external` activates the wire mirrors:
- **Session spine** (`src/runtime/bootstrap.ts:396-445`): on adopting an external daemon, `createHttpTransport({baseUrl, authToken})` is created and the TUI mirrors session identity via `operator.sessions.register/close`, polls inbound steer/follow-up inputs via `operator.sessions.inputs` + `deliverInput`, and serves cross-surface session lists from `operator.sessions.list`. A one-time marker-guarded fold imports legacy local `control-plane/sessions.json` into the adopted daemon.
- **Memory spine** (`src/runtime/memory-spine-transport.ts`): same adoption signal switches `MemorySpineClient` from local `MemoryRegistry` access to the daemon's wire.

### Auth / lifecycle credentials
- **Companion token**: `getOrCreateCompanionToken('tui', {daemonHomeDir: ~/.goodvibes/daemon})` (`@pellux/goodvibes-sdk/platform/pairing`) — auto-generated bearer token persisted in `~/.goodvibes/daemon/operator-tokens.json`; used as the default daemon token when `GOODVIBES_DAEMON_TOKEN` is unset (`src/daemon/cli.ts:243-264`).
- **Env tokens**: `GOODVIBES_DAEMON_TOKEN` (control plane bearer), `GOODVIBES_HTTP_TOKEN` (webhook listener bearer; defaults to daemon token). Read by both daemon and TUI so a fixed shared token makes adoption work without shared files (`docs/deployment-and-services.md:76-88`).
- **Local user auth**: `UserAuthManager` (SDK `platform/security`) with users at `~/.goodvibes/tui/auth-users.json` and a bootstrap password at `~/.goodvibes/tui/auth-bootstrap.txt`; `POST /login` (username/password → session token with `expiresAt`), session revocation, password rotation via `local_auth.*` methods.
- **Pairing**: daemon prints a QR at startup: `buildCompanionConnectionInfo({daemonUrl, token, password, surface:'tui'})` → `encodeConnectionPayload` (JSON payload) → QR. Mobile/companion apps scan it to get URL+token (`src/daemon/cli.ts:303-322`).
- **Interactive adoption**: onboarding wizard "Connect to an existing running daemon" installs host/port/token into `operator-tokens.json` and restarts the external-services controller (`src/input/handler-onboarding-daemon-adopt.ts`).

---

## 2. How it uses @pellux/goodvibes-sdk

The SDK is not a client library here — it is ~90% of the product. 300+ TUI source files import it. The TUI's own code is mostly UI (renderer/panels/input), CLI, glue wiring, and a small set of daemon handler surfaces.

### Key subpath imports (all under `@pellux/goodvibes-sdk/...`)
- `platform/config` — `ConfigManager`, `ServiceRegistry`, `SubscriptionManager`, `ToolLLM`, `DEFAULT_CONFIG`, `CONFIG_SCHEMA`, `resolveDaemonEnabled` (`src/config/index.ts`, `src/daemon/cli.ts:4`).
- `platform/daemon` — `DaemonServer`, `HttpListener`, `bootDaemon` (`src/daemon/cli.ts:11`, `src/runtime/bootstrap.ts:52`).
- `platform/control-plane` — `GatewayMethodCatalog`, `ApprovalBroker`, `SharedSessionBroker` (`src/runtime/services.ts:7`).
- `platform/core` — **`Orchestrator`** (the turn engine; `src/core/orchestrator.ts` is a 7-line re-export), `AdaptivePlanner`, `ExecutionPlanManager`, `DeterministicReplayEngine`, `SessionMemoryStore`, `SessionLineageTracker`.
- `platform/agents` — `AgentManager`-adjacent: `AgentMessageBus`, `AgentOrchestrator`, `ArchetypeLoader`, `WrfcController`.
- `platform/tools` — `AgentManager`, `ProcessManager`, `OverflowHandler`, `createWorkflowServices`.
- `platform/providers` — `ProviderRegistry`, `ProviderOptimizer`, `ProviderCapabilityRegistry`, `ModelLimitsService`, `CacheHitTracker`, `FavoritesStore`, `BenchmarkStore`.
- `platform/knowledge` — `KnowledgeStore/Service/SemanticService`, `HomeGraphService`, `ProjectPlanningService`.
- `platform/sessions`, `platform/state` (MemoryStore, ProjectIndex, FileUndoManager, ModeManager, code-index types), `platform/hooks`, `platform/plugins`, `platform/mcp`, `platform/channels`, `platform/automation`, `platform/watchers`, `platform/voice`, `platform/web-search`, `platform/media`, `platform/multimodal`, `platform/artifacts`, `platform/security`, `platform/permissions`, `platform/workspace`, `platform/pairing`, `platform/discovery`, `platform/companion`, `platform/runtime/{memory-spine,session-spine,fleet,...}`, `platform/utils` (logger), `platform/acp`, `platform/adapters` (inbound webhook handlers for slack/discord/telegram/whatsapp/signal/matrix/msteams/mattermost/imessage/bluebubbles/google-chat/telephony/ntfy/homeassistant/github/generic-webhook).

### The composition root — concrete example
`src/runtime/services.ts:244` `createRuntimeServices()` builds ~80 services and returns the `RuntimeServices` bag consumed by both `src/main.ts` (TUI) and `src/daemon/cli.ts` (headless daemon). Notable wiring:
- `new GatewayMethodCatalog()` (line 254) — the SDK auto-registers **every builtin gateway descriptor with `handler: undefined`** (HTTP-fallback). The TUI attaches host implementations for a handful of surfaces via `registerCatalogHandler(catalog, methodId, handler, {replace:true})` (`src/daemon/handlers/register.ts:106-137`) — only the handler slot changes; id/schema/scopes/dangerous flags stay SDK-owned. Host-implemented surfaces (`src/daemon/handlers/index.ts`, registered in fixed order): `channels.routing.*` → inbox (`channels.inbox.list` triage-decorated) → `channels.drafts.*` → `calendar.*` (CalDAV client) → `email.*` (IMAP/SMTP) → `remote.peers.*` (backed by `DistributedRuntimeManager`).
- `sessionBroker.setContinuationRunner(...)` (line 365) — shared-session continuations spawn agents via `agentManager.spawn({mode:'spawn', task, model/provider/tools routing...})`; `automationManager` gets the same `spawnTask` seam (line 414). **This is how daemon-side API calls become real agent runs.**
- `agentOrchestrator.setDependencies({...})` (line 668) — injects fileCache, projectIndex, webSearchService, knowledgeService, memoryRegistry, code-index injection, providerRegistry, toolLLM, sandbox registry, workflow services into the SDK agent executor.
- `createProcessRegistry({...})` (line 612) — unified live fleet registry (agents, WRFC chains, workflows, watchers, schedules, code-index) that backs the Fleet panel and the `fleet.*` WS methods.

### TUI turn engine
`src/runtime/bootstrap.ts:218` constructs the SDK `Orchestrator` in-process: `new Orchestrator({conversation, toolRegistry, permissionManager, getSystemPrompt, hookDispatcher, runtimeBus, sessionId, services:{agentManager, wrfcController}})`, then `orchestrator.setCoreServices(buildSharedOrchestratorCoreServices(...))` (`src/runtime/orchestrator-core-services.ts`). Companion messages arriving over the daemon fire `orchestrator.handleUserInput(...)` (bootstrap.ts:243). An `AcpManager` (Agent Client Protocol, `@agentclientprotocol/sdk`) is registered as a delegate tool (bootstrap.ts:256-267).

### Client-side SDK usage (TUI as daemon client)
When an external daemon is adopted the TUI uses `createHttpTransport({baseUrl, authToken})` and calls typed `httpTransport.operator.sessions.{register,close,list,inputs,deliverInput}` (`src/runtime/bootstrap.ts:414-431`). That is the same client stack a GUI would use.

### Realtime events
`RuntimeEventBus` (SDK) is the in-process spine; `DaemonServer` bridges it to SSE (`/api/control-plane/events?domains=...`) and WS (`/api/control-plane/ws`) with domain-filtered subscriptions. Typed payloads for every domain are exported per-subpath: `@pellux/goodvibes-sdk/events/{agents,automation,communication,compaction,control-plane,deliveries,forensics,knowledge,mcp,ops,orchestration,permissions,planner,plugins,providers,routes,security,session,surfaces,tasks,tools,transport,turn,ui,watchers,workflows,workspace}`.

---

## 3. State & storage (ground truth from the live `~/.goodvibes` on this machine + code)

Two roots via `ShellPathService` (SDK `platform/runtime/shell-paths`): `userGoodVibesRoot = ~/.goodvibes`, `projectGoodVibesRoot = <cwd>/.goodvibes`. TUI passes surface segment `'tui'` (goodvibes-agent uses `'agent'` — note `~/.goodvibes/agent/` and `agent.json` coexist with `tui/` and `tui.json`).

**`~/.goodvibes/` (user root):**
- `tui/settings.json` — canonical config (`GOODVIBES_TUI_SETTINGS_PATH` override).
- `tui/memory.sqlite` + `tui/memory.vec.sqlite` — the ONE home-scoped canonical memory store (`resolveCanonicalMemoryDbPath(home)`, sqlite + sqlite-vec vectors; deliberately never per-project — services.ts:388-397).
- `tui/knowledge-wiki.sqlite`, `tui/knowledge-agent.sqlite` (+ `knowledge-home-graph.sqlite` when used) — the three `KnowledgeStore` databases (services.ts:78-79, 431-442).
- `tui/code-index.sqlite` — repo code index (per-project db path, rerooted on workspace swap).
- `tui/sessions/*.jsonl` + `tui/transcript-user-*.journal` — session transcripts/journals; `tui/sessions/task-graph.json` (cross-session tasks).
- `tui/` JSON stores: `model-catalog.json`, `model-limits.json`, `favorites.json`, `benchmarks.json`, `subscriptions.json`, `auth-users.json`, `input-history.json`, `wrfc-chains.json`, `automation-jobs.json`, `discovered-providers.json`, `onboarding-state.json`, `keybindings.json`, `plugins.json`; dirs `profiles/`, `bookmarks/`, `artifacts/`, `operator/`, `providers/`, `remote/`, `agents/`, `skills/`, `control-plane/`.
- `daemon/` — daemon-owned: `operator-tokens.json` (bearer tokens), `detached-daemon.json` (pid/port record), `detached-daemon.log`.
- `companion-chat/sessions/` — disk-persisted companion chat sessions (atomic JSON, survive daemon restart — SDK `companion-chat-persistence`).
- Top-level: `goodvibes.json`, `tui.json`, `agent.json`, `GOODVIBES.md`, `checkpoints/`, `hooks/`, `logs/`, `sessions/`, `shared/`, `control-plane/`.

**`<project>/.goodvibes/` (project root):** `tui/services.json` (service registry + credentials via SecretsManager), `tui/watchers.json`, `tui/control-plane/{approvals.json,sessions.json}`, `tui/channels/policies.json`, `tui/remote/distributed-runtime.json`, `tui/sessions/task-graph.json`, plus `agents/` (archetypes) and `skills/`.

Secrets: `SecretsManager` (`src/config/secrets.ts`) with `goodvibes://` secret references resolvable from env/files; daemon handlers get a scoped `DaemonCredentialStore` (`src/daemon/handlers/credentials.ts`).

---

## 4. Agent-execution engine — what a GUI can reuse vs reimplement

**Where AI requests flow:** `Orchestrator` (SDK `platform/core`) drives the main-chat turn: system prompt assembly → `ProviderRegistry` model resolution → streaming provider call → tool-call loop through `ToolRegistry` + `PermissionManager` + `HookDispatcher` → runtimeBus events (`turn`, `tools`, `agents` domains). Subagents go through `AgentManager.spawn()` → `AgentOrchestrator` (SDK executor) with archetypes from `.goodvibes/agents`, WRFC chains via `WrfcController`, phase/work-item workstreams via `createWorkstreamServices` (`src/runtime/workstream-services.ts`).

**Provider adapters live entirely in the SDK** (`platform/providers`): anthropic (+SSE assembler/stream), anthropic-vertex, amazon-bedrock (+mantle), openai, openai-codex, openai-compat, anthropic-compat, gemini, github-copilot, ollama, lm-studio, llama-cpp, microsoft-foundry, synthetic, discovered-compat (LAN-scanned local servers via `platform/discovery`). Plus prompt-cache planning, model catalogs/limits, capability registry, optimizer, health.

**Where the engine runs — the critical answer for the GUI:**
- The engine lives in **whichever process hosts `createRuntimeServices()`**. In TUI-only/embedded mode that's the TUI process. In the detached/headless topology, the **standalone daemon itself hosts the full engine** — it has the complete provider registry, agent manager, tools, knowledge, etc.
- The daemon **executes real agent work server-side** through three entry surfaces:
  1. `sessions.*` + `SharedSessionBroker` continuation runner → `agentManager.spawn` (services.ts:365-385);
  2. `automation.*` jobs/schedules → same `spawnTask` seam (services.ts:414-429);
  3. **`companion.chat.*`** — the SDK's `CompanionChatManager` (`platform/companion/companion-chat-manager`) runs full LLM turns **inside the daemon**: per-session `ConversationManager`, provider-registry streaming, **tool execution via the injected ToolRegistry**, permission/hook integration, streaming chunks fanned out via control-plane events filtered per-session clientId, rate limiting (30 msg/min/client), disk persistence, GC. Message edit/retry/regenerate supported (`companion.chat.messages.{create,edit,retry}`).
- The TUI's *own* interactive chat runs its in-process `Orchestrator` even when an external daemon is adopted; the daemon then only mirrors session identity + memory and relays steer inputs.

**GUI recommendation implied by the architecture:** a "Claude Desktop"-class app can (a) connect to the shared daemon and drive `companion.chat.*` + `sessions.*`/`tasks.*`/`automation.*` for full server-side execution with streaming — zero engine reimplementation — or (b) embed the SDK runtime in its own Bun process exactly as `src/daemon/cli.ts` does (~100 lines to a full engine) and optionally embed a `DaemonServer` to stay interoperable with the TUI/mobile companions. The adopt-or-start + version-band logic in `startHostServices` is reusable as-is so GUI and TUI share one daemon without port fights.

---

## 5. Public integration points — protocol catalog (canonical, from the shipped contract artifact)

Source of truth: `@pellux/goodvibes-sdk/contracts/operator-contract.json` (importable JSON; also served live at `GET /api/control-plane/contract`). Contract v1, product `goodvibes`, surface `operator`, SDK 1.3.1. **327 methods (all with typed input+output schemas; 325 validated), 31 event catalog entries.** Peer surface is separate (below).

### Transports & handshake
- **HTTP JSON**: base `http(s)://host:3421` (config `controlPlane.host/port/hostMode/tls`). Status/identity: `GET /status` (returns `status`, `version` — used for the adopt handshake + version band check: 0.y minor-match, ≥1.0 major-match). Method catalog: `GET /api/control-plane/methods` (+ `/methods/{methodId}`); events catalog: `GET /api/control-plane/events/catalog`; full contract: `GET /api/control-plane/contract`.
- **SSE**: `GET /api/control-plane/events?domains=<csv>`. Emits `control.ready` handshake, `control.heartbeat` keepalives, then domain events.
- **WebSocket**: `GET /api/control-plane/ws`. Client frames: `ping`, `auth {token?, domains?, label?, capabilities?}`, `subscribe {domains}`, `unsubscribe {domains}`, **`call {id?, methodId?|method?+path?, query?, body?}`** (full RPC over WS — any catalog method). Server frames: `event {event, payload}`, `pong {ts}`, `auth {ok, clientId?, principalId?, error?}`, `subscribed`/`unsubscribed {clientId, domains}`, `response {id, ok, status, body}`, `error {error}`.
- **Auth modes**: `shared-bearer` (Authorization: Bearer <token>; companion token from `~/.goodvibes/daemon/operator-tokens.json` or `GOODVIBES_DAEMON_TOKEN`) and `session-login` (`POST /login {username,password}` → `{token, expiresAt}`; `GET /api/control-plane/auth` for current auth snapshot). Methods carry `scopes` (`read:X`/`write:X`), `access` (`public|authenticated|admin`), and `dangerous` flags; mutations flagged confirm-gated require `body.confirm===true` + `explicitUserRequest` metadata (`src/daemon/handlers/register.ts:87-98`).
- **Ports**: control plane **3421**, webhook/HTTP listener **3422** (inbound channel webhooks at `/webhook/<surface>`, e.g. `/webhook/homeassistant`), browser/web surface **3423** (`web.*` config).
- **Client libraries**: `createGoodVibesSdk()` (auth + operator + peer + realtime wired together), `createOperatorSdk({baseUrl, authToken})` → typed namespaces (`operator.sessions.create(...)`, `invoke(methodId, ...)`, `stream(...)`, `getOperation(methodId)`), `createBrowserGoodVibesSdk` / `createWebGoodVibesSdk` / `createReactNativeGoodVibesSdk` / `createExpoGoodVibesSdk`, `createHttpTransport` (raw), transport-realtime for SSE/WS domain events, plus browser-scoped bundles `browser/agent`, `browser/knowledge`, `browser/homeassistant`.

### Method catalog (all 327, grouped; `id | HTTP | scopes` — ADMIN/DANGEROUS flags noted; `[ws]` = WS-only `call` transport, no HTTP path)

- **accounts (1):** `accounts.snapshot` GET /api/accounts.
- **approvals (5):** `approvals.list` GET /api/approvals; `approve|deny|claim|cancel` POST /api/approvals/{approvalId}/<action>.
- **artifacts (4):** `list|create` GET|POST /api/artifacts; `get` GET /api/artifacts/{artifactId}; `content.get` GET /api/artifacts/{artifactId}/content.
- **auth / local_auth (6, admin):** `local_auth.status` GET /api/local-auth; `users.create` POST /api/local-auth/users; `users.delete` DELETE .../users/{username} (D); `users.password.rotate` POST .../users/{username}/password; `sessions.delete` DELETE .../sessions/{sessionId} (D); `bootstrap.delete` DELETE .../bootstrap-file (D).
- **automation (20):** `integration.snapshot` GET /api/automation; jobs `list|create` GET|POST /api/automation/jobs, `update` PATCH .../jobs/{jobId}, `delete` (D), `enable|disable|run` POST .../jobs/{jobId}/<action>; schedules `list|create|delete(D)|enable|disable|run` (same shape under /schedules); runs `list|get|cancel|retry`; heartbeat `list|run` GET|POST /api/automation/heartbeat.
- **calendar (5):** `events.list|create(admin)` GET|POST /api/calendar/events; `events.get`; `ics.export` GET, `ics.import` POST (admin).
- **channels (36):** `status` GET /api/channels/status; `inbox.list` GET /api/channels/inbox; accounts `list|surface.list|get` + `action.default|action.named` POST (admin); `actions.list|surface.list` + `actions.invoke` POST /api/channels/actions/{surface}/{actionId} (admin); `agent_tools.list|surface.list`; `tools.list|surface.list` + `tools.invoke` (admin); `capabilities.list|surface.list`; `directory.query`; `doctor.get`; `lifecycle.get`; `setup.get`; `repairs.list`; `allowlist.edit|resolve` (admin); `authorize` (admin); `targets.resolve` (admin); policies `list|audit|update(admin)`; drafts `list|get|save(admin,D)|delete(admin,D)`; routing `list|assign(admin,D)|delete(admin,D)`.
- **checkpoints (4) [ws]:** `create|list|diff|restore(D)` — workspace checkpoints.
- **companion (11):** chat sessions `list|create|get|update|delete|close` under /api/companion/chat/sessions[...]; `messages.list|create|edit|retry`; `events.stream` GET .../sessions/{sessionId}/events (per-session streaming).
- **config (3, admin):** `config.get|set` GET|POST /config; `credentials.get` GET /config/credentials.
- **continuity (1):** `continuity.snapshot` GET /api/continuity.
- **control-plane (12):** `control.status` GET /status; `control.auth.login` POST /login (public); `control.auth.current` GET /api/control-plane/auth (public); `control.snapshot` GET /api/control-plane; `control.web` GET /api/control-plane/web; `control.contract`; `control.methods.list|get`; `control.events.catalog`; `control.events.stream` GET /api/control-plane/events; `control.clients.list`; `control.messages.list`.
- **deliveries (2):** `list|get` /api/deliveries[/{deliveryId}].
- **email (4):** `inbox.list` GET /api/email/inbox; `inbox.read` GET /api/email/inbox/{uid}; `draft.create` POST /api/email/drafts (admin,D); `send` POST /api/email/send (admin,D).
- **fleet (2) [ws]:** `fleet.snapshot|fleet.list` — the live process registry (agents/WRFC/workflows/watchers/schedules).
- **health (1):** `health.snapshot` GET /api/health.
- **intelligence (1):** `intelligence.snapshot` GET /api/intelligence.
- **knowledge (90):** wiki: `status|search(POST)|ask(POST)|map|nodes.list|item.get|packet(POST)|lint|reindex(admin)`; ingest `url|urls|artifact|bookmarks|browserHistory|connector` (admin); sources/extractions/candidates/issues/reports/usage list+get+decide/review; jobs `list|get|run(admin)` + `job-runs.list`; schedules `list|get|save|enable|delete` (admin); projections `list|render|materialize(admin)`; refinement `run(admin)` + tasks `list|get|cancel`; connectors `list|get|doctor`; **GraphQL**: `knowledge.graphql.execute` POST /api/knowledge/graphql + `.schema`. Home-graph mirror under /api/homeassistant/home-graph/* (25 methods: ask/browse/map/sync/import/export/ingest/link/facts.review/device-passport/room-page/packet/refinement/reset(D)/...). Project planning: `projectPlanning.status|state.get/upsert|language.get/upsert|decisions.list/record|evaluate` + work plan `snapshot|tasks.list|task.create/get/update/delete/status|tasks.reorder|clearCompleted` under /api/projects/planning/*.
- **mcp (6):** `servers.list` GET /api/mcp/servers; `tools.list` GET /api/mcp/tools; `config.get` GET /api/mcp/config; `config.reload` POST /api/mcp/reload (admin); `servers.upsert|remove` (admin).
- **media/multimodal (9):** `media.providers.list|analyze|generate|transform`; `multimodal.status|providers.list|analyze|packet|writeback(admin)`.
- **memory (17):** records `add|get|list(POST)|search(POST)|search-semantic(POST)|update|update-review|delete|export|import`; `links.add|list`; `review-queue`; `vector.stats|rebuild(admin)`; `embeddings.default.set(admin)`; `doctor` — under /api/memory/*.
- **panels (2):** `panels.list` GET /api/panels; `panels.open` POST /api/panels/open (remote-open TUI panels).
- **providers (3):** `providers.list` GET /api/providers; `get`; `usage.get` GET /api/providers/{providerId}/usage.
- **push (5) [ws]:** `push.vapid.get`, `subscriptions.list|create|delete|verify` (web-push).
- **remote (12):** `remote.snapshot` GET /api/remote; peers `list|invoke(admin)|disconnect(admin)|token.rotate|token.revoke(admin)`; pair requests `list|approve|reject(admin)`; work `list|cancel(admin)`; `node_host.contract` GET /api/remote/node-host/contract.
- **review (1):** `review.snapshot` GET /api/review.
- **routes (6):** `routes.snapshot` GET /api/routes; bindings `list|create|update|delete(D)` (admin); `surfaces.list` GET /api/surfaces.
- **scheduler (1):** `scheduler.capacity` GET /api/runtime/scheduler.
- **services (6):** `services.status` GET /api/service/status; `install|start|stop|restart|uninstall(D)` POST /api/service/<action> (admin) — OS service management over the wire.
- **sessions (17):** `list|create` GET|POST /api/sessions; `get|delete`; `register` POST /api/sessions/register (spine mirror); `close|reopen|detach|steer|followUp` POST /api/sessions/{sessionId}/<action>; `messages.list|create`; inputs `list|deliver|cancel` (steer-input queue); `integration.snapshot` GET /api/session; `sessions.search` [ws].
- **settings (2):** `settings.snapshot` GET /api/settings; `security.settings` GET /api/security-settings.
- **tasks (6):** `tasks.create` **POST /task**; `tasks.status` GET /task/{agentId}; `tasks.list` GET /api/tasks; `get|cancel|retry` /api/tasks/{taskId}[...]. (Fire-and-forget agent tasks.)
- **telemetry (9):** `snapshot|events.list|errors.list|traces.list|metrics.get|stream` under /api/v1/telemetry/*; OTLP `logs|metrics|traces` under /api/v1/telemetry/otlp/v1/*.
- **voice (7):** `voice.status` GET /api/voice; `providers.list`; `voices.list`; `stt` POST /api/voice/stt; `tts` POST /api/voice/tts; `tts.stream` POST /api/voice/tts/stream (raw binary audio); `realtime.session` POST /api/voice/realtime/session.
- **watchers (7, admin):** `list`; `create`; `update` PATCH; `delete(D)`; `start|stop|run` POST /api/watchers/{watcherId}/<action>.
- **web-search (2):** `web_search.providers.list` GET /api/web-search/providers; `web_search.query` POST /api/web-search/query.
- **worktrees (1):** `worktrees.snapshot` GET /api/worktrees.

Additional SDK-owned HTTP routes outside the method catalog: Home Assistant Assist remote-chat (`GET /api/homeassistant/health`, `POST /api/homeassistant/conversation[/stream|/cancel]`), inbound webhooks on the listener (`/webhook/<surface>`), and provider auth routes (`src/cli/provider-auth-routes.ts`).

### Event domains (subscribe via SSE `?domains=` or WS `subscribe`)
27 runtime domains: `agents, automation, communication, compaction, control-plane, deliveries, forensics, knowledge, mcp, ops, orchestration, permissions, planner, plugins, providers, routes, security, session, surfaces, tasks, tools, transport, turn, ui, watchers, workflows, workspace` — plus wire-level `control.ready`, `control.heartbeat`, `control.session_update` (session lifecycle broadcast), `control.surface_message`. Typed payload maps: `RuntimeDomainEventPayloadMap`, `OperatorEventPayloadMap` in `@pellux/goodvibes-sdk/contracts`.

### Peer surface (device/node-host runners — separate contract)
`@pellux/goodvibes-sdk/contracts/peer-contract.json`: transport http-json, base `/api/remote`; peerKinds `node|device`; workTypes `invoke, status.request, location.request, session.message, automation.run`; scopes `remote:heartbeat|pull|complete`; endpoints: `pair.request` POST /api/remote/pair/request, `pair.verify` POST /api/remote/pair/verify (challenge verification → scoped peer token), `peer.heartbeat` POST /api/remote/heartbeat, `work.pull` POST /api/remote/work/pull, `work.complete` POST /api/remote/work/{workId}/complete, `operator.snapshot` GET /api/remote. Client: `@pellux/goodvibes-sdk/peer` (`goodvibes-peer-sdk`). A GUI that wants to *execute* work for a daemon (rather than operate it) would pair as a peer.

### Versioning summary for a sibling app
Handshake = `GET /status` → check `version` with `isDaemonVersionCompatible` (SDK `platform/runtime/daemon-version-compat`: 0.y minor-band, ≥1.0 major-band); then either adopt (bearer token from `~/.goodvibes/daemon/operator-tokens.json` / env / QR pairing payload) or spawn `goodvibes-daemon` detached and adopt it. Contract discovery is fully dynamic at `GET /api/control-plane/methods` + `/events/catalog` + `/contract`, and statically importable from `@pellux/goodvibes-sdk/contracts/operator-contract.json` for codegen.