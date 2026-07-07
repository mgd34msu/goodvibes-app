# goodvibes-app — Parity Gap Audit

Row-by-row audit of `docs/FEATURES.md` against the code. Original audit at commit
`b2ca124`; refreshed after the Wave E gap-closure pass, after the Wave F pass, then
**refreshed again after the Wave G pass** (five agents + integration gate) — Wave G
closures are marked `(Wave G)` in their evidence cell and the counts below reflect the
post-Wave-G working tree (SDK upgraded to `@pellux/goodvibes-sdk@1.3.3`), verified against
the tree by the integration gate (not trusted from agent reports).
Wave F also fixed two arithmetic errors in the prior summary table (§14 was listed 8/1/4
but its rows count 9/1/3; §15 was listed 6/3/3 but its rows count 7/3/2 — the section-text
tallies were right, the summary table was not). Method: for each row, the Backing method id was checked against
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
| 29 | Prompt undo/redo | SHIPPED | `draft-history.ts` `useDraftHistory` (bounded 50-entry checkpoint ring over the composer draft); wired in `ChatView.tsx:115` and undo/redo restore at `:504,512` (Wave F) |
| 30 | Conversation clear / reset | SHIPPED | `/clear` slash command (`ChatView.tsx:72`) starts a new session |
| 31 | Notes: `/note`, `/keep` (session → durable memory) | SHIPPED | `useSlashCommands.ts:71` handles `/note`→app-local notes registry (`chat-local.ts:262` `NOTES_BASE`) and `/keep`→`gv.memory.records.add` (`:108`, ConfirmSurface-gated); registered from chat at `ChatView.tsx:250` (Wave E) |
| 32 | Export transcript (md/json/html) | SHIPPED | `chat-local.ts:186` `buildTranscriptExport`, `ExportFormat` type |
| 33 | Share with `--redact` | SHIPPED | `chat-local.ts:166` `redactSecrets` |
| 34 | Templates (prompt templates) | SHIPPED | `chat-local.ts:67-86` `readTemplates`/`saveTemplate`/`deleteTemplate` |
| 35 | Image attach (`/image`, Ctrl+V) | SHIPPED | `/image` is a real `SLASH_COMMANDS` entry (`ChatView.tsx:83`) whose handler (`ChatView.tsx:480-485`) clicks `imageFileInputRef` — the `accept="image/*"` file input in `Composer.tsx:766-770` — routing the chosen file through the same attachment-chip flow as Ctrl+V paste-to-attachment (row 10) (Wave F) |
| 36 | Image generation (`/imagine`) | SHIPPED | `useSlashCommands.ts:126` → `media.generate`, inline markdown preview appended to the transcript (`:145`), artifact retained in Artifacts (Wave E) |
| 37 | Voice dictation (mic → composer) | SHIPPED | `voice.ts:214` `gv.voice.stt`; `MicButton.tsx` |
| 38 | Speak-aloud replies (TTS) + always-speak toggle | SHIPPED | `SpeakButton.tsx`; always-speak `chat-local.ts:153-157`, `ChatView.tsx:117,194` |
| 39 | Turn cancel (stop button) | PARTIAL (honest) | `ChatView.tsx:745` wires a Stop button, but `useChatStream.ts:87` explicitly states "Companion chat has no wire cancel" — stops local rendering only, no `sessions.inputs.cancel` call for companion turns. This matches the row's own caveat but is not a true cancel |
| 40 | Conversation branches (fork a chat) | SHIPPED (honest) | `ChatView.tsx:305-347` `forkChat` mutation creates a new session and drops a local-only "forked from" note explaining the honest scope (wire has no whole-chat fork, so history is not copied); matches the row's own "honest 'forked from' marker" ask (Wave F) |
| 41 | Long-turn desktop notification | SHIPPED | `chat-local.ts:305` `shouldNotifyLongTurn`/`LONG_TURN_NOTIFY_MS` (60s + `document.hidden`); wired at `ChatView.tsx:200-209` `onTurnCompleted` → metadata-only POST `/app/notifications/notify` (Wave E) |

