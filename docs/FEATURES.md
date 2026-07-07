# goodvibes-app — Feature Parity Matrix

**This file is the completion bar.** Every user-facing capability of goodvibes-tui v1.10 and goodvibes-agent v1.6 appears below, mapped to the app surface that owns it and the exact backing that implements it. Ground truth for the enumerations: `docs/research/tui-features.md`, `docs/research/agent-map.md`, `docs/research/tui-daemon-architecture.md` (§5 method catalog), `docs/research/sdk-map.md`.

**How to read:**
- **Source** — where the feature comes from: `tui`, `agent`, `both`, `desktop` (goodvibes-desktop prior art worth carrying), `new` (app-original).
- **Backing** — what implements it: an operator method id (e.g. `sessions.steer`), an SSE **domain** (e.g. `turn` events), `app-local` (implemented in this repo: UI state, file registries, Bun main process), `app-bun:<sdk subpath>` (Bun main process importing a Bun-only SDK platform subpath), or `RPC` (Electrobun native bridge: dialogs/tray/clipboard/notifications/PTY/shell).
- **Status** — `planned` → `wired` → `verified`, or `excluded` (moved to §25 with justification). **Wire-or-delete is the law**: at ship time no row may remain `planned`.
- `[ws]` — WS-only `call` transport method (no HTTP path); reach it over the daemon WebSocket or note the degradation.

