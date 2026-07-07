// goodvibes-app main process boot.
// Order matters for UX: the window opens as early as possible; daemon adoption
// happens concurrently and hydrates in (docs/UX.md §6 — never serialize window
// creation behind network calls).

// Env normalization MUST come first: imports execute in order, and electrobun's
// import initializes GTK, which reads these variables (see env.ts).
import "./env.ts";
import { BrowserWindow, Tray, Utils } from "electrobun/bun";
import { join } from "node:path";
import { ensureDaemon, type DaemonHandle } from "./daemon-manager.ts";
import { startUiServer } from "./ui-server.ts";
import { createWsBridge } from "./ws-bridge.ts";
import { createDevDriver } from "./dev-driver.ts";
import { buildAppRoutes } from "./app-routes.ts";
import { notifications } from "./notifications.ts";
import type { DaemonInfo } from "../shared/app-contract.ts";

const APP_VERSION = "0.1.0";

// Built layout: this bundle runs as Resources/app/bun/index.js; view assets are
// bundled to Resources/app/views/mainview/* (verified against electrobun 1.18.1).
const assetsDir = join(import.meta.dir, "..", "views", "mainview");

async function main(): Promise<void> {
  // Kick off daemon adoption immediately, but do not block the window on it.
  const daemonPromise: Promise<DaemonHandle> = ensureDaemon();

  // The proxy needs a daemon handle to exist; give it a mutable holder that the
  // adoption promise fills in. Requests arriving before adoption resolve get a
  // clean 503 the UI renders as "connecting…".
  const pendingInfo: DaemonInfo = {
    mode: "unreachable",
    baseUrl: "http://127.0.0.1:3421",
    detail: "Connecting to daemon…",
  };
  const handle: DaemonHandle = { info: pendingInfo, token: "" };

  // The bridge holds the same mutable handle: connections opened after
  // adoption resolves pick up the real baseUrl/token automatically.
  const wsBridge = createWsBridge(handle);
  const devDriver = process.env["GOODVIBES_APP_DEV"] === "1" ? createDevDriver() : null;
  const appRoutes = buildAppRoutes({ daemon: handle });
  if (devDriver) appRoutes["/app/dev"] = devDriver.handle;
  const ui = startUiServer({
    assetsDir,
    daemon: handle,
    appVersion: APP_VERSION,
    wsBridge,
    devDriver: devDriver !== null,
    appRoutes,
  });
  console.log(`[goodvibes-app] UI server at ${ui.url}`);

  const win = new BrowserWindow({
    title: "GoodVibes",
    url: `${ui.url}/`,
    frame: { width: 1440, height: 940, x: 120, y: 80 },
  });

  // XWayland GDK_SCALE display compensation lives in the UI (src/ui/main.tsx,
  // transform-based, driven by /app/health display.gdkScale). Do NOT use
  // win.setPageZoom here: on this electrobun/GTK version it either inverts
  // (0.5 doubled the magnification) or hard-crashes the event loop seconds
  // after dom-ready ("invalid unclassed pointer in cast to 'GtkWidget'") --
  // both verified live 2026-07-07. Unsetting GDK_SCALE at spawn also crashes
  // WebKitGTK (SIGILL). The transform approach is the only path that proved
  // stable.

  // Prime the notification pause state so the tray menu label is correct on
  // first paint (best-effort; never blocks the window).
  void notifications.prime();

  const quitApp = (): void => {
    // Daemon-side work must survive app close (docs/UX.md §1). We only stop the
    // local UI server; the (possibly spawned) daemon stays up.
    ui.stop();
    process.exit(0);
  };

  // Status-tray icon + quick actions. Null when the platform/desktop has no
  // system tray (electrobun's Tray creation fails gracefully — see setupTray).
  const tray = setupTray(win, ui.url, quitApp);

  win.on("close", () => {
    if (tray) {
      // Close-to-tray: with a live tray the window close button only hides the
      // window; the app (and daemon-side work) keeps running. Quit is explicit
      // via the tray menu (docs/FEATURES.md §24: window close ≠ app quit).
      win.hide();
      return;
    }
    quitApp();
  });

  const daemon = await daemonPromise;
  handle.info = daemon.info;
  handle.token = daemon.token;
  if (daemon.spawnedPid != null) {
    console.log(`[goodvibes-app] spawned goodvibes-daemon pid=${daemon.spawnedPid}`);
  }
  console.log(
    `[goodvibes-app] daemon ${daemon.info.mode} at ${daemon.info.baseUrl}` +
      (daemon.info.version ? ` (v${daemon.info.version})` : ""),
  );
}

/**
 * Create the status-tray icon + menu. Returns null when the platform has no
 * usable system tray (electrobun's Tray swallows creation errors and leaves
 * `ptr` null; many GNOME setups need the AppIndicator extension — see
 * electrobun/dist/api/bun/proc/linux.md). Callers treat null as "no tray", which
 * preserves the exit-on-close behavior.
 */
function setupTray(
  win: BrowserWindow,
  uiUrl: string,
  onQuit: () => void,
): Tray | null {
  let tray: Tray;
  try {
    tray = new Tray({ title: "GoodVibes", template: true });
  } catch (err) {
    console.warn(`[goodvibes-app] tray unavailable: ${String(err)}`);
    return null;
  }
  if (tray.ptr == null) {
    // Native tray creation failed (no system tray on this desktop). Drop it.
    tray.remove();
    return null;
  }

  const rebuildMenu = (): void => {
    const paused = notifications.isPausedSync();
    tray.setMenu([
      { type: "normal", label: "Show GoodVibes", action: "show" },
      { type: "normal", label: "Hide GoodVibes", action: "hide" },
      { type: "divider" },
      { type: "normal", label: "New chat", action: "new-chat" },
      {
        type: "normal",
        label: paused ? "Resume notifications" : "Pause notifications",
        action: "toggle-pause",
        checked: paused,
      },
      { type: "divider" },
      { type: "normal", label: "Quit GoodVibes", action: "quit" },
    ]);
  };
  rebuildMenu();

  tray.on("tray-clicked", (event) => {
    // The tray FFI callback emits an ElectrobunEvent whose `.data` is the
    // { id, action, data } payload (electrobun/dist/api/bun/proc/native.ts).
    const action = (event as { data?: { action?: string } }).data?.action ?? "";
    switch (action) {
      case "show":
        win.show();
        break;
      case "hide":
        win.hide();
        break;
      case "new-chat":
        // Deep-link convention from src/ui/lib/router.ts (?view=…). `new=1` is a
        // hint the chat view may honor to start a fresh session.
        win.webview?.loadURL(`${uiUrl}/?view=chat&new=1`);
        win.show();
        break;
      case "toggle-pause":
        void notifications.togglePaused().then(rebuildMenu);
        break;
      case "quit":
        onQuit();
        break;
      default:
        break;
    }
  });

  return tray;
}

main().catch((err) => {
  console.error("[goodvibes-app] fatal boot error:", err);
  process.exit(1);
});
