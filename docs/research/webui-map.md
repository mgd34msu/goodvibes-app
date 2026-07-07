# goodvibes-webui — Codebase Map

Repo: `/home/buzzkill/Projects/goodvibes-webui` (v1.1.0, private, Bun 1.3.14). "Browser operator surface for the GoodVibes daemon" — a Vite SPA that is intentionally a thin shell over `@pellux/goodvibes-sdk@1.3.1`. This is the closest existing analogue to the desktop app's GUI and its SDK wiring is the single most valuable reference in the ecosystem.

---

## 1. Feature Inventory (pages, panels, flows)

Navigation is a collapsible left sidebar with 11 views, routed by URL query string (`?view=...&session=...&filter[k]=v`) — no react-router (`src/lib/router.ts`, `src/App.tsx` lines 56–76).

### Views
| View | File | Features |
|---|---|---|
| **Chat** (primary) | `src/views/ChatView.tsx` + `src/views/chat/*` | Daemon-owned *companion chat*: session list in sidebar (create/rename/hard-delete with proof-of-gone reconcile — `App.tsx` deleteChat mutation), optimistic send with `local/sent/failed` states, SSE streaming assistant replies (`useChatStream.ts`), attachments via daemon artifact upload (drag/drop + paste-image, `composer-attachments.ts`), resend/regenerate (`companion.chat.messages.retry`), **edit-and-branch** with retained superseded lineage (`companion.chat.messages.edit`, `MessageLineage.tsx`, `lineage.ts`), chat search (backend `sessions.search` + client-side message search, `ChatSearch.tsx`), per-session provider/model picker in composer (updates daemon model selection, never on message payload), auto-title (`auto-title.test.ts`), slash-command hints in composer, voice dictation (`MicButton`) and TTS speak-aloud (`SpeakButton`), artifacts slide-over per message (`ArtifactsPanel.tsx` — extracted code blocks + attachments). |
| **Sessions** ("Union") | `src/views/sessions/SessionsView.tsx` | Cross-surface session union over `sessions.list` (all surface kinds: TUI, agent, webui), master/detail, badges for kind/project/status/truncation, **steer** a live session (`SteerComposer.tsx`, `sessions.steer`), close/reopen/delete, live via raw `session-update` SSE stream. Honest 50-row daemon cap disclosed. |
| **Fleet** ("Processes") | `src/views/fleet/FleetView.tsx` | Live process/session tree from `fleet.snapshot()` (flat parentId-linked nodes → tree), master/detail, per-node capability-gated actions: steer, detach (`sessions.detach`), stop (watchers only, `watchers.stop`); inline approval cards for nodes correlated to pending approvals (`FleetApprovalInline.tsx`); poll + manual refresh (no wire event for fleet.*). |
| **Checkpoints** | `src/views/checkpoints/CheckpointsView.tsx` | Workspace checkpoint browser: list, diff vs working tree, create (renders honest `noop:true`), destructive restore behind explicit confirm. |
| **Approvals** | `src/views/approvals/ApprovalsTasksView.tsx` | Human-in-the-loop approvals: list pending/claimed/history; **per-hunk edit approval** (select individual edit hunks, send `approvals.approve({selectedHunks})` index array — daemon computes result); claim/deny(with note)/cancel; category × risk matrix; plus Tasks: list/create/cancel/retry with verbatim statuses. Realtime via `permissions`/`tasks` domains. |
| **Workstream** | `src/views/workstream/WorkstreamView.tsx` | Orchestration view: `fleet.snapshot` filtered client-side to `workstream`/`phase`/`work-item` kinds, rendered as tree with usage/cost where reported. |
| **Knowledge** ("Wiki") | `src/views/KnowledgeView.tsx` + `src/views/knowledge/*` | ask / search / status / sources / nodes / issues / map (`KnowledgeMap.tsx`) / item / packet (`KnowledgePacket.tsx`) / projections list-render-materialize / URL+artifact ingest / refinement tasks / jobs peek (`KnowledgeJobsPeek.tsx`) / consolidation candidates review (`KnowledgeCandidates.tsx`). Paginated lists, Markdown answers. |
| **Memory** ("Recall") | `src/views/memory/MemoryView.tsx` + siblings | Canonical cross-surface memory store (`memory.records.*`): search/browse (literal vs semantic with server-side **recall-honesty note** — `MemorySearchHonestyNote.tsx`), add (`AddMemoryForm.tsx`), record detail, review queue (`ReviewQueuePanel.tsx`), delete, read-only personas (VIBE.md constraint records). |
| **Calendar** | `src/views/calendar/CalendarView.tsx` | CalDAV-backed `calendar.*`: windowed event list, event peek, create, ICS import/export. Three-way honest refusal taxonomy: unconfigured (412) vs capability-missing (404/501) vs genuine error. |
| **Providers** ("Models") | `src/views/ProvidersView.tsx` | Provider list with derived auth-freshness status (`provider-status.ts`), provider detail/usage, current-model select (provider-first, model-second — `provider-models.ts`), credential status panel (secret-free, `CredentialStatusPanel.tsx`), accounts panel, **Model Workspace modal** (`ModelWorkspaceModal.tsx`) — multi-target picker (main/helper/tool/tts/embeddings) with search/price filter, ported toward the TUI's model workspace. |
| **Admin** ("Secure") | `src/views/AdminView.tsx` | Username/password login (daemon `/login`), paste/validate explicit operator token, clear token, local auth status, control status/snapshot diagnostics, config **SettingsModal** (categorized like the TUI's settings modal, secret-key masking via `config-redaction.ts`, one-key-at-a-time `config.set`), display prefs (code line numbers), **NotificationSettings** (Web Push subscribe/verify/test + PWA install prompt), realtime error diagnostics. |

### App-level chrome & flows
- **Auth gates**: `SignedOutGate` (401 → front door), `DaemonUnreachableGate` rendered as *overlay over the still-mounted inert workspace* so drafts survive outages (`App.tsx` ~330–375), splash while validating stored token.
- **Command palette** (⌘K): registry + fuzzy palette + shortcut cheatsheet (`src/lib/commands.ts`, `command-groups.ts`, `src/components/command/*`, `useHotkeys.ts` — `g c`-style chords).
- **Peek panel**: right slide-over used by Knowledge/Memory/Providers/Calendar/Artifacts (`src/components/peek/PeekPanel.tsx`).
- **Status strip** (bottom, 32px): three-axis daemon health — Reachable / Signed-in / Working — plus latency, SSE state, active turns, queued tasks (`src/components/status/StatusStrip.tsx`, `src/lib/daemon-health.ts`, `useDaemonHealth.ts` 15s poll).
- **Toasts** (`src/lib/toast.ts`, `src/components/toast/*`), **Onboarding** first-run panels per surface, **EmptyState/ErrorState/SkeletonBlock/ErrorBoundary** feedback kit, ARIA announcer (`useAnnouncer.ts`), focus trap (`useFocusTrap.ts`).
- **Voice**: daemon-routed STT dictation and streaming TTS playback (`src/components/voice/*`, `sdk.operator.voice.*`, raw `ttsStream` fetch → Web Audio), with honest insecure-context/unsupported/unconfigured states.
- **PWA**: service worker, install prompt, Web Push (VAPID key fetch, subscribe/list/verify/delete via `push.*` verbs; approval/completion pushes with deep links — `src/lib/push/*`, `src/lib/pwa/*`, `notification-link.ts`).
- **Theming**: dark default, light opt-in, compact density, reduced-motion — persisted + cross-tab synced (`src/lib/theme.ts`, `useTheme.ts`).

---

## 2. Tech Stack

- **Runtime/build**: Bun 1.3.14 + Vite 8 + React 19 + TypeScript 6 (strict). Tests: `bun test` with happy-dom + Testing Library; e2e Playwright (phone + desktop projects).
- **State**: TanStack Query v5 is the *only* server-state store — no Redux/Zustand. Central query-key registry in `src/lib/queries.ts` (`queryKeys`), boot via one `Promise.allSettled` snapshot (`loadBootSnapshot`). Local React state + localStorage caches only for UI prefs and companion-session sidebar warm-start (`src/lib/companion-chat.ts`). Doctrine: "no second local store for canonical daemon data" (`docs/architecture.md`).
- **Routing**: hand-rolled URL-state encoder over `window.history` (`src/lib/router.ts`, `useUrlState.ts`).
- **Styling**: plain CSS with a token system (`src/styles/tokens.css` → `src/styles.css` → per-component CSS files in `src/styles/components/*.css`). No Tailwind, no CSS-in-JS, no component library. Icons: `lucide-react`. Markdown: `react-markdown` + `remark-gfm` + `remark-breaks` + `highlight.js` (`MarkdownMessage.tsx`, `src/lib/highlight.ts`).
- **SDK consumption in browser** (`src/lib/goodvibes.ts`, 1472 lines — the keystone file):
  - `createBrowserKnowledgeSdk` + `forSession` from `@pellux/goodvibes-sdk/browser/knowledge`; token store via `createBrowserTokenStore({key:'goodvibes.webui.token'})` from `@pellux/goodvibes-sdk/auth`; types from `@pellux/goodvibes-sdk/contracts`.
  - Exports a hand-built `sdk` facade: `auth`, `operator.{invoke, control, accounts, providers, credentials, config, voice, models, tasks, calendar, approvals, memory, fleet, checkpoints, sessions (incl. steer/followUp/detach/search/inputs), watchers, push}`, `chat.{sessions, messages(+retry/edit), events}`, `artifacts`, `realtime.viaSse`, `streams.open` (raw SSE escape hatch), `knowledge` (lines 1003–1336).
  - `EXTRA_METHOD_ROUTES` table: hand-written HTTP route rows for operator methods the pinned browser SDK route maps don't cover (approvals, calendar, memory, models, config, companion delete/close/retry/edit, ...), with capability probes via `control.methods.get` and error classifiers (`isMethodUnavailableError`, `isMethodNotInvokableError`, etc. in `src/lib/errors.ts`).
  - `contract-bridge-types.ts`: hand-authored I/O types for verbs whose generated contracts haven't landed (fleet/checkpoints/sessions.search) — a documented swap seam.
- **Realtime**: SSE only, exactly **two** connections by design (browser 6-per-origin cap):
  1. `useRealtimeInvalidation.ts` — one multiplexed stream `GET /api/control-plane/events?domains=tasks,permissions,providers,knowledge,control-plane`; frames only *invalidate* React Query keys (never rendered directly).
  2. `useSessionRealtime.ts` — raw stream for the un-domained `session-update` wire event (the scoped `viaSse()` drops it).
  Chat streaming is a third, session-scoped SSE via `sdk.chat.events.stream` (`useChatStream.ts`). Both app streams are gated on `auth.isSuccess` and degrade to a single "live updates paused" banner + periodic refetch.
- **Dev topology**: daemon/control-plane on port 3421, web surface 3423; Vite proxies `/api/*`, `/login`, `/status`, `/task`, `/config` with WS upgrade; binding resolved from `GOODVIBES_WEB_HOST/PORT/GOODVIBES_DAEMON_BASE_URL` env → `goodvibes web --json` → TUI settings (`vite.config.ts`). `strictPort:true`. An SDK-overlay guard plugin refuses production builds while a local SDK link is active; `scripts/sdk-dev.ts` manages link/status/restore.

---

## 3. Design System

Yes — a coherent, documented visual language exists and is contract-enforced (`docs/ux-overhaul/TOKEN-CONTRACT.md`: "all workstreams MUST use these exact names"). Two explicit layers:

**Layer 1 — WebUI brand tokens** (`src/styles/tokens.css`, explicitly "webui-only, NOT the SDK presentation contract"). Dark-first neon-cyan operator aesthetic:
- Theme mechanic: `:root` = dark default; `:root[data-theme="light"]` opt-in; `:root[data-density="compact"]`; `prefers-reduced-motion` collapses motion to 0. JS falls back to `prefers-color-scheme` only when no stored pref.
- **Dark colors**: surfaces `#08080f` base / `rgb(8 8 15/86%)` raised / `rgb(12 10 28/94%)` overlay; borders are cyan-alpha (`rgb(0 255 255/18–64%)`); text `#f8fbff`/`#a7b7d8`/`#7583a4`, accent-text `#8ffcff`; accent teal `#00dede` (hover `#00ffff`); status success `#38ff8b`, warning `#ffcc66`, danger `#ff6ac8` (pink!), info `#8da2ff`, each with `-soft` 12–14% alpha fills; brand neon `--brand-cyan #00ffff / --brand-pink #ff00ff / --brand-yellow #ffcc00 / --brand-purple #1a0b2e` — rule: "glow/accents only, never large fills". Light theme is a full desaturated re-mapping (accent `#0a8f73` green-teal etc., lines 88–134).
- **Scales**: 4px space scale (`--space-1..12`); radius 6/8/12/999; type: Inter (`--font-sans`), Space Mono (`--font-mono`), Press Start 2P (`--font-display`, "brand moments only"); sizes 12–30px (base 14); motion 120/180/260ms with standard + spring easings; z-index ladder nav 10 / peek 40 / overlay 50 / palette 60 / toast 70; layout constants `--sidebar-width:264px`, collapsed 60px, `--statusstrip-height:32px`, `--row-h:36px` (28 compact). Elevations are cyan-ring + black shadow combos.
- Layout pattern: sidebar + topbar (eyebrow-subtitle + h1) + view-frame + bottom status strip; master/detail lists that collapse to single-pane ≤980px; right peek slide-over; modal for configuration ("modals are configuration, pages are observability" doctrine — `SettingsModal.tsx` header).

**Layer 2 — SDK presentation contract** (generated): `@pellux/goodvibes-sdk/platform/presentation` → `scripts/generate-presentation-tokens.ts` → checked-in `src/lib/generated/presentation-tokens.ts` + `src/styles/generated/presentation-tokens.css` (`--contract-glyph-*`, `--contract-state-*`), drift-checked in the build (`presentation:check`). `src/lib/presentation-bridge.ts` maps webui status vocabulary (BadgeTone ok/warning/bad/neutral, daemon-health axes) onto the contract's 4 severity buckets + 16 status glyphs **the TUI and agent already render through**. For the desktop app this is the cross-surface consistency mechanism to adopt wholesale: consume the SDK presentation contract for glyphs/state tones, keep surface-specific brand palette separate.

The desktop app should stay consistent with: dark-first cyan/teal identity, the semantic token names (the TOKEN-CONTRACT list is directly portable), the honest-status color/glyph bridge, and the shell anatomy (sidebar/topbar/status-strip/peek/palette).

---

## 4. Reusable for the Desktop App (patterns/code to adapt — with paths)

**Adopt nearly verbatim (framework-agnostic TS, minimal DOM coupling):**
- `src/lib/goodvibes.ts` — the entire SDK facade: scoped-SDK setup, `invokeOperator` typed/untyped overloads, `EXTRA_METHOD_ROUTES` pattern, capability probing (`control.methods.get`), proof-of-gone delete reconcile. In a Bun desktop app you may use the *node/server* SDK entry instead of `browser/knowledge`, but the facade shape, method inventory, and honesty patterns transfer directly.
- `src/lib/errors.ts` — error taxonomy (`isDaemonUnreachableError`, `isMethodUnavailableError`, `isMethodNotInvokableError`, `isSessionNotFoundError`, `isAuthExpiredError`, calendar-specific classifiers). Load-bearing for every view's degraded states.
- `src/lib/queries.ts` — query-key registry + boot snapshot + the prefix-key convention (`['sessions', id, 'messages']` so one invalidation fans out).
- `src/hooks/useRealtimeInvalidation.ts` + `useSessionRealtime.ts` — the two-stream SSE architecture, the `?domains=a,b,c` multiplexing, the DOMAIN_INVALIDATIONS map, and the "invalidate, never render from frames" rule. The connection-budget rationale matters less in a desktop webview but the architecture is still right.
- `src/lib/daemon-health.ts` + `useDaemonHealth.ts` — three-axis health model (Reachable/Signed-in/Working) and StatusStrip semantics.
- `src/lib/companion-chat.ts`, `src/views/chat/message-utils.ts`, `lineage.ts`, `useChatSend.ts`, `useChatStream.ts` — optimistic send/stream/reconcile state machine, edit-and-branch lineage, turn states.
- `src/lib/presentation-bridge.ts` + `scripts/generate-presentation-tokens.ts` — regenerate-and-drift-check pipeline for SDK presentation contract parity.
- `src/lib/provider-models.ts`, `provider-status.ts`, `model-catalog.ts` — provider-first/model-second normalization and auth-freshness derivation.
- `src/lib/commands.ts` + `command-groups.ts` + `useHotkeys.ts` — command registry/palette/chord system.
- `src/lib/config-redaction.ts` — secret-shaped key masking + TUI-parity settings category labels.
- `src/lib/approvals.ts`, `fleet.ts` (wire-backed action gating, `buildFleetRows`, approval↔node correlation), `checkpoints.ts`, `sessions-union.ts`, `object.ts` (defensive `bestId/bestTitle/firstString` wire readers).
- `src/styles/tokens.css` + `docs/ux-overhaul/TOKEN-CONTRACT.md` — copy the token sheet outright.

**Patterns to reimplement (React components, easy to port since it's plain React+CSS):**
- Shell: `src/components/shell/AppShell.tsx` provider nesting (Theme → ErrorBoundary → Toast → Command → Peek + StatusStrip/Announcer chrome); `App.tsx` auth-gate/overlay-not-remount pattern.
- Component kit: Modal (focus-trapped), PeekPanel, Toast, CommandPalette, StatusBadge, RecordList, DataBlock, MarkdownMessage (line numbers UI-only/not-copied), EmptyState/ErrorState/Skeleton/Onboarding, motion/Presence + useReducedMotion.
- Every view's honest-state taxonomy (Calendar's 3-way refusal, Memory's recall-honesty note, Fleet's unbacked-capability notes, delete-means-delete reconcile) — these encode hard-won daemon-contract knowledge in their header comments; read those docblocks when reimplementing.
- Voice: `src/components/voice/*` + `src/lib/voice/*` (daemon STT/TTS via `voice.*` verbs; note: browser `getUserMedia`/secure-context caveats change in a desktop webview — mostly *simplify*).
- Docs worth mining: `docs/architecture.md` (chat model do/don'ts: never `sessions.followUp` for companion chat, never `sessions.messages.create` as send fallback), `docs/sdk-surface-matrix.md` (surface→SDK-call map + explicit non-surfaces), `docs/sdk-update-checklist.md`, `docs/ux-overhaul/PLAN.md`.

---

## 5. Gaps and Weaknesses

- **Docs lag code**: `docs/architecture.md`/`operator-guide.md`/README describe a 4-view app (Chat/Knowledge/Providers/Admin) and SDK 0.33.30; the code has 11 views and SDK 1.3.1. Trust code + inline docblocks over the top-level docs.
- **No realtime for fleet/checkpoints/memory/calendar** — no wire events exist for these verb families (pinned upstream); views poll or refetch on mutation (`src/lib/queries.ts` comments). Desktop app inherits this until the SDK adds events.
- **Contract shims everywhere**: `EXTRA_METHOD_ROUTES` + `contract-bridge-types.ts` carry hand-written routes/types for approvals, calendar, memory, models, config, companion retry/edit/close/delete, fleet, checkpoints, sessions.search — each a drift risk against daemon versions, mitigated by capability probes but real maintenance load. The desktop app should centralize the same seam.
- **Chat is companion-only**: no operator-session continuation from Chat (deliberate); steer/follow-up live in Sessions/Fleet. No rich attachment preview/management, no true branch-tree UI (lineage is linear supersede history). Work-plan surface explicitly deferred (`docs/known-limitations.md`).
- **Fleet control is thin**: only steer/detach/stop-watcher are wire-backed; kill/pause/resume of processes render as honest notes, not actions. Workstream view is a client-side filter over fleet.snapshot (no dedicated contract), 2000-node cap, 50-session union cap.
- **Voice**: dictation/TTS require secure context in the browser; no full duplex voice conversation mode.
- **No component library/design tooling**: plain CSS per component (~30 files) is coherent but has legacy alias vars (`--gv-*`, `--ink`, `--panel` in `src/styles.css`) layered over the token system — two naming generations coexist; external Google Fonts import (`styles.css` line 1) would break under a strict-CSP/offline desktop shell — fonts must be bundled.
- **Auth UX**: username/password + pasted operator tokens in localStorage; `window.confirm` for destructive actions (delete chat, restore checkpoint) — fine for a webpage, sub-par for a desktop-class app (should get native dialogs/keychain).
- **Model workspace capability filter** renders disabled (no wire data for capabilities yet — `model-catalog.ts`).
- **Phone support is best-effort** (≤980px single-pane collapses, mutation actions desktop-only in Fleet) — irrelevant for desktop, but the breakpoint logic is baked into components and CSS.