# goodvibes-app — Architecture

The GoodVibes desktop app: a "Claude Desktop"-class GUI that unifies every capability of
goodvibes-tui (coding, operations, automation, knowledge, channels, control plane) and
goodvibes-agent (operator assistant: routines, personas, skills, personal ops, research,
documents) in one TypeScript-native, Bun-powered application built on `@pellux/goodvibes-sdk`.

Ground-truth research for every claim in this document lives in `docs/research/*.md`.
The feature completion bar is `docs/FEATURES.md`; the UX contract is `docs/UX.md`.

## 0. Non-negotiables

1. **UI/UX first.** When a technical choice trades against perceived latency, clarity, or
   click count, UX wins. Streaming renders immediately; mutations are optimistic; nothing
   blocks the window from painting.
2. **Wire or delete.** (The goodvibes-desktop autopsy rule.) No surface ships unless its
   backing call works end to end. Capabilities without wire backing render as *honest*
   read-only or "not available on this daemon" states — never silent stubs.
3. **TypeScript-native, Bun everywhere.** One language, one runtime. No Node, no Rust,
   no Electron.
4. **The daemon is the engine.** We do not reimplement agent execution, providers, tools,
   knowledge, or channels. We operate them over the typed 327-method operator contract.

## 1. Stack (versions verified against npm / this machine, 2026-07-07)

| Layer | Choice | Why |
|---|---|---|
| Shell/runtime | `electrobun@1.18.1` | Bun-native main process, typed RPC to webview, system WebKitGTK on Linux (~14 MB bundles). Verified working on Arch/Hyprland (XWayland). See `docs/research/runtime-evaluation.md`. |
| Engine | `goodvibes-daemon` from `@pellux/goodvibes-tui@1.9.2` (npm dep) | The full runtime: providers, tools, agents, knowledge, channels, automation. Adopt-or-spawn so app + TUI + agent share one daemon. |
| Contract/client | `@pellux/goodvibes-sdk@1.3.1` | Typed operator client, contracts, realtime SSE/WS connectors, auth, errors, pairing helpers. |
| UI | React 19 + TanStack Query v5 | Direct reuse of goodvibes-webui's proven patterns (`docs/research/webui-map.md` §4). |
| Styling | Plain CSS design tokens (webui token contract) + SDK presentation contract | Cross-surface visual consistency with TUI/agent/webui. No Tailwind, no CSS-in-JS. |
| Markdown/code | react-markdown + remark-gfm + highlight.js | Same as webui. Fonts bundled locally (no external fetches — strict offline). |
| Icons | lucide-react | Same as webui. |

**Linux launch requirement:** `WEBKIT_DISABLE_DMABUF_RENDERER=1` must be in the process
environment before the native wrapper creates a webview, or WebKitGTK paints a blank
window (GBM buffer failures — verified in the spike). The launcher wrapper script sets it.
Known-benign: one `GLXBadWindow` X11 warning at startup; Linux runs under XWayland until
Electrobun's Wayland PR lands. App menus don't exist on Linux — all chrome is in-page.

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
                    │ 327-method contract    │   agent, webui,
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

Mirrors the TUI's `startHostServices` topology (research: tui-daemon-architecture §1):
1. Resolve config: `controlPlane.host/port` from `~/.goodvibes/tui/settings.json` if
   present (TUI users), else defaults `127.0.0.1:3421`.
2. Probe `GET /status`. If a GoodVibes daemon answers: version-band check (1.x major
   match). Compatible → **adopt**. Incompatible → surface a first-class error screen with
   the versions and remediation (never start a competing daemon on the port).