Statuses start at `planned`. The final audit (task #8) checks every row.

---

## 1. Chat (companion chat — the primary surface)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Chat session list (sidebar, warm-start cache) | both | `companion.chat.sessions.list` | planned | localStorage warm-start per webui pattern |
| Create chat session | both | `companion.chat.sessions.create` | planned | provider+model selectable at create |
| Rename / auto-title | both | `companion.chat.sessions.update` | planned | auto-title after first exchange (webui pattern) |
| Close / delete chat (proof-of-gone reconcile) | both | `companion.chat.sessions.close` / `.delete` | planned | delete-means-delete reconcile from webui |
| Send message (optimistic local/sent/failed states) | both | `companion.chat.messages.create` | planned | never `sessions.messages.create` as fallback (webui architecture.md rule) |
| Streaming assistant reply | both | `companion.chat.events.stream` (SSE per-session) | planned | delta/completed/error frames |
| Edit-and-branch with lineage | both | `companion.chat.messages.edit` | planned | superseded-lineage UI (webui `lineage.ts`) |
| Retry / regenerate | both | `companion.chat.messages.retry` | planned | |
| Message history load | both | `companion.chat.messages.list` | planned | |
| Attachments: drag-drop / paste-image / file picker | both | `artifacts.create` + message `attachments[]` | planned | upload first, then reference by artifactId |
| Per-session provider/model picker in composer | both | `providers.list` + session update | planned | provider-first, model-second |
| Reasoning effort selector | both | session/config (`provider.reasoningEffort`) | planned | instant/low/medium/high |
| Markdown rendering (GFM, tolerant tables) | both | app-local (react-markdown + remark-gfm) | planned | |
| Syntax highlighting + line-number modes (off/code/all) | tui | app-local (highlight.js) | planned | line numbers UI-only, never copied |
| Collapsible blocks + auto-collapse threshold | tui | app-local | planned | threshold configurable (`display.collapseThreshold`) |
| Inline diff rendering in transcript | tui | app-local | planned | |
| Block copy / save to file | tui | app-local + RPC (clipboard, save dialog) | planned | |
| Bookmarks (add/list/jump) | both | app-local store (`~/.goodvibes/app/bookmarks.json`) | planned | |
| Conversation search (Ctrl+F, n/N, wrap marker) | tui | app-local | planned | |
| Next/prev error jump | both | app-local (scan transcript for error blocks) | planned | |
| Thinking display + live token strip | tui | stream events + app-local render | planned | tokens/sec optional (`display.showTokenSpeed`) |
| Context usage meter | both | usage fields on stream/turn events + app-local | planned | fresh-input vs cached-context split where reported |
| Chat search (across sessions) | both | `sessions.search` [ws] + client-side message search | planned | degrade to client-side if WS unavailable |
| Slash-command hints in composer | both | app-local command registry | planned | GUI-native: palette-backed autocomplete |
| `@` file reference picker | both | app-local + RPC (file dialog) + workspace glob | planned | |
| Multi-line composer, grows with content | both | app-local | planned | Shift+Enter newline, Enter send |
| Paste normalization (big paste → chip) | tui | app-local | planned | >8 lines collapses to a paste chip |
| Input history + reverse search (Ctrl+R) | both | app-local (`~/.goodvibes/app/input-history.json`) | planned | |
| Prompt undo/redo | both | app-local | planned | |
| Conversation clear / reset | both | new session + archive | planned | GUI semantic: new chat |
| Notes: `/note`, `/keep` (session → durable memory) | both | `memory.records.add` | planned | scope=session, promote flow |
| Export transcript (md/json/html) | both | app-local render from `companion.chat.messages.list` | planned | |
| Share with `--redact` | tui | app-local (secret-shaped masking before export) | planned | reuse config-redaction patterns |
| Templates (prompt templates) | tui | app-local store | planned | |
| Image attach (`/image`, Ctrl+V) | both | `artifacts.create` + attachments | planned | |
| Image generation (`/imagine`) | both | `media.generate` → artifact preview | planned | |
| Voice dictation (mic → composer) | both | `voice.stt` | planned | webview `getUserMedia` OK on loopback origin |
| Speak-aloud replies (TTS) + always-speak toggle | both | `voice.tts.stream` + `ui.voiceEnabled` config | planned | native audio via Web Audio |
| Turn cancel (stop button) | both | stream cancel + `sessions.inputs.cancel` where applicable | planned | never a silent kill; confirm on busy |
| Conversation branches (fork a chat) | tui | app-local: create session + replay seed from history | planned | wire fork doesn't exist for companion chat; honest "forked from" marker |
| Long-turn desktop notification | both | stream timing + RPC (native notification) | planned | `behavior.notifyAfterSeconds` |

## 2. Sessions (operator sessions union — all surfaces)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Cross-surface session union list | both | `sessions.list` | planned | tui/agent/webui/app kinds, 50-row cap disclosed |
| Session detail + message transcript | both | `sessions.get`, `sessions.messages.list` | planned | |
| Search sessions | both | `sessions.search` [ws] | planned | |
| Steer a live session | both | `sessions.steer` | planned | SteerComposer pattern |
| Follow-up on completed session | both | `sessions.followUp` | planned | |
| Input queue: list / deliver / cancel | both | `sessions.inputs.list/.deliver/.cancel` | planned | |
| Close / reopen / delete | both | `sessions.close/.reopen/.delete` | planned | destructive = native confirm dialog |
| Detach | both | `sessions.detach` | planned | detach never kills |
| Live session updates | both | `session-update` wire event (raw SSE) + `session` domain | planned | webui two-stream pattern |
| Create operator session | both | `sessions.create` | planned | |
| Session export | both | app-local from messages | planned | |
| Session integration snapshot | tui | `sessions.integration.snapshot` | planned | diagnostics panel |

## 3. Fleet (live control room)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Live process tree (agents/WRFC/workflows/watchers/schedules/code-index) | tui | `fleet.snapshot` / `fleet.list` [ws] | planned | flat parentId → tree; poll + `agents`/`workflows`/`tasks` domain invalidation |
| Node detail: transcript / usage / cost | tui | `sessions.messages.list` + `agents` domain events | planned | |
| Steer agent | tui | `sessions.steer` | planned | |
| Detach (never kills) | tui | `sessions.detach` | planned | |
| Watcher start/stop/run from fleet | tui | `watchers.start/.stop/.run` | planned | |
| Task cancel/retry from fleet | tui | `tasks.cancel/.retry` | planned | where node maps to a task |
| Interrupt / kill / pause / resume of agents | tui | — | planned | gap: no wire method — ship honest capability notes (webui pattern); revisit if contract grows |
| Inline approval cards on correlated nodes | tui | `approvals.list` + `permissions` domain | planned | |
| Workstream view (phases / work-items) | tui | `fleet.snapshot` filtered to workstream kinds | planned | usage/cost where reported |
| WRFC chain badges (`c:N/M`, SAT/UNS/UNV) | tui | fleet node metadata + `workflows` domain | planned | render what the wire reports; no fabrication |
| Worktree detail per agent | tui | `worktrees.snapshot` | planned | |
| Deep links into fleet nodes | tui | app-local routing | planned | |

## 4. Approvals & Tasks (human-in-the-loop)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Pending / claimed / history list | both | `approvals.list` + `permissions` domain | planned | category × risk matrix |
| Approve (whole) | both | `approvals.approve` | planned | |
| Per-hunk edit approval | both | `approvals.approve({selectedHunks})` | planned | hunk-picker UI (webui pattern) |
| Deny with note / claim / cancel | both | `approvals.deny/.claim/.cancel` | planned | |
| Approval desktop notification + palette jump | new | `permissions` domain + RPC notification | planned | the "answer from anywhere" flow |
| Task list / detail | both | `tasks.list/.get/.status` | planned | verbatim statuses |
| Create fire-and-forget task | both | `tasks.create` | planned | POST /task semantics |
| Cancel / retry task | both | `tasks.cancel/.retry` | planned | |
| Realtime task updates | both | `tasks` domain | planned | |

## 5. Automation (jobs, schedules, watchers, hooks)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Integration snapshot dashboard | tui | `automation.integration.snapshot` | planned | |
| Jobs: list/create/update/delete/enable/disable/run | both | `automation.jobs.*` | planned | delete is dangerous-flagged → confirm |
| Schedules: list/create/delete/enable/disable/run | both | `automation.schedules.*` | planned | kinds `cron\|every\|at`, IANA timezones |
| Cron editor with human preview + next-run times | new | app-local UI over schedules | planned | zero-friction cron authoring |
| Runs: list/get/cancel/retry | both | `automation.runs.*` | planned | run history with outcomes |
| Heartbeat: list/run | tui | `automation.heartbeat.*` | planned | |
| Watchers: list/create/update/delete/start/stop/run | both | `watchers.*` | planned | admin-scoped; webhook/email/event triggers |
| Delivery targets on schedules (16 surface kinds) | agent | schedule payload fields | planned | slack/discord/telegram/…/webhook |
| Reminders (one-shot `at` schedules) | agent | `automation.schedules.create` kind=at | planned | Personal Ops integration |
| Hooks file editor (`.goodvibes/hooks.json`) | tui | app-local file editor + schema validation | planned | gap: no wire method — app-local editor with event-path/type reference docs |
| Workflow runs visibility (wrfc/fix_loop/…) | tui | `workflows` domain + fleet | planned | read-only; execution stays daemon/tui-side |
| Scheduler capacity | tui | `scheduler.capacity` | planned | observability hub tile |

## 6. Knowledge (wiki + graph + ingestion + planning)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Status dashboard | both | `knowledge.status` | planned | |
| Ask (grounded answer) | both | `knowledge.ask` | planned | markdown answers with citations |
| Search | both | `knowledge.search` | planned | |
| Map (graph view) | both | `knowledge.map` | planned | interactive graph, GUI-native win |
| Nodes list / item detail | both | `knowledge.nodes.list`, `knowledge.item.get` | planned | |
| Packet build (task-time injection preview) | both | `knowledge.packet` | planned | explainability: why each item |
| Lint / reindex | both | `knowledge.lint`, `knowledge.reindex` | planned | reindex admin-gated |
| Ingest URL / URLs / artifact | both | `knowledge.ingest.url/.urls/.artifact` | planned | |
| Import bookmarks / browser history / connector | both | `knowledge.ingest.bookmarks/.browserHistory/.connector` | planned | file pickers via RPC |
| Sources list/get + health | both | `knowledge.sources.*` | planned | |
| Extractions / candidates review (decide) | both | `knowledge.extractions.*`, `knowledge.candidates.*` | planned | consolidation review UI |
| Issues list / review | both | `knowledge.issues.*` | planned | |
| Reports / usage | both | `knowledge.reports.*`, `knowledge.usage.*` | planned | |
| Jobs: list/get/run + job-runs | both | `knowledge.jobs.*` | planned | lint/reindex/refresh-stale/consolidation jobs |
| Schedules: list/get/save/enable/delete | both | `knowledge.schedules.*` | planned | |
| Projections: list/render/materialize | both | `knowledge.projections.*` | planned | wiki/markdown projections viewer |
| Refinement: run + tasks list/get/cancel | both | `knowledge.refinement.*` | planned | |
| Connectors: list/get/doctor | both | `knowledge.connectors.*` | planned | |
| GraphQL console (query + schema) | tui | `knowledge.graphql.execute/.schema` | planned | power-user console with schema explorer |
| Agent-scoped knowledge (isolated store) | agent | `/api/goodvibes-agent/knowledge/*` routes | planned | capability-probe at runtime; scope switcher in Knowledge view |
| Home-graph: ask/browse/map/sync/import/export/ingest/link | tui | `homeassistant.homeGraph.*` (~25) | planned | shown when HA surface configured |
| Home-graph facts review / device passport / room page / reset | tui | `homeassistant.homeGraph.*` | planned | reset is dangerous → confirm |
| Project planning: status/state/language/decisions/evaluate | tui | `projectPlanning.*` | planned | decision records timeline |
| Work plan: snapshot + tasks CRUD/status/reorder/clearCompleted | both | `projectPlanning.workPlan.*` | planned | kanban-ish checklist UI |
| Knowledge realtime updates | both | `knowledge` domain | planned | invalidation only |

## 7. Memory (canonical cross-surface store)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Records: add/get/list/update/delete | both | `memory.records.*` | planned | classes: decision/constraint/incident/pattern/fact/risk/runbook/architecture/ownership |
| Literal + semantic search (recall-honesty note) | both | `memory.records.search/.search-semantic` | planned | honest note about which index answered |
| Review queue + update-review | both | `memory.review-queue`, `memory.records.update-review` | planned | fresh/reviewed/stale/contradicted states |
| Links: add/list (record graph) | both | `memory.links.*` | planned | |
| Import / export (handoff bundles) | both | `memory.records.import/.export` | planned | |
| Vector stats / rebuild | both | `memory.vector.stats/.rebuild` | planned | rebuild admin-gated |
| Embedding provider doctor + default set | both | `memory.doctor`, `memory.embeddings.default.set` | planned | |
| Scope + confidence faceting (session/project/team) | both | list filters + app-local facets | planned | |
| Promote note → durable memory | both | `memory.records.add` + review flow | planned | |

## 8. Agent Brain (routines, personas, skills, profiles, VIBE)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Routines: create/edit/enable/list/delete | agent | app-local registry `~/.goodvibes/app/routines.json` | planned | same record shape as agent (name/steps/triggers/tags/requirements/reviewState/startCount) |
| Start routine in chat (prints steps, bumps count) | agent | app-local + chat composer injection | planned | |
| Promote routine → daemon schedule (confirm-gated) | agent | `automation.schedules.create` | planned | redacted local receipt |
| Personas: create/inspect/activate/review/delete | agent | app-local registry | planned | |
| Persona discovery/import from VIBE.md | agent | app-local | planned | |
| Skills: create/import/enable/disable/review/bundles | agent | app-local registry (standard format + readiness checks) | planned | |
| Profiles: named isolated app homes + starter templates | agent | app-local (`GOODVIBES_APP_HOME`-style roots) | planned | isolates config/sessions/registries |
| VIBE.md personality editor (real disk writes) | agent | app-local file editor + secret scan | planned | the anti-desktop-lie row: writes to disk, shows blocked/truncated states |
| Project context file inspection (CLAUDE.md, AGENTS.md, .cursorrules, …) | agent | app-local discovery + viewer | planned | secret-scanned, read-only inspect |
| Import registries/settings from `~/.goodvibes/agent` + `~/.goodvibes/tui` | agent | app-local bridge (preview → confirm, redacted, source never mutated) | planned | routines/personas/skills/notes/VIBE + provider/UI/permission settings |
| Scratchpad notes + promote flows | agent | app-local notes registry + `memory.records.add` | planned | |
| Learning review (stale/low-confidence/duplicates) | agent | `memory.review-queue` + `knowledge.candidates.*` UI | planned | curator logic reimagined over wire review surfaces |
| Away digest ("while you were away") | agent | `automation.runs.list` + `tasks.list` + `deliveries.list` since lastSeen | planned | lastSeen store app-local |
| Coming-up rail (next runs + calendar) | agent | schedules `nextRunAt` + `calendar.events.list` | planned | 60s cache, silent-failure |

## 9. Personal Ops

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Daily briefing (inbox/agenda/tasks/reminders/deliveries) | agent | `email.inbox.list` + `calendar.events.list` + `tasks.list` + `automation.schedules.list` + `deliveries.list` | planned | composed dashboard, honest per-source degradation |
| Email inbox list / read | agent | `email.inbox.list/.read` | planned | 412-unconfigured vs error taxonomy |
| Email draft (confirm-gated) | agent | `email.draft.create` | planned | dangerous-flagged |
| Email send (confirm-gated) | agent | `email.send` | planned | dangerous-flagged, explicit confirm |
| Calendar windowed list + event peek | agent | `calendar.events.list/.get` | planned | |
| Calendar create (admin) | agent | `calendar.events.create` | planned | |
| ICS import / export | agent | `calendar.ics.import/.export` | planned | file dialogs via RPC |
| Unified inbox (channels + email merged) | agent | `channels.inbox.list` + `email.inbox.list` | planned | triage decorations preserved |
| Reminders | agent | `automation.schedules.create` (kind=at) | planned | |

## 10. Research

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Web search (ranked, source-labeled) | both | `web_search.query` | planned | |
| Search provider list/status | both | `web_search.providers.list` | planned | 7 providers, keyless default |
| Research runs (visible, checkpointable, log tails) | agent | app-local run registry + `tasks.create` + `web_search.query` | planned | every run has status/cancel routes |
| Source triage + credibility scoring | agent | app-local registry | planned | reviewed-source bundles |
| Sourced report artifacts (citation coverage, source maps) | agent | app-local compose + `artifacts.create` | planned | |
| Promote research → Knowledge | agent | `knowledge.ingest.url/.artifact` | planned | explicit, confirm-gated |
| URL inspection (read-only fetch preview) | agent | app-bun fetch + app-local viewer | planned | config-gated for private hosts |

## 11. Documents & Compare

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Versioned markdown drafts | agent | app-local document registry + `artifacts.create` | planned | |
| Review comments + AI suggestion accept/reject | agent | app-local + companion chat turns | planned | |
| Uploads / exports | agent | `artifacts.*` + RPC file dialogs | planned | |
| Review packets: wizard + presets + freshness check | agent | app-local | planned | 6-step wizard, reusable presets |
| Reviewer handoff ZIP archives | agent | app-local (Bun zip) | planned | |
| Share packet via channel (confirm-gated) | agent | `channels.actions.invoke` | planned | |
| Blind model comparison (delayed reveal) | agent | parallel `companion.chat.sessions.create` with different models | planned | judgment artifacts stored app-local + `artifacts.create` |
| Preference analytics / synthesis | agent | app-local store | planned | |
| Winner → model route update (confirm-gated) | agent | `config.set` model routes | planned | |

## 12. Artifacts

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| List / browse | both | `artifacts.list` | planned | type facets (md/json/csv/pdf/image/audio/video) |
| Detail + content fetch | both | `artifacts.get`, `artifacts.content.get` | planned | |
| Preview: markdown/code/image/audio/video/PDF | both | app-local viewers | planned | GUI-native win over TUI |
| Upload / create | both | `artifacts.create` | planned | drag-drop anywhere |
| Export / package / archive | both | app-local + RPC save dialogs | planned | |
| Promote artifact → Knowledge | both | `knowledge.ingest.artifact` | planned | |
| Per-message artifacts slide-over in chat | both | app-local extraction + attachments | planned | webui ArtifactsPanel pattern |

## 13. Channels (omnichannel)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Status overview (all 17 surfaces) | both | `channels.status` | planned | tui/web/slack/discord/ntfy/webhook/HA/telegram/google-chat/signal/whatsapp/telephony/imessage/msteams/bluebubbles/mattermost/matrix |
| Lifecycle / setup guide / doctor / repairs | both | `channels.lifecycle.get`, `.setup.get`, `.doctor.get`, `.repairs.list` | planned | ordered setup guide (agent pattern) |
| Inbox (triage-decorated) | both | `channels.inbox.list` | planned | |
| Accounts: list / per-surface / get + actions | both | `channels.accounts.*` | planned | admin-gated actions |
| Actions: list / invoke (confirmed sends) | both | `channels.actions.*` | planned | confirm + explicitUserRequest |
| Agent tools + tools list / invoke | both | `channels.agent_tools.*`, `channels.tools.*` | planned | |
| Capabilities / directory query | both | `channels.capabilities.*`, `channels.directory.query` | planned | |
| Allowlist edit / resolve; authorize; target resolve | both | `channels.allowlist.*`, `.authorize`, `.targets.resolve` | planned | admin |
| Policies: list / audit / update | both | `channels.policies.*` | planned | |
| Drafts: list/get/save/delete | both | `channels.drafts.*` | planned | dangerous-flagged saves → confirm |
| Routing: list / assign / delete | both | `channels.routing.*` | planned | |
| Delivery receipts (redacted) + dead-letter states | both | `deliveries.list/.get` | planned | last-error surfaced |
| Companion pairing (QR) | both | app-bun `platform/pairing` payload + app-local QR render | planned | pair phones/companions to the daemon |
| Notification targets (ntfy/webhook) manage + test | both | config + `channels.actions.invoke` test | planned | |
| Realtime channel events | both | `communication` + `deliveries` domains | planned | |

## 14. Providers & Models

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Provider list + auth-freshness status | both | `providers.list` + derived status | planned | webui provider-status.ts pattern |
| Provider detail + usage | both | `providers.get`, `providers.usage.get` | planned | |
| Accounts snapshot (route posture, fallback risk) | tui | `accounts.snapshot` | planned | |
| Model workspace: multi-target routes (main/helper/tool/tts/embeddings) | both | `config.get/.set` + `providers.list` | planned | provider-first picker, tier badges, search/price filters |
| Model catalog (models.dev, 4000+ models, tiers) | tui | app-bun catalog fetch (24h TTL) shared-store | planned | reuse `~/.goodvibes/tui/model-catalog.json` conventions |
| Synthetic failover posture display | tui | `providers.list` + config | planned | display-only; failover runs daemon-side |
| Credential status (secret-free) | both | `credentials.get` (`config.credentials.get`) | planned | |
| Custom provider JSON management | tui | app-local editor over `~/.goodvibes/tui/providers/*.json` | planned | shared store, hot-reloaded by daemon host |
| Local LLM server scan (opt-in, never silent) | both | app-bun `@pellux/goodvibes-sdk/platform/discovery` | planned | Ollama/LM Studio/vLLM/llama.cpp/… |
| Refresh models | both | app-bun catalog refresh | planned | |
| Subscriptions status (OAuth-backed) | both | config + `settings.snapshot` | planned | OAuth flows open external browser via RPC |
| Reasoning effort defaults | both | `config.set provider.reasoningEffort` | planned | |
| Pin/unpin favorite models | both | app-local favorites (shared-store conventions) | planned | |

## 15. Coding / Dev

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Git panel: status/log/stage/unstage/commit | tui+desktop | app-bun git CLI via RPC | planned | |
| Branches: list/create/checkout with dirty-tree guard | desktop | app-bun git | planned | explain-and-confirm modal, no force-push |
| Stash / tags / remotes / reflog rescue | desktop | app-bun git | planned | |
| Diff viewer: working/staged/HEAD/arbitrary refs | both | app-bun git + app-local unified diff renderer | planned | syntax-highlighted, side-by-side toggle |
| Worktrees: snapshot + list | tui | `worktrees.snapshot` + app-bun git | planned | agent-worktree awareness from fleet |
| Checkpoints: create/list/diff/restore | both | `checkpoints.*` [ws] | planned | restore is destructive → confirm; honest `noop:true` render |
| Embedded terminal tabs (PTY) | desktop | RPC + PTY in Bun main (bun-pty or `script(1)` wrapper) | planned | exit codes always surfaced; confirm on busy close; scrollback preserved on view switch |
| Intelligence snapshot (LSP/tree-sitter posture) | tui | `intelligence.snapshot` | planned | read-only; full control room excluded (§25) |
| Repo file browser + preview | desktop | app-bun fs via RPC | planned | rendered-markdown toggle; delete requires confirm |
| Per-repo session table (sessions in this project) | desktop | `sessions.list` filtered by project | planned | |
| GitHub: device-flow auth + PR/issue list/create | desktop | app-bun GitHub REST (bundled device-flow client id) | planned | zero-setup; degrade honestly when offline/unauthed |
| Review snapshot | tui | `review.snapshot` | planned | |

## 16. MCP

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Server list + status | both | `mcp.servers.list` | planned | |
| Add / edit / remove servers | both | `mcp.servers.upsert/.remove` | planned | admin-gated |
| Tool inventory (namespaced `mcp:<server>:<tool>`) | both | `mcp.tools.list` | planned | |
| Config view + reload | both | `mcp.config.get`, `mcp.config.reload` | planned | |
| Trust / role review | both | config keys + app-local review UI | planned | |
| Sandbox isolation posture display | tui | `settings.snapshot` | planned | read-only; QEMU bootstrap excluded (§25) |
| MCP realtime events | both | `mcp` domain | planned | |

## 17. Observability (forefront requirement)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Telemetry dashboard (events, filters: domain/type/severity/trace/session/turn/agent/task) | tui | `telemetry.snapshot`, `telemetry.events.list` | planned | |
| Error ledger | tui | `telemetry.errors.list` | planned | |
| Traces browser | tui | `telemetry.traces.list` | planned | |
| Metrics | tui | `telemetry.metrics.get` | planned | |
| Live telemetry stream | tui | `telemetry.stream` | planned | pausable live tail |
| Cost analytics: 4-bucket tokens, dated pricing, dedup, per-project/session/provider rollups | desktop+tui | `providers.usage.get` + telemetry + app-local engine | planned | port desktop's praised semantics; frame all big numbers; "Ephemeral" bucket |
| Cost budget alert (`GOODVIBES_COST_BUDGET_USD`) | tui | config + app-local threshold alerts | planned | |
| Token budget / context console | tui | usage events + app-local | planned | |
| Health snapshot + repair guidance | both | `health.snapshot` | planned | actionable cause/impact/next-action cards |
| Daemon control snapshot / connected clients / messages | tui | `control.snapshot/.clients.list/.messages.list` | planned | |
| Routes snapshot + bindings CRUD | tui | `routes.*` | planned | binding delete dangerous → confirm |
| Surfaces list | tui | `surfaces.list` | planned | |
| Continuity snapshot | tui | `continuity.snapshot` | planned | |
| Scheduler capacity | tui | `scheduler.capacity` | planned | |
| Connection diagnostics (SSE state, latency, reconnects) | new | app-local (connector lifecycle hooks) | planned | "live updates paused" banner + resume |
| Status strip: Reachable / Signed-in / Working + latency + active turns | both | app-local composite (webui daemon-health) | planned | always visible, never lies |
| Contract explorer (method catalog + event catalog browser) | new | `control.contract`, `control.methods.list/.get`, `control.events.catalog` | planned | observability-of-the-API; powers capability probes |
| Remote-open TUI panels | tui | `panels.list`, `panels.open` | planned | delightful cross-surface trick |
| OTLP ingest endpoints info | tui | `telemetry.otlp.*` (display endpoints/status) | planned | display-only |

## 18. Voice & Media

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| TTS speak (one-shot) | both | `voice.tts` | planned | |
| Streaming TTS (sentence-chunked live speech) | both | `voice.tts.stream` (raw binary) → Web Audio | planned | replaces tui's mpv/ffplay with native audio |
| TTS speed / voice / provider settings | both | `voice.voices.list`, `voice.providers.list`, config `tts.*` | planned | 0.25–4.0 speed |
| STT dictation | both | `voice.stt` | planned | |
| Voice status / doctor | both | `voice.status` | planned | honest unconfigured states |
| Realtime voice session (duplex) | both | `voice.realtime.session` | planned | v1: session bootstrap + status; full duplex UI stretch |
| Media providers list | both | `media.providers.list` | planned | |
| Media analyze / generate / transform | both | `media.analyze/.generate/.transform` | planned | generation → artifact preview |
| Multimodal: status/providers/analyze/packet/writeback | tui | `multimodal.*` | planned | writeback admin-gated |

## 19. Settings & Config (forefront requirement)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Full schema-driven settings workspace (all SDK config keys, categories, defaults diamond, live edit) | both | `config.get/.set` + `settings.snapshot` + app-bun `CONFIG_SCHEMA` from `platform/config` | planned | one-key-at-a-time set; secret-shaped masking |
| Settings search (fuzzy, cross-category) | new | app-local | planned | zero-friction: find any key in <2s |
| Feature flags | both | `config.set` flags | planned | |
| Secrets manager: set/link/get(test)/list/delete + providers (env/file/exec/1Password/Bitwarden/Vaultwarden/BWS) | both | app-bun `platform/config` SecretsManager (shared stores) | planned | gap: no wire method — Bun-side via SDK against shared `secrets.enc` |
| Keybindings editor (conflict detection, single source of truth for hints) | both+desktop | app-local `~/.goodvibes/app/keybindings.json` | planned | every displayed hint reads the registry |
| Profiles + profile-sync bundles | both | app-local | planned | |
| Settings import from tui/agent (preview→confirm, redacted) | agent | app-local bridge | planned | |
| Theme: dark default / light / density / reduced-motion | both | app-local (tokens) | planned | persisted; instant apply, no restart |
| Service registry inspect/test/doctor (`/services`) | tui | app-bun `platform/config` ServiceRegistry | planned | gap: no wire method — Bun-side via SDK |
| Storage posture (`/storage`) | tui | `settings.snapshot` + app-local | planned | |
| Daemon settings (host/port/TLS/trust-proxy) read+edit | tui | `config.get/.set` controlPlane.* | planned | edits flagged "requires daemon restart" honestly |
| App-own settings (window, launch-at-login posture, notifications) | new | app-local `~/.goodvibes/app/settings.json` | planned | |

## 20. Security & Auth

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Daemon token bootstrap (companion token, zero-friction) | both | app-bun `platform/pairing` `getOrCreateCompanionToken('app')` | planned | token injected by proxy; never enters webview |
| Username/password login + current principal | both | `control.auth.login`, `control.auth.current` | planned | |
| Local auth status + users create/delete | tui | `local_auth.status`, `local_auth.users.*` | planned | admin; deletes dangerous → confirm |
| Password rotate / session revoke / bootstrap-file clear | tui | `local_auth.users.password.rotate`, `.sessions.delete`, `.bootstrap.delete` | planned | |
| Security settings snapshot | both | `security.settings` | planned | |
| Permission mode + per-tool rules editor | both | `config.set permissions.*` | planned | prompt/allow-all/custom with per-tool allow/prompt/deny |
| Approval decision history (audit trail) | both | `approvals.list` history + `permissions` domain log | planned | |
| OS service: install/start/stop/restart/uninstall/status | tui | `services.*` | planned | systemd user unit over the wire; uninstall dangerous |
| TLS / network posture display | tui | `settings.snapshot` | planned | |

## 21. Remote / Peers

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Remote snapshot | tui | `remote.snapshot` | planned | |
| Peers: list / invoke / disconnect / token rotate / revoke | tui | `remote.peers.*` | planned | admin-gated, invoke confirm |
| Pair requests: list / approve / reject | tui | `remote.pair.*` requests methods | planned | |
| Work queue: list / cancel | tui | `remote.work.*` | planned | |
| Node-host contract inspection | tui | `remote.node_host.contract` | planned | |
| Web-push subscriptions manage (for PWA companions) | both | `push.vapid.get`, `push.subscriptions.*` [ws] | planned | app itself uses native notifications |

## 22. Onboarding (zero-friction first run)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Daemon detect → adopt-or-spawn (status probe + version band) | both | app-bun spawn `goodvibes-daemon` (from @pellux/goodvibes-tui dep) + `GET /status` | planned | lands in a working chat with zero setup when possible |
| Token provisioning (automatic) | both | app-bun `platform/pairing` | planned | no manual token paste on happy path |
| Provider key entry / detection (env inventory) | both | app-bun env scan + `config.set` / secrets | planned | shows which keys already present |
| Default model pick (+ effort) | both | catalog + `config.set` | planned | |
| Permissions posture pick | both | `config.set permissions.mode` | planned | |
| Doctor (gtk/webkit deps, daemon reachable, token valid, provider sane) | both | app-local checks + `health.snapshot` | planned | every failure has a next action |
| Welcome tour + first-run cards | desktop | app-local | planned | rendered, dismissible, never blocks |
| Import from existing tui/agent installs | agent | app-local bridge | planned | detects `~/.goodvibes/{tui,agent}` |
| QR pairing display for mobile companions | both | app-local QR render | planned | |

## 23. Command Palette & Keyboard

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Command palette (⌘/Ctrl+K, fuzzy, every action registered) | both+desktop | app-local registry | planned | actions-first navigation; nothing exists outside the registry |
| Chord hotkeys (`g c` style) + customizable bindings | both | app-local + keybindings registry | planned | conflict detection |
| Shortcut cheatsheet overlay | both | app-local (reads registry — never hardcoded) | planned | |
| Quick switcher (sessions/chats/views) | desktop | app-local | planned | |
| Global focus management + focus traps in modals | both | app-local | planned | |
| ARIA announcer wired to real events | both | app-local | planned | desktop audit: useAnnounce had zero callers — ours must announce |
| Reduced-motion support | both | app-local tokens | planned | |
| Keyboard shortcuts work regardless of focused pane | desktop-audit | app-local (explicit terminal-focus escape hatch) | planned | fixes desktop audit theme 2 |

## 24. Notifications & Tray

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Native desktop notifications (approvals, turn complete, task done, long-turn) | both | domains (`permissions`/`tasks`/`turn`) + RPC notification | planned | metadata-only content, deep-link to view |
| Tray icon: status + quick actions (show/hide, new chat, pause notifications) | new | Electrobun Tray | planned | window close ≠ app quit when tray enabled |
| Notification routing prefs (quiet-while-typing, batching, per-domain verbosity) | tui | app-local | planned | |
| ntfy/webhook outbound notify config | tui | config + channels | planned | |

---

## 25. Deliberate exclusions & honest gaps

Rows here are **excluded from v1 scope with justification** or carry a named upstream gap. Everything else above must reach `wired`/`verified`.

| Item | Reason |
|---|---|
| TUI panel/layout commands (`/panel open|split|width|…`, Alt+1..9 terminal tabs) | Terminal-specific layout system; the GUI has its own IA (sidebar/views/peek), which covers the same content surfaces. |
| Alt-screen / `--no-alt-screen`, raw-ANSI renderer options, bracketed-paste/kill-ring internals | Terminal rendering mechanics; GUI composer implements equivalent behaviors natively. |
| Shell completions, `goodvibes run/exec` print modes, CLI flag surface | CLI-specific; the daemon `tasks.create` covers scripted execution, and the TUI remains available for terminal workflows. |
| Plugin runtime hosting (registerCommand/registerTool/registerProvider…), marketplace install/publish | Plugin API is TUI-process-local with no wire methods. gap: no wire method — v1 shows `plugins` domain events read-only; MCP is the app's extension path. Revisit if the SDK exposes plugin management. |
| Eval harness (`/eval`), deterministic replay (`/replay`), incident/forensics bundles | TUI-process engines, no wire methods. gap: no wire method — telemetry errors/traces views cover the observability need; exclude authoring. |
| QEMU sandbox bootstrap / guest-bundle management | No wire methods; deep host mutation. App shows sandbox posture read-only from `settings.snapshot`. |
| LSP/tree-sitter intelligence control room detail (server mgmt, per-language ops) | Engine-internal; only `intelligence.snapshot` exists on the wire. Read-only tile ships. |
| Fleet interrupt/kill/pause/resume of in-process agents | gap: no wire method (only steer/detach/watcher-stop/task-cancel are wire-backed). Ship honest capability notes like webui; upstream contract request noted. |
| Companion-chat compaction (`/compact` semantics) | Orchestrator-local, not on the companion wire. App manages long chats via history windowing + "start fresh with summary" (app-local), labeled as such. |
| Prompt-context receipts (agent) | Receipts are produced by the agent's local prompt builder; companion-chat prompts are daemon-internal. Excluded until the wire exposes them. |
| ACP (Agent Client Protocol) delegate management | Engine-internal delegation plumbing; invisible to end users. |
| Cloudflare batch/tunnel/teleport bundles, `/bootstrap`, runner-pool authoring | Config keys shown in Settings; dedicated flows excluded v1 (deep infra workflows, low GUI value now). Remote peers view covers inspection. |
| `goodvibes://` deep links on Linux | Electrobun `urlSchemes` is macOS-only today. In-app deep links (palette + internal routes) ship; OS-level scheme registration deferred. |
| Hosting inbound channel webhooks in-app | The daemon owns listener ports (3421/3422); app controls and observes via `channels.*`/`watchers.*` — correct architecture, not a gap. |
| Home Assistant Assist conversation proxy endpoints | HA-device-facing routes (`/api/homeassistant/conversation*`); app covers the home-graph + channel surfaces instead. |
| Model benchmarks store authoring (`benchmarks.json`) | Display tiers from catalog; authoring benchmarks stays tui-side. |
| Peer-mode execution (app as work-pulling peer via peer-sdk) | The app is an operator surface; executing daemon work is the TUI/node-host role. |

**Cross-cutting upstream gaps to re-probe at runtime** (capability-probe via `control.methods.get`, degrade honestly): `sessions.search`/`fleet.*`/`checkpoints.*`/`push.*` are WS-only `[ws]`; agent-scoped knowledge routes (`/api/goodvibes-agent/knowledge/*`) may be absent on older daemons; no wire events exist for fleet/checkpoints/memory/calendar (poll + refetch-on-mutation).

---

### Row counts

| § | Surface | Rows |
|---|---|---|
| 1 | Chat | 44 |
| 2 | Sessions | 12 |
| 3 | Fleet | 12 |
| 4 | Approvals & Tasks | 9 |
| 5 | Automation | 12 |
| 6 | Knowledge | 25 |
| 7 | Memory | 9 |
| 8 | Agent Brain | 14 |
| 9 | Personal Ops | 9 |
| 10 | Research | 7 |
| 11 | Documents & Compare | 9 |
| 12 | Artifacts | 7 |
| 13 | Channels | 15 |
| 14 | Providers & Models | 13 |
| 15 | Coding / Dev | 12 |
| 16 | MCP | 7 |
| 17 | Observability | 18 |
| 18 | Voice & Media | 9 |
| 19 | Settings & Config | 12 |
| 20 | Security & Auth | 9 |
| 21 | Remote / Peers | 6 |
| 22 | Onboarding | 9 |
| 23 | Palette & Keyboard | 8 |
| 24 | Notifications & Tray | 4 |
| — | **Total planned rows** | **291** |
| 25 | Exclusions & gaps | 17 |
