# goodvibes-desktop (Electron) — Prior-Art Map for the New Bun App

Repo: `/home/buzzkill/Projects/goodvibes-desktop` — "GoodVibes - Claude Code companion app", v1.1.4, MIT, Electron 39 + React 19. Formerly "Clausitron" (`CHANGELOG.md`). **It has zero dependency on @pellux/goodvibes-sdk, goodvibes-tui, or the goodvibes daemon** — it is a wrapper around the `claude` CLI binary and the `~/.claude/projects` JSONL session files.

---

## 1. Feature Inventory

Single window, 15 views switched via a title-bar nav with 4 groups — Code / Features / Organize / System (`src/shared/constants.ts:107-160`, `src/renderer/components/layout/MainContent.tsx`). Only the active view is mounted (lazy-loaded, per-view error boundaries).

**Code group**
- **TerminalView** — multi-tab xterm.js terminals running `claude` (or a plain shell) via node-pty; claude binary auto-discovery for stripped-PATH desktop launches; optional tmux wrapping (`src/main/services/terminalManager.ts`, `tmuxService.ts`); session resume via `--resume <id>`; PTY stream analyzer infers busy/idle activity (`ptyStreamAnalyzer/`); context-menus, large-paste handling; search addon loaded but never wired.
- **SessionsView** — virtualized history of all Claude sessions scanned from `~/.claude/projects` JSONL (`sessionManager.ts`); live-session detection, favorites, archive, tags (+tag templates, aliases, hierarchy, pinning), collections + smart collections, saved searches, session detail modal (tokens/cost/duration/messages/tool breakdown), one-click CLI resume, export (single + bulk via `archiver`).

**Features group** (four "twin" views sharing one header/empty-state/confirm/spinner pattern, per the audit)
- **MemoryView** — CLAUDE.md editor for user/project/local scope + templates (BROKEN: writes to a SQLite `knowledge_entries` table, never to disk — `useMemoryFiles.ts`).
- **AgentsView** — agent template library (personalities per task) with install/uninstall to `~/.claude/agents`.
- **SkillsView / CommandsView** — two skins over the same skills IPC/table; install modals with code preview.
- **HooksView** — 62 built-in hooks for all Claude Code event types, per-project or user scope, hook script install/validate, test-hook runner; a local HTTP **hook server on 127.0.0.1:23847** receives hook POSTs from Claude Code (`hookServer/service.ts`), feeding hook-event history/stats and the recommendation engine.
- **MCPView** — MCP server CRUD + enable/disable + a curated MCP Marketplace with categories/featured.
- **PluginsView** — Claude Code plugin install/uninstall/enable, marketplace cards.

**Organize group**
- **FilesView** — file manager: tree + icon grid, live preview (rendered Markdown toggle, syntax highlighting, metadata), pinned folders (persisted), per-folder Claude session table with resume, create/rename/delete files & dirs (delete has NO confirmation), open-in-editor/explorer.
- **NotebookView** — knowledge-base notes (menu says "Notebook", backend still "knowledge" everywhere).
- **TasksView** — quick notes/tasks with status.

**System group**
- **AnalyticsView** — cost/token dashboards, trends, per-project breakdowns, usage heatmap, tool-usage/efficiency stats; correct 4-bucket token accounting with per-message dedup and **dated pricing history** so old sessions are priced at time-of-use (praised by the audit); subagent cost roll-up to parent project.
- **ProjectRegistryView** — multi-project registry with per-project settings (permission mode, budget limit — both saved but never read), per-project analytics, agents, templates (`project:*`, `template:*` IPC).
- **SettingsView** — 54 settings in 16 sections: 12 themes + custom themes, shell choice, date/time/timezone, startup behavior, tmux, GitHub OAuth (built-in device-flow client ID or custom app), keyboard list (partly fictional).

**Cross-cutting / overlays** — CommandPalette, QuickSwitcher (Ctrl+K), KeyboardShortcutsPanel, About, confirm modals, toasts (max 3 visible), notification bell + SQLite store (never fed), onboarding wizard (never rendered), LoadingOverlay with progress (never reachable), customizable shortcut registry with conflict detection (`src/renderer/hooks/useKeyboardShortcuts.ts`).

**Git/GitHub** (panel components in `src/renderer/components/git`, `github`) — extremely deep git IPC surface: status/stage/commit/amend/branches+hierarchy/checkout with dirty-tree guard/merge/rebase/cherry-pick (incl. abort/continue/in-progress detection)/stash/tags/remotes/reflog+reset-to-reflog/worktrees/submodules/blame/file history/diff-for-staging/apply-patch/conflict ours-theirs; live git watcher. GitHub: OAuth device flow (zero-setup default client ID) + auth-code flow via `goodvibes://` protocol, repos/orgs, PRs (create/merge/close), issues, checks/commit status, workflow runs.

