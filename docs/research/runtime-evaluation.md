# Desktop Runtime Evaluation for the GoodVibes Bun Desktop App (Arch Linux x64 primary)

Context anchor: `@pellux/goodvibes-sdk@1.3.1` declares `engines: { bun: "1.3.10", node: ">=22.0.0" }` (npm registry) — so SDK/daemon logic can run under Bun or Node 22+, but the brief mandates a Bun-side process. All options below are evaluated on that constraint.

---

## 1. Electrobun (npm `electrobun`, github blackboardsh/electrobun, docs at framework.blackboard.sh/electrobun)

**Versions & cadence (verified against npm registry 2026-07-07):**
- `latest`: **1.18.1** (published 2026-05-04); `beta`: **1.18.4-beta.6** (2026-06-14)
- Cadence is active: stable 1.18.0/1.18.1 on May 3–4 2026, betas roughly weekly through mid-June 2026; steady beta stream through March–April before that.

**Linux support status (the deciding factor) — verified, nuanced:**
- Linux IS officially supported. README support matrix: macOS 14+ **Official**, Windows 11+ **Official**, **Ubuntu 22.04+ Official**, other Linux (gtk3 + webkit2gtk-4.1) **community-supported**, Raspberry Pi unofficial fork. Arch falls in the "community-supported" tier but ships both `gtk3` and `webkit2gtk-4.1` packages, so the dependency story is fine.
- Linux x64 + arm64 CLI binaries are published per release (`electrobun-cli-linux-x64.tar.gz` on the releases page).
- Renderer choice on Linux: system **WebKitGTK** or bundled **CEF**, dual binaries shipped in the npm package so you can toggle CEF without recompiling.
- **Wayland caveat (matters on Arch/Hyprland):** current releases force `GDK_BACKEND=x11`, i.e. the app runs under **XWayland**, not native Wayland. PR **#420** (opened 2026-05-06, still **open** as of this research) removes the forced X11 backend, adds `isX11Backend()` guards, and explicitly targets crashes like `GLXBadWindow (code 170)` under GNOME/KDE/Hyprland. Until it merges, native-Wayland is not there.
- Open Linux issues that are real risks: **#371** window cannot be resized (Apr 2026), **#188** GTK window can grow but not shrink due to `gtk_widget_set_size_request` misuse (Feb 2026), **#281** blank tabs / signal 11 crashes in the multitab template under Wayland+CEF (Mar 2026), **#158** missing GTK/WebKit deps cause an opaque launcher failure (Feb 2026). Net: Linux works but window-management polish lags macOS.

**API shape (framework.blackboard.sh/electrobun docs):**
- `import { BrowserWindow } from "electrobun/bun"` — constructor takes `title`, `frame`, `url`/`html` (`views://` scheme for bundled assets), `titleBarStyle` (`default|hidden|hiddenInset`), `transparent`, `partition`, `sandbox` (disables RPC for untrusted content), `activate`. Methods: `setPosition/setFrame/getFrame/setSize/show/hide/minimize/maximize/setFullScreen/setAlwaysOnTop/setTitle/close/setPageZoom`. Events (`close/resize/move/focus/blur`) via `win.on()` or global `Electrobun.events.on()`.
- **Typed RPC**: shared request/message schemas, `BrowserView.defineRPC()` with typed handlers passed as the `rpc` option to `BrowserWindow`; call as `win.webview.rpc.request.fn()` (async, `maxRequestTime` timeout) and `rpc.send.msg()` for one-way. This is exactly the "Bun main process ↔ webview" bridge the app needs.
- Also: Tray, application/context menus, Updater API, WebGPU surface, `<electrobun-webview>` custom element, Three.js/Babylon adapters.
- **Bundler/updater**: self-extracting bundles ~14 MB (system webview) / ~16 MB (bundled CEF); differential updates via bsdiff, "as small as 4KB". `npx electrobun init` scaffolds; CLI does dev/build/dist.

**Maturity risks:** effectively a single-maintainer project (README: "no expectation that I will review, respond to, or merge" issues/PRs) despite 12.5k stars and claimed production apps. Bus factor is the biggest long-term risk; Linux/Wayland polish is the biggest short-term one.

## 2. Alternatives ranked

### (a) Bun main process + other webview bindings
- **`webview-bun` 2.4.0** (tr1ckydev; last publish 2025-04-27 — 14 months stale). Wraps the tiny `webview/webview` C library. Linux needs **GTK4 + webkitgtk-6.0** (`pacman -S gtk4 webkitgtk-6.0` documented for Arch). Minimal API (one window, eval/bind JS); no multi-window management, no tray/menus, no bundler/updater. Blocking `run()` loop complicates running a Bun server in the same process.
- **`@webviewjs/webview` 0.4.0** (2026-06-29): napi-rs bindings over Tauri's **tao + wry**; runs on Node/Deno/**Bun**; Linux x64/arm64 with WebKitGTK, **both Wayland and X11**. `Application`/`BrowserWindow`/`Webview` objects, IPC via `window.ipc.postMessage` + exposed namespaces. Self-described "lightweight, not a full-featured framework"; 55 stars, experimental exe-building CLI. Promising direction, too immature to bet the product on.
- **`Bun.WebView`** (built-in, experimental): **headless only** — automation/scraping; `headless:false` not implemented. Not a windowing option; ruled out.
- Packaging story for all of these: roll your own (bun build --compile + manual .desktop/AppImage). Verdict: fine for prototypes, not for a Claude-Desktop-class app.

