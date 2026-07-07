# goodvibes-app

Desktop operator console for the GoodVibes daemon — chat, fleet, automation, knowledge,
code, and observability in one native window. It unifies the capability of
`goodvibes-tui` (coding, operations, automation, knowledge, channels, control plane) and
`goodvibes-agent` (operator assistant: routines, personas, skills, personal ops, research,
documents) on top of `@pellux/goodvibes-sdk`, in a single Bun/TypeScript-native app built
with Electrobun. No Node, no Rust, no Electron.

The daemon does the work; this app is a control surface over its ~327-method operator
contract, plus a handful of process-local features (git, terminal, file-based registries)
implemented directly in the Bun main process.

## Architecture, in brief

```
Bun main process (Electrobun)          src/bun/
  daemon-manager   probe 127.0.0.1:3421 → adopt an existing daemon, or spawn one detached
  ui-server        Bun.serve: serves the built UI, reverse-proxies /api/* to the daemon
                    (stamping the bearer token server-side — the webview never sees it),
                    passes SSE straight through, and answers app-local /app/* routes
  native RPC       Electrobun typed RPC: dialogs, notifications, tray, clipboard, PTY,
                    window controls, external-open
        │ BrowserWindow(http://127.0.0.1:<random port>)
        ▼
Webview (WebKitGTK)                    src/ui/
  React 19 SPA, TanStack Query for all server state, SSE for realtime invalidation,
  plain-CSS design tokens shared with the wider GoodVibes UI family
        │ fetch("/api/...")  — same-origin, proxied
        ▼
goodvibes-daemon :3421 (shared with the TUI, agent, webui, mobile companions)
```

The app talks to the daemon through a same-origin loopback proxy rather than directly from
the webview: it removes CORS entirely, keeps the bearer token out of the renderer, and
gives daemon restarts/adoption one seam to hide behind instead of touching every fetch call
in the UI.

22 views across six groups (Work / Automate / Know / Assistant / Code / System) — see
`docs/UX.md` §2 for the full information architecture. Details, the process model diagram,
security posture, and the reasoning behind each choice live in `docs/ARCHITECTURE.md`.
The feature-completion bar (every capability, its backing daemon method or app-local
implementation, and status) is `docs/FEATURES.md`. UX principles and interaction contracts
are `docs/UX.md`. Known gaps against that completion bar are tracked in `docs/GAPS.md`
(create it via the final parity audit if it isn't present yet).

## Install, build, run

```sh
bun install
bun run build          # bunx electrobun build
bun scripts/launch.ts  # or: bun run dev  (build + launch)
```

`scripts/launch.ts` finds the most recently built launcher under `build/` (checks
`dev-linux-x64`, `canary-linux-x64`, `stable-linux-x64` in that order) and spawns it with a
patched environment:

- `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set automatically — without it, WebKitGTK paints a
  blank window on affected hardware (GBM buffer failures). This is a launcher-only fix; see
  Known limitations below for the gap in the production launcher.
- `GDK_SCALE` / `GDK_DPI_SCALE` are stripped from the child process's environment (the
  user's own shell environment is untouched). An inherited `GDK_SCALE=2` doubles the whole
  UI on XWayland because GTK4 Wayland apps ignore the variable and only this app's
  XWayland webview honors it — stripping it is the only fix that doesn't blur the UI or
  desync native control sizing.

The daemon is adopted if something already answers `GET /status` on `127.0.0.1:3421`
(version-band checked, 1.x major match), or spawned detached from the
`goodvibes-daemon` binary bundled with `@pellux/goodvibes-tui`. It outlives the app —
closing the window never kills in-flight agent work.

## Dev workflow

```sh
bun run typecheck        # tsc --noEmit
bun test                 # bun test
bun run check:boundaries # enforce: src/ui/ never imports node:*, platform/*, or electrobun-bun
bun run generate:routes  # regenerate the operator-route map from the SDK contract
bun run generate         # generate:routes + generate:presentation
bun run verify           # typecheck + check:boundaries + generate:check + test
```

`electrobun.config.ts` holds the app identifier, entrypoints, and copy rules.

**Dev eval driver.** Launching with `GOODVIBES_APP_DEV=1` (set automatically by
`scripts/launch.ts`) enables a `/app/dev/eval` route that executes arbitrary JS inside the
running webview and returns the result — the way to drive and inspect UI state without a
browser automation stack. It requires the same `X-GV-App` header the proxy checks
everywhere else, and only exists when that env var is set; it is not present in a
production build unless something explicitly opts in.

## Known limitations

- **Linux-first.** Verified on Arch Linux + Hyprland (XWayland). macOS and Windows targets
  are buildable through Electrobun but untested — treat them as unverified, not
  unsupported.
- **Voice input depends on WebKitGTK's permission model.** Mic access goes through the
  webview's `getUserMedia`, which behaves differently across WebKitGTK builds and desktop
  permission portals than it does in a browser; test on your own distro before relying on
  it.
- **The `WEBKIT_DISABLE_DMABUF_RENDERER` and display-scale fixes only apply to
  `scripts/launch.ts`.** The packaged production launcher (the `.desktop` file / wrapper
  script produced by `electrobun build --release`-equivalent targets) does not yet carry
  the same environment patching — this is an open gap, not a solved one. Until it's
  closed, run via `scripts/launch.ts` on Linux rather than the packaged binary directly.
- One benign `GLXBadWindow` X11 warning is expected at startup on Linux; it does not
  indicate a failure.
- Electrobun's Wayland support (native, non-XWayland) hasn't landed upstream yet, so
  Linux runs under XWayland.
