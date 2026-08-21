# goodvibes-app: architecture

The GoodVibes desktop app is a "Claude Desktop"-class GUI that unifies every capability of
goodvibes-tui (coding, operations, automation, knowledge, channels, control plane) and
goodvibes-agent (an operator assistant covering routines, personas, skills, personal ops,
research, and documents) in one TypeScript-native, Bun-powered application built on
`@pellux/goodvibes-sdk`.

Every claim in this document is verified against goodvibes-app's own current source. The
feature completion bar is `docs/FEATURES.md`; the UX contract is `docs/UX.md`.

## 0. Non-negotiables

1. **UI/UX first.** When a technical choice trades against perceived latency, clarity, or
   click count, UX wins. Streaming renders immediately; mutations are optimistic; nothing
   blocks the window from painting.
2. **Wire or delete.** (The goodvibes-desktop autopsy rule.) No surface ships unless its
   backing call works end to end. Capabilities without wire backing render as *honest*
   read-only or "not available on this daemon" states, never silent stubs.
3. **TypeScript-native, Bun everywhere.** One language, one runtime. No Node, no Rust,
   no Electron.
4. **The daemon is the engine.** We do not reimplement agent execution, providers, tools,
   knowledge, or channels. We operate them over the typed 507-method operator contract.

## 1. Stack (versions verified against package.json and this machine, 2026-08-21)

| Layer | Choice | Why |
|---|---|---|
| Shell/runtime | `electrobun@1.18.1` | Bun-native main process, typed RPC to webview, system WebKitGTK on Linux (~14 MB bundles). Verified working on Arch/Hyprland (XWayland). |
| Engine | `goodvibes-daemon` from `@pellux/goodvibes-tui@2.0.15` (npm dep), running as daemon 1.28.21 once adopted | The full runtime, covering providers, tools, agents, knowledge, channels, and automation. Adopt-or-spawn so app + TUI + agent share one daemon. |
| Contract/client | `@pellux/goodvibes-sdk@2.0.19` | Typed operator client, contracts, realtime SSE/WS connectors, auth, errors, pairing helpers. |
| UI | React 19 + TanStack Query v5 | Direct reuse of goodvibes-webui's proven patterns. |
| Styling | Plain CSS design tokens (webui token contract) + SDK presentation contract | Cross-surface visual consistency with TUI/agent/webui. No Tailwind, no CSS-in-JS. |
| Markdown/code | react-markdown + remark-gfm + highlight.js | Same as webui. Fonts bundled locally (no external fetches, strict offline). |
| Icons | lucide-react | Same as webui. |

**Linux launch requirement:** `WEBKIT_DISABLE_DMABUF_RENDERER=1` must be in the process
environment before the native wrapper creates a webview, or WebKitGTK paints a blank
window (GBM buffer failures, verified in the spike). The launcher wrapper script sets it.
Known-benign: one `GLXBadWindow` X11 warning at startup; Linux runs under XWayland until
Electrobun's Wayland PR lands. App menus don't exist on Linux. All chrome is in-page.

## 2. Process model

```
┌────────────────────────────────────────────────────────────────┐
│ Bun main process (Electrobun)                    src/bun/      │
│                                                                │
│  daemon-manager   probe :3421 /status → adopt | spawn detached │
│                   (goodvibes-daemon bin from node_modules),    │
│                   version-band check, companion token          │
│  ui-server        Bun.serve on 127.0.0.1:<random>              │
│                   • serves bundled UI assets                   │
│                   • reverse-proxies /api/*, /login, /status,   │
│                     /task, /config → daemon, injecting         │
│                     Authorization: Bearer <token> server-side  │
│                   • streams SSE through untouched              │
│  native-rpc       Electrobun typed RPC: dialogs, notifications,│
│                   tray, clipboard, external-open, PTY,         │
│                   window controls, app-settings                │
│  app-registries   file-based agent-brain stores (routines,     │
│                   personas, skills, notes, VIBE) under         │
│                   ~/.goodvibes/app/ + import bridges           │
│  git-service      app-local git ops for Git/Diff views         │
│  pty-service      terminal tabs (spawn shell under a pty)      │
│  wake-service     same-origin wake-word model byte serving,    │
│                   sha256-verified per request (see §5b)        │
│  github, subscriptions, secrets, pairing, notifications        │
│                   further app-local Bun-side services (§5)     │
└───────────────┬───────────────────────────┬────────────────────┘
                │ BrowserWindow(url:        │ HTTP (loopback)
                │  http://127.0.0.1:<port>) │
┌───────────────▼───────────────────────────▼────────────────────┐
│ Webview (WebKitGTK)                              src/ui/       │
│  React 19 SPA · TanStack Query · SSE realtime · CSS tokens     │
│  fetch("/api/...") → same-origin → proxy → daemon              │
│  Electrobun RPC bridge for native-only actions                 │
└────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │ goodvibes-daemon :3421 │  (shared with TUI,
                    │ 507-method contract    │   agent, webui,
                    │ SSE /WS realtime       │   mobile companions)
                    └────────────────────────┘
```