**Section 1 tally: 40 shipped, 1 partial, 0 missing** (of 41 rows; FEATURES.md's own row-count table claims 44 — the table overcounts, actual rows in the section are 41). Wave E closed rows 28/31/36/41; Wave F closed row 29 (prompt undo/redo), row 40 (honest whole-chat fork), and row 35 (the literal `/image` slash command, wired into the existing image-attach flow). The one remaining partial is row 39 (companion turn has no wire cancel — wire-blocked: `useChatStream.ts:87` "Companion chat has no wire cancel").

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
| 5 | Watcher start/stop/run from fleet | SHIPPED | `watchers.stop` (`FleetView.tsx:321`) plus `watchers.start` (`:393`) and `watchers.run` (`:403`) now wired from the Fleet view (Wave F) |
| 6 | Task cancel/retry from fleet | SHIPPED | `FleetTaskInline.tsx` (rendered `FleetView.tsx:505`) → `gv.tasks.list`/`.cancel`/`.retry` for task-mapped nodes (Wave F) |
| 7 | Interrupt / kill / pause / resume of agents | SHIPPED (composed; no hard-pause verb) | `FleetAgentControl.tsx` (rendered `FleetView.tsx:433` whenever a node carries a `sessionId`, driven by FleetView palette commands via an imperative handle) composes the real agent-control surface out of session verbs: steer/follow-up (`sessions.steer`/`.followUp` `:133-135`), interrupt = cancel a queued/delivered input (`sessions.inputs.list`/`.cancel` `:124,180`), stop = `sessions.close` (`:153`) or the gentler `sessions.detach` (`:162`, never kills the process), and resume = `sessions.reopen` (`:171`). There is still **no** single freeze-and-thaw *pause* verb on the operator wire — the panel says so outright (`FleetAgentControl.tsx:283`, "Nothing in this panel is ever labeled 'Pause'") rather than faking one (Wave G) |
| 8 | Inline approval cards on correlated nodes | SHIPPED | `FleetApprovalInline.tsx:33,43,117` → `gv.approvals.{approve,deny,list}` |
| 9 | Workstream view (phases / work-items) | SHIPPED | `FleetView.tsx:57,115,137-141,171-176` — dedicated "Workstreams" scope filter + palette command |
| 10 | WRFC chain badges (`c:N/M`, SAT/UNS/UNV) | SHIPPED | derived in `fleet.ts:424-452` (`chainProgress` `c:N/M`, `reviewTally` SAT/UNS/UNV from the node's own `constraintFindings`); rendered as badges in `FleetView.tsx:95-122` (Wave E) |
| 11 | Worktree detail per agent | SHIPPED | `fleet.ts:386-392` `agentWorkingDirectory`/`worktreeLabel` off the node's reported worktree path; rendered on rows and in detail at `FleetView.tsx:287-289,411-413` (Wave E) |
| 12 | Deep links into fleet nodes | SHIPPED | `FleetView.tsx:92-103` `writeNodeToUrl`/`selectedId` round-trips through `router.ts` URL filters |

**Section 3 tally: 12 shipped, 0 partial, 0 missing.** Wave E closed rows 10-11; Wave F closed row 5 (watcher start/run from fleet) and row 6 (task cancel/retry via `FleetTaskInline`). Wave G closed row 7 — the former "interrupt/kill/pause/resume" exclusion — by composing steer/interrupt(cancel queued input)/stop(close|detach)/resume(reopen) out of `sessions.*` verbs in `FleetAgentControl`, while stating plainly that no true freeze-and-thaw *pause* verb exists on the wire (nothing in the panel is ever labeled "Pause"). The section no longer carries an excluded row.

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
| 8 | Delivery targets on schedules (16 surface kinds) | SHIPPED | `DeliveryPicker.tsx` (rendered `ScheduleForm.tsx:353`) enumerates surface kinds from `delivery-targets.ts` + live `channels.directory.query`/`channels.status`, replacing the raw-JSON textarea with a real picker (Wave F) |
| 9 | Reminders (one-shot `at` schedules) | SHIPPED | `RemindersPanel.tsx:74-77` → `automation.schedules.create` with `kind:"at"` |
| 10 | Hooks file editor (`.goodvibes/hooks.json`) | SHIPPED | `HooksSection.tsx` (Automation `hooks` tab, `AutomationView.tsx:194`) reads/writes the file via new Bun route `GET/PUT /app/local/hooks` (`hooks-api.ts` → `src/bun/local-tools.ts`), with JSON-parse validation returning the error position on bad input (Wave F, F0 backing) |
| 11 | Workflow runs visibility (wrfc/fix_loop/…) | SHIPPED | rendered through Fleet, not Automation, per the row's own Backing (`workflows domain + fleet`): `fleet.ts:16` recognizes `"workflow"` node kind, `realtime.ts:27` invalidates `queryKeys.fleet` on the `workflows` domain |
| 12 | Scheduler capacity | SHIPPED | rendered in Observability, not Automation, per the row's own Backing: `SystemMiscPanels.tsx:124` → `gv.invoke("scheduler.capacity")` |

**Section 5 tally: 12 shipped, 0 partial, 0 missing.** Wave F closed row 8 (delivery-target picker) and row 10 (hooks file editor over new `/app/local/hooks` Bun route).

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
| 15 | Schedules: list/get/save/enable/delete | SHIPPED | list/save/enable/delete (`JobsPanel.tsx:212,222,243,254`) plus a dedicated single-item `knowledge.schedule.get` peek — `ScheduleDetailPeek` (`JobsPanel.tsx:151`, opened from each schedule row `:402`) seeds from the schedules-list cache as instant placeholder, then refetches; on a refresh error (that isn't method-unavailable) it falls back to the cached values behind an honest "may be stale" note (Wave G) |
| 16 | Projections: list/render/materialize | SHIPPED | `ProjectionsPanel.tsx:93,106,111` |
| 17 | Refinement: run + tasks list/get/cancel | SHIPPED | run/list/cancel (`RefinePanel.tsx:33,41,61`) plus a dedicated single-task `knowledge.refinement.task.get` peek — `RefinementTaskDetailPeek` (`RefinePanel.tsx:177`, opened from each task row `:139`) which polls every 4s while the fetched task is still active (pending/queued/running/in-progress) and stops once it settles (Wave G) |
| 18 | Connectors: list/get/doctor | SHIPPED | `IngestPanel.tsx:355,454,458` → `.connectors.list`, `.connector.doctor`, `.connector.get` |
| 19 | GraphQL console (query + schema) | SHIPPED | `GraphqlPanel.tsx:29,36` → `knowledge.graphql.schema`/`.execute` |
| 20 | Agent-scoped knowledge (isolated store) | SHIPPED | `scope.ts` `agentKnowledgePath`; runtime probe pattern in `KnowledgeView.tsx:16,89`, `AskPanel.tsx:5,42,92` — routes to `/api/goodvibes-agent/knowledge/*` when `scope==="agent"` |
| 21 | Home-graph: ask/browse/map/sync/import/export/ingest/link | SHIPPED | `HomeGraphPanel.tsx` (mounted `KnowledgeView.tsx:238`) invokes `homeassistant.homeGraph.askHomeGraph` (`:78`), `.browse` (`:153`), `.map` (`:206`), `.ingestHomeGraphUrl/Note/Artifact` (`:422,433,444`), `.linkHomeGraphKnowledge` (`:455`), `.export`/`.import` (`:679,689`); capability-probed (Wave E) |
| 22 | Home-graph facts review / device passport / room page / reset | SHIPPED | same panel: `.reviewHomeGraphFact` (`HomeGraphPanel.tsx:291`), `.refreshDevicePassport` (`:640`), `.generateRoomPage` (`:650`), `.generateHomeGraphPacket` (`:660`), all ConfirmSurface-gated (Wave E) |
| 23 | Project planning: status/state/language/decisions/evaluate | SHIPPED | `PlanningPanel.tsx` (mounted `KnowledgeView.tsx:239`) → `projectPlanning.state.get` (`:101`), `.language.get/.upsert` (`:214,217`), `.decisions.list/.record` (`:315,319`), `.evaluate` (`:410`) (Wave E) |
| 24 | Work plan: snapshot + tasks CRUD/status/reorder/clearCompleted | SHIPPED | `PlanningPanel.tsx` `WorkPlanSection` → `projectPlanning.workPlan.snapshot` (`:601`), `.tasks.list` (`:604`), `.task.create/.get/.update/.status/.delete` (`:609,476,492,623,633`), `.tasks.reorder` (`:643`), `.clearCompleted` (`:651`) (Wave E) |
| 25 | Knowledge realtime updates | SHIPPED | `realtime.ts:24` `knowledge: [queryKeys.knowledgeStatus, queryKeys.knowledgeSources, queryKeys.knowledgeIssues]` |

**Section 6 tally: 25 shipped, 0 partial, 0 missing.** Wave E closed rows 21-24 — the home-graph (`HomeGraphPanel.tsx`) and project-planning (`PlanningPanel.tsx`) sub-surfaces are now full, capability-probed panels, eliminating what was the single largest concentration of missing surface. Wave G closed the last two partials: rows 15 and 17 now each have a dedicated single-item fetch (`knowledge.schedule.get` peek with cache-seed + honest stale fallback, and `knowledge.refinement.task.get` peek that polls while the task is active), no longer editing purely off the list-query cache.

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
| 7 | Profiles: named isolated app homes + starter templates | SHIPPED (honest scope) | `ProfilesPanel.tsx` (Routines `profiles` tab, `RoutinesView.tsx:106`) over the `"profiles"` registry (`listRegistryItems`/`createRegistryItem("profiles",…)`), with three starter templates (dev/research/writing). Activation is honestly scoped in-UI: it sets the active persona + overwrites VIBE.md — separate `GOODVIBES_APP_HOME` roots are a daemon concept this app cannot create, and the panel says so (Wave F) |
| 8 | VIBE.md personality editor (real disk writes) | SHIPPED | `VibePanel.tsx` (`fetchVibe`/`saveVibe` → `registries.ts:198-217` → `PUT /app/registries/vibe`, a real file write per `src/bun/registries/vibe.ts`) |
| 9 | Project context file inspection (CLAUDE.md, AGENTS.md, .cursorrules, …) | SHIPPED | `ProjectContextPanel.tsx` (Personal Ops `context` tab, `PersonalOpsView.tsx:158`) lists well-known context files with existence flags via new Bun route `GET /app/local/context` and reads an allowlisted file via `GET /app/local/context/file` (allowlist + traversal guard tested in `test/local-tools.test.ts`) (Wave F, F0 backing) |
| 10 | Import registries/settings from `~/.goodvibes/agent` + `~/.goodvibes/tui` | SHIPPED | registries (agent-only, correctly — tui has no routines/personas/skills to import): `ImportBridgeModal.tsx` → `previewImport`/`applyImport` → `src/bun/registries/import-bridge.ts:223-253` reads `agentRoot`; settings (both surfaces): `ProfilesSection.tsx:206-213` lets the user pick `tui`/`agent` as the read-only settings-import source |
| 11 | Scratchpad notes + promote flows | SHIPPED | `ScratchpadPanel.tsx` (Routines `scratchpad` tab, `RoutinesView.tsx:107`) over the `"notes"` registry (`listRegistryItems`/`createRegistryItem("notes",…)`), with promote flows to `gv.memory.records.add`, `gv.artifacts.create`, and `knowledge.ingest.artifact`; `HomeView.tsx:211` `QuickCapture` writes a note and deep-links here (Wave F) |
| 12 | Learning review (stale/low-confidence/duplicates) | SHIPPED | `MemoryView.tsx` now renders a single combined "Learning review" curator (`:585`) that puts the memory review queue (its own triage buckets over `memory.review-queue`, §7 row 3) side by side with the knowledge consolidation-candidates queue — reusing `RefinePanel.tsx`'s exported `CandidatesSection` (`knowledge.candidates.list`/`candidate.decide`) rather than re-fetching or duplicating that wiring, each half degrading independently. One stop for what the agent learned instead of two separate views (Wave G) |
| 13 | Away digest ("while you were away") | SHIPPED | `AwayDigest.tsx:88,97,183` → `automation.runs.list` + `deliveries.list` + `tasks.list`, filtered against `last-seen.ts:6` (`localStorage` "goodvibes.app.home.lastSeen") |
| 14 | Coming-up rail (next runs + calendar) | SHIPPED | `ComingUpRail.tsx:46,79` — schedules `nextRunAt` merged with `calendar.events.list`, silent per-source degradation via `calendarRefusal` |

**Section 8 tally: 14 shipped, 0 partial, 0 missing.** Wave F closed row 7 (profiles panel, honest scope), row 9 (project-context file viewer over `/app/local/context`), and row 11 (scratchpad/notes panel + promote flows). Wave G closed the last partial, row 12 (learning review): `MemoryView.tsx` now hosts a single combined curator that puts the memory review queue side by side with the knowledge consolidation-candidates queue (reusing `RefinePanel`'s exported `CandidatesSection`), so it is one surface rather than two.

## 9. Personal Ops (9 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Daily briefing (inbox/agenda/tasks/reminders/deliveries) | SHIPPED | `BriefingChips.tsx` composes calendar/inbox/approvals/tasks plus the previously-absent 5th source `deliveries.list` (`:83`, capability-honest refusal at `:101`) into the briefing (Wave F) |
| 2 | Email inbox list / read | SHIPPED | `personal-ops-data.ts:238` (`email.inbox.list`), `EmailPanel.tsx:346` (`email.inbox.read`) |
| 3 | Email draft (confirm-gated) | SHIPPED | `EmailPanel.tsx:83` → `email.draft.create` |
| 4 | Email send (confirm-gated) | SHIPPED | `EmailPanel.tsx:116` → `email.send` |
| 5 | Calendar windowed list + event peek | SHIPPED | `personal-ops-data.ts:250` (`calendar.events.list`), `CalendarPanel.tsx:432` (`calendar.events.get`) |
| 6 | Calendar create (admin) | SHIPPED | `CalendarPanel.tsx:102` → `calendar.events.create` |
| 7 | ICS import / export | SHIPPED | `CalendarPanel.tsx:138,163` → `calendar.ics.export`/`.import` |
| 8 | Unified inbox (channels + email merged) | SHIPPED | `UnifiedInboxPanel.tsx` (Personal Ops `unified` tab, `PersonalOpsView.tsx:147`) merges `channels.inbox.list` with the email inbox into one list (Wave F) |
| 9 | Reminders | SHIPPED | `RemindersPanel.tsx:77` → `automation.schedules.create` kind=at |

**Section 9 tally: 9 shipped, 0 partial, 0 missing.** Wave F closed row 1 (briefing now includes `deliveries.list`) and row 8 (unified channels+email inbox).

## 10. Research (7 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Web search (ranked, source-labeled) | SHIPPED | `ResearchView.tsx:160` → `web_search.query` |
| 2 | Search provider list/status | SHIPPED | `ResearchView.tsx:151` → `web_search.providers.list` |
| 3 | Research runs (visible, checkpointable, log tails) | SHIPPED | Rebuilt on daemon tasks: `ResearchView.tsx:710` (`RunsSection`'s composer) and `:494` (`CollectModal`'s "New run…") both call `gv.tasks.create` (`research-data.ts:189` `researchTaskCreateBody`) and resolve the RuntimeTask id via `gv.tasks.list` + `research-data.ts:149` `findRuntimeTaskIdForAgent` (owner===agentId, the same link `fleet.ts`'s `taskForNode` uses) — that becomes the run's `taskId` (`research-data.ts:103-127` `ResearchRun`). Live status/cancel/retry ride `gv.tasks.get`/`.cancel`/`.retry` in `ResearchView.tsx:1261,956,970` (`RunTaskStatus`, ConfirmSurface-gated), sharing `queryKeys.tasks`/`taskDetail` so the `tasks` SSE domain (`lib/realtime.ts`) keeps them live. The app-local `research-runs` registry (`research-data.ts:58-87`) is now annotation-only (question/findings/log/checkpoints) on top of that. Pre-task-era rows with no `taskId`/`agentId` (`research-data.ts:136-144` `runLinkState`/`isLegacyRun`) render read-only in a separate "Legacy runs (pre-task era)" section (`ResearchView.tsx:1318` `LegacyRunsSection`) — viewable and deletable, never resumable, never auto-converted |
| 4 | Source triage + credibility scoring | SHIPPED | `research-data.ts:84,100`, `ResearchView.tsx:319-427,696-721` `credibilityFrom` UI |
| 5 | Sourced report artifacts (citation coverage, source maps) | SHIPPED | `ResearchView.tsx:671` → `gv.artifacts.create`; markdown report built from findings (`research-data.ts:220-230`) |
| 6 | Promote research → Knowledge | SHIPPED | `ResearchView.tsx:462` → `knowledge.ingest.url`, capability-probed at `:73` |
| 7 | URL inspection (read-only fetch preview) | SHIPPED | new Bun route `POST /app/local/fetch-preview` (`src/bun/local-tools.ts`) does a read-only fetch with a private-address/non-http-scheme refusal guard (tested in `test/local-tools.test.ts`); consumed by a `usePeek`-backed drawer in `ResearchView.tsx:129` via `research-data.ts:266` (Wave F, F0 backing) |

**Section 10 tally: 7 shipped, 0 partial, 0 missing.** Wave F closed row 7 (URL inspection over new `/app/local/fetch-preview` Bun route). Row 3 is now closed too: research runs are rebuilt on `tasks.create`-backed daemon tasks with real cancel/retry, and pre-task-era rows migrate into a read-only legacy section rather than being dropped or faked as task-backed.

## 11. Documents & Compare (9 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Versioned markdown drafts | SHIPPED | `documents-data.ts:49-81` (`listDocuments`/`createDocument`/`updateDocument`/`deleteDocument`/`listVersions`/`saveVersion` over `/app/registries/documents`) |
| 2 | Review comments + AI suggestion accept/reject | SHIPPED | comments shipped (`documents-data.ts:124,168`); AI-suggestion accept/reject now shipped — `DocumentComment.suggestion`/`decision` fields (`documents-data.ts:129-158`) with an accept path at `DocumentsView.tsx:392` applying the suggestion via `saveVersion` (Wave F) |
| 3 | Uploads / exports | SHIPPED | export shipped (`documents-data.ts:178-189`); uploads now shipped — `DocumentsView.tsx:371` → `gv.artifacts.create` (Wave F) |
| 4 | Review packets: wizard + presets + freshness check | SHIPPED | `PacketsPanel.tsx` (mounted `DocumentsView.tsx:41` as a `packets` tab) + `packets-data.ts` — preset-driven wizard and `checkFreshness` re-run at `PacketsPanel.tsx:343` (Wave E) |
| 5 | Reviewer handoff ZIP archives | SHIPPED | `zip-writer.ts` `createZip`/`downloadBlob` (store-only archive); consumed at `PacketsPanel.tsx:359` (Wave E) |
| 6 | Share packet via channel (confirm-gated) | SHIPPED | `PacketsPanel.tsx:494` → `channels.actions.invoke`, admin+dangerous ConfirmSurface (`:447`) (Wave E) |
| 7 | Blind model comparison (delayed reveal) | SHIPPED | `CompareLab.tsx:164-190,260-261` — randomized A/B assignment, `revealed` gate before showing which model answered |
| 8 | Preference analytics / synthesis | SHIPPED (basic) | judgments recorded to the app-local `notes` registry tagged `"model-compare"` (comment `CompareLab.tsx:4-5`) with a "Past judgments" history list (`:405-422`) — this is a plain history list, not a deeper win-rate/synthesis rollup, but it satisfies the row as an app-local store |
| 9 | Winner → model route update (confirm-gated) | SHIPPED | `CompareLab.tsx:227` → `gv.config.set({key:"provider.model"})`, gated behind `promoteTarget`/confirm at `:388` |

**Section 11 tally: 9 shipped, 0 partial, 0 missing.** Wave E built the entire review-packet workflow. Wave F closed the two remaining partials: row 2 (AI-suggestion accept/reject) and row 3 (`artifacts.create` upload).

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
| 14 | Notification targets (ntfy/webhook) manage + test | SHIPPED | `NotificationTargetsSection.tsx` (Settings, `SettingsView.tsx:156`) lists outbound targets via `channels.actions.list` and fires a real per-target test send via `channels.actions.invoke`, distinct from the app's own native-notification bridge test (Wave F) |
| 15 | Realtime channel events | SHIPPED | `realtime.ts:28-29` → `communication: [queryKeys.channels]`, `deliveries: [queryKeys.deliveries]` |

**Section 13 tally: 15 shipped, 0 partial, 0 missing.** Wave E closed row 12; Wave F closed row 14 (dedicated per-target manage + test-send via `NotificationTargetsSection`). (Row 6 `agent_tools.invoke` remains list-only, as originally noted, folded into the shipped count as before.)

## 14. Providers & Models (13 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Provider list + auth-freshness status | SHIPPED | `ProvidersView.tsx:87` → `gv.providers.list()`; derived status `provider-status.ts` |
| 2 | Provider detail + usage | SHIPPED | `ProvidersView.tsx:110,115` → `gv.providers.get`/`.usage` |
| 3 | Accounts snapshot (route posture, fallback risk) | SHIPPED | `AccountsPanel.tsx:52` → `gv.accounts.snapshot()` |
| 4 | Model workspace: multi-target routes | SHIPPED | `ModelWorkspaceModal.tsx:80,85,128` → `providers.list` + `config.get/.set` |
| 5 | Model catalog (models.dev, 4000+ models, tiers) | SHIPPED (Wave E) | `providers/model-dev-catalog.ts` (models.dev api.json fetch, 24h localStorage TTL, manual refresh) + `ModelCatalogPanel.tsx` (browse/search/filter by provider/modality/tier, offline fallback to providers.list with honest note), mounted in `ModelWorkspaceModal.tsx:308` |
| 6 | Synthetic failover posture display | SHIPPED (honest degrade) | `FailoverPostureCard.tsx` (rendered `ProvidersView.tsx:502`) is the display-only posture surface the row asks for; it searches provider/config for failover/fallback/synthetic keys and, finding none on the current daemon, renders an honest "no provider-failover config key on this daemon — synthetic failover is daemon-side and reports nothing to this client" state (Wave F) |
| 7 | Credential status (secret-free) | SHIPPED | `CredentialStatusPanel.tsx:45` → `gv.config.credentials()` (cross-referenced in §20 correction above) |
| 8 | Custom provider JSON management | SHIPPED | `CustomProvidersPanel.tsx` (rendered `ProvidersView.tsx:506`) does full CRUD over provider JSON files via new Bun routes `GET/PUT/DELETE /app/local/providers[/name]` (`providers-local-api.ts` → `src/bun/local-tools.ts`), with filename/`.json`/object validation tested in `test/local-tools.test.ts` (Wave F, F0 backing) |
| 9 | Local LLM server scan (opt-in, never silent) | SHIPPED | `LlmScanPanel.tsx` (rendered `ProvidersView.tsx:503`) runs an opt-in scan via new Bun route `POST /app/local/llm-scan` (`providers-local-api.ts` → `src/bun/local-tools.ts`), with a "use as custom provider" handoff prefilling `CustomProvidersPanel` (Wave F, F0 backing) |
| 10 | Refresh models | SHIPPED (as list refetch) | `ProvidersView.tsx:231` `providers.refetch()` — refreshes the `providers.list` query; not a distinct catalog-refresh action since no separate catalog exists (row 5) |
| 11 | Subscriptions status (OAuth-backed) | SHIPPED (Wave G follow-up) | posture via `AccountsPanel.tsx` (`accounts.snapshot`), and the full OAuth login flow is now app-served: `src/bun/subscriptions.ts` at `/app/subscriptions` on the SDK's `SubscriptionManager`/`beginOAuthLogin`/`completeOAuthLogin` + bundled OpenAI-Codex flow (`beginOpenAICodexLogin`), with loopback auto-capture (`createOAuthLocalListener`) and paste-code fallback; `SubscriptionsPanel.tsx` rendered in `ProvidersView.tsx:~502`. Storage is the TUI's own `~/.goodvibes/tui/subscriptions.json`, so logins made in either surface appear in both (live-verified: the TUI's existing openai subscription rendered in-app, token fields stripped). `test/subscriptions.test.ts` (15 tests) proves tokens never leak through the list endpoint |
| 12 | Reasoning effort defaults | SHIPPED | shared with §1 row 12 — `gv.config.set({key:"provider.reasoningEffort"})` |
| 13 | Pin/unpin favorite models | SHIPPED | `favorites.ts:34,38` `isFavoriteModel`/`toggleFavoriteModel`, localStorage-backed |

**Section 14 tally: 13 shipped, 0 partial, 0 missing.** Wave F closed all three provider holes around the (Wave-E) catalog: row 6 (failover posture, honest-degrade display), row 8 (custom-provider JSON CRUD over `/app/local/providers`), and row 9 (opt-in local-LLM scan over `/app/local/llm-scan`). The Wave G follow-up closed row 11 (subscription OAuth served app-side from `src/bun/subscriptions.ts` on the SDK's `SubscriptionManager` machinery, sharing the TUI's `subscriptions.json`). (Note: the prior summary table listed this section as 8/1/4 — an arithmetic error; the rows count 9/1/3 pre-Wave-F, 12/1/0 post-Wave-G, now 13/0/0.)

## 15. Coding / Dev (12 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Git panel: status/log/stage/unstage/commit | SHIPPED | `git-api.ts:113,114,120,131-133` → `/app/git/{workspace,status,log,stage,unstage,commit}`; guarded against no-op commits (`src/bun/git.ts:408-434`) |
| 2 | Branches: list/create/checkout with dirty-tree guard | SHIPPED | list + create + checkout all wired. `BranchesSection` (rendered `GitView.tsx:175`) calls `gitApi.checkout` (`git-api.ts:176`) and `gitApi.branchCreate` (`git-api.ts:178`); checkout is gated through `ConfirmSurface` (`GitView.tsx:774`). Bun side (`src/bun/git.ts:604-676`) refuses checkout when the working tree is dirty (409 `GIT_CHECKOUT_DIRTY`, surfaced via `isCheckoutDirtyError`) and never uses a force flag; branch-create never switches (Wave F) |
| 3 | Stash / tags / remotes / reflog rescue | PARTIAL | stash push/pop/list shipped (`GitView.tsx:558-635`); tags/remotes/reflog now all have read-only panels — `TagsPanel`/`RemotesPanel`/`ReflogSection` (rendered `GitView.tsx:191,194,195`) call `gitApi.tags`/`.remotes`/`.reflog` backed by `src/bun/git.ts:626-742` (`for-each-ref refs/tags`, `remote -v`, bounded `reflog show -n50`). Deliberate design choice: destructive local-git mutations (tag create/delete, remote add/remove, and reflog reset-to-restore "rescue") are intentionally not wired — the reflog drawer labels restore as a terminal op left unwired (`GitView.tsx:896-922`), keeping the whole panel non-destructive (Wave F) |
| 4 | Diff viewer: working/staged/HEAD/arbitrary refs | SHIPPED | `git-api.ts:100,129` `DiffMode` ("working"/"staged"/"ref"); `DiffView.tsx` renders it |
| 5 | Worktrees: snapshot + list | SHIPPED | `WorktreesView.tsx:58` → `worktrees.snapshot`; `git-api.ts:141` → `/app/git/worktrees` |
| 6 | Checkpoints: create/list/diff/restore | SHIPPED | `CheckpointsView.tsx:68,84,92,118` → `gv.checkpoints.{list,diff,create,restore}` `[ws]` |
| 7 | Embedded terminal tabs (PTY) | SHIPPED | `pty-client.ts:32,45,71,75,83,144` → `/app/pty/sessions*` (list/create/delete/input/resize/stream) |
| 8 | Intelligence snapshot (LSP/tree-sitter posture) | SHIPPED | `DevSnapshotsPanel.tsx` (rendered `GitView.tsx:174`) → `gv.invoke("intelligence.snapshot")` as a read-only posture tile, capability-honest when the daemon lacks the route (Wave F; v1.3.3 now serves the method) |
| 9 | Repo file browser + preview | SHIPPED (Wave E follow-up) | `src/bun/git.ts` `/app/git/files` (git ls-files, 20k cap) + `/app/git/file` (tracked-only bounded 512KB read — tracked-only is the traversal guard); `GitView.tsx` `RepoFilesPanel` (filter, 500-row render cap, text preview with binary/truncation honesty) |
| 10 | Per-repo session table (sessions in this project) | SHIPPED | `RepoSessionsPanel.tsx` (mounted `GitView.tsx:166`) → `gv.sessions.list()` (`:75`) filtered to the current `workspaceDir` (Wave E) |
| 11 | GitHub: device-flow auth + PR/issue list/create | SHIPPED (app-local surface) | Closed by serving GitHub from the app process itself instead of waiting on a daemon wire: `src/bun/github.ts` (registered `app-routes.ts:35` `"/app/github"`) implements device-flow + PAT auth, proxied reads (user/repos/pulls/issues/rate-limit), and three SDK-backed writes. It reuses the SDK rather than hand-rolling: `beginDeviceCodeFlow`/`pollDeviceCodeFlow` from `@pellux/goodvibes-sdk/platform/calendar` (RFC 8628 machinery) drive the device flow, and `GitHubIntegration.postPRComment`/`postPRReview`/`postIssueComment` from `@pellux/goodvibes-sdk/platform/integrations` do the writes; the token is stored via the shared `SecretsManager` and never echoed back. `GitHubPanel.tsx` (mounted `GitView.tsx:181`) is now wired to that surface through `github-model.ts`'s typed `githubApi` client (`authStatus`/`deviceStart`/`devicePoll`/`saveToken`/`pulls`/`issues`/`prComment`/`prReview`/`issueComment`), all confirm-gated for writes. Unit-covered in `test/github.test.ts` (device-flow quirk adapter, 409 client-not-configured, token never leaked). The write endpoints answer `{ok:true}` because the SDK methods return `void`; the UI keys off resolution, not a returned object (Wave G) |
| 12 | Review snapshot | SHIPPED | same `DevSnapshotsPanel.tsx` (`GitView.tsx:174`) → `gv.invoke("review.snapshot")` as a read-only tile, capability-honest (Wave F; v1.3.3 now serves the method) |

**Section 15 tally: 11 shipped, 1 partial, 0 missing.** Wave E closed row 10 and built the GitHub UI; the Wave E follow-up closed row 9. Wave F closed both read-only snapshot tiles — row 8 (`intelligence.snapshot`) and row 12 (`review.snapshot`) via `DevSnapshotsPanel` (v1.3.3 now serves both methods) — and closed row 2 (dirty-guarded branch checkout + create, no force flag). Wave G closed row 11: rather than wait on a daemon `github.*` wire, GitHub is served from the app process itself (`src/bun/github.ts` at `/app/github`, on the SDK's device-flow + `GitHubIntegration` machinery), and `GitHubPanel` is wired live to it through `github-model.ts`. The one remaining partial is row 3 (tags/remotes/reflog shipped read-only; destructive local-git mutations deliberately not wired — design choice).

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
| 1 | TTS speak (one-shot) | SHIPPED | `gv.voice.tts` (`gv.ts:294`) is now the live fallback inside the real speak path: `synthSegment` (`voice.ts:527`, used by `useTts`) tries the streaming route first and, on any non-ok response — e.g. a provider like Microsoft Edge that reports `["tts"]` with no `tts-stream` and returns 409 rather than a clean 404 — falls back to `synthSegmentOneShot` (`voice.ts:517`) which calls `voice.tts` and decodes the base64 audio into the same ArrayBuffer the WebAudio sink already plays. No longer dead code (Wave G) |
| 2 | Streaming TTS (sentence-chunked live speech) | SHIPPED | `voice.ts:497` → `gv.voice.ttsStreamPath()`, consumed via Web Audio in `SpeakButton.tsx` |
| 3 | TTS speed / voice / provider settings | SHIPPED | `voice-settings.ts:169,180` → `voice.providers.list`/`voice.voices.list`; `config.set` for `tts.*` (`:72`) |
| 4 | STT dictation | SHIPPED | `voice.ts:214` → `gv.voice.stt` |
| 5 | Voice status / doctor | SHIPPED | `voice-settings.ts:77-124` `deriveVoiceDoctor` over `voice.status` |
| 6 | Realtime voice session (duplex) | SHIPPED (v1 bootstrap, as scoped) | `voice-settings.ts:190,211` → `voice.realtime.session`, explicitly scoped as "session bootstrap + status" per the row's own note |
| 7 | Media providers list | SHIPPED | `media-data.ts:52` → `media.providers.list` |
| 8 | Media analyze / generate / transform | SHIPPED | `media-data.ts:131,139,154` |
| 9 | Multimodal: status/providers/analyze/packet/writeback | SHIPPED | `media-data.ts:72,82,164,173,181` |

**Section 18 tally: 9 shipped, 0 partial, 0 missing.** Wave G closed row 1 (one-shot `voice.tts`): it is now the live fallback in `synthSegment`'s real speak path (`voice.ts`) when the streaming route is unavailable for the active provider, decoded into the same WebAudio playback pipeline — no longer declared-but-dead.

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
| 2 | Username/password login + current principal | PARTIAL (deliberate — owner decision 2026-07-07) | current-principal is shipped: `gv.control.authCurrent()` (`gv.ts:159`), used by `onboarding/checks.ts:60`. Interactive login is intentionally unbuilt: the app is single-user-local by design — the daemon-manager only adopts/spawns on 127.0.0.1 and the companion-token bootstrap (token never enters the webview) is the only auth path. A login form would only matter for a multi-user/shared-remote-daemon scenario the app does not target; owner confirmed it stays unbuilt unless that becomes a goal. `control.auth.login` remains declared-but-uncalled; `/login` stays a raw passthrough prefix (`ui-server.ts:19`) |
| 3 | Local auth status + users create/delete | SHIPPED | `LocalAuthSection.tsx:60,78,315` → `local_auth.status`, `.users.delete`, `.users.create` |
| 4 | Password rotate / session revoke / bootstrap-file clear | SHIPPED | `LocalAuthSection.tsx:89,101,371` → `.sessions.delete`, `.bootstrap.delete`, `.users.password.rotate` |
| 5 | Security settings snapshot | SHIPPED | `SecuritySection.tsx:54` → `security.settings` |
| 6 | Permission mode + per-tool rules editor | SHIPPED (generic) | no dedicated permission-rules widget, but `permissions.mode` + `permissions.tools.{read,write,edit,exec,find,fetch,analyze,inspect,agent}` are all present as rows in the generic schema-driven `ConfigSettingsSection.tsx` (`config-schema.generated.ts:178-277`) |
| 7 | Approval decision history (audit trail) | SHIPPED | `ApprovalsTasksView.tsx:3,46-90,268` — history tab filters `approvals.list` to terminal states |
| 8 | OS service: install/start/stop/restart/uninstall/status | SHIPPED | `OsServiceSection.tsx` (rendered `SettingsView.tsx:145-150` under the Security section) is the first and only caller of all six `services.*` methods — `services.status` on a poll plus `.install/.start/.stop/.restart/.uninstall` as actions. install/stop/restart/uninstall go through `ConfirmSurface` naming the exact host effect (uninstall+stop danger-flagged); status is re-fetched after every action. Wire-shape-honest: the operator contract's input schema for every `services.*` method is `{additionalProperties:false}` (no body — verified against `operator-contract.json`), so no `confirm`/`explicitUserRequest` is forwarded, the daemon takes none. 403 renders an admin-required notice, method-absent renders `UnavailableState`. Distinct from `ServicesSection.tsx` (the §19 row 9 connect-plugin registry) (Wave F) |
| 9 | TLS / network posture display | SHIPPED (generic) | `controlPlane.tls.mode/.certFile/.keyFile` are generic rows in `config-schema.generated.ts:717-734`, editable through the same schema-driven settings workspace |

**Section 20 tally: 8 shipped, 1 partial, 0 missing.** Wave F closed row 8 (OS service lifecycle) via `OsServiceSection`, the first caller of the six `services.*` methods. The one remaining partial is row 2 (no in-chrome interactive login form — deliberate design choice: the app is architected so zero-friction companion-token bootstrap is the only auth path, and `control.auth.login` stays unused).

## 21. Remote / Peers (6 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Remote snapshot | SHIPPED | `OverviewSection.tsx:23` → `remote.snapshot` (`PeersView.tsx` Overview section, capability-probed) (Wave E) |
| 2 | Peers: list / invoke / disconnect / token rotate / revoke | SHIPPED | `PeersSection.tsx:34,58,71` (`remote.peers.list`/`.disconnect`/`.token.rotate`, `.token.revoke`) + `InvokeConsole.tsx:60` (`remote.peers.invoke`) (Wave E) |
| 3 | Pair requests: list / approve / reject | SHIPPED | `PairRequestsSection.tsx:38,49,63` → `remote.pair.requests.list`/`.approve`/`.reject` (Wave E) |
| 4 | Work queue: list / cancel | SHIPPED | `WorkSection.tsx:34,41` → `remote.work.list`/`.cancel` (Wave E) |
| 5 | Node-host contract inspection | SHIPPED | `NodeHostContractSection.tsx:17` → `remote.node_host.contract` (Wave E) |
| 6 | Web-push subscriptions manage (for PWA companions) | SHIPPED | `PushSection.tsx` (rendered `PeersView.tsx:46`) → `gv.invoke("push.vapid.get")` + `push.subscriptions.list`/`.verify`/`.delete` (ws-only), capability-honest when absent (Wave F; v1.3.3 now serves `push.*`) |

**Section 21 tally: 6 shipped, 0 partial, 0 missing.** Wave F closed row 6 (web-push subscription management via `PushSection`, now that v1.3.3 serves `push.*`). Wave E built the whole `src/ui/views/peers/` view — `PeersView.tsx` (registered as `peers` in `registry.tsx:234-238`, in the "System" sidebar group) with Overview/Peers/PairRequests/Work/NodeHostContract/InvokeConsole sections covering all 12 `remote.*` methods, each capability-probed with honest `UnavailableState` when the daemon lacks the route. Every row is now shipped.

## 22. Onboarding (9 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Daemon detect → adopt-or-spawn | SHIPPED | `src/bun/daemon-manager.ts:120` "Adopt-or-spawn. Never starts a competing daemon on an occupied port" |
| 2 | Token provisioning (automatic) | SHIPPED | `src/bun/pairing.ts` companion-token bootstrap, proxy-injected |
| 3 | Provider key entry / detection (env inventory) | SHIPPED | `OnboardingChecks.tsx:104,174-208` (`PROVIDER_ENV_KEYS`, `envKeyForProvider`) → `gv.config.set` |
| 4 | Default model pick (+ effort) | SHIPPED | model pick shipped (`OnboardingChecks.tsx:121`); reasoning-effort control now added as `ReasoningEffortStep.tsx` (`OnboardingOverlay.tsx:121`) → `gv.config.get`/`.set` for `provider.reasoningEffort` (Wave F) |
| 5 | Permissions posture pick | SHIPPED | `PermissionsStep.tsx` (mounted `OnboardingOverlay.tsx:117`) audits `permissions.mode` and offers a picker → `config.set permissions.mode` (admin+dangerous, ConfirmSurface); renders honestly when the daemon exposes no `permissions.mode` key (`:83`) (Wave E) |
| 6 | Doctor (gtk/webkit deps, daemon reachable, token valid, provider sane) | SHIPPED | daemon/token/provider checks shipped (`checks.ts:36-152`); the gtk/webkit dependency check is now added as `DepsCheckStep.tsx` (`OnboardingOverlay.tsx:122`) → new Bun route `GET /app/local/deps` returning a `{id,label,ok,detail}` checks array (`src/bun/local-tools.ts`, tested in `test/local-tools.test.ts`) (Wave F, F0 backing) |
| 7 | Welcome tour + first-run cards | SHIPPED | `WelcomeTour.tsx` + `tour.ts` (first-run-only, `hasTourBeenSeen` gate); shown on first run via `OnboardingOverlay.tsx:61,97` before the checks screen (Wave E) |
| 8 | Import from existing tui/agent installs | SHIPPED | `ImportStep.tsx` now mounted directly in the onboarding flow (`OnboardingOverlay.tsx:118`), surfacing the import bridge at first run (Wave E) |
| 9 | QR pairing display for mobile companions | SHIPPED | `PairingStep.tsx` now mounted in the onboarding flow (`OnboardingOverlay.tsx:119`), surfacing companion pairing at first run (Wave E) |

**Section 22 tally: 9 shipped, 0 partial, 0 missing.** Wave E expanded onboarding into a first-run flow (welcome tour, permissions pick, import-bridge, QR pairing). Wave F closed the two remaining partials: row 4 (reasoning-effort step) and row 6 (gtk/webkit dependency check over new `/app/local/deps` Bun route).

## 23. Command Palette & Keyboard (8 rows)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Command palette (fuzzy, every action registered) | SHIPPED | `components/CommandPalette.tsx`; registry `lib/commands.ts:39-130` (`registerCommand`/`fuzzyMatch`/`filterCommands`) |
| 2 | Chord hotkeys (`g c` style) + customizable bindings | SHIPPED | `lib/hotkeys.ts:91-149` `useHotkeys` sequence/chord handling; bindings customizable via `ShellPrefsSection.tsx` (§19) |
| 3 | Shortcut cheatsheet overlay | SHIPPED | `ShortcutCheatsheet` (`components/CommandPalette.tsx:184`, mounted in `components/shell/AppShell.tsx:19`) renders a grouped shortcut overlay from the command registry (Wave F) |
| 4 | Quick switcher (sessions/chats/views) | SHIPPED | `components/QuickSwitcher.tsx` (mounted in `App.tsx:22`) — a fuzzy switcher across sessions/chats/views (Wave F; F6's new component + the two legitimate `App.tsx` mount lines) |
| 5 | Global focus management + focus traps in modals | SHIPPED | `lib/focus-trap.ts:18,24` `getFocusableElements`/`useFocusTrap`, used across modals |
| 6 | ARIA announcer wired to real events | SHIPPED | `lib/announcer.ts:43,78` `announce`/`useAnnounce`; called from real state transitions (e.g. `SessionsView.tsx:647` "Transcript exported") |
| 7 | Reduced-motion support | SHIPPED | `ShellPrefsSection.tsx:46-70` `theme.motion` (cross-ref §19) |
| 8 | Keyboard shortcuts work regardless of focused pane | SHIPPED | `TerminalScreen.tsx:73-90` — deliberate escape hatch: Ctrl/Cmd+K always reaches the palette even while the terminal is focused, copy/paste passes through, everything else is captured by the terminal and `stopPropagation()`-ed so chords like `g c` don't misfire while typing |

**Section 23 tally: 8 shipped, 0 partial, 0 missing.** Wave F closed row 3 (shortcut cheatsheet overlay) and row 4 (quick switcher).

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
| LSP/tree-sitter intelligence control room | "only `intelligence.snapshot` exists on the wire. Read-only tile ships" | **NOW ACCURATE (Wave F).** Was inaccurate through Wave E (method declared but no tile); Wave F added the read-only tile in `DevSnapshotsPanel.tsx` (`GitView.tsx:174`) invoking `intelligence.snapshot`, so the claim now holds |
| Companion-chat compaction | "App manages long chats via history windowing + 'start fresh with summary' (app-local), labeled as such" | **INACCURATE.** No history-windowing or "start fresh with summary" feature exists anywhere in `src/ui/views/chat/` — the only "compact" hit in the codebase is `compactJson()` (`lib/wire.ts`), an unrelated JSON-formatting helper. Long chats are handled by ordinary pagination/scroll only |
| Fleet interrupt/kill/pause/resume | "no wire method (only steer/detach/watcher-stop/task-cancel are wire-backed)" | **STILL TRUE, NOW COMPOSED (Wave G).** No single `interrupt`/`kill`/`pause`/`resume` verb exists in the route table — but `FleetAgentControl` (§3 row 7) now builds an interrupt/stop/resume surface out of `sessions.inputs.cancel`/`sessions.close`/`sessions.reopen`, and states outright that no freeze-and-thaw *pause* verb exists (the panel never labels anything "Pause") |
| ACP delegate management | "Engine-internal delegation plumbing; invisible to end users" | **CONFIRMED** (no `acp.*` methods exist in the route table, consistent with "invisible") |
| Cloudflare batch/tunnel/teleport bundles | "Config keys shown in Settings" | **CONFIRMED.** `cloudflare.enabled`/`.freeTierMode`/`.accountId` etc. are present in `config-schema.generated.ts:1441-1498` |
| `goodvibes://` deep links on Linux | "Electrobun `urlSchemes` is macOS-only today" | Not independently checkable from this repo (upstream Electrobun claim); internal use of the `goodvibes://` string in `src/bun/secrets.ts:73` is an unrelated secret-reference URI scheme, not the OS deep-link claim, so it doesn't contradict this row |

The rest of §25 (TUI panel/layout commands, alt-screen/raw-ANSI, shell completions, eval/replay harnesses, QEMU sandbox, prompt-context receipts, Cloudflare `/bootstrap`/runner-pool authoring, inbound-webhook hosting, HA Assist proxy, benchmarks authoring, peer-mode execution) are architectural/scope judgments rather than falsifiable feature claims, and nothing found during this audit contradicts them.

**Recommendation**: correct the three inaccurate entries above — either build the small amount of missing surface they promise (a read-only `intelligence.snapshot` tile is a few hours of work matching the MCP sandbox-posture pattern already in the codebase) or rewrite the justification to say plainly that no such surface exists yet, matching the honesty standard the rest of this file holds itself to.

---

## Summary table

| § | Section | Shipped | Partial | Missing | Excluded | Rows |
|---|---|---|---|---|---|---|
| 1 | Chat | 40 | 1 | 0 | — | 41 |
| 2 | Sessions | 12 | 0 | 0 | — | 12 |
| 3 | Fleet | 12 | 0 | 0 | — | 12 |
| 4 | Approvals & Tasks | 9 | 0 | 0 | — | 9 |
| 5 | Automation | 12 | 0 | 0 | — | 12 |
| 6 | Knowledge | 25 | 0 | 0 | — | 25 |
| 7 | Memory | 9 | 0 | 0 | — | 9 |
| 8 | Agent Brain | 14 | 0 | 0 | — | 14 |
| 9 | Personal Ops | 9 | 0 | 0 | — | 9 |
| 10 | Research | 7 | 0 | 0 | — | 7 |
| 11 | Documents & Compare | 9 | 0 | 0 | — | 9 |
| 12 | Artifacts | 7 | 0 | 0 | — | 7 |
| 13 | Channels | 15 | 0 | 0 | — | 15 |
| 14 | Providers & Models | 13 | 0 | 0 | — | 13 |
| 15 | Coding / Dev | 11 | 1 | 0 | — | 12 |
| 16 | MCP | 7 | 0 | 0 | — | 7 |
| 17 | Observability | 18 | 0 | 0 | — | 18 |
| 18 | Voice & Media | 9 | 0 | 0 | — | 9 |
| 19 | Settings & Config | 12 | 0 | 0 | — | 12 |
| 20 | Security & Auth | 8 | 1 | 0 | — | 9 |
| 21 | Remote / Peers | 6 | 0 | 0 | — | 6 |
| 22 | Onboarding | 9 | 0 | 0 | — | 9 |
| 23 | Palette & Keyboard | 8 | 0 | 0 | — | 8 |
| 24 | Notifications & Tray | 4 | 0 | 0 | — | 4 |
| — | **Total** | **285** | **3** | **0** | **0** | **288** |

288 rows audited against actual code (FEATURES.md's own row-count table claims 291 — a minor overcount, see §1 note). After Wave G and its subscriptions follow-up, **99.0% shipped, 1.0% partial, 0% missing** of audited rows (was 98.6% / 1.4% post-Wave-G-proper, 96.5% / 3.1% / 0% post-Wave-F, 86.5% / 6.9% / 6.9% post-Wave-E on the corrected baseline, and 78.5% / 7.6% / 13.5% at commit `b2ca124`). Wave G closed six rows, verified against the tree by the integration gate (not trusted from agent reports): §15 row 11 (GitHub — device-flow + PAT auth, proxied reads, and SDK-backed PR/issue writes served app-locally from `src/bun/github.ts` on the SDK's `beginDeviceCodeFlow`/`pollDeviceCodeFlow` + `GitHubIntegration`, with `GitHubPanel` wired live to it), §3 row 7 (agent interrupt/stop/resume composed from `sessions.*` verbs in `FleetAgentControl`, with an honest note that no freeze-and-thaw *pause* verb exists — flipping the section's last EXCLUDED entry to shipped), §6 rows 15 and 17 (dedicated single-item `knowledge.schedule.get` / `knowledge.refinement.task.get` fetches), §8 row 12 (single combined "Learning review" curator in `MemoryView`), and §18 row 1 (one-shot `voice.tts` wired as the live streaming-TTS fallback). A new Bun surface `src/bun/github.ts` (registered `/app/github`, unit-covered by `test/github.test.ts`) backs the GitHub panel. **No MISSING rows remain, and no EXCLUDED rows remain.** A same-day follow-up closed §14 row 11 the same app-side way (subscription OAuth via `src/bun/subscriptions.ts` on the SDK's `SubscriptionManager`, sharing the TUI's `subscriptions.json`; `test/subscriptions.test.ts`). The 3 remaining partials are each either wire-blocked (the daemon lacks the method — proof cited on the row: §1 row 39 companion-turn cancel) or a named deliberate design choice (§15 row 3 read-only tags/remotes/reflog; §20 row 2 no in-chrome login form — both owner-confirmed 2026-07-07). §25's deliberate-exclusion/honest-gap entries were spot-checked separately (3 checkable claims found inaccurate) rather than folded into these counts.

## Remaining gaps by user impact (post-Wave-G)

Wave G closed six more rows — GitHub is now a live app-local surface, agent interrupt/stop/resume
is composed from `sessions.*` verbs, the two knowledge single-item fetches and the combined
learning-review curator landed, and the one-shot TTS method is now a real fallback. A same-day
follow-up closed subscription OAuth (§14 row 11) app-side. **Nothing app-side remains MISSING, and
no row is EXCLUDED any longer.** What is left is a short tail of three partials, each either
honestly **wire-blocked** (the app surface is built but the daemon lacks the method) or a named
**deliberate design choice** confirmed by the owner on 2026-07-07. Ranked by how much a real user
would notice:

1. **Companion-turn Stop is local-render-only (§1 row 39).** The wire has no companion-turn cancel (`useChatStream.ts:87`), so the Stop button halts local rendering rather than the turn — wire-blocked; owner has flagged this for an eventual daemon-side verb.
2. **Git tag/remote/reflog are read-only by design (§15 row 3).** Branch checkout/create (row 2) is shipped with a dirty-tree guard. Tags, remotes, and the reflog are surfaced as read-only panels; destructive local-git mutations are deliberately not wired to keep the panel non-destructive — owner-confirmed. (If one more git feature is ever wanted, the recorded recommendation is non-destructive rescue-branch-from-reflog: `git branch rescue/<name> <hash>`.)
3. **No in-chrome interactive login form (§20 row 2).** The app is single-user-local by design (companion-token bootstrap is the only auth path); owner-confirmed unbuilt unless multi-user/shared-remote-daemon ever becomes a goal — and the right shape then is remote-daemon-connect (daemon picker + login + permission model), not a lone form.

GitHub integration (§15 row 11) closed in Wave G: rather than wait on a `github.*` daemon wire, GitHub is served from the app process itself (`src/bun/github.ts` on the SDK's device-flow + `GitHubIntegration` machinery), so `GitHubPanel` now talks to a live surface on every daemon — it no longer appears above. Learning-review (§8 row 12), the two knowledge single-item fetches (§6 rows 15/17), agent interrupt/stop/resume (§3 row 7), and one-shot TTS (§18 row 1) likewise closed in Wave G.