**Headless/automation substrate (mostly main-process, thin or no UI)** — `headlessRunner.ts` (run Claude tasks without UI: prompt, model, permissionMode, allowed/denied tools, timeout, injected CLAUDE.md, workspace prep), `policyEngine.ts` (auto-approve/deny/queue permission requests), `recommendationEngine/` (agent/skill recommendations from UserPromptSubmit hook: keyword+intent+project context+success-rate boosting), `agentRegistry`/`agentIndexer`/`skillIndexer`/`contextInjection.ts` (CLAUDE.md section-marker injection, skill queueing, agent activation — the "agency-*" IPC family), `projectCoordinator/` (cross-project agent state, broadcast events, shared skills — "coordinator:*"), `testMonitor/`, `messageInjection.ts` (first-message injection), `sessionBackup.ts` (JSONL backups on startup), `claudeCliClient.ts` (headless `claude -p` with JSON schema for AI tag suggestions).

---

## 2. Architecture

- **Split**: classic Electron. Main process (`src/main`): `index.ts` entry → `lifecycle/` (initialization, shutdown), `window.ts`, `menu.ts`, `services/` (~45 services), `database/` (better-sqlite3, WAL, migrations; tables for sessions, messages, tags, collections, smart_collections, settings, prompts, quick_notes, notifications, knowledge_entries, hooks, mcp_servers, agents, skills, projects, hook_events, agent_tree_nodes, tool_usage, activity_log). Renderer (`src/renderer`): React 19 + Vite (electron-vite), Tailwind CSS 4, Zustand stores (`appStore`, `terminalStore`, `settingsStore`, `toastStore`), TanStack Query for server state, TanStack Virtual for big lists, xterm.js, lucide-react icons, react-markdown + rehype-highlight, react-error-boundary. Tests: Vitest (4125+ unit) + Playwright e2e.
- **Claude connection**: **no daemon, no SDK**. Three channels to Claude: (1) interactive — node-pty spawns the `claude` binary into an xterm tab; (2) data — a scanner walks `~/.claude/projects/**/*.jsonl` and imports into SQLite (plus fs.watch + 2s/10s polling loops — flagged as waste); (3) events — Claude Code hooks POST to the local hook server on port 23847. Headless calls use `child_process.spawn` of `claude` (tag suggestions, headless runner).
- **IPC pattern**: contextIsolation on, nodeIntegration off; preload bridge `window.goodvibes` composed from 17 API modules (`src/preload/api/index.ts`: terminal, sessions, git, github, database, settings, projects, hooks, primitives, agency, events, projectRegistry, recommendations, features, plugins, tags) → **~470 distinct `ipcRenderer.invoke` channels**, kebab-case (`git-*`, `github-*`) and namespaced (`project:*`, `coordinator:*`, `recommendations:*`, `agency-*`, `feature:*`, `plugins:*`, `template:*`, `test-monitor:*`, `tmux:*`). Handlers in `src/main/ipc/handlers/` with zod schemas in `src/main/ipc/schemas`. Push events via `sendToRenderer` (`terminal-data`, `terminal-exit`, `scan-status`, git watcher). Notably: **no `.d.ts` exists for the preload bridge** — `npm run typecheck` fails with 902 errors (audit Theme 8).
- **Packaging**: electron-builder (AppImage/zip/portable), custom `goodvibes://` protocol, no auto-update (`publish: null`), native-module ABI mismatch makes a fresh clone unrunnable without manual `electron-rebuild`.

---

## 3. UX Audit Findings (`ux-audit-2026-07-06.html` — 83 findings, 16/17 high-stakes claims adversarially confirmed)

Headline diagnosis: *"the app repeatedly builds a capability and then fails to connect it, and the core loop (a running Claude terminal) fails silently in the moments that matter most."*

**Theme 1 — core loop hides failure (Critical)**: terminal tab vanishes silently on process exit (exit code discarded, `useIpcListeners.ts:65-71`); hover-X kills a busy session with no confirm; window close kills all sessions with no warning and no tray; tmux copy promises persistence but `shutdown.ts:97-99` kill-sessions on quit; missing `claude` binary = dead-end with the real error string deliberately dropped; no tab restore/rename/reorder, no terminal search despite the addon being loaded.

