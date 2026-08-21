// wake-runtime.ts, onnxruntime-web, adapted to the engine's session shape.
// Adapted from goodvibes-webui src/lib/voice/wake-runtime.ts; the runtime
// selection logic is unchanged, only the wasm asset's URL differs (see
// WAKE_WASM_URL below).
//
// The SDK's wake engine never imports an inference runtime. It declares the
// shape of one (`WakeInferenceSession`) and the host supplies it, which is
// what lets the same engine run in a daemon child process, a browser tab and
// this webview. This file is that supply on the webview side.
//
// ONE ENGINE BINARY SERVES BOTH VALUES OF `voice.wake.browserBackend`.
//
// onnxruntime-web ships a separate wasm binary per backend set, and this
// file could ship two of them: the wasm-only build for `wasm` and the
// WebGPU build for `webgpu`. That would put 38 MB of engine in the built
// assets to serve a webview that fetches at most one of them.
//
// The WebGPU build CONTAINS THE CPU ENGINE TOO, so the second file buys
// nothing (verified by goodvibes-webui rather than assumed: a session
// created from that binary with `executionProviders: ['wasm']` loads and
// scores the real pinned classifier). So both settings resolve to the one
// WebGPU-capable binary:
//   - 'wasm'   -> executionProviders ['wasm']            (CPU provider inside it)
//   - 'webgpu' -> executionProviders ['webgpu', 'wasm']  (GPU provider, CPU behind)
// Both values keep working and keep meaning what they say; what changed is
// that they no longer imply two downloads. Nothing is fetched at all until
// wake detection is switched on, because the import is dynamic.
//
// In onnxruntime-web 1.27 the file the WebGPU entry loads is
// `ort-wasm-simd-threaded.asyncify.wasm`, WebGPU execution is asynchronous,
// so the WebGPU-capable build is the asyncify one. This app ships that one
// file via electrobun.config.ts's copy map (see WAKE_WASM_URL) rather than a
// bundler `?url` import: Bun.build has no Vite-style asset-URL loader for a
// raw binary import, and the copy map is this repo's existing idiom for
// exactly this ("assets/fonts" does the same thing).
//
// WebGPU is still capability-checked against `navigator.gpu` before it is
// selected, and when it is absent the tab falls back to the CPU provider IN
// THE SAME BINARY, no second fetch, no reload, and SAYS SO as a limitation.
// The engine's measured cost is ~3.5 ms per 80 ms frame on a single wasm
// thread, so the fallback is a real fallback and not a degraded-to-unusable
// one.
//
// THREADS ARE NOT ASSUMED. Multi-threaded wasm needs SharedArrayBuffer,
// which needs cross-origin isolation, which needs COOP/COEP response
// headers this app's loopback server does not send. `numThreads` is
// therefore pinned to 1 unless the webview reports `crossOriginIsolated`,
// rather than left at the library default of "as many as the system has",
// which on a non-isolated origin means a failed initialisation.
//
// KNOWN TRADEOFF (this pass): the onnxruntime-web WebGPU bundle
// (~514 KB minified) is a plain dynamic `import()`, not code-split into its
// own chunk. This app's Bun.build view config has no `splitting: true` and
// src/ui/index.html loads a single non-module script, so without splitting
// a dynamic import is inlined into the one shipped bundle rather than
// lazy-fetched on first use. Enabling splitting would need `splitting: true`
// in electrobun.config.ts's view build options plus switching the built
// entry to a `type="module"` script tag, a build-wide change out of scope
// for this pass; the simple inline is accepted here and the always-loaded
// cost is the tradeoff to revisit if bundle size becomes a real complaint.
import type { WakeInferenceSession, WakeTensor } from "@pellux/goodvibes-sdk/platform/voice/wake/runtime";

export type WakeBrowserBackend = "wasm" | "webgpu";

/**
 * Same-origin URL of the wasm binary, served by src/bun/ui-server.ts's
 * static asset path (the .wasm MIME row) from the file electrobun.config.ts
 * copies into views/mainview/wasm/ at build time.
 */
export const WAKE_WASM_URL = "/wasm/ort-wasm-simd-threaded.asyncify.wasm";

/**
 * Test seams. The module import and the GPU probe are the two things a unit
 * test cannot exercise for real, there is no WebGPU adapter and no 24 MB
 * binary in a test process, and they are exactly what has to be pinned: that
 * BOTH backend values reach one engine binary.
 */
export interface WakeRuntimeDeps {
  readonly importModule?: (() => Promise<OrtModule>) | undefined;
  readonly gpuAvailable?: (() => boolean) | undefined;
}