### (b) Tauri v2 (`@tauri-apps/cli` 2.11.4, 2026-06-28) with a Bun sidecar
- **Linux**: first-class, mature — WebKitGTK-based, packaged as deb/rpm/AppImage; Wayland handled by GTK properly; Arch dev deps are standard (`webkit2gtk-4.1`, `base-devel`, Rust).
- **Bun story**: official sidecar mechanism embeds a `bun build --compile` standalone binary per target triple (`externalBin`, name suffixed e.g. `-x86_64-unknown-linux-gnu`); Rust/JS spawns it; community pattern uses kkrpc or a localhost HTTP/WS port for webview↔Bun RPC with near-zero Rust code (v2.tauri.app/develop/sidecar/, niraj-khatiwada/tauri-bun).
- **Dev ergonomics**: excellent tooling (`tauri dev` with HMR for the frontend) but a **two-runtime architecture**: Rust host + Bun sidecar, IPC hop webview→Rust→Bun (or webview→localhost→Bun), plus Rust toolchain in the dev loop. More moving parts than Electrobun, best-in-class packaging/updater/signing.
- **Long-term viability**: best of all options (large org, CI'd releases, plugin ecosystem).

### (c) Electron 43.0.0 (2026-06-30) with Bun-built backend
- Electron's main process is **Node, not Bun** — the SDK's `node >=22` engine means it *could* run in Electron's main process directly, but to honor the "Bun-side process" requirement you'd spawn a Bun child (compiled or via system bun) and bridge it, duplicating the sidecar complexity of Tauri while paying Electron's ~100 MB+ footprint per app.
- Linux support is rock solid (X11 + native Wayland via `--ozone-platform-hint=auto`); packaging via electron-builder/forge is mature (AppImage/deb/pacman targets). Dev ergonomics good but the Bun↔Electron split runtime is awkward and Chromium bloat contradicts the project's Bun-native identity. Viable fallback, uninspiring fit.

### (d) Plain Bun HTTP/WS server + system browser in app mode
- Bun process serves the UI + WebSocket; launch `chromium --app=http://localhost:PORT` (or `--app` in Brave/Edge; Firefox has no equivalent). Zero framework risk, 100% of logic in one Bun process, trivially debuggable on Arch.
- Costs: no real window management (no tray, no global shortcuts, `--app` window controlled only at launch), browser-dependent chrome/behavior, no packaging/updater story beyond "install a binary + .desktop file", target machine must have a Chromium-family browser. Great as a **development/fallback mode**, not a shippable "Claude Desktop"-class product on its own.

## 3. Recommendation

**Primary: Electrobun `1.18.1` (move to the `1.18.4` stable when it lands; track `beta` tag during development).**

Rationale against the four criteria:
1. **Zero-friction dev loop on Arch**: one runtime, one language — `bun install electrobun`, `npx electrobun init`, dev/build from the same CLI; deps are just `gtk3` + `webkit2gtk-4.1` from pacman. No Rust toolchain, no sidecar binary matrix.
2. **Bun process hosting `@pellux/goodvibes-sdk`**: this is Electrobun's core design — the main process **is** Bun (SDK engines field pins `bun: 1.3.10`, satisfied), so daemon/SDK logic imports directly into the process that owns the windows. Every alternative requires an extra hop (Tauri/Electron sidecar) or lacks windows entirely.
3. **Window management**: full `BrowserWindow` API (frames, titleBarStyle, transparency, multi-window, tray, menus) plus typed RPC (`BrowserView.defineRPC`, `win.webview.rpc.request.*`) — the exact Claude-Desktop shape. Known Linux caveats: runs under **XWayland** until PR #420 merges, and resize bugs #188/#371 are open — design the app to tolerate these (avoid CEF-on-Wayland multiwebview patterns per #281; use the system WebKitGTK renderer on Linux initially).
4. **Long-term viability**: weakest axis (single maintainer). Mitigate architecturally: keep ALL app logic in the Bun process behind a thin transport interface (typed RPC now; the same message schema can ride a WebSocket later). That makes the fallback migration — **Tauri v2 (`@tauri-apps/cli` 2.11.4) + Bun sidecar** if Electrobun's Linux track stalls, or option (d) as a dev-mode harness — a rendering-shell swap, not a rewrite.

**Exact versions to pin:** `electrobun@1.18.1` (or `electrobun@beta` = 1.18.4-beta.6 during bring-up if 1.18.1's resize bugs bite), Bun `>=1.3.10` (SDK engine), `@pellux/goodvibes-sdk@1.3.1`. Fallbacks if ever needed: `@tauri-apps/cli@2.11.4`, `electron@43.0.0`, `@webviewjs/webview@0.4.0`, `webview-bun@2.4.0`.

Sources: [Electrobun releases](https://github.com/blackboardsh/electrobun/releases), [Electrobun README](https://github.com/blackboardsh/electrobun/blob/main/README.md), [Electrobun site](https://blackboard.sh/electrobun/), [Electrobun docs](https://framework.blackboard.sh/electrobun/), [BrowserWindow API](https://framework.blackboard.sh/electrobun/apis/browser-window/), [Wayland PR #420](https://github.com/blackboardsh/electrobun/pull/420), [Linux/Wayland issues](https://github.com/blackboardsh/electrobun/issues?q=is%3Aissue+linux+wayland), [webview-bun](https://github.com/tr1ckydev/webview-bun), [@webviewjs/webview](https://github.com/webviewjs/webview), [Bun WebView docs](https://bun.com/docs/runtime/webview), [Tauri sidecar](https://v2.tauri.app/develop/sidecar/), [tauri-bun example](https://github.com/niraj-khatiwada/tauri-bun), [Bun/Deno server in Tauri](https://codeforreal.com/blogs/using-bun-or-deno-as-a-web-server-in-tauri/), plus npm registry metadata fetched directly for electrobun, electron, @tauri-apps/cli, webview-bun, @webviewjs/webview, @pellux/goodvibes-sdk.