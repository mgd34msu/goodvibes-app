// goodvibes-app main process boot.
// Order matters for UX: the window opens as early as possible; daemon adoption
// happens concurrently and hydrates in (docs/UX.md §6 — never serialize window
// creation behind network calls).

// Linux WebKitGTK renders blank without this (verified on Arch — docs/ARCHITECTURE.md §1).
process.env["WEBKIT_DISABLE_DMABUF_RENDERER"] ??= "1";

import { BrowserWindow } from "electrobun/bun";
import { join } from "node:path";
import { ensureDaemon, type DaemonHandle } from "./daemon-manager.ts";
import { startUiServer } from "./ui-server.ts";
import { createWsBridge } from "./ws-bridge.ts";
import { createDevDriver } from "./dev-driver.ts";
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
  const ui = startUiServer({
    assetsDir,
    daemon: handle,
    appVersion: APP_VERSION,
    wsBridge,
    devDriver: devDriver !== null,
    appRoutes: devDriver ? { "/app/dev": devDriver.handle } : undefined,
  });
  console.log(`[goodvibes-app] UI server at ${ui.url}`);

  const win = new BrowserWindow({
    title: "GoodVibes",
    url: `${ui.url}/`,
    frame: { width: 1440, height: 940, x: 120, y: 80 },
  });

  win.on("close", () => {
    // Daemon-side work must survive app close (docs/UX.md §1). We only stop the
    // local UI server; the (possibly spawned) daemon stays up.
    ui.stop();
    process.exit(0);
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

main().catch((err) => {
  console.error("[goodvibes-app] fatal boot error:", err);
  process.exit(1);
});