/** A loaded runtime: which backend is really in force, and how to make a session. */
export interface WakeRuntime {
  /** The backend actually selected, which may differ from the one requested. */
  readonly backend: WakeBrowserBackend;
  /** Written reason the requested backend was not used, or null when it was. */
  readonly fallbackReason: string | null;
  createSession(bytes: Uint8Array): Promise<WakeInferenceSession>;
}

/** The slice of onnxruntime-web this module uses, so the import stays typed. */
export interface OrtModule {
  readonly env: {
    wasm: {
      numThreads?: number;
      wasmPaths?: unknown;
      simd?: boolean | "fixed" | "relaxed";
    };
  };
  readonly InferenceSession: {
    create(bytes: Uint8Array, options: { executionProviders: string[] }): Promise<OrtSession>;
  };
  readonly Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => OrtTensor;
}

interface OrtTensor {
  readonly data: unknown;
  readonly dims: readonly number[];
}

interface OrtSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}

/** True when the webview can actually use WebGPU. */
export function webGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && Boolean((navigator as { gpu?: unknown }).gpu);
}

/**
 * Threads only where cross-origin isolation genuinely holds.
 * `crossOriginIsolated` is the browser's own answer to "is SharedArrayBuffer
 * usable here", which is the actual requirement, probing for the constructor
 * is not, because it exists and throws on a non-isolated origin.
 */
function wasmThreadCount(): number {
  const isolated = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
  return isolated === true ? 2 : 1;
}

/**
 * Load the inference runtime for a requested backend.
 *
 * ONE import path, whichever backend is asked for, so the built assets carry
 * one engine binary.
 */
export async function loadWakeRuntime(
  requested: WakeBrowserBackend,
  deps: WakeRuntimeDeps = {},
): Promise<WakeRuntime> {
  const wantsWebGpu = requested === "webgpu";
  const gpuUsable = wantsWebGpu && (deps.gpuAvailable ?? webGpuAvailable)();
  const fallbackReason = wantsWebGpu && !gpuUsable
    ? 'set to "webgpu", but this webview exposes no navigator.gpu. Detection is running on the CPU provider in '
      + "the same engine binary instead, no second download, which measures about 3.5 ms per 80 ms frame, "
      + "well inside real time."
    : null;

  const ort = await (deps.importModule ?? importWakeRuntimeModule)();
  ort.env.wasm.numThreads = wasmThreadCount();

  const backend: WakeBrowserBackend = gpuUsable ? "webgpu" : "wasm";
  // The GPU provider is listed ahead of the CPU one so onnxruntime falls back
  // within the binary if a kernel is unsupported on this device.
  const executionProviders = gpuUsable ? ["webgpu", "wasm"] : ["wasm"];

  return {
    backend,
    fallbackReason,
    createSession: async (bytes) => adaptSession(await ort.InferenceSession.create(bytes, { executionProviders }), ort),
  };
}

/**
 * The WebGPU-capable build, which carries the CPU engine as well. Both
 * values of `voice.wake.browserBackend` load this and only this.
 */
async function importWakeRuntimeModule(): Promise<OrtModule> {
  const ort = (await import("onnxruntime-web/webgpu")) as unknown as OrtModule;
  ort.env.wasm.wasmPaths = { wasm: WAKE_WASM_URL };
  return ort;
}

/**
 * Wrap an onnxruntime session in the engine's shape.
 *
 * The tensor conversion is checked rather than cast: a float32 output
 * arrives as a Float32Array, and anything else means the model is not the
 * one this webview was built for, which must fail here rather than produce
 * scores from a reinterpreted buffer.
 */
export function adaptSession(session: OrtSession, ort: Pick<OrtModule, "Tensor">): WakeInferenceSession {
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    run: async (feeds) => {
      const ortFeeds: Record<string, OrtTensor> = {};
      for (const [name, tensor] of Object.entries(feeds)) {
        ortFeeds[name] = new ort.Tensor("float32", tensor.data, tensor.dims);
      }
      const outputs = await session.run(ortFeeds);
      const result: Record<string, WakeTensor> = {};
      for (const [name, tensor] of Object.entries(outputs)) {
        if (!(tensor.data instanceof Float32Array)) {
          throw new Error(`[wake] output "${name}" is not float32; this is not the pinned model.`);
        }
        result[name] = { data: tensor.data, dims: tensor.dims };
      }
      return result;
    },
    release: async () => {
      await session.release();
    },
  };
}
