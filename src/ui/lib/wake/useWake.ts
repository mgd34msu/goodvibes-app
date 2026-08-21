// useWake.ts, React glue for wake-word detection in this app. Adapted from
// goodvibes-webui src/lib/voice/useWake.ts:
//
//   useWakeProvisioning()  voice.wake.status + the explicit voice.wake.provision act.
//   useWakeHost()          mounts the singleton host: resolve settings, start/stop,
//                          and route a confirmed wake's transcript onward.
//   useWakeState()         read-only live state, for the indicator components.
//
// The host itself (wake-host.ts) holds no React and no daemon client; this
// file is where the two are joined, which is why the daemon-facing
// dependencies are INSTALLED here rather than imported there, a component
// that only wants the indicator must not pull the whole SDK client surface
// in behind it.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WakeRuntimeSettings } from "@pellux/goodvibes-sdk/platform/voice/wake/runtime";
import { gv } from "../gv.ts";
import { asRecord } from "../wire.ts";
import { queryKeys } from "../queries.ts";
import {
  createAppModelSetLoader,
  installWakeHostDaemonDeps,
  wakeHost,
  wakeHostWarn,
  type WakeHostState,
  type WakeTranscriptSink,
} from "./wake-host.ts";
import { resolveAppWakeSettings } from "./wake-config.ts";
import type { WakeModelComponent } from "./wake-models.ts";

/** The query key `voice.wake.status` shares (queries.ts), so a provision can
 * invalidate it and useWakeSettings' vadReady read shares one fetch. */
export const WAKE_STATUS_QUERY_KEY = queryKeys.voiceWakeStatus;

interface WakeStatusSnapshot {
  readonly vadReady: boolean;
  readonly modelVersion: string | null;
}

function readWakeStatus(value: unknown): WakeStatusSnapshot {
  const r = asRecord(value);
  return {
    vadReady: r["vadReady"] === true,
    modelVersion: typeof r["modelVersion"] === "string" ? r["modelVersion"] : null,
  };
}

/**
 * `voice.wake.*` resolved for this app from the shared `config.get` query,
 * plus the daemon's report of whether the speech gate is provisioned
 * (its own artifact, its own read: `voice.wake.vadThreshold` above 0 must
 * block while it is missing rather than let this app score frames ungated
 * behind a row that says otherwise).
 */
export function useWakeSettings(): { settings: WakeRuntimeSettings; isLoading: boolean } {
  const config = useQuery({ queryKey: queryKeys.configAll, queryFn: () => gv.config.get() });
  const gate = useQuery({
    queryKey: WAKE_STATUS_QUERY_KEY,
    queryFn: () => gv.voice.wake.status(),
    staleTime: 30_000,
    retry: false,
  });
  const vadReady = gate.isSuccess ? readWakeStatus(gate.data).vadReady : false;
  // No tree yet resolves to the SHIPPED defaults (enabled false,
  // surfaces.app false) rather than to zeroes, so an app that has not loaded
  // its config never opens a device on the strength of a blank read.
  const settings = useMemo(
    () => resolveAppWakeSettings(config.data ?? {}, vadReady),
    [config.data, vadReady],
  );
  return { settings, isLoading: config.isLoading };
}

/**
 * `voice.wake.status` plus the one-act `voice.wake.provision`.
 *
 * Provisioning is never automatic: it is a few MB fetched by the daemon on
 * an explicit act, exactly like managed local voice. `enabled` gates the
 * read so a view that never opens the voice surface does not poll it.
 */
export function useWakeProvisioning(enabled = true) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: WAKE_STATUS_QUERY_KEY,
    queryFn: () => gv.voice.wake.status(),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const provision = useMutation({
    mutationFn: () => gv.voice.wake.provision(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: WAKE_STATUS_QUERY_KEY });
    },
  });
  return { status, provision };
}

/** Read the live host state. Safe in a render path; the host keeps a snapshot. */
export function useWakeState(): WakeHostState {
  return useSyncExternalStore(
    useCallback((onChange: () => void) => wakeHost.subscribe(onChange), []),
    () => wakeHost.getState(),
    () => wakeHost.getState(),
  );
}

let daemonDepsInstalled = false;

/**
 * Install the host's daemon-facing dependencies once per app lifetime.
 */
function ensureDaemonDeps(): void {
  if (daemonDepsInstalled) return;
  daemonDepsInstalled = true;
  installWakeHostDaemonDeps({
    loadModelSet: createAppModelSetLoader({
      readChunk: async (input: { component: WakeModelComponent; offset: number }) =>
        (await gv.voice.wake.modelChunk(input.component, input.offset)) as {
          readonly component: WakeModelComponent;
          readonly offset: number;
          readonly bytes: number;
          readonly totalBytes: number;
          readonly sha256: string;
          readonly dataBase64: string;
          readonly complete: boolean;
        },
      modelVersion: async () => {
        try {
          return readWakeStatus(await gv.voice.wake.status()).modelVersion;
        } catch {
          // A status read that fails is not a reason to refuse the download;
          // it only costs the cache its version segment.
          return null;
        }
      },
      warn: wakeHostWarn,
    }),
    transcribe: async (artifact) => {
      const result = await gv.voice.stt({
        audio: {
          mimeType: artifact.mimeType,
          format: artifact.format,
          dataBase64: artifact.dataBase64,
          metadata: { sampleRateHz: artifact.sampleRateHz, durationMs: artifact.durationMs },
        },
      });
      const text = asRecord(result)["text"];
      return typeof text === "string" ? text.trim() : "";
    },
  });
}

/**
 * Mount the wake host: resolve `voice.wake.*` for this app and apply it.
 *
 * `applySettings` is idempotent, so this runs on every `config.get` refetch
 * without restarting anything that has not changed. While the resolved
 * settings are not `.active` the host loads no model and calls no
 * `getUserMedia`, so an install with `voice.wake.surfaces.app` false never
 * produces a permission prompt.
 *
 * `onTranscript` receives the words a confirmed wake produced, together with
 * whether `voice.wake.autoSubmit` says to send them rather than place them
 * in the draft. Pass it from the view that owns a composer; omit it and the
 * host still listens and still records the transcript in its own state.
 */
export function useWakeHost(onTranscript?: WakeTranscriptSink): WakeHostState {
  const { settings } = useWakeSettings();
  const state = useWakeState();
  ensureDaemonDeps();

  useEffect(() => {
    void wakeHost.applySettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!onTranscript) return undefined;
    return wakeHost.setTranscriptSink(onTranscript);
  }, [onTranscript]);

  return state;
}

/**
 * Register where a confirmed wake's transcript goes, without owning the
 * host's lifetime.
 *
 * The host is mounted at the shell (AppShell.tsx: it holds a microphone
 * across view changes); the composer belongs to a view. So the view
 * registers the sink and unregisters on unmount, and the host keeps
 * listening either way, recording the transcript in its own state so a wake
 * is never silently lost because no composer was mounted.
 */
export function useWakeTranscriptSink(sink: WakeTranscriptSink): void {
  useEffect(() => wakeHost.setTranscriptSink(sink), [sink]);
}

/**
 * The settings the indicator and the settings UI both read, without either
 * of them re-resolving them. Exported so a component can render
 * `blockers`/`limitations` verbatim, those strings are the resolver's own
 * written reasons, never re-worded here.
 */
export function useWakeSurfaceSettings(): WakeRuntimeSettings {
  return useWakeSettings().settings;
}