Why the proxy (instead of webview → daemon directly):
- **Zero CORS.** The UI is same-origin with its API. Identical to webui's Vite dev proxy
  topology, so all webui patterns port unchanged.
- **Token security.** The bearer token lives only in the Bun process. The webview never
  sees or stores credentials (fixes webui's localStorage-token weakness).
- **One seam for resilience.** Daemon restarts/retries/adoption changes are invisible to
  the UI; the proxy re-resolves the daemon base URL.

The proxy binds `127.0.0.1` only, on a random free port, and requires an
`X-GV-App` header stamped by the webview bootstrap (defense-in-depth against other local
processes; the port is also unguessable).

## 3. Daemon lifecycle (src/bun/daemon-manager.ts)

Mirrors the TUI's `startHostServices` topology:
1. Resolve config: `controlPlane.host/port` from `~/.goodvibes/tui/settings.json` if
   present (TUI users), else defaults `127.0.0.1:3421`.
2. Probe `GET /status`. If a GoodVibes daemon answers, it runs a version-band check
   (1.x major match). Compatible → **adopt**. Incompatible → surface a first-class error
   screen with the versions and remediation (never start a competing daemon on the port).
3. If nothing listens, spawn `goodvibes-daemon` **detached** (bin from our
   `node_modules/@pellux/goodvibes-tui`), record pid/port, poll `/status` until ready,
   then adopt. The daemon outlives the app (same as TUI's detached layer). Closing the
   app never kills running agent work. A settings toggle offers "stop daemon on quit".
4. Token: `getOrCreateCompanionToken('app', { daemonHomeDir: ~/.goodvibes/daemon })`
   from `@pellux/goodvibes-sdk/platform/pairing`, the same store the TUI/agent use, so
   adoption works with zero setup on a machine that has ever run either.
5. Health loop: `/status` + `control.snapshot` on a 15s cadence feeding the status strip
   (three axes, Reachable / Signed-in / Working), with SSE liveness as the fast signal.

## 4. UI data layer (src/ui/lib/)

Ported webui doctrine, adapted for this app's own proxy topology:
- **TanStack Query is the only server-state store.** Central `queryKeys` registry;
  prefix-key invalidation fan-out; boot snapshot via one `Promise.allSettled`.
- **SDK facade** (`src/ui/lib/gv.ts`): typed wrapper over `fetch('/api/...')` built from
  `@pellux/goodvibes-sdk/contracts` types (client-safe subpath, browser-legal). Includes
  the `EXTRA_METHOD_ROUTES` seam for methods missing from pinned route maps, capability
  probing via `control.methods.get`, and the webui error taxonomy
  (`isMethodUnavailableError`, `isDaemonUnreachableError`, …).
- **Realtime:** SSE. One multiplexed invalidation stream
  (`/api/control-plane/events?domains=…`) that only invalidates query keys. Frames are
  never rendered directly; one raw stream for `session-update`; per-chat-session streams
  via `companion.chat.events.stream`. Desktop has no 6-connection browser cap, but the
  architecture stays: it's the right consistency model. Degradation: "live updates
  paused" banner + refetch, never a blank screen.
- **Mutations on HTTP, reads refreshed by events** (snapshot → subscribe → invalidate).

## 5. App-local services (Bun side)

Features from the products that are process-local (not daemon methods) are implemented in
the Bun main process and exposed to the UI through the same proxy server under `/app/*`
routes (same-origin, same patterns, and TanStack Query doesn't care who answers). Every
service registers under its own route prefix in `src/bun/app-routes.ts`, the single
composition point; one module owns each prefix:

- `/app/registries/*` (`src/bun/registries/`): agent-brain stores for routines, personas,
  skills, notes, VIBE.md, and profiles. File-based JSON registries under
  `~/.goodvibes/app/` matching goodvibes-agent's record shapes, plus **read-only import
  bridges** from `~/.goodvibes/agent/*` and TUI stores (preview then confirm, redacted,
  source never mutated, the agent's own settings-import pattern).
- `/app/git/*` (`src/bun/git.ts`): status/log/diff/branches/stage/commit/stash/worktrees
  for the workspace (Bun spawning `git`; no native modules). Safety rules include
  dirty-checkout confirm, no force-push, and no unguarded destructive ops.
- `/app/pty/*` + WS (`src/bun/pty.ts`): terminal tabs, real pseudo-terminals, no native
  npm modules. Exit codes surface loudly rather than leaving a dead terminal silent.
- `/app/settings/*` (`src/bun/settings-store.ts`): the single writer for
  `~/.goodvibes/app/settings.json`, holding app-shell settings (theme, density,
  keybindings, window state, daemon lifecycle prefs); `secrets.ts` owns a disjoint set of
  top-level keys in the same file.
- `/app/secrets` (`src/bun/secrets.ts`): SecretsManager and ServiceRegistry, surfaced
  Bun-side through the SDK's `platform/config` because no daemon wire method exists for
  either.
- `/app/local/*` (`src/bun/local-tools.ts`): Bun-side local-machine tools that touch the
  user's real home directory and localhost; each handler is bounded and self-contained.
- `/app/pairing` (`src/bun/pairing.ts`): builds the QR-encodable connection payload for
  pairing a phone or companion device to the daemon this app adopted, using the SDK's own
  pairing helpers, in the same payload format the TUI and daemon already use.
- `/app/notifications` (`src/bun/notifications.ts`): native desktop notifications and
  routing preferences; delivery prefers `notify-send` on Linux and falls back to
  Electrobun's cross-platform `Utils.showNotification` (wired in `src/bun/index.ts`).
- `/app/subscriptions` (`src/bun/subscriptions.ts`): OAuth-backed provider subscriptions,
  built on the SDK's `SubscriptionManager` and subscription-provider helpers (including
  OpenAI Codex OAuth and loopback OAuth), sharing state with the TUI's own
  `subscriptions.json`.
- `/app/github` (`src/bun/github.ts`): GitHub device-flow and PAT auth, a thin read proxy
  to the GitHub REST API, and the SDK-backed write calls (PR comment, PR review, issue
  comment) `GitHubPanel` calls live.
- `/app/wake/*` (`src/bun/wake-models.ts`): same-origin serving of the pinned wake-word
  model bytes; see §5b for the full design.
- `/app/ws` (`src/bun/ws-bridge.ts`): a WebSocket bridge between the webview and the
  daemon's `/api/control-plane/ws`, opened Bun-side so the bearer auth frame never reaches
  the webview; frames pipe through verbatim after that.
- `/app/dev/eval` (`src/bun/dev-driver.ts`): dev-only, enabled by `GOODVIBES_APP_DEV=1`
  (which `scripts/launch.ts` sets automatically), executes arbitrary JS inside the running
  webview and returns the result, the app's built-in end-to-end harness. Requires the same
  `X-GV-App` header the proxy checks everywhere else and is absent from production builds
  unless something explicitly opts in.

Rule: Bun-side platform subpaths of the SDK (`platform/*`) may be imported **only** in
`src/bun/`, never in `src/ui/` (which uses client-safe subpaths only). A check script
(`bun run check:boundaries`) enforces this at build.

## 5b. Wake-word architecture

The wake-word stack lets the app listen for a wake phrase locally in the webview and hand
a confirmed detection off to voice input, without streaming raw audio anywhere. It is
ported from goodvibes-webui's own wake tab, adapted for this app's process split: capture,
mic arbitration, the detection runtime, model management, and the React host/glue live
under `src/ui/lib/wake/` (`capture.ts`, `mic-arbiter.ts`, `wake-runtime.ts`,
`wake-models.ts`, `wake-host.ts`, `wake-config.ts`, `wake-chime.ts`, `useWake.ts`).

Model bytes (a classifier, an embedding model, and a VAD model, together a few megabytes)
are served same-origin rather than proxied through the daemon:
- **Local daemon (the common case):** once `voice.wake.status` reports a model artifact as
  content-verified, `src/bun/wake-models.ts` reads that file straight off the disk the Bun
  process shares with the daemon (`GET /app/wake/model/:component` for
  `classifier | embedding | vad`, plus a `HEAD` variant that returns the same headers
  without a body so the UI-side cache can check the current sha256 before deciding whether
  to re-download). The route re-reads the file fresh on every request rather than trusting
  a previously reported status, refuses to serve a file whose size no longer matches what
  the daemon last reported, and computes the sha256 of the bytes it actually sends,
  carrying it in a response header so the client verifies the same bytes it received.
- **Non-local daemon:** when `voice.wake.surfaces.app` points at a daemon that is not this
  machine, `src/bun/wake-models.ts` cannot read its files and refuses honestly with `409
  APP_WAKE_MODEL_REMOTE_DAEMON` instead of pretending to serve them. The UI-side loader
  (`src/ui/lib/wake/wake-models.ts`) falls back to the chunked daemon verb
  `voice.wake.model.get`, the same path goodvibes-webui's tab has always used.

The detector runtime is WASM-backed (`onnxruntime-web`); its `ort-wasm-simd-threaded.asyncify.wasm`
binary is copied at build time into `views/mainview/wasm/` (`electrobun.config.ts`) and
served with an explicit `application/wasm` MIME type (`src/bun/ui-server.ts`), since
`Bun.build` has no bundler asset-URL loader for it here.

A confirm-gated toggle and a live status indicator join the app's existing voice controls,
and the status strip gains a wake chip reflecting current listening state.

## 6. Repo layout

```
electrobun.config.ts      app name/identifier, entrypoints, copy rules
src/bun/                  main process
  index.ts                boot: env fix → daemon-manager → ui-server → window →
                           tray/notification wiring (tray and native-notification
                           delivery are set up here, not in separate files)
  env.ts                  process-local environment normalization, first import
  daemon-manager.ts       probe/adopt/spawn/version-band/token
  ui-server.ts            static assets + /api proxy + /app routes + SSE pass-through
  app-routes.ts           composition point every /app/* service registers into
  ws-bridge.ts            webview /app/ws to daemon /api/control-plane/ws bridge
  dev-driver.ts           dev-only /app/dev/eval webview driver
  registries/             agent-brain file stores + import bridges
  git.ts, pty.ts          workspace git ops, terminal PTY sessions
  settings-store.ts       single writer for ~/.goodvibes/app/settings.json
  secrets.ts              SecretsManager + ServiceRegistry (Bun-side only)
  local-tools.ts          local-machine tools bounded to the user's own home dir
  pairing.ts              companion/phone pairing QR payload
  notifications.ts        native desktop notifications + routing prefs
  subscriptions.ts        OAuth-backed provider subscriptions
  github.ts               GitHub device-flow/PAT auth + REST proxy + SDK writes
  wake-models.ts          same-origin wake-word model byte serving (§5b)
src/shared/               types shared bun↔ui (RPC schema, /app route contracts)
src/ui/                   webview SPA
  main.tsx, App.tsx       shell: providers → gates → sidebar/topbar/statusstrip
  lib/                    gv.ts facade, queries.ts, errors.ts, realtime hooks,
                          commands.ts (palette), presentation-bridge.ts, safe-href.ts
                          (the one URL-scheme gate for every daemon- or
                          content-supplied href), wake/ (wake-word client stack)
  views/<domain>/         one directory per sidebar view (31 views, §UX)
  components/             kit: Modal, Peek, Toast, Palette, StatusBadge, Markdown, …
  styles/tokens.css       design tokens (see docs/UX.md)
scripts/                  build, typecheck, presentation-token generation, checks
test/                     bun test (lib/logic), later Playwright against the proxy port
```

## 7. Security posture

- Bearer token: Bun process memory + the shared `operator-tokens.json` store (0600).
  Never in the webview, never in logs.
- Proxy: loopback bind, random port, `X-GV-App` header check, no directory listing.
- Confirm-gated daemon methods (`dangerous: true` / `confirm` required): the UI renders
  explicit confirmation surfaces and passes `confirm:true` + `explicitUserRequest`
  metadata exactly like the agent does. No auto-confirm setting exists.
- Secrets views mask by default (webui `config-redaction` pattern); reveal is explicit
  and never persisted.
- External links open via RPC → `xdg-open`, never navigate the app webview.
- URL scheme gate (`src/ui/lib/safe-href.ts`): every href built from a daemon payload or
  other content the app did not write itself (research findings, GitHub API bodies, CI
  reports, subscription provider links, daemon update links, device capture payloads)
  passes through one function before it reaches an `<a href>`. A `javascript:` or `data:`
  value never renders as a link, and a bare relative-looking string never silently
  resolves against the app's own origin; a refused value renders as an inert span instead.

## 8. Packaging & dev loop

- Dev: `bun run dev` → `electrobun build` + launcher with dev console; UI hot-iteration
  via rebuild (Bun.build is fast; watch mode via `electrobun dev --watch`).
- Dist: `electrobun build --release`-equivalent targets; Linux artifact is the
  self-extracting bundle + a `.desktop` file + wrapper script exporting the WebKit env
  fix. macOS/Windows targets stay buildable but are untested for now (documented).
- Updates: Electrobun's bsdiff updater wired later; out of scope until the app is stable.

## 9. Display scale (Linux/XWayland)

A user-global `GDK_SCALE=2` (set for other GTK3/XWayland apps on this machine) doubles
the entire app UI when inherited into this process's environment. GTK4-native-Wayland
apps ignore `GDK_SCALE`, which is why this app is the one thing on the machine affected.
WebKitGTK's webview still renders through the X11/XWayland scaling path.

- **Dev-launch fix (in place):** `scripts/launch.ts` builds the spawned child's env from a
  copy of `process.env` with `GDK_SCALE` and `GDK_DPI_SCALE` deleted before `Bun.spawn`.
  The user's own shell/session environment is never touched. Only the launched app
  process's env is stripped. This is verified working (2026-07-07).
- **Production-launcher gap (open, not yet fixed):** the bundled release launcher
  (the `.desktop` entry + wrapper script from §8) execs the built `bin/launcher`
  directly and inherits whatever environment the desktop session hands it. It does
  **not** go through `scripts/launch.ts`, so the `GDK_SCALE` strip does not apply to
  installed/packaged builds today. A future wrapper script (or a patch to the
  `.desktop`/wrapper generation in the electrobun CLI's Linux packaging step) needs to
  perform the same env-stripping before exec. Until then, packaged builds on a machine
  with a global `GDK_SCALE` override will render doubled.
- **The port-50000 relaunch race (operational hazard, not a scale bug):** Electrobun
  binds a fixed internal port (50000) for its own IPC. Killing and immediately
  relaunching the app races that port's release. A relaunch that starts before the
  previous process's port is freed dies at boot with GTK "invalid unclassed pointer in
  cast to GtkWidget" errors. This race was repeatedly misdiagnosed as instability in the
  `GDK_SCALE` env fix itself during investigation. Always poll `ss -tln | grep :50000`
  until the port is free before spawning a new instance. Never relaunch
  back-to-back without that check.
- **Known dead ends, do not retry these:**
  - **CSS `zoom`.** Blurry text/images and native form-control sizes desync from the
    scaled layout (checkboxes, selects, and other form controls do not scale with `zoom`).
  - **CSS `transform: scale(...)` on the root.** Breaks `vh`/`vw`-relative sizing and
    any resize-driven layout; scrolling and hit-testing region math goes wrong too.
  - **Electrobun's `webviewSetPageZoom` / `setPageZoom` API.** Semantics are inverted
    from what the name implies on this build, and toggling it has produced webview
    instability ("invalid unclassed pointer in cast to GtkWidget", the same failure
    signature as the port-50000 race, which is what made this dead end hard to isolate
    from the operational hazard above).

  All three were tried and rejected during the Wave D display-scale investigation
  (2026-07-07); the only working fix remains the dev-launch env strip above.

## 10. Risks & fallbacks

| Risk | Mitigation |
|---|---|
| Electrobun bus factor / Linux polish (resize bugs #188/#371) | All logic lives behind the proxy + RPC seams; the shell is swappable (Tauri sidecar or `--app`-mode browser) without touching src/ui or the Bun services. Avoid CEF on Linux; system WebKitGTK only. |
| Daemon contract drift (sdk 2.0.19 vs a running daemon that may lag, e.g. 1.28.21 from tui 2.0.15) | Capability probes before non-core calls; `EXTRA_METHOD_ROUTES` seam; version-band gate at adopt time; honest "method unavailable" states. |
| WebKitGTK quirks (fonts, media) | Bundle fonts; test TTS audio playback early (Wave D); `WEBKIT_DISABLE_DMABUF_RENDERER=1` baked into every launch path. |
| Companion-chat rate limit (30 msg/min/client) | Client-side send throttle indicator; never silently drop. |
| Linux window-class branding (`WM_CLASS` shows electrobun's own default, not "GoodVibes") | Upstream gap in electrobun 1.18.1's Linux native wrapper. `libNativeWrapper.so` has no JS-facing hook to set the X11 class hint; `app.name`/`app.identifier` in `electrobun.config.ts` already correctly drive the build folder name and `Info.plist` but never reach that native call. No app-side config fix exists; needs an electrobun upstream fix or a native-wrapper patch. Never target windows by title/class in tooling. Match by PID/process instead. |