**Theme 2 — keyboard broken where users live (Critical)**: app shortcuts don't fire when a terminal has focus (xterm's hidden textarea trips the "user is typing" heuristic, `useKeyboardShortcuts.ts:550-558`); xterm swallows Ctrl+Tab/K/N/3-8 and leaks control codes into the shell; three surfaces advertise shortcuts that don't exist while a real registry goes unread; palette/QuickSwitcher lack focus traps and dialog roles; `useAnnounce()` has zero callers; ~56 unlabeled icon buttons; no reduced-motion.

**Theme 3 — built-but-never-wired ledger (11 items)**: onboarding wizard, notification bell/store, loading-progress overlay, FTS5 full-text session search (search box only filters project names client-side), session titles/summaries columns never written, tag filter stub that always returns `[]`, palette theme toggle that does nothing until restart, per-project permission/budget fields nobody reads, terminal SearchAddon, 626-line `ErrorRecovery.tsx` with zero imports, LiveRegion/`defaultFilterLogic`. Verdict per item: wire or delete.

**Theme 4 — the UI lies (Critical/High)**: Memory view "saves" CLAUDE.md to SQLite, never disk — Claude never sees it (real file I/O exists unconnected in `contextInjection.ts`); Live Monitor's four stats measure four different things ("27 Live Sessions · 0 Terminals · Idle · 0s Uptime"); analytics shows ephemeral `wf_*` dirs as projects and gives cumulative billions no framing; Notebook/Knowledge and Commands/Skills naming drift.

**Theme 5 — startup (Critical)**: window creation serialized behind DB init, sync backups, full session-tree walk, and an un-timeouted GitHub token fetch (`initialization.ts:34-127`); progress events fire before the window exists; three overlapping session-tree watchers poll forever; every view switch destroys state including terminal scrollback (`MainContent.tsx:207-214`).

**Theme 6 — destructive actions unguarded (High)**: file/dir delete with zero confirm; built-in installs silently overwrite same-name custom hooks/skills/agents (`features.ts:73-97`); merge-conflict UI is whole-file ours/theirs only; a corrupt goodvibes.db (the one un-backed-up file, holding all irreplaceable curation) locks you out.

**Theme 7 — papercuts**: literal string "clipboard" rendered instead of the icon; native `alert()`s for git errors; first push fails without `-u` fallback; detached HEAD shown raw; no stash-and-switch; `--dangerously-skip-permissions` styled like a cosmetic toggle; three permission-mode vocabularies; toast overflow invisible past 3; "empty" indistinguishable from "failed to load" in all 8 feature views; deep links dropped on cold start; no update check.

**Theme 8 — contributor experience**: no `engines` pin, better-sqlite3 fails on current Node, Electron ABI mismatch with no rebuild step, 902 typecheck errors from the missing preload `.d.ts`.

**What the audit says to keep**: trustworthy cost math with dated pricing history (`pricing-fetcher.ts:260-347`); the four-twin feature-view pattern; field-level settings corruption recovery (`settingsStore.ts:243-251`); first-run welcome screen; zero-setup GitHub device flow; dirty-checkout guard / no force-push; performance fundamentals (no sync IPC, debounced watchers, virtualization, bounded buffers, ready-to-show); layered error boundaries; one-click session resume with binary auto-discovery.

