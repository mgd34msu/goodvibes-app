# goodvibes-app: feature parity matrix

**This file is the completion bar.** Every user-facing capability of goodvibes-tui v1.10 and goodvibes-agent v1.6, plus every app-original capability added since, appears below, mapped to the app surface that owns it and the exact backing that implements it.

**How to read:**
- **Source.** Where the feature comes from, one of `tui`, `agent`, `both`, `desktop` (goodvibes-desktop prior art worth carrying), or `new` (app-original).
- **Backing.** What implements it, one of an operator method id (e.g. `sessions.steer`), an SSE **domain** (e.g. `turn` events), `app-local` (implemented in this repo, covering UI state, file registries, Bun main process), `app-bun:<sdk subpath>` (Bun main process importing a Bun-only SDK platform subpath), or `RPC` (Electrobun native bridge, covering dialogs/tray/clipboard/notifications/PTY/shell).
- **Status.** `shipped` (wired end-to-end, cited evidence in `docs/GAPS.md`), `partial` (part of the row exists, the rest doesn't, both halves cited in `docs/GAPS.md`), or `excluded` (moved to §25 with justification). No row is left at a `planned`-only state in this file; `docs/GAPS.md` is the row-by-row audit that keeps this column honest.
- `[ws]`: WS-only `call` transport method (no HTTP path); reach it over the daemon WebSocket or note the degradation.

---

## 1. Chat (companion chat, the primary surface)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Chat session list (sidebar, warm-start cache) | both | `companion.chat.sessions.list` | shipped | localStorage warm-start per webui pattern |
| Create chat session | both | `companion.chat.sessions.create` | shipped | provider+model selectable at create |
| Rename / auto-title | both | `companion.chat.sessions.update` | shipped | auto-title after first exchange (webui pattern) |
| Close / delete chat (proof-of-gone reconcile) | both | `companion.chat.sessions.close` / `.delete` | shipped | delete-means-delete reconcile from webui |
| Send message (optimistic local/sent/failed states) | both | `companion.chat.messages.create` | shipped | never `sessions.messages.create` as fallback (webui architecture.md rule) |
| Streaming assistant reply | both | `companion.chat.events.stream` (SSE per-session) | shipped | delta/completed/error frames |
| Edit-and-branch with lineage | both | `companion.chat.messages.edit` | shipped | superseded-lineage UI (webui `lineage.ts`) |
| Retry / regenerate | both | `companion.chat.messages.retry` | shipped | |
| Message history load | both | `companion.chat.messages.list` | shipped | |
| Attachments: drag-drop / paste-image / file picker | both | `artifacts.create` + message `attachments[]` | shipped | upload first, then reference by artifactId |
| Per-session provider/model picker in composer | both | `providers.list` + session update | shipped | provider-first, model-second |
| Reasoning effort selector | both | session/config (`provider.reasoningEffort`) | shipped | instant/low/medium/high |
| Markdown rendering (GFM, tolerant tables) | both | app-local (react-markdown + remark-gfm) | shipped | |
| Syntax highlighting + line-number modes (off/code/all) | tui | app-local (highlight.js) | shipped | line numbers UI-only, never copied |
| Collapsible blocks + auto-collapse threshold | tui | app-local | shipped | threshold configurable (`display.collapseThreshold`) |
| Inline diff rendering in transcript | tui | app-local | shipped | |
| Block copy / save to file | tui | app-local + RPC (clipboard, save dialog) | shipped | |
| Bookmarks (add/list/jump) | both | app-local store (`~/.goodvibes/app/bookmarks.json`) | shipped | |
| Conversation search (Ctrl+F, n/N, wrap marker) | tui | app-local | shipped | |
| Next/prev error jump | both | app-local (scan transcript for error blocks) | shipped | |
| Thinking display + live token strip | tui | stream events + app-local render | shipped | tokens/sec optional (`display.showTokenSpeed`) |
| Context usage meter | both | usage fields on stream/turn events + app-local | shipped | fresh-input vs cached-context split where reported |
| Chat search (across sessions) | both | `sessions.search` [ws] + client-side message search | shipped | degrade to client-side if WS unavailable |
| Slash-command hints in composer | both | app-local command registry | shipped | GUI-native: palette-backed autocomplete |
| `@` file reference picker | both | app-local + RPC (file dialog) + workspace glob | shipped | |
| Multi-line composer, grows with content | both | app-local | shipped | Shift+Enter newline, Enter send |
| Paste normalization (big paste → chip) | tui | app-local | shipped | >8 lines collapses to a paste chip |
| Input history + reverse search (Ctrl+R) | both | app-local (`~/.goodvibes/app/input-history.json`) | shipped | |
| Prompt undo/redo | both | app-local | shipped | |
| Conversation clear / reset | both | new session + archive | shipped | GUI semantic: new chat |
| Notes: `/note`, `/keep` (session → durable memory) | both | `memory.records.add` | shipped | scope=session, promote flow |
| Export transcript (md/json/html) | both | app-local render from `companion.chat.messages.list` | shipped | |
| Share with `--redact` | tui | app-local (secret-shaped masking before export) | shipped | reuse config-redaction patterns |
| Templates (prompt templates) | tui | app-local store | shipped | |
| Image attach (`/image`, Ctrl+V) | both | `artifacts.create` + attachments | shipped | |
| Image generation (`/imagine`) | both | `media.generate` → artifact preview | shipped | |
| Voice dictation (mic → composer) | both | `voice.stt` | shipped | webview `getUserMedia` OK on loopback origin |
| Speak-aloud replies (TTS) + always-speak toggle | both | `voice.tts.stream` + `ui.voiceEnabled` config | shipped | native audio via Web Audio |
| Turn cancel (stop button) | both | stream cancel + `sessions.inputs.cancel` where applicable | shipped | never a silent kill; confirm on busy |
| Conversation branches (fork a chat) | tui | app-local: create session + replay seed from history | shipped | wire fork doesn't exist for companion chat; honest "forked from" marker |
| Long-turn desktop notification | both | stream timing + RPC (native notification) | shipped | `behavior.notifyAfterSeconds` |

## 2. Sessions (operator sessions union, all surfaces)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Cross-surface session union list | both | `sessions.list` | shipped | tui/agent/webui/app kinds, 50-row cap disclosed |
| Session detail + message transcript | both | `sessions.get`, `sessions.messages.list` | shipped | |
| Search sessions | both | `sessions.search` [ws] | shipped | |
| Steer a live session | both | `sessions.steer` | shipped | SteerComposer pattern |
| Follow-up on completed session | both | `sessions.followUp` | shipped | |
| Input queue: list / deliver / cancel | both | `sessions.inputs.list/.deliver/.cancel` | shipped | |
| Close / reopen / delete | both | `sessions.close/.reopen/.delete` | shipped | destructive = native confirm dialog |
| Detach | both | `sessions.detach` | shipped | detach never kills |
| Live session updates | both | `session-update` wire event (raw SSE) + `session` domain | shipped | webui two-stream pattern |
| Create operator session | both | `sessions.create` | shipped | |
| Session export | both | app-local from messages | shipped | |
| Session integration snapshot | tui | `sessions.integration.snapshot` | shipped | diagnostics panel |
| Hosted-session tab (separate from the operator union) | new | app-local tab over `sessions.hosted.*` | shipped | a hosted session REGISTERS on this daemon rather than merely appearing in the cross-surface list above; URL-addressable via `?filter[stab]=hosted` |
| Hosted session list (live) | new | `sessions.hosted.list` [ws] | shipped | |
| Hosted session create | new | `sessions.hosted.create` [ws] | shipped | |
| Hosted session full attach (transcript + live turn/tool frames) | new | `sessions.hosted.attach` [ws] | shipped | a superseded attach response is dropped against the current selection |
| Hosted session detach / kill (confirmation-gated) | new | `sessions.hosted.detach` / `.kill` [ws] | shipped | detach confirmation states what leaving now does for other attached clients |

## 3. Fleet (live control room)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Live process tree (agents/WRFC/workflows/watchers/schedules/code-index) | tui | `fleet.snapshot` / `fleet.list` [ws] | shipped | flat parentId → tree; poll + `agents`/`workflows`/`tasks` domain invalidation |
| Node detail: transcript / usage / cost | tui | `sessions.messages.list` + `agents` domain events | shipped | |
| Steer agent | tui | `sessions.steer` | shipped | |
| Detach (never kills) | tui | `sessions.detach` | shipped | |
| Watcher start/stop/run from fleet | tui | `watchers.start/.stop/.run` | shipped | |
| Task cancel/retry from fleet | tui | `tasks.cancel/.retry` | shipped | where node maps to a task |
| Interrupt / kill / pause / resume of agents | tui | `sessions.inputs.cancel` / `.close` / `.detach` / `.reopen` (composed) | shipped | no single wire verb exists for any of the four; the panel composes them from session verbs and states outright that nothing here is ever labeled "Pause," since no freeze-and-thaw verb exists |
| Inline approval cards on correlated nodes | tui | `approvals.list` + `permissions` domain | shipped | |
| Workstream view (phases / work-items) | tui | `fleet.snapshot` filtered to workstream kinds | shipped | usage/cost where reported |
| WRFC chain badges (`c:N/M`, SAT/UNS/UNV) | tui | fleet node metadata + `workflows` domain | shipped | render what the wire reports; no fabrication |
| Worktree detail per agent | tui | `worktrees.snapshot` | shipped | |
| Deep links into fleet nodes | tui | app-local routing | shipped | |

## 4. Approvals & tasks (human-in-the-loop)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Pending / claimed / history list | both | `approvals.list` + `permissions` domain | shipped | category × risk matrix |
| Approve (whole) | both | `approvals.approve` | shipped | |
| Per-hunk edit approval | both | `approvals.approve({selectedHunks})` | shipped | hunk-picker UI (webui pattern) |
| Deny with note / claim / cancel | both | `approvals.deny/.claim/.cancel` | shipped | |
| Approval desktop notification + palette jump | new | `permissions` domain + RPC notification | shipped | the "answer from anywhere" flow |
| Task list / detail | both | `tasks.list/.get/.status` | shipped | verbatim statuses |
| Create fire-and-forget task | both | `tasks.create` | shipped | POST /task semantics |
| Cancel / retry task | both | `tasks.cancel/.retry` | shipped | |
| Realtime task updates | both | `tasks` domain | shipped | |

## 5. Automation (jobs, schedules, watchers, hooks)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Integration snapshot dashboard | tui | `automation.integration.snapshot` | shipped | |
| Jobs: list/create/update/delete/enable/disable/run | both | `automation.jobs.*` | shipped | delete is dangerous-flagged → confirm |
| Schedules: list/create/delete/enable/disable/run | both | `automation.schedules.*` | shipped | kinds `cron\|every\|at`, IANA timezones |
| Cron editor with human preview + next-run times | new | app-local UI over schedules | shipped | zero-friction cron authoring |
| Runs: list/get/cancel/retry | both | `automation.runs.*` | shipped | run history with outcomes |
| Heartbeat: list/run | tui | `automation.heartbeat.*` | shipped | |
| Watchers: list/create/update/delete/start/stop/run | both | `watchers.*` | shipped | admin-scoped; webhook/email/event triggers |
| Delivery targets on schedules (16 surface kinds) | agent | schedule payload fields | shipped | slack/discord/telegram/…/webhook |
| Reminders (one-shot `at` schedules) | agent | `automation.schedules.create` kind=at | shipped | Personal Ops integration |
| Hooks file editor (`.goodvibes/hooks.json`) | tui | app-local file editor + schema validation | shipped | gap: no wire method, app-local editor with event-path/type reference docs |
| Workflow runs visibility (wrfc/fix_loop/…) | tui | `workflows` domain + fleet | shipped | read-only; execution stays daemon/tui-side |
| Scheduler capacity | tui | `scheduler.capacity` | shipped | observability hub tile |

## 6. Knowledge (wiki + graph + ingestion + planning)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Status dashboard | both | `knowledge.status` | shipped | |
| Ask (grounded answer) | both | `knowledge.ask` | shipped | markdown answers with citations |
| Search | both | `knowledge.search` | shipped | |
| Map (graph view) | both | `knowledge.map` | shipped | interactive graph, GUI-native win |
| Nodes list / item detail | both | `knowledge.nodes.list`, `knowledge.item.get` | shipped | |
| Packet build (task-time injection preview) | both | `knowledge.packet` | shipped | explainability: why each item |
| Lint / reindex | both | `knowledge.lint`, `knowledge.reindex` | shipped | reindex admin-gated |
| Ingest URL / URLs / artifact | both | `knowledge.ingest.url/.urls/.artifact` | shipped | |
| Import bookmarks / browser history / connector | both | `knowledge.ingest.bookmarks/.browserHistory/.connector` | shipped | file pickers via RPC |
| Sources list/get + health | both | `knowledge.sources.*` | shipped | |
| Extractions / candidates review (decide) | both | `knowledge.extractions.*`, `knowledge.candidates.*` | shipped | consolidation review UI |
| Issues list / review | both | `knowledge.issues.*` | shipped | |
| Reports / usage | both | `knowledge.reports.*`, `knowledge.usage.*` | shipped | |
| Jobs: list/get/run + job-runs | both | `knowledge.jobs.*` | shipped | lint/reindex/refresh-stale/consolidation jobs |
| Schedules: list/get/save/enable/delete | both | `knowledge.schedules.*` | shipped | |
| Projections: list/render/materialize | both | `knowledge.projections.*` | shipped | wiki/markdown projections viewer |
| Refinement: run + tasks list/get/cancel | both | `knowledge.refinement.*` | shipped | |
| Connectors: list/get/doctor | both | `knowledge.connectors.*` | shipped | |
| GraphQL console (query + schema) | tui | `knowledge.graphql.execute/.schema` | shipped | power-user console with schema explorer |
| Agent-scoped knowledge (isolated store) | agent | `/api/goodvibes-agent/knowledge/*` routes | shipped | capability-probe at runtime; scope switcher in Knowledge view |
| Home-graph: ask/browse/map/sync/import/export/ingest/link | tui | `homeassistant.homeGraph.*` (~25) | shipped | shown when HA surface configured |
| Home-graph facts review / device passport / room page / reset | tui | `homeassistant.homeGraph.*` | shipped | reset is dangerous → confirm |
| Project planning: status/state/language/decisions/evaluate | tui | `projectPlanning.*` | shipped | decision records timeline |
| Work plan: snapshot + tasks CRUD/status/reorder/clearCompleted | both | `projectPlanning.workPlan.*` | shipped | kanban-ish checklist UI |
| Knowledge realtime updates | both | `knowledge` domain | shipped | invalidation only |

## 7. Memory (canonical cross-surface store)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Records: add/get/list/update/delete | both | `memory.records.*` | shipped | classes: decision/constraint/incident/pattern/fact/risk/runbook/architecture/ownership |
| Literal + semantic search (recall-honesty note) | both | `memory.records.search/.search-semantic` | shipped | honest note about which index answered |
| Review queue + update-review | both | `memory.review-queue`, `memory.records.update-review` | shipped | fresh/reviewed/stale/contradicted states |
| Links: add/list (record graph) | both | `memory.links.*` | shipped | |
| Import / export (handoff bundles) | both | `memory.records.import/.export` | shipped | |
| Vector stats / rebuild | both | `memory.vector.stats/.rebuild` | shipped | rebuild admin-gated |
| Embedding provider doctor + default set | both | `memory.doctor`, `memory.embeddings.default.set` | shipped | |
| Scope + confidence faceting (session/project/team) | both | list filters + app-local facets | shipped | |
| Promote note → durable memory | both | `memory.records.add` + review flow | shipped | |

## 8. Agent brain (routines, personas, skills, profiles, VIBE)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Routines: create/edit/enable/list/delete | agent | app-local registry `~/.goodvibes/app/routines.json` | shipped | same record shape as agent (name/steps/triggers/tags/requirements/reviewState/startCount) |
| Start routine in chat (prints steps, bumps count) | agent | app-local + chat composer injection | shipped | |
| Promote routine → daemon schedule (confirm-gated) | agent | `automation.schedules.create` | shipped | redacted local receipt |
| Personas: create/inspect/activate/review/delete | agent | app-local registry | shipped | |
| Persona discovery/import from VIBE.md | agent | app-local | shipped | |
| Skills: create/import/enable/disable/review/bundles | agent | app-local registry (standard format + readiness checks) | shipped | |
| Profiles: named isolated app homes + starter templates | agent | app-local (`GOODVIBES_APP_HOME`-style roots) | shipped | isolates config/sessions/registries |
| VIBE.md personality editor (real disk writes) | agent | app-local file editor + secret scan | shipped | the anti-desktop-lie row: writes to disk, shows blocked/truncated states |
| Project context file inspection (CLAUDE.md, AGENTS.md, .cursorrules, …) | agent | app-local discovery + viewer | shipped | secret-scanned, read-only inspect |
| Import registries/settings from `~/.goodvibes/agent` + `~/.goodvibes/tui` | agent | app-local bridge (preview → confirm, redacted, source never mutated) | shipped | routines/personas/skills/notes/VIBE + provider/UI/permission settings |
| Scratchpad notes + promote flows | agent | app-local notes registry + `memory.records.add` | shipped | |
| Learning review (stale/low-confidence/duplicates) | agent | `memory.review-queue` + `knowledge.candidates.*` UI | shipped | curator logic reimagined over wire review surfaces |
| Away digest ("while you were away") | agent | `automation.runs.list` + `tasks.list` + `deliveries.list` since lastSeen | shipped | lastSeen store app-local |
| Coming-up rail (next runs + calendar) | agent | schedules `nextRunAt` + `calendar.events.list` | shipped | 60s cache, silent-failure |

## 9. Personal Ops

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Daily briefing (inbox/agenda/tasks/reminders/deliveries) | agent | `email.inbox.list` + `calendar.events.list` + `tasks.list` + `automation.schedules.list` + `deliveries.list` | shipped | composed dashboard, honest per-source degradation |
| Email inbox list / read | agent | `email.inbox.list/.read` | shipped | 412-unconfigured vs error taxonomy |
| Email draft (confirm-gated) | agent | `email.draft.create` | shipped | dangerous-flagged |
| Email send (confirm-gated) | agent | `email.send` | shipped | dangerous-flagged, explicit confirm |
| Calendar windowed list + event peek | agent | `calendar.events.list/.get` | shipped | |
| Calendar create (admin) | agent | `calendar.events.create` | shipped | |
| ICS import / export | agent | `calendar.ics.import/.export` | shipped | file dialogs via RPC |
| Unified inbox (channels + email merged) | agent | `channels.inbox.list` + `email.inbox.list` | shipped | triage decorations preserved |
| Reminders | agent | `automation.schedules.create` (kind=at) | shipped | |

## 9b. Dates (occasions, gift interviews, plans)

The occasions domain, top-level view `dates` (Assistant group). Every write lands as one
line in the owner profile and goes through that file's write gate, so `confirm` takes
surface + a verbatim `said` + authority exactly as `profile.set/append` do.

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Important dates list with countdown | agent | `occasions.list` | shipped | the one verb that carries dates; `daysUntil`/`inLeadWindow` are read, never recomputed (the daemon owns `daemon.timezone`) |
| Add a date: preview then confirm | agent | `occasions.propose` → `occasions.confirm` | shipped | propose writes nothing; kind is required and never inferred (`needsKind`); preview freshness is derived from the draft |
| Remove a date | agent | `occasions.remove` | shipped | daemon's own two-step: `confirmed:false` returns the sentence, which becomes the confirm sheet's blast radius; dangerous |
| Answer an occurrence (yes / no / later) | agent | `occasions.answer` | shipped | a yes on a gift-giving occasion returns the interview's first question inline |
| Acknowledge ("I have this in hand") | agent | `occasions.acknowledge` | shipped | not a yes and not a no: the item stays open and enumerable, only the push stops; the daemon's reply is rendered verbatim |
| Gift interview: resume, answer, record | agent | `occasions.interview.get/.answer/.record` | shipped | conversational card flow; `complete` and `nextStep` are read together, since every question answered still leaves `complete:false` until the outcome is recorded |
| Gift history peek | agent | `occasions.gifts` | shipped | read-only; a record is written only by closing an interview |
| Outstanding items, pulled not pushed | agent | `occasions.pending` | shipped | nudge + conflicts + mid-thread interviews; carries the person and a proximity word, never a date |
| Date conflicts | agent | `occasions.list` conflicts + `occasions.conflict.resolve` | shipped | never resolved automatically; `resolved:false` means nothing was being raised, reported as that and not as a failure |
| Plans (ambient dated ranges) | agent | `occasions.plans.list/.propose/.confirm` | shipped | never prompts; `away` is opt-in, never assumed |
| Approach sweep on demand | agent | `occasions.sweep` | shipped | `hold:"quiet-hours"` / `hold:"disabled"` named against `occasions.activeHours` / `occasions.enabled`; per-destination delivery results |
| Store state disclosure | agent | `occasions.state` | shipped | counts and reasons only, no answer/gift/date/name; the one part of the view safe in a support bundle |

## 9c. Payments (cards, budget, checkout, purchase ledger)

Top-level view `payments` (Assistant group). All seven payments verbs are wired
end-to-end on the app side; the shipped daemon composition attaches no handler for any
of them today, so every call answers `501` regardless of `payments.enabled`. That is a
daemon-side gap, not an app-side one: the UI names the composition rather than pointing
at a setting that does not work.

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Budget status | new | `payments.budget.status` | shipped (app-side; daemon 501 today) | |
| Cards: list / create / delete | new | `payments.cards.list/.create/.delete` | shipped (app-side; daemon 501 today) | concealed inputs, no `<form>` element, no `name` attributes |
| Checkout: begin / fill card | new | `payments.checkout.begin/.fillCard` | shipped (app-side; daemon 501 today) | plain async submit, not a mutation, so a card draft never persists in query-client state |
| Purchase ledger | new | `payments.purchases.list` | shipped (app-side; daemon 501 today) | |
| Card-intake draft hygiene | new | app-local | shipped | drafts clear on submit, cancel, unmount, and the moment the intake form stops rendering; enforced as tests |
| Card-entry eligibility gate | new | app-local mirror of the SDK's surface allowlist | shipped | a test pins the mirror to the real gate |
| Money handling (no float currency math) | new | app-local | shipped | amounts never touch floats; a `null` currency renders as labeled minor units, never an invented dollar amount |

## 10. Research

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Web search (ranked, source-labeled) | both | `web_search.query` | shipped | |
| Search provider list/status | both | `web_search.providers.list` | shipped | 7 providers, keyless default |
| Research runs (visible, checkpointable, log tails) | agent | app-local run registry + `tasks.create` + `web_search.query` | shipped | every run has status/cancel routes |
| Source triage + credibility scoring | agent | app-local registry | shipped | reviewed-source bundles |
| Sourced report artifacts (citation coverage, source maps) | agent | app-local compose + `artifacts.create` | shipped | |
| Promote research → Knowledge | agent | `knowledge.ingest.url/.artifact` | shipped | explicit, confirm-gated |
| URL inspection (read-only fetch preview) | agent | app-bun fetch + app-local viewer | shipped | config-gated for private hosts |

## 11. Documents & compare

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Versioned markdown drafts | agent | app-local document registry + `artifacts.create` | shipped | |
| Review comments + AI suggestion accept/reject | agent | app-local + companion chat turns | shipped | |
| Uploads / exports | agent | `artifacts.*` + RPC file dialogs | shipped | |
| Review packets: wizard + presets + freshness check | agent | app-local | shipped | 6-step wizard, reusable presets |
| Reviewer handoff ZIP archives | agent | app-local (Bun zip) | shipped | |
| Share packet via channel (confirm-gated) | agent | `channels.actions.invoke` | shipped | |
| Blind model comparison (delayed reveal) | agent | parallel `companion.chat.sessions.create` with different models | shipped | judgment artifacts stored app-local + `artifacts.create` |
| Preference analytics / synthesis | agent | app-local store | shipped | |
| Winner → model route update (confirm-gated) | agent | `config.set` model routes | shipped | |

## 12. Artifacts

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| List / browse | both | `artifacts.list` | shipped | type facets (md/json/csv/pdf/image/audio/video) |
| Detail + content fetch | both | `artifacts.get`, `artifacts.content.get` | shipped | |
| Preview: markdown/code/image/audio/video/PDF | both | app-local viewers | shipped | GUI-native win over TUI |
| Upload / create | both | `artifacts.create` | shipped | drag-drop anywhere |
| Export / package / archive | both | app-local + RPC save dialogs | shipped | |
| Promote artifact → Knowledge | both | `knowledge.ingest.artifact` | shipped | |
| Per-message artifacts slide-over in chat | both | app-local extraction + attachments | shipped | webui ArtifactsPanel pattern |

## 13. Channels (omnichannel)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Status overview (all 17 surfaces) | both | `channels.status` | shipped | tui/web/slack/discord/ntfy/webhook/HA/telegram/google-chat/signal/whatsapp/telephony/imessage/msteams/bluebubbles/mattermost/matrix |
| Lifecycle / setup guide / doctor / repairs | both | `channels.lifecycle.get`, `.setup.get`, `.doctor.get`, `.repairs.list` | shipped | ordered setup guide (agent pattern) |
| Inbox (triage-decorated) | both | `channels.inbox.list` | shipped | |
| Accounts: list / per-surface / get + actions | both | `channels.accounts.*` | shipped | admin-gated actions |
| Actions: list / invoke (confirmed sends) | both | `channels.actions.*` | shipped | confirm + explicitUserRequest |
| Agent tools + tools list / invoke | both | `channels.agent_tools.*`, `channels.tools.*` | shipped | |
| Capabilities / directory query | both | `channels.capabilities.*`, `channels.directory.query` | shipped | |
| Allowlist edit / resolve; authorize; target resolve | both | `channels.allowlist.*`, `.authorize`, `.targets.resolve` | shipped | admin |
| Policies: list / audit / update | both | `channels.policies.*` | shipped | |
| Drafts: list/get/save/delete | both | `channels.drafts.*` | shipped | dangerous-flagged saves → confirm |
| Routing: list / assign / delete | both | `channels.routing.*` | shipped | |
| Delivery receipts (redacted) + dead-letter states | both | `deliveries.list/.get` | shipped | last-error surfaced |
| Companion pairing (QR) | both | app-bun `platform/pairing` payload + app-local QR render | shipped | pair phones/companions to the daemon |
| Notification targets (ntfy/webhook) manage + test | both | config + `channels.actions.invoke` test | shipped | |
| Realtime channel events | both | `communication` + `deliveries` domains | shipped | |

## 14. Providers & models

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Provider list + auth-freshness status | both | `providers.list` + derived status | shipped | webui provider-status.ts pattern |
| Provider detail + usage | both | `providers.get`, `providers.usage.get` | shipped | |
| Accounts snapshot (route posture, fallback risk) | tui | `accounts.snapshot` | shipped | |
| Model workspace: multi-target routes (main/helper/tool/tts/embeddings) | both | `config.get/.set` + `providers.list` | shipped | provider-first picker, tier badges, search/price filters |
| Model catalog (models.dev, 4000+ models, tiers) | tui | app-bun catalog fetch (24h TTL) shared-store | shipped | reuse `~/.goodvibes/tui/model-catalog.json` conventions |
| Synthetic failover posture display | tui | `providers.list` + config | shipped | display-only; failover runs daemon-side |
| Credential status (secret-free) | both | `credentials.get` (`config.credentials.get`) | shipped | |
| Custom provider JSON management | tui | app-local editor over `~/.goodvibes/tui/providers/*.json` | shipped | shared store, hot-reloaded by daemon host |
| Local LLM server scan (opt-in, never silent) | both | app-bun `@pellux/goodvibes-sdk/platform/discovery` | shipped | Ollama/LM Studio/vLLM/llama.cpp/… |
| Refresh models | both | app-bun catalog refresh | shipped | |
| Subscriptions status (OAuth-backed) | both | config + `settings.snapshot` | shipped | OAuth flows open external browser via RPC |
| Reasoning effort defaults | both | `config.set provider.reasoningEffort` | shipped | |
| Pin/unpin favorite models | both | app-local favorites (shared-store conventions) | shipped | |

## 15. Coding / dev

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Git panel: status/log/stage/unstage/commit | tui+desktop | app-bun git CLI via RPC | shipped | |
| Branches: list/create/checkout with dirty-tree guard | desktop | app-bun git | shipped | explain-and-confirm modal, no force-push |
| Stash / tags / remotes / reflog rescue | desktop | app-bun git | partial | stash push/pop/list shipped; tags/remotes/reflog are read-only panels; destructive local-git mutations (tag create/delete, remote add/remove, reflog reset-to-restore) are deliberately not wired, keeping the panel non-destructive |
| Diff viewer: working/staged/HEAD/arbitrary refs | both | app-bun git + app-local unified diff renderer | shipped | syntax-highlighted, side-by-side toggle |
| Worktrees: snapshot + list | tui | `worktrees.snapshot` + app-bun git | shipped | agent-worktree awareness from fleet |
| Checkpoints: create/list/diff/restore | both | `checkpoints.*` [ws] | shipped | restore is destructive → confirm; honest `noop:true` render |
| Embedded terminal tabs (PTY) | desktop | RPC + PTY in Bun main (bun-pty or `script(1)` wrapper) | shipped | exit codes always surfaced; confirm on busy close; scrollback preserved on view switch |
| Intelligence snapshot (LSP/tree-sitter posture) | tui | `intelligence.snapshot` | shipped | read-only; full control room excluded (§25) |
| Repo file browser + preview | desktop | app-bun fs via RPC | shipped | rendered-markdown toggle; delete requires confirm |
| Per-repo session table (sessions in this project) | desktop | `sessions.list` filtered by project | shipped | |
| GitHub: device-flow auth + PR/issue list/create | desktop | app-bun GitHub REST (bundled device-flow client id) | shipped | zero-setup; degrade honestly when offline/unauthed |
| Review snapshot | tui | `review.snapshot` | shipped | |

## 16. MCP

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Server list + status | both | `mcp.servers.list` | shipped | |
| Add / edit / remove servers | both | `mcp.servers.upsert/.remove` | shipped | admin-gated |
| Tool inventory (namespaced `mcp:<server>:<tool>`) | both | `mcp.tools.list` | shipped | |
| Config view + reload | both | `mcp.config.get`, `mcp.config.reload` | shipped | |
| Trust / role review | both | config keys + app-local review UI | shipped | |
| Sandbox isolation posture display | tui | `settings.snapshot` | shipped | read-only; QEMU bootstrap excluded (§25) |
| MCP realtime events | both | `mcp` domain | shipped | |

## 17. Observability (forefront requirement)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Telemetry dashboard (events, filters: domain/type/severity/trace/session/turn/agent/task) | tui | `telemetry.snapshot`, `telemetry.events.list` | shipped | |
| Error ledger | tui | `telemetry.errors.list` | shipped | |
| Traces browser | tui | `telemetry.traces.list` | shipped | |
| Metrics | tui | `telemetry.metrics.get` | shipped | |
| Live telemetry stream | tui | `telemetry.stream` | shipped | pausable live tail |
| Cost analytics: 4-bucket tokens, dated pricing, dedup, per-project/session/provider rollups | desktop+tui | `providers.usage.get` + telemetry + app-local engine | shipped | port desktop's praised semantics; frame all big numbers; "Ephemeral" bucket |
| Cost budget alert (`GOODVIBES_COST_BUDGET_USD`) | tui | config + app-local threshold alerts | shipped | |
| Token budget / context console | tui | usage events + app-local | shipped | |
| Health snapshot + repair guidance | both | `health.snapshot` | shipped | actionable cause/impact/next-action cards |
| Daemon control snapshot / connected clients / messages | tui | `control.snapshot/.clients.list/.messages.list` | shipped | |
| Routes snapshot + bindings CRUD | tui | `routes.*` | shipped | binding delete dangerous → confirm |
| Surfaces list | tui | `surfaces.list` | shipped | |
| Continuity snapshot | tui | `continuity.snapshot` | shipped | |
| Scheduler capacity | tui | `scheduler.capacity` | shipped | |
| Connection diagnostics (SSE state, latency, reconnects) | new | app-local (connector lifecycle hooks) | shipped | "live updates paused" banner + resume |
| Status strip: Reachable / Signed-in / Working + latency + active turns | both | app-local composite (webui daemon-health) | shipped | always visible, never lies |
| Contract explorer (method catalog + event catalog browser) | new | `control.contract`, `control.methods.list/.get`, `control.events.catalog` | shipped | observability-of-the-API; powers capability probes |
| Remote-open TUI panels | tui | `panels.list`, `panels.open` | shipped | delightful cross-surface trick |
| OTLP ingest endpoints info | tui | `telemetry.otlp.*` (display endpoints/status) | shipped | display-only |

## 18. Voice & media

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| TTS speak (one-shot) | both | `voice.tts` | shipped | |
| Streaming TTS (sentence-chunked live speech) | both | `voice.tts.stream` (raw binary) → Web Audio | shipped | replaces tui's mpv/ffplay with native audio |
| TTS speed / voice / provider settings | both | `voice.voices.list`, `voice.providers.list`, config `tts.*` | shipped | 0.25–4.0 speed |
| STT dictation | both | `voice.stt` | shipped | |
| Voice status / doctor | both | `voice.status` | shipped | honest unconfigured states |
| Realtime voice session (duplex) | both | `voice.realtime.session` | shipped | v1: session bootstrap + status; full duplex UI stretch |
| Media providers list | both | `media.providers.list` | shipped | |
| Media analyze / generate / transform | both | `media.analyze/.generate/.transform` | shipped | generation → artifact preview |
| Multimodal: status/providers/analyze/packet/writeback | tui | `multimodal.*` | shipped | writeback admin-gated |
| Wake-word provisioning + status | new | `voice.wake.status`, `voice.wake.provision` | shipped | |
| Wake-word detection host (confirm-gated toggle, live status, chime) | new | app-local host running the SDK's shared `WakeListener` | shipped | a wake chip joins the status strip |
| Same-origin wake-word model serving (local daemon) | new | `app-bun` `/app/wake/model/:component` | shipped | re-reads and re-hashes the file on every request; carries the served sha256 in a response header |
| Remote-daemon wake-word fallback | new | `voice.wake.model.get` (chunked) | shipped | honest `409 APP_WAKE_MODEL_REMOTE_DAEMON` refusal when the daemon isn't this machine, then falls back to the chunked verb |

## 19. Settings & Config (forefront requirement)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Full schema-driven settings workspace (all SDK config keys, categories, defaults diamond, live edit) | both | `config.get/.set` + `settings.snapshot` + app-bun `CONFIG_SCHEMA` from `platform/config` | shipped | one-key-at-a-time set; secret-shaped masking |
| Settings search (fuzzy, cross-category) | new | app-local | shipped | zero-friction: find any key in <2s |
| Feature flags | both | `config.set` flags | shipped | |
| Secrets manager: set/link/get(test)/list/delete + providers (env/file/exec/1Password/Bitwarden/Vaultwarden/BWS) | both | app-bun `platform/config` SecretsManager (shared stores) | shipped | gap: no wire method, Bun-side via SDK against shared `secrets.enc` |
| Keybindings editor (conflict detection, single source of truth for hints) | both+desktop | app-local `~/.goodvibes/app/keybindings.json` | shipped | every displayed hint reads the registry |
| Profiles + profile-sync bundles | both | app-local | shipped | |
| Settings import from tui/agent (preview→confirm, redacted) | agent | app-local bridge | shipped | |
| Theme: dark default / light / density / reduced-motion | both | app-local (tokens) | shipped | persisted; instant apply, no restart |
| Service registry inspect/test/doctor (`/services`) | tui | app-bun `platform/config` ServiceRegistry | shipped | gap: no wire method, Bun-side via SDK |
| Storage posture (`/storage`) | tui | `settings.snapshot` + app-local | shipped | |
| Daemon settings (host/port/TLS/trust-proxy) read+edit | tui | `config.get/.set` controlPlane.* | shipped | edits flagged "requires daemon restart" honestly |
| App-own settings (window, launch-at-login posture, notifications) | new | app-local `~/.goodvibes/app/settings.json` | shipped | |

## 19b. Devices (device-node hosting)

Devices tab in Settings. Covers the daemon's seven paired-device verbs: a paired phone
SERVES capabilities, and this desktop app CONSUMES them.

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Paired node list + live capability availability | new | `devices.nodes.list` | shipped | a web node and a native node are described identically on the wire |
| Capability request with in-app confirm gating | new | `devices.capability.request` | shipped | the confirmation prompt is driven by the app's own pinned capability catalog, never the wire's `effect` field |
| Durable grants: list + revoke | new | `devices.grants.list/.revoke` | shipped | |
| Housekeeping | new | `devices.housekeeping.run` | shipped | |
| Capture viewer (allowlisted render policy) | new | `devices.artifacts.list/.read` | shipped | a capture is only ever built with an allowlisted image media type; everything else downloads as `application/octet-stream`; `open_url` payloads are scheme-gated before the wire |
| Rewind hosting posture (honest subset) | new | `rewind.conversation.hosts.list` | shipped (posture-only, by design) | this app holds no conversation of its own, so it lists hosts and reports posture rather than registering as one; the register/release/request verbs are wired for a future surface that does hold messages |

## 19c. Owner profile

Owner profile tab in Settings, over the daemon's nine owner-profile verbs. One markdown
file the daemon keeps, holding what the platform knows about the owner, addressed as
mechanical fields (superseded and undoable) plus prose bullets (addressed by content,
never by position).

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Profile read (fields + prose + person summary) | new | `profile.read/.get/.person` | shipped | |
| Field set / append / forget (confirm-gated writes) | new | `profile.set/.append/.forget` | shipped | writes carry a surface hand-edit marker naming this app |
| Provenance disclosure | new | `profile.provenance` | shipped | names which superseded entry Undo restores |
| Undo | new | `profile.undo` | shipped | disabled while provenance refetches |
| Status disclosure | new | `profile.status` | shipped | |

## 20. Security & auth

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Daemon token bootstrap (companion token, zero-friction) | both | app-bun `platform/pairing` `getOrCreateCompanionToken('app')` | shipped | token injected by proxy; never enters webview |
| Username/password login + current principal | both | `control.auth.login`, `control.auth.current` | partial | current-principal is shipped; interactive login is deliberately unbuilt, since the app is single-user-local by design and the companion-token bootstrap is the only auth path a local-only daemon needs |
| Local auth status + users create/delete | tui | `local_auth.status`, `local_auth.users.*` | shipped | admin; deletes dangerous → confirm |
| Password rotate / session revoke / bootstrap-file clear | tui | `local_auth.users.password.rotate`, `.sessions.delete`, `.bootstrap.delete` | shipped | |
| Security settings snapshot | both | `security.settings` | shipped | |
| Permission mode + per-tool rules editor | both | `config.set permissions.*` | shipped | prompt/allow-all/custom with per-tool allow/prompt/deny |
| Approval decision history (audit trail) | both | `approvals.list` history + `permissions` domain log | shipped | |
| OS service: install/start/stop/restart/uninstall/status | tui | `services.*` | shipped | systemd user unit over the wire; uninstall dangerous |
| TLS / network posture display | tui | `settings.snapshot` | shipped | |
| URL scheme gate (every daemon- or content-supplied href) | new | app-local (`safe-href.ts`) | shipped | a `javascript:`/`data:` value never reaches an href; a refused value renders as an inert span |

## 21. Remote / Peers

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Remote snapshot | tui | `remote.snapshot` | shipped | |
| Peers: list / invoke / disconnect / token rotate / revoke | tui | `remote.peers.*` | shipped | admin-gated, invoke confirm |
| Pair requests: list / approve / reject | tui | `remote.pair.*` requests methods | shipped | |
| Work queue: list / cancel | tui | `remote.work.*` | shipped | |
| Node-host contract inspection | tui | `remote.node_host.contract` | shipped | |
| Web-push subscriptions manage (for PWA companions) | both | `push.vapid.get`, `push.subscriptions.*` [ws] | shipped | app itself uses native notifications |

## 22. Onboarding (zero-friction first run)

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Daemon detect → adopt-or-spawn (status probe + version band) | both | app-bun spawn `goodvibes-daemon` (from @pellux/goodvibes-tui dep) + `GET /status` | shipped | lands in a working chat with zero setup when possible |
| Token provisioning (automatic) | both | app-bun `platform/pairing` | shipped | no manual token paste on happy path |
| Provider key entry / detection (env inventory) | both | app-bun env scan + `config.set` / secrets | shipped | shows which keys already present |
| Default model pick (+ effort) | both | catalog + `config.set` | shipped | |
| Permissions posture pick | both | `config.set permissions.mode` | shipped | |
| Doctor (gtk/webkit deps, daemon reachable, token valid, provider sane) | both | app-local checks + `health.snapshot` | shipped | every failure has a next action |
| Welcome tour + first-run cards | desktop | app-local | shipped | rendered, dismissible, never blocks |
| Import from existing tui/agent installs | agent | app-local bridge | shipped | detects `~/.goodvibes/{tui,agent}` |
| QR pairing display for mobile companions | both | app-local QR render | shipped | |

## 23. Command palette & keyboard

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Command palette (⌘/Ctrl+K, fuzzy, every action registered) | both+desktop | app-local registry | shipped | actions-first navigation; nothing exists outside the registry |
| Chord hotkeys (`g c` style) + customizable bindings | both | app-local + keybindings registry | shipped | conflict detection |
| Shortcut cheatsheet overlay | both | app-local (reads registry, never hardcoded) | shipped | |
| Quick switcher (sessions/chats/views) | desktop | app-local | shipped | |
| Global focus management + focus traps in modals | both | app-local | shipped | |
| ARIA announcer wired to real events | both | app-local | shipped | desktop audit: useAnnounce had zero callers, ours must announce |
| Reduced-motion support | both | app-local tokens | shipped | |
| Keyboard shortcuts work regardless of focused pane | desktop-audit | app-local (explicit terminal-focus escape hatch) | shipped | fixes desktop audit theme 2 |

## 24. Notifications & tray

| Feature | Source | Backing | Status | Notes |
|---|---|---|---|---|
| Native desktop notifications (approvals, turn complete, task done, long-turn) | both | domains (`permissions`/`tasks`/`turn`) + RPC notification | shipped | metadata-only content, deep-link to view |
| Tray icon: status + quick actions (show/hide, new chat, pause notifications) | new | Electrobun Tray | shipped | window close ≠ app quit when tray enabled |
| Notification routing prefs (quiet-while-typing, batching, per-domain verbosity) | tui | app-local | shipped | |
| ntfy/webhook outbound notify config | tui | config + channels | shipped | |

---

## 25. Deliberate exclusions & honest gaps

Rows here are **excluded from v1 scope with justification** or carry a named upstream gap. Everything else above must reach `wired`/`verified`.

| Item | Reason |
|---|---|
| TUI panel/layout commands (`/panel open|split|width|…`, Alt+1..9 terminal tabs) | Terminal-specific layout system; the GUI has its own IA (sidebar/views/peek), which covers the same content surfaces. |
| Alt-screen / `--no-alt-screen`, raw-ANSI renderer options, bracketed-paste/kill-ring internals | Terminal rendering mechanics; GUI composer implements equivalent behaviors natively. |
| Shell completions, `goodvibes run/exec` print modes, CLI flag surface | CLI-specific; the daemon `tasks.create` covers scripted execution, and the TUI remains available for terminal workflows. |
| Plugin runtime hosting (registerCommand/registerTool/registerProvider…), marketplace install/publish | Plugin API is TUI-process-local with no wire methods and no `plugins` domain of any kind. This app shows nothing plugin-related, read-only or otherwise; MCP is the app's extension path. Revisit if the SDK exposes plugin management. |
| Eval harness (`/eval`), deterministic replay (`/replay`), incident/forensics bundles | TUI-process engines, no wire methods. gap: no wire method, telemetry errors/traces views cover the observability need; exclude authoring. |
| QEMU sandbox bootstrap / guest-bundle management | No wire methods; deep host mutation. App shows sandbox posture read-only from `settings.snapshot`. |
| LSP/tree-sitter intelligence control room detail (server mgmt, per-language ops) | Engine-internal; only `intelligence.snapshot` exists on the wire. Read-only tile ships. |
| Companion-chat compaction (`/compact` semantics) | Orchestrator-local, not on the companion wire. No history-windowing or "start fresh with summary" feature exists; long chats are handled by ordinary pagination and scroll only. |
| Prompt-context receipts (agent) | Receipts are produced by the agent's local prompt builder; companion-chat prompts are daemon-internal. Excluded until the wire exposes them. |
| ACP (Agent Client Protocol) delegate management | Engine-internal delegation plumbing; invisible to end users. |
| Cloudflare batch/tunnel/teleport bundles, `/bootstrap`, runner-pool authoring | Config keys shown in Settings; dedicated flows excluded v1 (deep infra workflows, low GUI value now). Remote peers view covers inspection. |
| `goodvibes://` deep links on Linux | Electrobun `urlSchemes` is macOS-only today. In-app deep links (palette + internal routes) ship; OS-level scheme registration deferred. |
| Hosting inbound channel webhooks in-app | The daemon owns listener ports (3421/3422); app controls and observes via `channels.*`/`watchers.*`, correct architecture, not a gap. |
| Home Assistant Assist conversation proxy endpoints | HA-device-facing routes (`/api/homeassistant/conversation*`); app covers the home-graph + channel surfaces instead. |
| Model benchmarks store authoring (`benchmarks.json`) | Display tiers from catalog; authoring benchmarks stays tui-side. |
| Peer-mode execution (app as work-pulling peer via peer-sdk) | The app is an operator surface; executing daemon work is the TUI/node-host role. |

**Cross-cutting upstream gaps to re-probe at runtime** (capability-probe via `control.methods.get`, degrade honestly). `sessions.search`/`fleet.*`/`checkpoints.*`/`push.*` are WS-only `[ws]`; agent-scoped knowledge routes (`/api/goodvibes-agent/knowledge/*`) may be absent on older daemons; no wire events exist for fleet/checkpoints/memory/calendar (poll + refetch-on-mutation).

---

### Row counts

| § | Surface | Rows |
|---|---|---|
| 1 | Chat | 41 |
| 2 | Sessions | 17 |
| 3 | Fleet | 12 |
| 4 | Approvals & Tasks | 9 |
| 5 | Automation | 12 |
| 6 | Knowledge | 25 |
| 7 | Memory | 9 |
| 8 | Agent Brain | 14 |
| 9 | Personal Ops | 9 |
| 9b | Dates / Occasions | 12 |
| 9c | Payments | 7 |
| 10 | Research | 7 |
| 11 | Documents & Compare | 9 |
| 12 | Artifacts | 7 |
| 13 | Channels | 15 |
| 14 | Providers & Models | 13 |
| 15 | Coding / Dev | 12 |
| 16 | MCP | 7 |
| 17 | Observability | 19 |
| 18 | Voice & Media | 13 |
| 19 | Settings & Config | 12 |
| 19b | Devices | 6 |
| 19c | Owner Profile | 5 |
| 20 | Security & Auth | 10 |
| 21 | Remote / Peers | 6 |
| 22 | Onboarding | 9 |
| 23 | Palette & Keyboard | 8 |
| 24 | Notifications & Tray | 4 |
| n/a | **Total rows** | **329** |
| 25 | Exclusions & gaps | 15 |
