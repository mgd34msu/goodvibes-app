// wake-config.ts, `voice.wake.*` as this app's webview resolves it. Adapted
// from goodvibes-webui src/lib/voice/wake-config.ts: same resolver, same
// capability answers (the app's webview is the same WASM-backed detector
// runtime the web UI tab runs, per voice.wake.surfaces.app's own
// description), different surface id and a different config tree reader.
//
// The daemon's `config.get` answers the WHOLE config tree as nested objects;
// the SDK's `resolveWakeRuntimeSettings` reads FLAT dotted keys. This is the
// adapter between them, plus the one honest statement of what this webview
// can do.
//
// None of the capability answers is a guess:
//   - speexAvailable, asked of the SDK, not declared here. The filter is a
//     WebAssembly module the SDK carries, so the only question is whether
//     this runtime has WebAssembly, which the webview does:
//     `voice.wake.noiseSuppression: "speex"` RUNS here, applied by the
//     wrapper inside WakeListener and PushToTalkSession.
//   - vadAvailable, follows the daemon's `voice.wake.status`, because the
//     speech gate is its own pinned artifact. Provisioned,
//     `voice.wake.vadThreshold` above 0 screens frames; missing, it BLOCKS
//     rather than scoring ungated behind a row that claims otherwise.
//   - canRetainAudio, this webview has no filesystem exposed to it to retain
//     a clip to (the Bun process does, but nothing here asks it to).
//   - canPlayLocalFile, the webview cannot read an absolute path on the
//     user's machine, so a custom activation sound downgrades to the
//     built-in chime, exactly like the web UI tab.
//
// The resolver turns the last two into `limitations` (the detector still
// runs and says which row is not in force) and the first two into `blockers`
// (the detector does not start). Only `.active` decides whether a device is
// opened.
import {
  resolveWakeRuntimeSettings,
  wakeSurfaceKey,
  type WakeRuntimeSettings,
  type WakeSettingReader,
  type WakeSurfaceCapabilities,
} from "@pellux/goodvibes-sdk/platform/voice/wake/runtime";
import { noiseSuppressionSupport } from "@pellux/goodvibes-sdk/platform/voice/capture";
import { asRecord } from "../wire.ts";

/** The surface id this app resolves `voice.wake.surfaces.*` under. */
export const WAKE_SURFACE = "app" as const;

/** The `voice.wake.surfaces.app` key, from the SDK rather than spelled again. */
export const WAKE_SURFACE_KEY = wakeSurfaceKey(WAKE_SURFACE);

/**
 * What this webview can actually do. See this file's header for each answer.
 *
 * `vadAvailable` is NOT a constant, because the speech gate is its own
 * pinned artifact the daemon has to have provisioned: see
 * {@link appWakeCapabilities}.
 */
export const APP_WAKE_CAPABILITIES: WakeSurfaceCapabilities = appWakeCapabilities(false);

/**
 * Capabilities for this webview, given whether the daemon reports the speech
 * gate provisioned. With the artifact missing, `voice.wake.vadThreshold`
 * above 0 still blocks startup and says why, rather than the webview scoring
 * frames ungated while the row claims they are screened.
 */
export function appWakeCapabilities(vadReady: boolean): WakeSurfaceCapabilities {
  return {
    speexAvailable: noiseSuppressionSupport().supported,
    vadAvailable: vadReady,
    canRetainAudio: false,
    canPlayLocalFile: false,
  };
}

/**
 * Read a dotted path out of a `config.get` tree.
 *
 * Returns undefined for anything the tree does not hold, which is exactly
 * what the resolver wants: it then applies the shipped default rather than a
 * zero, so a partial tree resolves to shipped behaviour instead of a
 * disabled detector with every threshold at 0.
 */
export function configPathReader(tree: unknown): WakeSettingReader {
  return (key: string): unknown => {
    const segments = key.split(".");
    let cursor: unknown = tree;
    for (const segment of segments) {
      if (cursor === null || typeof cursor !== "object") return undefined;
      cursor = asRecord(cursor)[segment];
      if (cursor === undefined) return undefined;
    }
    return cursor;
  };
}

/** Resolve every `voice.wake.*` row for this app from a `config.get` tree. */
export function resolveAppWakeSettings(tree: unknown, vadReady = false): WakeRuntimeSettings {
  return resolveWakeRuntimeSettings(configPathReader(tree), WAKE_SURFACE, appWakeCapabilities(vadReady));
}
