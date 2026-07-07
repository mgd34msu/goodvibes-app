# goodvibes-app — Parity Gap Audit

Row-by-row audit of `docs/FEATURES.md` against the code. Original audit at commit
`b2ca124`; **refreshed after the Wave E gap-closure pass** (six agents + integration
gate) — closed rows are marked `(Wave E)` in their evidence cell and the counts below
reflect the post-Wave-E working tree. Method: for each row, the Backing method id was checked against
every literal string passed to `invoke(...)` / `streamPath(...)` in `src/ui`
(220 unique method ids actually called, out of 327 known in
`src/ui/lib/generated/operator-routes.ts`), then the calling component was
opened to confirm the call is reachable from a rendered view (not just present
in `gv.ts`'s convenience wrapper, which wraps some methods that no view ends
up calling). `app-local`/`RPC` rows were checked against the actual Bun route
(`src/bun/app-routes.ts` and its handlers) and the UI module implementing them.

Legend: **SHIPPED** — wired end-to-end with cited evidence. **PARTIAL** — some
of the row exists, the rest doesn't (both halves cited). **MISSING** — no
evidence found; stated plainly, no inference.

---

## 1. Chat (41 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Chat session list (sidebar, warm-start cache) | SHIPPED | `gv.chat.sessions.list` called at `src/ui/views/chat/useChatSessions.ts:48`; localStorage warm-start in `companion-chat.ts:115-143` |
| 2 | Create chat session | SHIPPED | `useChatSessions.ts:92` → `gv.chat.sessions.create` |
| 3 | Rename / auto-title | SHIPPED | rename: `useChatSessions.ts:116` (`sessions.update`); auto-title: `ChatView.tsx` `autoTitledSessionsRef` + `deriveChatTitle` (`message-utils.ts:151`) |
| 4 | Close / delete chat (proof-of-gone reconcile) | SHIPPED | `useChatSessions.ts:128,137,141-142`; missing-session reconcile at `ChatView.tsx:138-148` (`onSessionMissing`) |
| 5 | Send message (optimistic local/sent/failed states) | SHIPPED | `useChatSend.ts:246` → `gv.chat.messages.create`; local/sent/failed state via `deliveryState()` (`message-utils.ts:162`) |
| 6 | Streaming assistant reply | SHIPPED | `useChatStream.ts:111` opens SSE on `gv.chat.events.streamPath` |
| 7 | Edit-and-branch with lineage | SHIPPED | `useChatSend.ts:327` → `gv.chat.messages.edit`; lineage render `lineage.ts:46` `buildLineage`, `MessageLineage.tsx` |
| 8 | Retry / regenerate | SHIPPED | `useChatSend.ts:318` → `gv.chat.messages.retry` |
| 9 | Message history load | SHIPPED | `ChatView.tsx:164` → `gv.chat.messages.list` |
| 10 | Attachments: drag-drop / paste-image / file picker | SHIPPED | paste-image → attachment: `Composer.tsx:407-426`; upload: `useChatSend.ts:227` → `gv.artifacts.create` |
| 11 | Per-session provider/model picker in composer | SHIPPED | `ChatView.tsx:244` `gv.chat.sessions.update(...,{provider,model})`; `provider-models.ts` |
| 12 | Reasoning effort selector | SHIPPED | `ChatView.tsx:265-273` → `gv.config.set({key:"provider.reasoningEffort"})`; UI in `Composer.tsx:761` |
| 13 | Markdown rendering (GFM, tolerant tables) | SHIPPED | react-markdown/remark-gfm imported and rendered in `MessageItem.tsx` |
| 14 | Syntax highlighting + line-number modes | SHIPPED | `src/ui/lib/highlight.ts` (highlight.js core + per-language imports); line-number pref `chat-local.ts:139-146`, toggle in `ChatView.tsx:116` |
| 15 | Collapsible blocks + auto-collapse threshold | SHIPPED | `chat-local.ts:148` `readCollapseThreshold`; consumed `ChatView.tsx:119` |
| 16 | Inline diff rendering in transcript | SHIPPED | highlight.js `diff` language registered (`highlight.ts:10`); rendered via code-block path in `MessageItem.tsx` |
| 17 | Block copy / save to file | SHIPPED | `MessageItem.tsx` copy button + `downloadContent()` (`chat-local.ts:241`) |
| 18 | Bookmarks (add/list/jump) | SHIPPED | `chat-local.ts:101,120` `readBookmarks`/`toggleBookmark`; jump handled in `ChatSearch.tsx` |
| 19 | Conversation search (Ctrl+F, n/N, wrap marker) | SHIPPED | `ChatSearch.tsx`; wired via `CHAT_SEARCH_EVENT` (`chat-events.ts`) |
| 20 | Next/prev error jump | SHIPPED | `ChatSearch.tsx:116` `jumpError`, button at `:244` |
| 21 | Thinking display + live token strip | SHIPPED | `TurnActivity.tsx:91-99` (`thinking-strip`, tok/s) |
| 22 | Context usage meter | SHIPPED | `TurnActivity.tsx:109-125`, fresh-vs-cached split at `:118-119`, honest-hidden when unreported (`:113`) |
| 23 | Chat search (across sessions) | SHIPPED | `ChatSearch.tsx:133` → `gv.sessions.search` `[ws]`, degrades client-side (comment at file top) |
| 24 | Slash-command hints in composer | SHIPPED | `Composer.tsx:253-269` slash menu; commands registered `ChatView.tsx:70-74` (only `new`/`clear`/`help` — see row 49/54 gaps below) |
| 25 | `@` file reference picker | SHIPPED | `Composer.tsx:309-372` `mentionQuery` against artifacts list |
| 26 | Multi-line composer, grows with content | SHIPPED | `Composer.tsx` textarea auto-grow + `shouldSubmitComposerKey` (`ChatView.tsx:77-79`) |
| 27 | Paste normalization (big paste → chip) | SHIPPED | `Composer.tsx:407-426` (`onFilesAdded` for pasted text as a file/chip) |
| 28 | Input history + reverse search (Ctrl+R) | SHIPPED | history storage `chat-local.ts:44-49` `readInputHistory`/`pushInputHistory`; ArrowUp/Down recall + Ctrl+R reverse-search handler now wired in `Composer.tsx:432,466` (Wave E) |
| 29 | Prompt undo/redo | MISSING | no `undo`/`redo` logic in `Composer.tsx` or `chat-local.ts`; textarea relies on native browser undo only |
| 30 | Conversation clear / reset | SHIPPED | `/clear` slash command (`ChatView.tsx:72`) starts a new session |
| 31 | Notes: `/note`, `/keep` (session → durable memory) | SHIPPED | `useSlashCommands.ts:71` handles `/note`→app-local notes registry (`chat-local.ts:262` `NOTES_BASE`) and `/keep`→`gv.memory.records.add` (`:108`, ConfirmSurface-gated); registered from chat at `ChatView.tsx:250` (Wave E) |
| 32 | Export transcript (md/json/html) | SHIPPED | `chat-local.ts:186` `buildTranscriptExport`, `ExportFormat` type |
| 33 | Share with `--redact` | SHIPPED | `chat-local.ts:166` `redactSecrets` |
| 34 | Templates (prompt templates) | SHIPPED | `chat-local.ts:67-86` `readTemplates`/`saveTemplate`/`deleteTemplate` |
| 35 | Image attach (`/image`, Ctrl+V) | PARTIAL | Ctrl+V paste-to-attachment shipped (row 10). No literal `/image` slash command in `SLASH_COMMANDS` |
| 36 | Image generation (`/imagine`) | SHIPPED | `useSlashCommands.ts:126` → `media.generate`, inline markdown preview appended to the transcript (`:145`), artifact retained in Artifacts (Wave E) |
| 37 | Voice dictation (mic → composer) | SHIPPED | `voice.ts:214` `gv.voice.stt`; `MicButton.tsx` |
| 38 | Speak-aloud replies (TTS) + always-speak toggle | SHIPPED | `SpeakButton.tsx`; always-speak `chat-local.ts:153-157`, `ChatView.tsx:117,194` |
| 39 | Turn cancel (stop button) | PARTIAL (honest) | `ChatView.tsx:745` wires a Stop button, but `useChatStream.ts:87` explicitly states "Companion chat has no wire cancel" — stops local rendering only, no `sessions.inputs.cancel` call for companion turns. This matches the row's own caveat but is not a true cancel |
| 40 | Conversation branches (fork a chat) | MISSING | no distinct "fork whole chat" action found; only per-message edit-and-branch (row 7) exists. FEATURES.md itself flags this as a known gap ("wire fork doesn't exist... honest 'forked from' marker") but no marker/action was found in `ChatView.tsx`/`MessageItem.tsx` |
| 41 | Long-turn desktop notification | SHIPPED | `chat-local.ts:305` `shouldNotifyLongTurn`/`LONG_TURN_NOTIFY_MS` (60s + `document.hidden`); wired at `ChatView.tsx:200-209` `onTurnCompleted` → metadata-only POST `/app/notifications/notify` (Wave E) |