Audit roadmap ordering (instructive for the new app's priorities): P0 stop lying/stop losing work → P1 startup + keyboard ("the daily driver") → P2 wire-or-delete → P3 structural (DB durability, updates, tray, tab restore, multi-window, real conflict resolution, a11y).

Other docs: `docs/ARCHITECTURE.md` (accurate high-level, partly stale vs. actual views), `docs/claude-code-hooks-reference.md`, `docs/claude-md-best-practices.md` — reference material, no additional retro content.

## 4. Carry Forward vs. Abandon

**Carry forward (designs/flows/patterns)**
- The **15-view IA and 4-group nav** (Code/Features/Organize/System) — proven, maps cleanly onto tui/agent feature families.
- **Cost/analytics engine semantics**: 4 disjoint token buckets, sha256(messageId|requestId) dedup, dated pricing history, subagent roll-up to parent project. Port the logic, add the missing framing captions and an "Ephemeral" bucket.
- The **uniform feature-view template** (header/empty/confirm/spinner) — extend it to Files and Project Registry which diverged.
- **Session flows**: virtualized list → detail modal → one-click resume; per-folder session table inside the file manager; favorites/archive/tags/collections data model.
- **Git safety patterns**: dirty-checkout explain-and-confirm modal, no force-push, the very complete git operation catalog (worktrees, reflog rescue, cherry-pick/rebase state machines).
- **GitHub device-flow with bundled client ID** — verified working, zero-setup.
- Settings **field-level corruption recovery** and welcome screen.
- Error-boundary layering ("other terminals unaffected") and perf fundamentals (async IPC only, virtualization, bounded PTY buffers, show-on-ready).
- The customizable **shortcut registry with conflict detection** — but make it the single source of truth for every displayed hint.
- Concepts worth reviving properly: recommendation engine, policy engine, headless runner, hook-event capture — in the new app these should ride on the SDK/daemon instead of homegrown plumbing.

**Abandon**
- Electron itself, the 470-channel hand-rolled untyped IPC bridge, and the native-module (better-sqlite3/node-pty) ABI treadmill — Bun + goodvibes-sdk replaces all three.
- Direct JSONL scraping + triple polling watchers; SQLite-mirror-of-everything; startup serialized behind network calls.
- PTY string-scraping for activity detection (`ptyStreamAnalyzer`) — the SDK/daemon has structured session state.
- The unwired features as code (onboarding, ErrorRecovery.tsx, notification store, FTS wiring, tag-filter stub) — re-implement the *ideas* wired end-to-end from day one; adopt the audit's "wire or delete" rule as a release gate.
- Memory-view-to-SQLite deception; Commands/Skills as two skins over one table; the Live Monitor's incoherent stats; unmount-on-view-switch top-level layout.
- Native `alert()`s, hardcoded shortcut lists, UTC-default timezone, single-window-no-tray model, no-update-channel packaging.

## 5. Gaps vs. goodvibes-tui and goodvibes-agent

Desktop is Claude-CLI-only and local-only. It covers none of the following (from `/home/buzzkill/Projects/goodvibes-tui/README.md` v1.10.0 and `/home/buzzkill/Projects/goodvibes-agent/README.md` v1.6.0):

**goodvibes-tui features absent from desktop**
- **Daemon/API host entirely** (loopback daemon, HTTP listener, REST/SSE/control-plane WebSocket, operator auth via bearer/session cookies, TLS off/proxy/direct modes, custom CA trust) — desktop never talks to the daemon.
- **Multi-provider model routing** (providers-and-routing; custom providers in `~/.goodvibes/tui/providers/*.json`; OPENAI_API_KEY etc.) — desktop is Claude-only.
- **Omnichannel surfaces**: Slack, Discord, Telegram, Home Assistant, webhooks, Teams, Matrix.
- **Structured knowledge system** with ingestion of URLs, bookmarks, docs, spreadsheets, artifacts (desktop's "Notebook" is plain notes rows).
- **Remote peer / node-host distributed execution**; dispatch and review work across runners.
- **Schedules** (`.goodvibes/tui/schedules.json`), **services registry**, **encrypted secrets** (`secrets.enc`); desktop only has electron-store token encryption.
- **Voice / live TTS**, **Cloudflare batch + control plane**, **QEMU sandbox bootstrapping**, **project planning**, control-room operator surfaces, typed contract artifacts for external clients (the seam the new app is supposed to consume).
- Native coding tools (`read`/`edit`/`find`/`analyze`/`exec` as first-class typed tools) — desktop delegates all agency to the Claude CLI inside a PTY.

**goodvibes-agent features absent from desktop**
- The **proactive assistant brain**: route planning (`route action:"plan"`), confirmation gates, receipts, `setup action:"repair"` — desktop has no assistant-native surface at all, only a terminal.
- **Workspace areas with no desktop equivalent**: Research (read-only web research → knowledge handoff), Documents & Compare (versioned drafting, blind model comparison with delayed reveal, review boards, judgment artifacts, reviewer handoff ZIPs), Artifacts, Personal Ops (inbox/agenda/tasks/reminders/routines/delivery, connectors), Memory & Skills (VIBE.md personality, vector/embedding health, learned behavior, personas), Channels (companion pairing, confirmed delivery), Voice & Media (image/video generation, browser-tool posture), Automation (visible autonomous agents, routine promotion, reconciliation), Operator Runtime (daemon method discovery, confirmed write/admin routes).
- **Model-visible harness** (`agent_harness`, first-class `workspace|settings|host|models|personal_ops|schedule|execution|memory|research|device|computer|channels|security|support|sessions|audit` tools) — nothing in desktop is model-operable.
- **Shared GoodVibes settings import** across platform stores; **support bundles**, **security posture/finding review**, **audit/readiness evidence**.

**Partial overlaps where desktop is the weaker half**: desktop's hooks/skills/agents/MCP management is Claude-Code-config file management (a real feature the tui/agent don't foreground — worth keeping); its headless runner/policy engine/coordinator prefigure agent's automation+confirmation model but were never surfaced. Conversely, tui/agent have no GUI git/GitHub panel, no xterm-style embedded terminal tabs, and no session-cost analytics dashboard of desktop's depth — those are desktop's unique contributions to the merged app.