3. If nothing listens: **spawn detached** `goodvibes-daemon` (bin from our
   `node_modules/@pellux/goodvibes-tui`), record pid/port, poll `/status` until ready,
   then adopt. The daemon outlives the app (same as TUI's detached layer) — closing the
   app never kills running agent work. A settings toggle offers "stop daemon on quit".
4. Token: `getOrCreateCompanionToken('app', { daemonHomeDir: ~/.goodvibes/daemon })`
   from `@pellux/goodvibes-sdk/platform/pairing` — the same store the TUI/agent use, so
   adoption works with zero setup on a machine that has ever run either.
5. Health loop: `/status` + `control.snapshot` on a 15s cadence feeding the status strip
   (three axes: Reachable / Signed-in / Working), with SSE liveness as the fast signal.

## 4. UI data layer (src/ui/lib/)

Ported webui doctrine (research: webui-map §2, §4 — read those files' docblocks when
implementing):
- **TanStack Query is the only server-state store.** Central `queryKeys` registry;
  prefix-key invalidation fan-out; boot snapshot via one `Promise.allSettled`.
- **SDK facade** (`src/ui/lib/gv.ts`): typed wrapper over `fetch('/api/...')` built from
  `@pellux/goodvibes-sdk/contracts` types (client-safe subpath, browser-legal). Includes
  the `EXTRA_METHOD_ROUTES` seam for methods missing from pinned route maps, capability
  probing via `control.methods.get`, and the webui error taxonomy
  (`isMethodUnavailableError`, `isDaemonUnreachableError`, …).
- **Realtime:** SSE. One multiplexed invalidation stream
  (`/api/control-plane/events?domains=…`) that only invalidates query keys — frames are
  never rendered directly; one raw stream for `session-update`; per-chat-session streams
  via `companion.chat.events.stream`. Desktop has no 6-connection browser cap, but the
  architecture stays: it's the right consistency model. Degradation: "live updates
  paused" banner + refetch, never a blank screen.
- **Mutations on HTTP, reads refreshed by events** (snapshot → subscribe → invalidate).

## 5. App-local services (Bun side)

Features from the products that are process-local (not daemon methods) are implemented in
the Bun main process and exposed to the UI through the same proxy server under `/app/*`
routes (same-origin, same patterns — TanStack Query doesn't care who answers):

- `/app/registries/*` — agent-brain stores: routines, personas, skills, notes, VIBE.md,
  profiles. File-based JSON registries under `~/.goodvibes/app/` matching goodvibes-agent's
  record shapes (research: agent-map §1b), plus **read-only import bridges** from
  `~/.goodvibes/agent/*` and TUI stores (preview → confirm, redacted, source never
  mutated — the agent's own settings-import pattern).
- `/app/git/*` — status/log/diff/branches/stage/commit/stash/worktrees for the workspace
  (Bun spawning `git`; no native modules). Safety rules from the desktop autopsy: dirty-
  checkout confirm, no force-push, no unguarded destructive ops.
- `/app/pty/*` + WS — terminal tabs (optional feature; a pty via `bun-pty` or
  `script -qfc` fallback). Exit codes surface loudly (autopsy Theme 1: never silently
  drop a dead terminal).
- `/app/settings/*` — app-shell settings (theme, density, keybindings, window state,
  daemon lifecycle prefs) in `~/.goodvibes/app/settings.json`.

Rule: Bun-side platform subpaths of the SDK (`platform/*`) may be imported **only** in
`src/bun/` — never in `src/ui/` (which uses client-safe subpaths only). An ESLint-grade
check script enforces this at build.

## 6. Repo layout

```
electrobun.config.ts      app name/identifier, entrypoints, copy rules
src/bun/                  main process
  index.ts                boot: env fix → daemon-manager → ui-server → window → rpc
  daemon-manager.ts       probe/adopt/spawn/version-band/token
  ui-server.ts            static assets + /api proxy + /app routes + SSE pass-through
  rpc.ts                  Electrobun defineRPC schema (native features)
  registries/…            agent-brain file stores + import bridges
  git.ts, pty.ts, notify.ts, tray.ts, dialogs.ts
src/shared/               types shared bun↔ui (RPC schema, /app route contracts)
src/ui/                   webview SPA
  main.tsx, App.tsx       shell: providers → gates → sidebar/topbar/statusstrip
  lib/                    gv.ts facade, queries.ts, errors.ts, realtime hooks,
                          commands.ts (palette), presentation-bridge.ts
  views/<domain>/         one directory per sidebar view
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
  metadata exactly like the agent does — no auto-confirm setting exists.
- Secrets views mask by default (webui `config-redaction` pattern); reveal is explicit
  and never persisted.
- External links open via RPC → `xdg-open`, never navigate the app webview.

## 8. Packaging & dev loop

- Dev: `bun run dev` → `electrobun build` + launcher with dev console; UI hot-iteration
  via rebuild (Bun.build is fast; watch mode via `electrobun dev --watch`).
- Dist: `electrobun build --release`-equivalent targets; Linux artifact is the
  self-extracting bundle + a `.desktop` file + wrapper script exporting the WebKit env
  fix. macOS/Windows targets stay buildable but are untested for now (documented).
- Updates: Electrobun's bsdiff updater wired later; out of scope until the app is stable.

## 9. Risks & fallbacks

| Risk | Mitigation |
|---|---|
| Electrobun bus factor / Linux polish (resize bugs #188/#371) | All logic lives behind the proxy + RPC seams; the shell is swappable (Tauri sidecar or `--app`-mode browser) without touching src/ui or the Bun services. Avoid CEF on Linux; system WebKitGTK only. |
| Daemon contract drift (sdk 1.3.1 vs daemon from tui 1.9.2) | Capability probes before non-core calls; `EXTRA_METHOD_ROUTES` seam; version-band gate at adopt time; honest "method unavailable" states. |
| WebKitGTK quirks (fonts, media) | Bundle fonts; test TTS audio playback early (Wave D); `WEBKIT_DISABLE_DMABUF_RENDERER=1` baked into every launch path. |
| Companion-chat rate limit (30 msg/min/client) | Client-side send throttle indicator; never silently drop. |