**Section 1 tally: 37 shipped, 2 partial, 2 missing** (of 41 rows; FEATURES.md's own row-count table claims 44 — the table overcounts, actual rows in the section are 41). Wave E closed rows 28/31/36/41; remaining gaps are row 29 (prompt undo/redo), row 35 (no literal `/image` command), and the honest partials on rows 35/39.

## 2. Sessions (12 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Cross-surface session union list | SHIPPED | `SessionsView.tsx:165` → `gv.sessions.list()` |
| 2 | Session detail + message transcript | SHIPPED | `SessionsView.tsx:554` → `gv.sessions.messages(id)`; detail render in same file |
| 3 | Search sessions | SHIPPED | `SessionsView.tsx:171` → `gv.sessions.search` `[ws]` |
| 4 | Steer a live session | SHIPPED | `SteerComposer.tsx:65` → `gv.sessions.steer` |
| 5 | Follow-up on completed session | SHIPPED | `SteerComposer.tsx:65` → `gv.sessions.followUp` (same composer, mode-switched) |
| 6 | Input queue: list / deliver / cancel | SHIPPED | `SessionsView.tsx:559,626,631` → `gv.sessions.inputs.{list,deliver,cancel}` |
| 7 | Close / reopen / delete | SHIPPED | `SessionsView.tsx:574,578,589,594` |
| 8 | Detach | SHIPPED | `SessionsView.tsx:617` → `invoke("sessions.detach", ...)` |
| 9 | Live session updates | SHIPPED | raw SSE stream mounted at shell level, comment `SessionsView.tsx:9`; `useSessionStreamPaused` (`lib/realtime.ts`) |
| 10 | Create operator session | SHIPPED | `SessionsView.tsx:488` → `gv.sessions.create` |
| 11 | Session export | SHIPPED | `SessionsView.tsx:638-647` `exportTranscript()` — app-local JSON download from retained messages |
| 12 | Session integration snapshot | SHIPPED | `SessionsView.tsx:129` → `gv.sessions.integrationSnapshot()` |

**Section 2 tally: 12 shipped, 0 partial, 0 missing.**

## 3. Fleet (12 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Live process tree (agents/WRFC/workflows/watchers/schedules/code-index) | SHIPPED | `FleetView.tsx:108` → `gv.fleet.snapshot()` `[ws]`, node-kind taxonomy in `fleet.ts:14-15` (`wrfc-chain`, `wrfc-subtask`, etc.) |
| 2 | Node detail: transcript / usage / cost | SHIPPED | usage/cost render `FleetView.tsx:245,352,419-424` (`costLabel`, `node.usage`) |
| 3 | Steer agent | SHIPPED | `FleetView.tsx:274` → `gv.sessions.steer` |
| 4 | Detach (never kills) | SHIPPED | `FleetView.tsx:332` → `invoke("sessions.detach", ...)` |
| 5 | Watcher start/stop/run from fleet | PARTIAL | only `watchers.stop` is wired (`FleetView.tsx:321`); no `watchers.start` or `watchers.run` call anywhere in the Fleet view |
| 6 | Task cancel/retry from fleet | MISSING | no `tasks.cancel`/`tasks.retry` call anywhere in `FleetView.tsx` — task-mapped nodes have no cancel/retry action |
| 7 | Interrupt / kill / pause / resume of agents | EXCLUDED (confirmed accurate) | matches §25 exclusion — no such wire method exists; not attempted, correctly a documented gap rather than a silent omission |
| 8 | Inline approval cards on correlated nodes | SHIPPED | `FleetApprovalInline.tsx:33,43,117` → `gv.approvals.{approve,deny,list}` |
| 9 | Workstream view (phases / work-items) | SHIPPED | `FleetView.tsx:57,115,137-141,171-176` — dedicated "Workstreams" scope filter + palette command |
| 10 | WRFC chain badges (`c:N/M`, SAT/UNS/UNV) | SHIPPED | derived in `fleet.ts:424-452` (`chainProgress` `c:N/M`, `reviewTally` SAT/UNS/UNV from the node's own `constraintFindings`); rendered as badges in `FleetView.tsx:95-122` (Wave E) |
| 11 | Worktree detail per agent | SHIPPED | `fleet.ts:386-392` `agentWorkingDirectory`/`worktreeLabel` off the node's reported worktree path; rendered on rows and in detail at `FleetView.tsx:287-289,411-413` (Wave E) |
| 12 | Deep links into fleet nodes | SHIPPED | `FleetView.tsx:92-103` `writeNodeToUrl`/`selectedId` round-trips through `router.ts` URL filters |

**Section 3 tally: 9 shipped, 1 partial, 1 missing, 1 correctly-excluded.** Wave E closed rows 10-11; the remaining partial (row 5, only `watchers.stop` wired) and missing (row 6, no task cancel/retry from fleet) were out of the Wave E fleet agent's scope.

## 4. Approvals & Tasks (9 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Pending / claimed / history list | SHIPPED | `lib/approvals.ts:364,389` → `gv.approvals.list()`; tabs in `ApprovalsTasksView.tsx` |
| 2 | Approve (whole) | SHIPPED | `ApprovalsTasksView.tsx:142` → `gv.approvals.approve(id)` |
| 3 | Per-hunk edit approval | SHIPPED | `ApprovalCard.tsx:50-225` real diff hunks + checkboxes; `ApprovalsTasksView.tsx:142` sends `{selectedHunks}` |
| 4 | Deny with note / claim / cancel | SHIPPED | `ApprovalsTasksView.tsx:166,178,189` |
| 5 | Approval desktop notification + palette jump | SHIPPED | native notify: `src/ui/lib/notify-bridge.ts:136-151` `handleApprovals` → POSTs `/app/notifications/notify`; palette jump: `ApprovalsNotifier.tsx:49,56,67` `jumpToApprovals`. **Note**: `ApprovalsNotifier.tsx:6-8`'s comment ("the native desktop-notification RPC path does not exist yet... Renders nothing") is stale — `notify-bridge.ts` (mounted in `App.tsx`) supplies the real native-notification path this row asks for; the comment predates it and should be corrected |
| 6 | Task list / detail | SHIPPED | `TasksSection.tsx:47` → `gv.tasks.get` |
| 7 | Create fire-and-forget task | SHIPPED | `TasksSection.tsx:158` → `gv.tasks.create` |
| 8 | Cancel / retry task | SHIPPED | `TasksSection.tsx:170,181` → `gv.tasks.cancel`/`.retry` |
| 9 | Realtime task updates | SHIPPED | `src/ui/lib/realtime.ts:21` `tasks: [queryKeys.tasks]` domain invalidation |

**Section 4 tally: 9 shipped, 0 partial, 0 missing** (plus one stale/incorrect code comment worth fixing).

## 5. Automation (12 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Integration snapshot dashboard | SHIPPED | `AutomationView.tsx:211` → `automation.integration.snapshot` |
| 2 | Jobs: list/create/update/delete/enable/disable/run | SHIPPED | `JobsSection.tsx:57,66,77,96,112` (method table `methods.{list,enable,disable,run,update,delete}`); create via `AutomationView.tsx:86` |
| 3 | Schedules: list/create/delete/enable/disable/run | SHIPPED | same `JobsSection.tsx` generic handler shared by jobs/schedules (`methods` table keyed by noun); create `AutomationView.tsx:86` |
| 4 | Cron editor with human preview + next-run times | SHIPPED | `automation/cron.ts:89-236` `parseCron`/`describeCron`/`nextCronRuns` |
| 5 | Runs: list/get/cancel/retry | SHIPPED | `RunsSection.tsx:40,51,76,223` |
| 6 | Heartbeat: list/run | SHIPPED | `HeartbeatSection.tsx:24,30` |
| 7 | Watchers: list/create/update/delete/start/stop/run | SHIPPED | `WatchersView.tsx:62,76,89,102,122` (`watchers.${verb}` covers start/stop/run) |
| 8 | Delivery targets on schedules (16 surface kinds) | PARTIAL | the wire field is reachable — `ScheduleForm.tsx:313` accepts a freeform JSON textarea (`{"targets":[{"kind":"slack",...}]}`) — but there is no dedicated picker enumerating the 16 surface kinds; authoring is raw-JSON only |
| 9 | Reminders (one-shot `at` schedules) | SHIPPED | `RemindersPanel.tsx:74-77` → `automation.schedules.create` with `kind:"at"` |
| 10 | Hooks file editor (`.goodvibes/hooks.json`) | MISSING | only a generic settings-schema row exists (`config-schema.generated.ts:1719` `tools.hooksFile` key, default `"hooks.json"`) — no dedicated file editor with schema validation or event-path/type reference docs as the row (and its own noted gap) call for |
| 11 | Workflow runs visibility (wrfc/fix_loop/…) | SHIPPED | rendered through Fleet, not Automation, per the row's own Backing (`workflows domain + fleet`): `fleet.ts:16` recognizes `"workflow"` node kind, `realtime.ts:27` invalidates `queryKeys.fleet` on the `workflows` domain |
| 12 | Scheduler capacity | SHIPPED | rendered in Observability, not Automation, per the row's own Backing: `SystemMiscPanels.tsx:124` → `gv.invoke("scheduler.capacity")` |

**Section 5 tally: 10 shipped, 1 partial, 1 missing.**

## 6. Knowledge (25 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Status dashboard | SHIPPED | `BrowsePanel.tsx:98`, `AskPanel.tsx:42`, `MapPanel.tsx:154` → `knowledge.status` |
| 2 | Ask (grounded answer) | SHIPPED | `AskPanel.tsx:103` → `knowledge.ask` |
| 3 | Search | SHIPPED | `AskPanel.tsx:113` → `knowledge.search` |
| 4 | Map (graph view) | SHIPPED | `MapPanel.tsx:158` → `knowledge.map` |
| 5 | Nodes list / item detail | SHIPPED | `BrowsePanel.tsx:39,123` — the generic `BrowseList` component calls `invoke(capability,...)` with `capability="knowledge.nodes.list"`; detail `ItemPeek.tsx:137` → `knowledge.item.get` |
| 6 | Packet build (task-time injection preview) | SHIPPED | `PacketPanel.tsx:38` → `knowledge.packet` |
| 7 | Lint / reindex | SHIPPED | `JobsPanel.tsx:396,408` → `knowledge.lint`/`knowledge.reindex` |
| 8 | Ingest URL / URLs / artifact | SHIPPED | `IngestPanel.tsx:110,248,485` → `knowledge.ingest.url`/`.urls`/`.artifact` |
| 9 | Import bookmarks / browser history / connector | SHIPPED | `IngestPanel.tsx:300,362,491` → `.ingest.browserHistory`/`.ingest.connector`/`.ingest.bookmarks` |
| 10 | Sources list/get + health | SHIPPED | list: `BrowsePanel.tsx:108` (`knowledge.sources.list`); detail/health via generic `knowledge.item.get` (no separate `sources.get` call — item peek covers it, `ItemPeek.tsx:4` "Sources additionally surface health") |
| 11 | Extractions / candidates review (decide) | SHIPPED | `ReportsPanel.tsx:131` (`extractions.list`), `ItemPeek.tsx:173` (`extraction.get`), `RefinePanel.tsx:167,174` (`candidates.list`, `candidate.decide`) |
| 12 | Issues list / review | SHIPPED | `BrowsePanel.tsx:149` (`issues.list`), `ItemPeek.tsx:77` (`issue.review`) |
| 13 | Reports / usage | SHIPPED | `ReportsPanel.tsx:121,126` → `knowledge.reports.list`/`knowledge.usage.list` |
| 14 | Jobs: list/get/run + job-runs | SHIPPED | `JobsPanel.tsx:32,39,121,143` |
| 15 | Schedules: list/get/save/enable/delete | PARTIAL | list/save/enable/delete shipped (`JobsPanel.tsx:212,222,243,254`); no dedicated `knowledge.schedule.get` (single-item fetch) call found — editing works off the list-query cache |
| 16 | Projections: list/render/materialize | SHIPPED | `ProjectionsPanel.tsx:93,106,111` |
| 17 | Refinement: run + tasks list/get/cancel | PARTIAL | run/list/cancel shipped (`RefinePanel.tsx:33,41,61`); no dedicated `knowledge.refinement.task.get` (single-task fetch) call found |
| 18 | Connectors: list/get/doctor | SHIPPED | `IngestPanel.tsx:355,454,458` → `.connectors.list`, `.connector.doctor`, `.connector.get` |
| 19 | GraphQL console (query + schema) | SHIPPED | `GraphqlPanel.tsx:29,36` → `knowledge.graphql.schema`/`.execute` |
| 20 | Agent-scoped knowledge (isolated store) | SHIPPED | `scope.ts` `agentKnowledgePath`; runtime probe pattern in `KnowledgeView.tsx:16,89`, `AskPanel.tsx:5,42,92` — routes to `/api/goodvibes-agent/knowledge/*` when `scope==="agent"` |
| 21 | Home-graph: ask/browse/map/sync/import/export/ingest/link | SHIPPED | `HomeGraphPanel.tsx` (mounted `KnowledgeView.tsx:238`) invokes `homeassistant.homeGraph.askHomeGraph` (`:78`), `.browse` (`:153`), `.map` (`:206`), `.ingestHomeGraphUrl/Note/Artifact` (`:422,433,444`), `.linkHomeGraphKnowledge` (`:455`), `.export`/`.import` (`:679,689`); capability-probed (Wave E) |
| 22 | Home-graph facts review / device passport / room page / reset | SHIPPED | same panel: `.reviewHomeGraphFact` (`HomeGraphPanel.tsx:291`), `.refreshDevicePassport` (`:640`), `.generateRoomPage` (`:650`), `.generateHomeGraphPacket` (`:660`), all ConfirmSurface-gated (Wave E) |
| 23 | Project planning: status/state/language/decisions/evaluate | SHIPPED | `PlanningPanel.tsx` (mounted `KnowledgeView.tsx:239`) → `projectPlanning.state.get` (`:101`), `.language.get/.upsert` (`:214,217`), `.decisions.list/.record` (`:315,319`), `.evaluate` (`:410`) (Wave E) |
| 24 | Work plan: snapshot + tasks CRUD/status/reorder/clearCompleted | SHIPPED | `PlanningPanel.tsx` `WorkPlanSection` → `projectPlanning.workPlan.snapshot` (`:601`), `.tasks.list` (`:604`), `.task.create/.get/.update/.status/.delete` (`:609,476,492,623,633`), `.tasks.reorder` (`:643`), `.clearCompleted` (`:651`) (Wave E) |
| 25 | Knowledge realtime updates | SHIPPED | `realtime.ts:24` `knowledge: [queryKeys.knowledgeStatus, queryKeys.knowledgeSources, queryKeys.knowledgeIssues]` |

**Section 6 tally: 23 shipped, 2 partial, 0 missing.** Wave E closed rows 21-24 — the home-graph (`HomeGraphPanel.tsx`) and project-planning (`PlanningPanel.tsx`) sub-surfaces are now full, capability-probed panels, eliminating what was the single largest concentration of missing surface. The only remaining partials are rows 15/17 (no single-item `schedule.get`/`refinement.task.get` fetch — both edit off list-query cache).

## 7. Memory (9 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Records: add/get/list/update/delete | SHIPPED | `MemoryView.tsx:130,139` (add/delete); `MemoryRecordPeek.tsx:39,188` (get/update); list via `records.search` (row 2) |
| 2 | Literal + semantic search (recall-honesty note) | SHIPPED | `MemoryView.tsx:97,107` → `.search`/`.search-semantic`; honesty note `MemorySearchHonestyNote.tsx:20`, rendered `MemoryView.tsx:461` |
| 3 | Review queue + update-review | SHIPPED | `MemoryView.tsx:116,158` → `reviewQueue`/`updateReview` |
| 4 | Links: add/list (record graph) | SHIPPED | `MemoryRecordPeek.tsx:298,304` → `memory.records.links.list`/`.add` |
| 5 | Import / export (handoff bundles) | SHIPPED | `MemoryView.tsx:172,199` → `memory.records.export`/`.import` |
| 6 | Vector stats / rebuild | SHIPPED | `MemoryAdminPanel.tsx:86,97` → `memory.vector.stats`/`.rebuild` |
| 7 | Embedding provider doctor + default set | SHIPPED | `MemoryAdminPanel.tsx:92,108` → `memory.doctor`/`memory.embeddings.default.set` |
| 8 | Scope + confidence faceting (session/project/team) | SHIPPED | `MemoryView.tsx:83,238,420-421` `scopeFilter`; confidence-floor recall contract note `:445` |
| 9 | Promote note → durable memory | SHIPPED | same `records.add` path as row 1 |

**Section 7 tally: 9 shipped, 0 partial, 0 missing.**

## 8. Agent Brain (14 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Routines: create/edit/enable/list/delete | SHIPPED | `RoutinesView.tsx:48,87,89,103,111` → `listRegistryItems`/`createRegistryItem`/`updateRegistryItem`/`deleteRegistryItem("routines",...)` (`registries.ts:150-186` → `/app/registries/routines`) |
| 2 | Start routine in chat (prints steps, bumps count) | SHIPPED | `RoutinesView.tsx:126` `updateRegistryItem` bumping `startCount`; `registries.ts:283` `writeChatDraftHandoff` (`gv.chat.draft` localStorage handoff) |
| 3 | Promote routine → daemon schedule (confirm-gated) | SHIPPED | `PromoteScheduleModal.tsx:103` → `gv.invoke("automation.schedules.create")`; capability-probed at `RoutinesView.tsx:58` |
| 4 | Personas: create/inspect/activate/review/delete | SHIPPED | `PersonasView.tsx:44,57-79,94,105` over `registryItems("personas")` |
| 5 | Persona discovery/import from VIBE.md | SHIPPED | `VibeDiscoveryModal.tsx:14,55` → `createRegistryItem("personas", ...)` sourced from VIBE.md parsing (`vibe-discovery.ts`) |
| 6 | Skills: create/import/enable/disable/review/bundles | SHIPPED | `SkillsView.tsx:40,63-64,78,86` over `registryItems("skills")` |
| 7 | Profiles: named isolated app homes + starter templates | MISSING | the `"profiles"` registry collection type is declared (`shared/registries.ts:14`, `routines/registries.ts:49`) but no view ever calls `listRegistryItems("profiles")`/`createRegistryItem("profiles",...)` — zero consumers found. `settings/ProfilesSection.tsx` (which sounds related) actually implements a *different* row (§19 "Profiles + profile-sync bundles" — export/import of the app's own settings as a JSON bundle), not multiple named/isolated `GOODVIBES_APP_HOME` roots with starter templates |
| 8 | VIBE.md personality editor (real disk writes) | SHIPPED | `VibePanel.tsx` (`fetchVibe`/`saveVibe` → `registries.ts:198-217` → `PUT /app/registries/vibe`, a real file write per `src/bun/registries/vibe.ts`) |
| 9 | Project context file inspection (CLAUDE.md, AGENTS.md, .cursorrules, …) | MISSING | no reference to `CLAUDE.md`, `AGENTS.md`, or `.cursorrules` anywhere in `src/ui` or `src/bun` — no discovery/viewer surface exists |
| 10 | Import registries/settings from `~/.goodvibes/agent` + `~/.goodvibes/tui` | SHIPPED | registries (agent-only, correctly — tui has no routines/personas/skills to import): `ImportBridgeModal.tsx` → `previewImport`/`applyImport` → `src/bun/registries/import-bridge.ts:223-253` reads `agentRoot`; settings (both surfaces): `ProfilesSection.tsx:206-213` lets the user pick `tui`/`agent` as the read-only settings-import source |
| 11 | Scratchpad notes + promote flows | MISSING | the `"notes"` registry collection exists server-side (`shared/registries.ts`, and `src/bun/registries/import-bridge.ts:239` can import notes from the agent) but no view calls `listRegistryItems("notes")`/`createRegistryItem("notes",...)` — no Notes/Scratchpad panel component exists anywhere under `src/ui/views` |
| 12 | Learning review (stale/low-confidence/duplicates) | PARTIAL | the underlying wire surfaces exist and are wired — `memory.review-queue` (Memory view, §7 row 3) and `knowledge.candidates.*` (Knowledge RefinePanel, §6 row 11) — but there is no distinct Agent-Brain-side "curator" UI that combines them as this row describes; a user has to know to visit Memory and Knowledge separately |
| 13 | Away digest ("while you were away") | SHIPPED | `AwayDigest.tsx:88,97,183` → `automation.runs.list` + `deliveries.list` + `tasks.list`, filtered against `last-seen.ts:6` (`localStorage` "goodvibes.app.home.lastSeen") |
| 14 | Coming-up rail (next runs + calendar) | SHIPPED | `ComingUpRail.tsx:46,79` — schedules `nextRunAt` merged with `calendar.events.list`, silent per-source degradation via `calendarRefusal` |

**Section 8 tally: 10 shipped, 1 partial, 3 missing.**

## 9. Personal Ops (9 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Daily briefing (inbox/agenda/tasks/reminders/deliveries) | PARTIAL | `BriefingChips.tsx:44-63` composes calendar/inbox/approvals/tasks (`calendar.events.list`, `email.inbox.list`, shared `useApprovalsSnapshot`/`useTasksSnapshot`) into 4 chips; `deliveries.list` is not part of the briefing composition — the row's own 5th source is absent |
| 2 | Email inbox list / read | SHIPPED | `personal-ops-data.ts:238` (`email.inbox.list`), `EmailPanel.tsx:346` (`email.inbox.read`) |
| 3 | Email draft (confirm-gated) | SHIPPED | `EmailPanel.tsx:83` → `email.draft.create` |
| 4 | Email send (confirm-gated) | SHIPPED | `EmailPanel.tsx:116` → `email.send` |
| 5 | Calendar windowed list + event peek | SHIPPED | `personal-ops-data.ts:250` (`calendar.events.list`), `CalendarPanel.tsx:432` (`calendar.events.get`) |
| 6 | Calendar create (admin) | SHIPPED | `CalendarPanel.tsx:102` → `calendar.events.create` |
| 7 | ICS import / export | SHIPPED | `CalendarPanel.tsx:138,163` → `calendar.ics.export`/`.import` |
| 8 | Unified inbox (channels + email merged) | MISSING | `channels.inbox.list` is wired only inside the Channels view (`InboxPanel.tsx:27`); Personal Ops's "Inbox" tab (`PersonalOpsView.tsx:19-132`) is email-only via `EmailPanel` — the two are never merged into one unified inbox as the row describes |
| 9 | Reminders | SHIPPED | `RemindersPanel.tsx:77` → `automation.schedules.create` kind=at |

**Section 9 tally: 7 shipped, 1 partial, 1 missing.**

## 10. Research (7 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Web search (ranked, source-labeled) | SHIPPED | `ResearchView.tsx:160` → `web_search.query` |
| 2 | Search provider list/status | SHIPPED | `ResearchView.tsx:151` → `web_search.providers.list` |
| 3 | Research runs (visible, checkpointable, log tails) | PARTIAL | run tracking is fully shipped via the app-local `research-runs` registry (`research-data.ts:42-134`, `ResearchView.tsx:546-579`), but the row's Backing calls for `tasks.create`-backed runs with wire status/cancel routes — no `tasks.create`/`tasks.cancel` call exists anywhere in `ResearchView.tsx`; status is a purely local registry field, not a real cancellable task |
| 4 | Source triage + credibility scoring | SHIPPED | `research-data.ts:84,100`, `ResearchView.tsx:319-427,696-721` `credibilityFrom` UI |
| 5 | Sourced report artifacts (citation coverage, source maps) | SHIPPED | `ResearchView.tsx:671` → `gv.artifacts.create`; markdown report built from findings (`research-data.ts:220-230`) |
| 6 | Promote research → Knowledge | SHIPPED | `ResearchView.tsx:462` → `knowledge.ingest.url`, capability-probed at `:73` |
| 7 | URL inspection (read-only fetch preview) | MISSING | no URL-preview route or viewer found anywhere in `src/ui` or `src/bun` — no `urlPreview`/`inspectUrl` handler exists |

**Section 10 tally: 5 shipped, 1 partial, 1 missing.**

## 11. Documents & Compare (9 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Versioned markdown drafts | SHIPPED | `documents-data.ts:49-81` (`listDocuments`/`createDocument`/`updateDocument`/`deleteDocument`/`listVersions`/`saveVersion` over `/app/registries/documents`) |
| 2 | Review comments + AI suggestion accept/reject | PARTIAL | comments shipped: `documents-data.ts:124,168` (`commentFrom`, `rawWithComments`), rendered `DocumentsView.tsx` `CommentsSection` (line 436). No AI-suggestion accept/reject flow exists — zero hits for `suggestion`/`accept`/`reject` anywhere in `src/ui/views/documents/` |
| 3 | Uploads / exports | PARTIAL | export shipped: `documents-data.ts:178-189` (`downloadText`/`exportFilename`); uploads via `artifacts.*` are missing — zero `artifacts.` calls anywhere in `src/ui/views/documents/` |
| 4 | Review packets: wizard + presets + freshness check | SHIPPED | `PacketsPanel.tsx` (mounted `DocumentsView.tsx:41` as a `packets` tab) + `packets-data.ts` — preset-driven wizard and `checkFreshness` re-run at `PacketsPanel.tsx:343` (Wave E) |
| 5 | Reviewer handoff ZIP archives | SHIPPED | `zip-writer.ts` `createZip`/`downloadBlob` (store-only archive); consumed at `PacketsPanel.tsx:359` (Wave E) |
| 6 | Share packet via channel (confirm-gated) | SHIPPED | `PacketsPanel.tsx:494` → `channels.actions.invoke`, admin+dangerous ConfirmSurface (`:447`) (Wave E) |
| 7 | Blind model comparison (delayed reveal) | SHIPPED | `CompareLab.tsx:164-190,260-261` — randomized A/B assignment, `revealed` gate before showing which model answered |
| 8 | Preference analytics / synthesis | SHIPPED (basic) | judgments recorded to the app-local `notes` registry tagged `"model-compare"` (comment `CompareLab.tsx:4-5`) with a "Past judgments" history list (`:405-422`) — this is a plain history list, not a deeper win-rate/synthesis rollup, but it satisfies the row as an app-local store |
| 9 | Winner → model route update (confirm-gated) | SHIPPED | `CompareLab.tsx:227` → `gv.config.set({key:"provider.model"})`, gated behind `promoteTarget`/confirm at `:388` |

**Section 11 tally: 7 shipped, 2 partial, 0 missing.** Wave E built the entire review-packet workflow (wizard, presets, freshness check, ZIP handoff, channel share) that was previously absent. Remaining partials are rows 2 (comments ship, no AI-suggestion accept/reject) and 3 (export ships, no `artifacts.*` upload).

## 12. Artifacts (7 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | List / browse | SHIPPED | `ArtifactsView.tsx:61` → `gv.artifacts.list` |
| 2 | Detail + content fetch | SHIPPED | `ArtifactsView.tsx:335,347` → `gv.artifacts.get`/`.contentPath` |
| 3 | Preview: markdown/code/image/audio/video/PDF | SHIPPED | `ArtifactsView.tsx:367,492-513` — all six kinds render in place |
| 4 | Upload / create | SHIPPED | `ArtifactsView.tsx:99` → `gv.artifacts.create` |
| 5 | Export / package / archive | SHIPPED (single-file only) | `ArtifactsView.tsx:398,542` `downloadCurrent()` — a browser-style anchor download, not an RPC native save dialog and not a batch/archive export; single-artifact download works |
| 6 | Promote artifact → Knowledge | SHIPPED | `ArtifactsView.tsx:87-88,385` → capability-probed then `knowledge.ingest.artifact` |
| 7 | Per-message artifacts slide-over in chat | SHIPPED | `src/ui/views/chat/ArtifactsPanel.tsx` (cited in §1 audit) |

**Section 12 tally: 7 shipped, 0 partial, 0 missing** (one row shipped with a narrower mechanism than described).

## 13. Channels (15 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Status overview (all 17 surfaces) | SHIPPED | `StatusBoard.tsx:47`, `CatalogPanel.tsx:433`, `AccessToolsPanel.tsx:70` → `channels.status` |
| 2 | Lifecycle / setup guide / doctor / repairs | SHIPPED | `StatusBoard.tsx:146,196,300,342` → `.doctor.get`/`.repairs.list`/`.lifecycle.get`/`.setup.get` |
| 3 | Inbox (triage-decorated) | SHIPPED | `InboxPanel.tsx:27` → `channels.inbox.list` |
| 4 | Accounts: list / per-surface / get + actions | SHIPPED | `AccountsPanel.tsx:35,45,49` → `.accounts.list`, `.accounts.action.named`/`.default` |
| 5 | Actions: list / invoke (confirmed sends) | SHIPPED | `CatalogPanel.tsx:197,232` → `.actions.list`/`.actions.invoke` |
| 6 | Agent tools + tools list / invoke | SHIPPED (tools invoke only) | `CatalogPanel.tsx:262,297,326` → `.tools.list`+`.tools.invoke` are both wired; `.agent_tools.list` is wired for listing, but no `.agent_tools.invoke` call was found — agent tools render as informational only |
| 7 | Capabilities / directory query | SHIPPED | `CatalogPanel.tsx:370,441` → `.capabilities.list`/`.directory.query` |
| 8 | Allowlist edit / resolve; authorize; target resolve | SHIPPED | `AccessToolsPanel.tsx:105,113,247,331` |
| 9 | Policies: list / audit / update | SHIPPED | `PoliciesPanel.tsx:70,158,315` |
| 10 | Drafts: list/get/save/delete | SHIPPED | `DraftsPanel.tsx:30,68,76,221` |
| 11 | Routing: list / assign / delete | SHIPPED | `RoutingPanel.tsx:28,34,143` |
| 12 | Delivery receipts (redacted) + dead-letter states | SHIPPED | `DeliveriesPanel.tsx` (mounted `ChannelsView.tsx:140`) — `deliveries.list` (`:120`) as a status/surface-filterable master list, `deliveries.get` detail peek (`:49`) showing failure reason, explicit `dead_lettered` state handling (`:26-35,182-184`) (Wave E) |
| 13 | Companion pairing (QR) | SHIPPED | `PairingModal.tsx:11,47-56,65-66` — real QR SVG rendered from `GET /app/pairing/connection` (`src/bun/pairing.ts`) |
| 14 | Notification targets (ntfy/webhook) manage + test | PARTIAL | config keys are editable generically through the schema-driven Settings editor (`config-schema.generated.ts:907-928` `surfaces.ntfy.*`), but there is no dedicated "send test notification through this ntfy/webhook target" action — `NotificationsSection.tsx`'s test button (`:67`) tests the app's own native-notification bridge, not an outbound channel target |
| 15 | Realtime channel events | SHIPPED | `realtime.ts:28-29` → `communication: [queryKeys.channels]`, `deliveries: [queryKeys.deliveries]` |

**Section 13 tally: 14 shipped, 1 partial, 0 missing.** Wave E closed row 12 (deliveries receipts/dead-letter view). The lone remaining partial is row 14 (ntfy/webhook targets editable via generic Settings, no dedicated per-target "send test" action). (Row 6 `agent_tools.invoke` remains list-only, as originally noted, folded into the shipped count as before.)

## 14. Providers & Models (13 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Provider list + auth-freshness status | SHIPPED | `ProvidersView.tsx:87` → `gv.providers.list()`; derived status `provider-status.ts` |
| 2 | Provider detail + usage | SHIPPED | `ProvidersView.tsx:110,115` → `gv.providers.get`/`.usage` |
| 3 | Accounts snapshot (route posture, fallback risk) | SHIPPED | `AccountsPanel.tsx:52` → `gv.accounts.snapshot()` |
| 4 | Model workspace: multi-target routes | SHIPPED | `ModelWorkspaceModal.tsx:80,85,128` → `providers.list` + `config.get/.set` |
| 5 | Model catalog (models.dev, 4000+ models, tiers) | MISSING | `model-catalog.ts` derives its model list entirely from the daemon's own `providers.list` response (`modelsFromProvidersResponse`, line 162) — there is no separate models.dev fetch, no 24h-TTL cache, and no `~/.goodvibes/tui/model-catalog.json` shared-store reuse anywhere in `src/bun` or `src/ui` |
| 6 | Synthetic failover posture display | MISSING | zero references to "failover" anywhere in `src/ui/views/providers/` |
| 7 | Credential status (secret-free) | SHIPPED | `CredentialStatusPanel.tsx:45` → `gv.config.credentials()` (cross-referenced in §20 correction above) |
| 8 | Custom provider JSON management | MISSING | zero references to `~/.goodvibes/tui/providers/*.json` or a custom-provider editor anywhere in `src/ui/views/providers/` |
| 9 | Local LLM server scan (opt-in, never silent) | MISSING | zero references to Ollama/LM Studio/vLLM/llama.cpp or any `platform/discovery` import anywhere in `src/ui` |
| 10 | Refresh models | SHIPPED (as list refetch) | `ProvidersView.tsx:231` `providers.refetch()` — refreshes the `providers.list` query; not a distinct catalog-refresh action since no separate catalog exists (row 5) |
| 11 | Subscriptions status (OAuth-backed) | PARTIAL | subscription posture is shown via `AccountsPanel.tsx` (comment `:1-3` "Accounts/subscription health") and a `"subscription"` filter option in `ModelWorkspaceModal.tsx:365`, sourced from `accounts.snapshot`/`providers.list`; no OAuth flow that opens an external browser via RPC was found anywhere in `src/ui` or `src/bun` |
| 12 | Reasoning effort defaults | SHIPPED | shared with §1 row 12 — `gv.config.set({key:"provider.reasoningEffort"})` |
| 13 | Pin/unpin favorite models | SHIPPED | `favorites.ts:34,38` `isFavoriteModel`/`toggleFavoriteModel`, localStorage-backed |

**Section 14 tally: 8 shipped, 1 partial, 4 missing.**

## 15. Coding / Dev (12 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Git panel: status/log/stage/unstage/commit | SHIPPED | `git-api.ts:113,114,120,131-133` → `/app/git/{workspace,status,log,stage,unstage,commit}`; guarded against no-op commits (`src/bun/git.ts:408-434`) |
| 2 | Branches: list/create/checkout with dirty-tree guard | PARTIAL (honestly labeled) | list shipped (`git-api.ts:124`, `src/bun/git.ts:289-310`); `GitView.tsx:4,516` explicitly states "checkout and branch creation are not wired in this wave" — an honest, in-UI-labeled gap rather than a silent omission |
| 3 | Stash / tags / remotes / reflog rescue | PARTIAL | stash push/pop/list shipped (`GitView.tsx:558-635`, `gitApi.stashList/.stashPush/.stashPop`); no tag management, no remote management (only read-only remote-tracking branch listing at `git.ts:292`), and no reflog-rescue UI exist anywhere |
| 4 | Diff viewer: working/staged/HEAD/arbitrary refs | SHIPPED | `git-api.ts:100,129` `DiffMode` ("working"/"staged"/"ref"); `DiffView.tsx` renders it |
| 5 | Worktrees: snapshot + list | SHIPPED | `WorktreesView.tsx:58` → `worktrees.snapshot`; `git-api.ts:141` → `/app/git/worktrees` |
| 6 | Checkpoints: create/list/diff/restore | SHIPPED | `CheckpointsView.tsx:68,84,92,118` → `gv.checkpoints.{list,diff,create,restore}` `[ws]` |
| 7 | Embedded terminal tabs (PTY) | SHIPPED | `pty-client.ts:32,45,71,75,83,144` → `/app/pty/sessions*` (list/create/delete/input/resize/stream) |
| 8 | Intelligence snapshot (LSP/tree-sitter posture) | MISSING | `intelligence.snapshot` is declared in `operator-routes.ts:154` but never invoked anywhere in `src/ui` — no read-only tile exists despite the row calling for one |
| 9 | Repo file browser + preview | MISSING (now honestly surfaced) | still no wire method — `src/bun/git.ts` exposes no `ls-tree`/`ls-files`/read-file route and no `fs.`/`files.`/`workspace.`/`tree.` route exists in `operator-routes.ts`. Wave E replaced the silent omission with an in-UI `RepoFilesNotice` (`GitView.tsx:178-190`) that states plainly what is missing and why (needs a new Bun-side endpoint, out of the UI-only scope) |
| 10 | Per-repo session table (sessions in this project) | SHIPPED | `RepoSessionsPanel.tsx` (mounted `GitView.tsx:166`) → `gv.sessions.list()` (`:75`) filtered to the current `workspaceDir` (Wave E) |
| 11 | GitHub: device-flow auth + PR/issue list/create | PARTIAL | `GitHubPanel.tsx` (mounted `GitView.tsx:163`) is a complete, capability-honest UI — it probes `control.methods.get` for `github.auth.deviceStart`/`.devicePoll`/`github.pulls.*`/`github.issues.*` and renders `UnavailableState` when absent. But **no `github.*` method exists in `operator-routes.ts` (0 matches)**, so on every known daemon the panel renders Unavailable — the UI is built and wired but has no live wire to talk to (Wave E, honest degrade) |
| 12 | Review snapshot | MISSING | `review.snapshot` is declared in `operator-routes.ts:280` but never invoked anywhere in `src/ui` |

**Section 15 tally: 6 shipped, 3 partial, 3 missing.** Wave E closed row 10 (per-repo session table) and built the GitHub UI (row 11 → PARTIAL, capability-honest but no `github.*` wire methods exist). Row 9 (repo file browser) stays MISSING but is now surfaced honestly in-UI; both read-only snapshot tiles (rows 8/12) remain absent (out of Wave E scope).

## 16. MCP (7 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Server list + status | SHIPPED | `McpView.tsx:41` → `mcp.servers.list` |
| 2 | Add / edit / remove servers | SHIPPED | `McpView.tsx:101,118` → `mcp.servers.upsert`/`.remove`; `ServerEditorModal.tsx` |
| 3 | Tool inventory (namespaced `mcp:<server>:<tool>`) | SHIPPED | `McpView.tsx:42` → `mcp.tools.list` |
| 4 | Config view + reload | SHIPPED | `McpView.tsx:43,91` → `mcp.config.get`/`.reload` |
| 5 | Trust / role review | SHIPPED | `McpView.tsx:258-259` renders `trustMode`/`role` badges per server |
| 6 | Sandbox isolation posture display | SHIPPED | `McpView.tsx:47,305-308` `readSandboxBindings`, read-only |
| 7 | MCP realtime events | SHIPPED | `realtime.ts:30` `mcp: [queryKeys.mcp]` |

**Section 16 tally: 7 shipped, 0 partial, 0 missing.**

## 17. Observability (18 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Telemetry dashboard (events, filters) | SHIPPED | `TelemetryDashboard.tsx:39` (`telemetry.snapshot`), `TelemetryEvents.tsx:59` (`telemetry.events.list`) |
| 2 | Error ledger | SHIPPED | `TelemetryErrors.tsx:25` → `telemetry.errors.list` |
| 3 | Traces browser | SHIPPED | `TelemetryTraces.tsx:25` → `telemetry.traces.list` |
| 4 | Metrics | SHIPPED | `TelemetryMetrics.tsx:31` → `telemetry.metrics.get` |
| 5 | Live telemetry stream | SHIPPED | `TelemetryLiveStream.tsx:46` → `gv.streamPath("telemetry.stream")` |
| 6 | Cost analytics: 4-bucket tokens, dated pricing, dedup, rollups | SHIPPED | `cost-engine.ts:2-6,24-262` — input/output/cache-read/cache-write buckets, `EPHEMERAL_PROJECT_LABEL`, `dedupeRecords`, `rollupByProvider/Session/Project` |
| 7 | Cost budget alert (`GOODVIBES_COST_BUDGET_USD`) | SHIPPED | `CostSection.tsx:39,156-176` |
| 8 | Token budget / context console | SHIPPED | same `CostSection.tsx` (comment `ObservabilityView.tsx:7` "token/context console") |
| 9 | Health snapshot + repair guidance | SHIPPED | `HealthPanel.tsx:17` → `gv.health.snapshot()` |
| 10 | Daemon control snapshot / connected clients / messages | SHIPPED | `ControlPanel.tsx:17,23,29` → `control.snapshot`/`.clients.list`/`.messages.list` |
| 11 | Routes snapshot + bindings CRUD | SHIPPED | `RoutesPanel.tsx:30,35,45,57,68` |
| 12 | Surfaces list | SHIPPED | `SystemMiscPanels.tsx:82` → `surfaces.list` |
| 13 | Continuity snapshot | SHIPPED | `SystemMiscPanels.tsx:92` → `continuity.snapshot` |
| 14 | Scheduler capacity | SHIPPED | `SystemMiscPanels.tsx:124` → `scheduler.capacity` (cross-referenced from §5) |
| 15 | Connection diagnostics (SSE state, latency, reconnects) | SHIPPED | `DiagnosticsSection.tsx:21`; `lib/daemon-health.ts` |
| 16 | Status strip: Reachable / Signed-in / Working + latency | SHIPPED | `components/shell/StatusStrip.tsx` |
| 17 | Contract explorer (method catalog + event catalog browser) | SHIPPED | `ContractSection.tsx:67,68,71,88` → `control.contract`/`control.methods.list`/`.get`/`control.eventsCatalog` |
| 18 | Remote-open TUI panels | SHIPPED | `PanelsSection.tsx:20,28` → `panels.list`/`panels.open` |

**Section 17 tally: 18 shipped, 0 partial, 0 missing.** The best-covered section in the audit — every row wired end-to-end.

## 18. Voice & Media (9 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | TTS speak (one-shot) | PARTIAL | `gv.voice.tts` wraps `voice.tts` (`gv.ts:294`) but is never called anywhere in `src/ui` — every speak action goes through `ttsStreamPath`/`voice.tts.stream` (row 2) instead; the one-shot method is declared but dead |
| 2 | Streaming TTS (sentence-chunked live speech) | SHIPPED | `voice.ts:497` → `gv.voice.ttsStreamPath()`, consumed via Web Audio in `SpeakButton.tsx` |
| 3 | TTS speed / voice / provider settings | SHIPPED | `voice-settings.ts:169,180` → `voice.providers.list`/`voice.voices.list`; `config.set` for `tts.*` (`:72`) |
| 4 | STT dictation | SHIPPED | `voice.ts:214` → `gv.voice.stt` |
| 5 | Voice status / doctor | SHIPPED | `voice-settings.ts:77-124` `deriveVoiceDoctor` over `voice.status` |
| 6 | Realtime voice session (duplex) | SHIPPED (v1 bootstrap, as scoped) | `voice-settings.ts:190,211` → `voice.realtime.session`, explicitly scoped as "session bootstrap + status" per the row's own note |
| 7 | Media providers list | SHIPPED | `media-data.ts:52` → `media.providers.list` |
| 8 | Media analyze / generate / transform | SHIPPED | `media-data.ts:131,139,154` |
| 9 | Multimodal: status/providers/analyze/packet/writeback | SHIPPED | `media-data.ts:72,82,164,173,181` |

**Section 18 tally: 8 shipped, 1 partial, 0 missing.**

## 19. Settings & Config (12 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Full schema-driven settings workspace | SHIPPED | `ConfigSettingsSection.tsx:51,102` → `gv.config.get`/`.set`; `config-schema.generated.ts` (full `CONFIG_SCHEMA`) |
| 2 | Settings search (fuzzy, cross-category) | SHIPPED | `settings-search.ts` (cited in §5/§8 audits) |
| 3 | Feature flags | SHIPPED (via generic editor) | no dedicated "feature flags" section, but any config key (including flags) is editable through the same schema-driven `ConfigSettingsSection.tsx` |
| 4 | Secrets manager: set/link/get(test)/list/delete + providers | SHIPPED | `secrets-api.ts:71-120` — full CRUD + `test`/`doctor`/`services.*` |
| 5 | Keybindings editor (conflict detection) | SHIPPED | `ShellPrefsSection.tsx:23,178,193-199` `findConflicts`/`setBinding` over `lib/keybindings.ts` |
| 6 | Profiles + profile-sync bundles | SHIPPED | `ProfilesSection.tsx`, `profile-bundle.ts:34-104` |
| 7 | Settings import from tui/agent (preview→confirm, redacted) | SHIPPED | `ProfilesSection.tsx:206-213`, `secrets-api.ts:170` → `/app/secrets/import-preview?source=` |
| 8 | Theme: dark default / light / density / reduced-motion | SHIPPED | `ShellPrefsSection.tsx:46-70` → `lib/theme.ts` `useTheme` |
| 9 | Service registry inspect/test/doctor (`/services`) | SHIPPED | `secrets-api.ts:116-120` → `/app/secrets/services*`; `ServicesSection.tsx` |
| 10 | Storage posture (`/storage`) | SHIPPED | `SyncSection.tsx:1,19,36` → `settings.snapshot`, doubles as the storage-posture display |
| 11 | Daemon settings (host/port/TLS/trust-proxy) read+edit | SHIPPED | `ProfilesSection.tsx:171` → `config.set controlPlane.host`/`.port`; TLS/trust-proxy keys are generic `config.get/.set` rows in `ConfigSettingsSection.tsx` |
| 12 | App-own settings (window, launch-at-login posture, notifications) | SHIPPED | `secrets-api.ts:137-145` → `/app/secrets/app-settings`(+`/autostart`); `AppLaunchSection.tsx` |

**Section 19 tally: 12 shipped, 0 partial, 0 missing.**

## 20. Security & Auth (9 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Daemon token bootstrap (companion token, zero-friction) | SHIPPED | `src/bun/pairing.ts:1-20` uses `@pellux/goodvibes-sdk/platform/pairing`'s `getOrCreateCompanionToken`-style helpers; the proxy injects the token (never enters the webview) |
| 2 | Username/password login + current principal | PARTIAL | current-principal is shipped: `gv.control.authCurrent()` (`gv.ts:159`), used by `onboarding/checks.ts:60`. Interactive login is not: `control.auth.login` is declared in the route table but never called from any UI component — `/login` is only a raw passthrough prefix in `ui-server.ts:19`, so if a daemon ever demands interactive login, the app has no in-chrome login form of its own (relies on the zero-friction companion-token bootstrap instead, which the app is architected to make the only path) |
| 3 | Local auth status + users create/delete | SHIPPED | `LocalAuthSection.tsx:60,78,315` → `local_auth.status`, `.users.delete`, `.users.create` |
| 4 | Password rotate / session revoke / bootstrap-file clear | SHIPPED | `LocalAuthSection.tsx:89,101,371` → `.sessions.delete`, `.bootstrap.delete`, `.users.password.rotate` |
| 5 | Security settings snapshot | SHIPPED | `SecuritySection.tsx:54` → `security.settings` |
| 6 | Permission mode + per-tool rules editor | SHIPPED (generic) | no dedicated permission-rules widget, but `permissions.mode` + `permissions.tools.{read,write,edit,exec,find,fetch,analyze,inspect,agent}` are all present as rows in the generic schema-driven `ConfigSettingsSection.tsx` (`config-schema.generated.ts:178-277`) |
| 7 | Approval decision history (audit trail) | SHIPPED | `ApprovalsTasksView.tsx:3,46-90,268` — history tab filters `approvals.list` to terminal states |
| 8 | OS service: install/start/stop/restart/uninstall/status | MISSING | `services.install/.start/.stop/.restart/.uninstall/.status` are declared in `operator-routes.ts:288-293` but never invoked anywhere in `src/ui` — do not confuse with `ServicesSection.tsx`, which implements the *unrelated* §19 row 9 (the connect-plugin `services.json` registry, explicitly labeled in its own header comment as a different "services" concept) |
| 9 | TLS / network posture display | SHIPPED (generic) | `controlPlane.tls.mode/.certFile/.keyFile` are generic rows in `config-schema.generated.ts:717-734`, editable through the same schema-driven settings workspace |

**Section 20 tally: 7 shipped, 1 partial, 1 missing.**

## 21. Remote / Peers (6 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Remote snapshot | SHIPPED | `OverviewSection.tsx:23` → `remote.snapshot` (`PeersView.tsx` Overview section, capability-probed) (Wave E) |
| 2 | Peers: list / invoke / disconnect / token rotate / revoke | SHIPPED | `PeersSection.tsx:34,58,71` (`remote.peers.list`/`.disconnect`/`.token.rotate`, `.token.revoke`) + `InvokeConsole.tsx:60` (`remote.peers.invoke`) (Wave E) |
| 3 | Pair requests: list / approve / reject | SHIPPED | `PairRequestsSection.tsx:38,49,63` → `remote.pair.requests.list`/`.approve`/`.reject` (Wave E) |
| 4 | Work queue: list / cancel | SHIPPED | `WorkSection.tsx:34,41` → `remote.work.list`/`.cancel` (Wave E) |
| 5 | Node-host contract inspection | SHIPPED | `NodeHostContractSection.tsx:17` → `remote.node_host.contract` (Wave E) |
| 6 | Web-push subscriptions manage (for PWA companions) | MISSING | `push.vapid.get`/`push.subscriptions.*` `[ws]` declared, still never invoked — the Wave E Peers view covers the `remote.*` surface but not the ws-only `push.*` subscription methods |

**Section 21 tally: 5 shipped, 0 partial, 1 missing.** Wave E built the whole `src/ui/views/peers/` view — `PeersView.tsx` (registered as `peers` in `registry.tsx:234-238`, in the "System" sidebar group) with Overview/Peers/PairRequests/Work/NodeHostContract/InvokeConsole sections covering all 12 `remote.*` methods, each capability-probed with honest `UnavailableState` when the daemon lacks the route. The only remaining gap is row 6 (ws-only `push.*` subscription management for PWA companions), which no view invokes.

## 22. Onboarding (9 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Daemon detect → adopt-or-spawn | SHIPPED | `src/bun/daemon-manager.ts:120` "Adopt-or-spawn. Never starts a competing daemon on an occupied port" |
| 2 | Token provisioning (automatic) | SHIPPED | `src/bun/pairing.ts` companion-token bootstrap, proxy-injected |
| 3 | Provider key entry / detection (env inventory) | SHIPPED | `OnboardingChecks.tsx:104,174-208` (`PROVIDER_ENV_KEYS`, `envKeyForProvider`) → `gv.config.set` |
| 4 | Default model pick (+ effort) | PARTIAL | model pick shipped (`OnboardingChecks.tsx:121` → `config.set provider.model`); no reasoning-effort control anywhere in the onboarding flow — zero hits for "effort" in `OnboardingChecks.tsx` |
| 5 | Permissions posture pick | SHIPPED | `PermissionsStep.tsx` (mounted `OnboardingOverlay.tsx:117`) audits `permissions.mode` and offers a picker → `config.set permissions.mode` (admin+dangerous, ConfirmSurface); renders honestly when the daemon exposes no `permissions.mode` key (`:83`) (Wave E) |
| 6 | Doctor (gtk/webkit deps, daemon reachable, token valid, provider sane) | PARTIAL | daemon-reachable/token-valid/provider-sane are the three live checks (`checks.ts:36-152` `daemonCheck`/`principalFrom`/`providerOptionsFrom`); there is no reported gtk/webkit dependency check — the only related code is a fire-and-forget env workaround (`src/bun/env.ts:10` `WEBKIT_DISABLE_DMABUF_RENDERER`), not a pass/fail check surfaced to the user |
| 7 | Welcome tour + first-run cards | SHIPPED | `WelcomeTour.tsx` + `tour.ts` (first-run-only, `hasTourBeenSeen` gate); shown on first run via `OnboardingOverlay.tsx:61,97` before the checks screen (Wave E) |
| 8 | Import from existing tui/agent installs | SHIPPED | `ImportStep.tsx` now mounted directly in the onboarding flow (`OnboardingOverlay.tsx:118`), surfacing the import bridge at first run (Wave E) |
| 9 | QR pairing display for mobile companions | SHIPPED | `PairingStep.tsx` now mounted in the onboarding flow (`OnboardingOverlay.tsx:119`), surfacing companion pairing at first run (Wave E) |

**Section 22 tally: 7 shipped, 2 partial, 0 missing.** Wave E expanded onboarding from the lean 3-check screen into a first-run flow with a welcome tour (row 7), permissions pick (row 5), import-bridge step (row 8), and QR pairing step (row 9). The two remaining partials are row 4 (model pick ships, no reasoning-effort control in the flow) and row 6 (daemon/token/provider checks ship, no gtk/webkit dependency check surfaced).

## 23. Command Palette & Keyboard (8 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Command palette (fuzzy, every action registered) | SHIPPED | `components/CommandPalette.tsx`; registry `lib/commands.ts:39-130` (`registerCommand`/`fuzzyMatch`/`filterCommands`) |
| 2 | Chord hotkeys (`g c` style) + customizable bindings | SHIPPED | `lib/hotkeys.ts:91-149` `useHotkeys` sequence/chord handling; bindings customizable via `ShellPrefsSection.tsx` (§19) |
| 3 | Shortcut cheatsheet overlay | MISSING | zero hits for "cheatsheet" (any spelling) anywhere in `src/ui` — no such overlay exists |
| 4 | Quick switcher (sessions/chats/views) | MISSING | zero hits for a switcher component — the only "switcher" matches in the codebase are the Knowledge view's unrelated agent/operator store-scope toggle (`AskPanel.tsx:4`, `KnowledgeView.tsx:15`) |
| 5 | Global focus management + focus traps in modals | SHIPPED | `lib/focus-trap.ts:18,24` `getFocusableElements`/`useFocusTrap`, used across modals |
| 6 | ARIA announcer wired to real events | SHIPPED | `lib/announcer.ts:43,78` `announce`/`useAnnounce`; called from real state transitions (e.g. `SessionsView.tsx:647` "Transcript exported") |
| 7 | Reduced-motion support | SHIPPED | `ShellPrefsSection.tsx:46-70` `theme.motion` (cross-ref §19) |
| 8 | Keyboard shortcuts work regardless of focused pane | SHIPPED | `TerminalScreen.tsx:73-90` — deliberate escape hatch: Ctrl/Cmd+K always reaches the palette even while the terminal is focused, copy/paste passes through, everything else is captured by the terminal and `stopPropagation()`-ed so chords like `g c` don't misfire while typing |

**Section 23 tally: 6 shipped, 0 partial, 2 missing.**

## 24. Notifications & Tray (4 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Native desktop notifications (approvals, turn complete, task done, long-turn) | SHIPPED | `notify-bridge.ts:125-179` (`surface()`, `handleApprovals`, `handleTasks` with long-vs-short variants); metadata-only, deep-links to `viewId` (cross-ref §4 correction) |
| 2 | Tray icon: status + quick actions | SHIPPED | `src/bun/index.ts:83,109-180` `setupTray` — real `electrobun/bun` `Tray`, graceful null fallback when no system tray exists, close-to-tray semantics (`:86-89`) |
| 3 | Notification routing prefs (quiet-while-typing, batching, per-domain verbosity) | SHIPPED | `NotificationsSection.tsx:82-151` (`patchDomain`, `batching`, `quietWhileTyping`); enforced client-side in `notify-bridge.ts:94-123` |
| 4 | ntfy/webhook outbound notify config | SHIPPED (config only) | `surfaces.ntfy.*`/webhook keys editable through the generic schema-driven config editor (cross-ref §13 row 14 — no dedicated "send test" action for these specific outbound targets) |

**Section 24 tally: 4 shipped, 0 partial, 0 missing.**

---

## 25. Deliberate exclusions & honest gaps — accuracy check

Spot-checked every falsifiable claim in this section against the actual route table (`operator-routes.ts`, 327 methods) and the app's own code. Most entries are architectural/qualitative judgments that aren't independently checkable (and read as reasonable); three make **specific factual claims about what ships**, and those were verified directly:

| Item | Claim made | Verified? |
|---|---|---|
| Plugin runtime hosting | "v1 shows `plugins` domain events read-only" | **INACCURATE.** There is no `plugins` domain anywhere — not in `realtime.ts`'s `DOMAIN_INVALIDATIONS` map, not in `operator-routes.ts`. Nothing shows plugin events, read-only or otherwise; the claim describes a feature that was never built |
| LSP/tree-sitter intelligence control room | "only `intelligence.snapshot` exists on the wire. Read-only tile ships" | **INACCURATE.** `intelligence.snapshot` is declared in `operator-routes.ts:154` but is never invoked anywhere in `src/ui` (confirmed in §15 row 8) — no read-only tile exists. The method-availability half of the claim is true; the "tile ships" half is not |
| Companion-chat compaction | "App manages long chats via history windowing + 'start fresh with summary' (app-local), labeled as such" | **INACCURATE.** No history-windowing or "start fresh with summary" feature exists anywhere in `src/ui/views/chat/` — the only "compact" hit in the codebase is `compactJson()` (`lib/wire.ts`), an unrelated JSON-formatting helper. Long chats are handled by ordinary pagination/scroll only |
| Fleet interrupt/kill/pause/resume | "no wire method (only steer/detach/watcher-stop/task-cancel are wire-backed)" | **CONFIRMED.** No `interrupt`/`kill`/`pause`/`resume` method exists in the 327-method route table |
| ACP delegate management | "Engine-internal delegation plumbing; invisible to end users" | **CONFIRMED** (no `acp.*` methods exist in the route table, consistent with "invisible") |
| Cloudflare batch/tunnel/teleport bundles | "Config keys shown in Settings" | **CONFIRMED.** `cloudflare.enabled`/`.freeTierMode`/`.accountId` etc. are present in `config-schema.generated.ts:1441-1498` |
| `goodvibes://` deep links on Linux | "Electrobun `urlSchemes` is macOS-only today" | Not independently checkable from this repo (upstream Electrobun claim); internal use of the `goodvibes://` string in `src/bun/secrets.ts:73` is an unrelated secret-reference URI scheme, not the OS deep-link claim, so it doesn't contradict this row |

The rest of §25 (TUI panel/layout commands, alt-screen/raw-ANSI, shell completions, eval/replay harnesses, QEMU sandbox, prompt-context receipts, Cloudflare `/bootstrap`/runner-pool authoring, inbound-webhook hosting, HA Assist proxy, benchmarks authoring, peer-mode execution) are architectural/scope judgments rather than falsifiable feature claims, and nothing found during this audit contradicts them.

**Recommendation**: correct the three inaccurate entries above — either build the small amount of missing surface they promise (a read-only `intelligence.snapshot` tile is a few hours of work matching the MCP sandbox-posture pattern already in the codebase) or rewrite the justification to say plainly that no such surface exists yet, matching the honesty standard the rest of this file holds itself to.

---

## Summary table

| § | Section | Shipped | Partial | Missing | Excluded | Rows |
|---|---|---|---|---|---|---|
| 1 | Chat | 37 | 2 | 2 | — | 41 |
| 2 | Sessions | 12 | 0 | 0 | — | 12 |
| 3 | Fleet | 9 | 1 | 1 | 1 | 12 |
| 4 | Approvals & Tasks | 9 | 0 | 0 | — | 9 |
| 5 | Automation | 10 | 1 | 1 | — | 12 |
| 6 | Knowledge | 23 | 2 | 0 | — | 25 |
| 7 | Memory | 9 | 0 | 0 | — | 9 |
| 8 | Agent Brain | 10 | 1 | 3 | — | 14 |
| 9 | Personal Ops | 7 | 1 | 1 | — | 9 |
| 10 | Research | 5 | 1 | 1 | — | 7 |
| 11 | Documents & Compare | 7 | 2 | 0 | — | 9 |
| 12 | Artifacts | 7 | 0 | 0 | — | 7 |
| 13 | Channels | 14 | 1 | 0 | — | 15 |
| 14 | Providers & Models | 8 | 1 | 4 | — | 13 |
| 15 | Coding / Dev | 6 | 3 | 3 | — | 12 |
| 16 | MCP | 7 | 0 | 0 | — | 7 |
| 17 | Observability | 18 | 0 | 0 | — | 18 |
| 18 | Voice & Media | 8 | 1 | 0 | — | 9 |
| 19 | Settings & Config | 12 | 0 | 0 | — | 12 |
| 20 | Security & Auth | 7 | 1 | 1 | — | 9 |
| 21 | Remote / Peers | 5 | 0 | 1 | — | 6 |
| 22 | Onboarding | 7 | 2 | 0 | — | 9 |
| 23 | Palette & Keyboard | 6 | 0 | 2 | — | 8 |
| 24 | Notifications & Tray | 4 | 0 | 0 | — | 4 |
| — | **Total** | **247** | **20** | **20** | **1** | **288** |

288 rows audited against actual code (FEATURES.md's own row-count table claims 291 — a minor overcount, see §1 note). After Wave E gap-closure, **85.8% shipped, 6.9% partial, 6.9% missing** of audited rows (was 78.5% / 7.6% / 13.5% at commit `b2ca124`). Wave E closed 21 previously-missing/partial rows across §1 (chat conveniences), §3 (fleet worktree + WRFC badges), §6 (home-graph + project planning — the largest single block), §11 (review packets), §13 (deliveries), §15 (per-repo sessions + capability-honest GitHub UI), §21 (the entire Remote/Peers view), and §22 (first-run onboarding flow). §25's 17 deliberate-exclusion/honest-gap entries were spot-checked separately (3 of the checkable claims found inaccurate — see above) rather than folded into these counts, since they were never meant to reach `wired`.

## Top 10 gaps by user impact (post-Wave-E)

Wave E closed seven of the previous top-ten entries (Remote/Peers, Home-graph & Planning,
Documents review-packets, chat conveniences, delivery receipts, onboarding flow, and fleet
worktree/WRFC badges). The remaining and newly-surfaced gaps, ranked by how much a real user
would notice and be blocked or misled:

1. **Provider/model catalog is not a real catalog (§14 row 5), and the provider surface has three more holes around it (§14 rows 6/8/9).** No models.dev fetch, no 4000+-model tier browsing, no 24h cache; plus no synthetic-failover posture, no custom-provider JSON editor, and no opt-in local-LLM server scan. Power users managing models lose the whole browsing/comparison experience.
2. **Repo file browser still missing (§15 row 9).** No `ls-tree`/read-file route exists on the wire, so the app shows an honest "not available, needs a new Bun endpoint" notice instead of a browser — browsing repo files without dropping to the terminal is still impossible.
3. **GitHub integration is UI-only / degraded (§15 row 11).** Wave E built a complete, capability-honest `GitHubPanel`, but **no `github.*` method exists in the route table**, so on every known daemon it renders Unavailable. The device-flow/PR/issue experience is wired but has nothing live to talk to.
4. **Two read-only Coding/Dev snapshot tiles are absent (§15 rows 8, 12).** `intelligence.snapshot` (LSP/tree-sitter posture) and `review.snapshot` are declared on the wire but no tile invokes them.
5. **OS service lifecycle is unwired (§20 row 8).** `services.install/.start/.stop/.restart/.uninstall/.status` have no UI — a user wanting the daemon to run as a managed OS service has no in-app control.
6. **Web-push subscriptions for PWA companions are missing (§21 row 6).** The one remaining Peers gap: the ws-only `push.vapid.get`/`push.subscriptions.*` methods have no management UI.
7. **Hooks file editor is missing (§5 row 10).** No dedicated `.goodvibes/hooks.json` editor with schema validation / event-path reference — only a generic settings-schema key exposes the file path.
8. **Agent-brain surfaces have three holes (§8 rows 7, 9, 11).** Named isolated profile homes with starter templates, project-context file viewing (CLAUDE.md/AGENTS.md/.cursorrules), and a scratchpad/notes panel are all absent despite server-side collections existing.
9. **Chat still lacks prompt undo/redo and whole-chat fork (§1 rows 29, 40), and has no literal `/image` command (§1 row 35).** Small daily-use conveniences that remain after Wave E closed `/note`/`/keep`/`/imagine`/long-turn-notify.
10. **Palette has no cheatsheet overlay or quick switcher (§23 rows 3, 4).** Two discoverability affordances (a shortcut cheatsheet, a sessions/chats/views quick switcher) are still absent.




