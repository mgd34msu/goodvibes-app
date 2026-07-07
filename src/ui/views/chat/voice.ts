// Voice glue for the chat surface, ported (trimmed) from goodvibes-webui
// src/lib/voice/*: mic capture → voice.stt for dictation (the daemon's
// registered provider, never the browser speech engine), and voice.tts.stream
// → Web Audio for spoken replies (one gapless sink per reply, drain-not-abort,
// bounded request policy: coalesce, concurrency 2, 429 retry + honest skip).
// Every unavailable case is an honest named state read from voice.status.

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { appFetch, HttpError } from "../../lib/http.ts";
import { queryKeys } from "../../lib/queries.ts";
import { asRecord } from "../../lib/wire.ts";

// ─── voice.status → honest availability posture ─────────────────────────────

export interface VoiceAvailability {
  readonly enabled: boolean;
  readonly ttsAvailable: boolean;
  readonly sttAvailable: boolean;
  readonly note: string;
  readonly defaultTtsProviderId?: string;
  readonly defaultSttProviderId?: string;
}

function readCapabilities(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function deriveVoiceAvailability(status: unknown): VoiceAvailability {
  const record = asRecord(status);
  const rawProviders = Array.isArray(record["providers"]) ? record["providers"] : [];
  const providers = rawProviders.map((entry) => {
    const p = asRecord(entry);
    return {
      id: typeof p["id"] === "string" ? p["id"] : "",
      configured: p["configured"] === true,
      capabilities: readCapabilities(p["capabilities"]),
    };
  });
  const ttsProvider = providers.find(
    (p) => p.configured && (p.capabilities.includes("tts") || p.capabilities.includes("tts-stream")),
  );
  const sttProvider = providers.find((p) => p.configured && p.capabilities.includes("stt"));
  return {
    enabled: record["enabled"] === true,
    ttsAvailable: Boolean(ttsProvider),
    sttAvailable: Boolean(sttProvider),
    note: typeof record["note"] === "string" ? record["note"] : "",
    ...(ttsProvider?.id ? { defaultTtsProviderId: ttsProvider.id } : {}),
    ...(sttProvider?.id ? { defaultSttProviderId: sttProvider.id } : {}),
  };
}

export const TTS_UNAVAILABLE_MESSAGE =
  "Read-aloud needs a voice provider with an API key configured on the daemon.";
export const STT_UNAVAILABLE_MESSAGE =
  "Dictation needs a speech-to-text provider with an API key configured on the daemon.";

export function useVoiceStatus(): { availability: VoiceAvailability; isLoading: boolean } {
  const query = useQuery({
    queryKey: [...queryKeys.voice, "status"],
    queryFn: () => gv.voice.status(),
    staleTime: 30_000,
    retry: false,
  });
  const availability = useMemo(() => deriveVoiceAvailability(query.data), [query.data]);
  return { availability, isLoading: query.isLoading };
}

// ─── Mic capture (dictation) ─────────────────────────────────────────────────

export type MicSupport = "ok" | "insecure-context" | "unsupported";
export type MicPhase = "idle" | "requesting" | "recording" | "transcribing" | "error";

export function detectMicSupport(): MicSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  const hasApi =
    typeof window.MediaRecorder === "function" &&
    typeof navigator.mediaDevices?.getUserMedia === "function";
  if (!hasApi) return window.isSecureContext ? "unsupported" : "insecure-context";
  return window.isSecureContext ? "ok" : "insecure-context";
}

interface RecordedAudio {
  mimeType: string;
  format: string;
  dataBase64: string;
}

interface RecordingHandle {
  stop(): Promise<RecordedAudio>;
  cancel(): void;
}

function formatFromMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim() ?? "";
  const subtype = base.split("/")[1] ?? base;
  if (subtype === "mpeg") return "mp3";
  if (subtype === "x-wav" || subtype === "wave") return "wav";
  return subtype || "webm";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

async function startRecording(): Promise<RecordingHandle> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
      throw new Error("Microphone access was blocked. Allow it and try again.");
    }
    throw new Error("Could not start recording from the microphone.");
  }
  const mimeType = PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  const releaseMic = () => {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore
      }
    }
  };
  recorder.start();
  return {
    stop: () =>
      new Promise<RecordedAudio>((resolve, reject) => {
        recorder.onerror = () => {
          releaseMic();
          reject(new Error("Recording failed."));
        };
        recorder.onstop = () => {
          releaseMic();
          const type = recorder.mimeType.trim() ? recorder.mimeType : (mimeType ?? "audio/webm");
          new Blob(chunks, { type })
            .arrayBuffer()
            .then((buffer) =>
              resolve({ mimeType: type, format: formatFromMimeType(type), dataBase64: arrayBufferToBase64(buffer) }),
            )
            .catch(() => reject(new Error("Could not read the recorded audio.")));
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      try {
        recorder.stop();
      } catch {
        // ignore
      }
      releaseMic();
    },
  };
}

export interface UseVoiceInputResult {
  readonly support: MicSupport;
  readonly availability: VoiceAvailability;
  readonly phase: MicPhase;
  readonly error: string;
  readonly ready: boolean;
  readonly start: () => Promise<void>;
  readonly stopAndTranscribe: () => Promise<void>;
  readonly cancel: () => void;
}

/** Mic → voice.stt → transcript, handed to `onTranscript` for review-before-send. */
export function useVoiceInput(onTranscript: (text: string) => void): UseVoiceInputResult {
  const { availability } = useVoiceStatus();
  const support = useMemo(() => detectMicSupport(), []);
  const [phase, setPhase] = useState<MicPhase>("idle");
  const [error, setError] = useState("");
  const handleRef = useRef<RecordingHandle | null>(null);

  const start = useCallback(async () => {
    setError("");
    setPhase("requesting");
    try {
      handleRef.current = await startRecording();
      setPhase("recording");
    } catch (e) {
      handleRef.current = null;
      setError(e instanceof Error ? e.message : "Could not start recording.");
      setPhase("error");
    }
  }, []);

  const stopAndTranscribe = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    handleRef.current = null;
    setPhase("transcribing");
    try {
      const audio = await handle.stop();
      const result = await gv.voice.stt({
        audio: { mimeType: audio.mimeType, format: audio.format, dataBase64: audio.dataBase64, metadata: {} },
        ...(availability.defaultSttProviderId ? { providerId: availability.defaultSttProviderId } : {}),
      });
      const text = asRecord(result)["text"];
      onTranscript(typeof text === "string" ? text.trim() : "");
      setPhase("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not transcribe the recording.");
      setPhase("error");
    }
  }, [availability.defaultSttProviderId, onTranscript]);

  const cancel = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
    setPhase("idle");
    setError("");
  }, []);

  return { support, availability, phase, error, ready: support === "ok" && availability.sttAvailable, start, stopAndTranscribe, cancel };
}

// ─── Speech coalescing + bounded request policy ──────────────────────────────

const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+/;

/** Split a reply into the FEWEST synthesis segments each within maxChars —
 * paragraph, then sentence, then word boundaries, greedily re-joined. */
export function coalesceForSpeech(text: string, maxChars = 1800): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const atoms: string[] = [];
  for (const paragraph of trimmed.split(/\n{2,}/)) {
    const p = paragraph.trim();
    if (!p) continue;
    if (p.length <= maxChars) {
      atoms.push(p);
      continue;
    }
    for (const sentence of p.split(SENTENCE_BOUNDARY)) {
      const s = sentence.trim();
      if (!s) continue;
      if (s.length <= maxChars) atoms.push(s);
      else atoms.push(...hardWrap(s, maxChars));
    }
  }

  const segments: string[] = [];
  let current = "";
  for (const atom of atoms) {
    if (!current) current = atom;
    else if (current.length + 1 + atom.length <= maxChars) current = `${current} ${atom}`;
    else {
      segments.push(current);
      current = atom;
    }
  }
  if (current) segments.push(current);
  return segments;
}

function hardWrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars) current = `${current} ${word}`;
    else {
      out.push(current);
      current = word;
    }
    if (current.length > maxChars && current === word) {
      out.push(current);
      current = "";
    }
  }
  if (current) out.push(current);
  return out;
}

// ─── Web Audio playback engine (one sink, drain-not-abort) ───────────────────

export type TtsPhase = "loading" | "playing";

export interface TtsPlaybackState {
  readonly id: string | null;
  readonly phase: TtsPhase | null;
  readonly skipped: number;
  readonly error: string | null;
}

const IDLE: TtsPlaybackState = { id: null, phase: null, skipped: 0, error: null };

export function canPlayAudio(): boolean {
  return typeof window !== "undefined" && typeof window.AudioContext === "function";
}

class WebAudioSink {
  private readonly ctx: AudioContext;
  private nextStart = 0;
  private stopped = false;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly pending = new Set<() => void>();

  constructor() {
    this.ctx = new AudioContext();
  }

  async enqueue(audio: ArrayBuffer): Promise<void> {
    if (this.stopped) return;
    await this.ctx.resume().catch(() => undefined);
    const buffer = await this.ctx.decodeAudioData(audio);
    if (this.stopped) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const startAt = Math.max(this.ctx.currentTime, this.nextStart);
    this.nextStart = startAt + buffer.duration;
    this.sources.add(source);
    return new Promise<void>((resolve) => {
      this.pending.add(resolve);
      source.onended = () => {
        this.sources.delete(source);
        this.pending.delete(resolve);
        resolve();
      };
      source.start(startAt);
    });
  }

  stop(): void {
    this.stopped = true;
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // a never-started source throws on stop — ignore
      }
    }
    this.sources.clear();
    for (const resolve of this.pending) resolve();
    this.pending.clear();
  }

  async close(): Promise<void> {
    this.stop();
    await this.ctx.close().catch(() => undefined);
  }
}

interface TtsSpeakRequest {
  readonly id: string;
  readonly segments: readonly string[];
  readonly synth: (text: string, signal: AbortSignal) => Promise<ArrayBuffer>;
}

class TtsEngine {
  private state: TtsPlaybackState = IDLE;
  private readonly listeners = new Set<() => void>();
  private current: { abort: AbortController; sink: WebAudioSink } | null = null;
  private token = 0;

  getState(): TtsPlaybackState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(next: TtsPlaybackState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  stop(): void {
    this.token += 1;
    this.teardown();
    this.set(IDLE);
  }

  private teardown(): void {
    const active = this.current;
    this.current = null;
    if (!active) return;
    active.abort.abort();
    active.sink.stop();
    void active.sink.close();
  }

  /** Speak a reply; interrupts anything already playing. Concurrency-2 fetch
   * ahead with 429 retry + honest skip-and-continue per segment. */
  async speak(request: TtsSpeakRequest): Promise<void> {
    this.teardown();
    const token = (this.token += 1);
    if (request.segments.length === 0) {
      this.set({ id: null, phase: null, skipped: 0, error: "There is nothing to read aloud." });
      return;
    }
    if (!canPlayAudio()) {
      this.set({ id: null, phase: null, skipped: 0, error: "Audio playback is not available here." });
      return;
    }

    const sink = new WebAudioSink();
    const abort = new AbortController();
    this.current = { abort, sink };
    this.set({ id: request.id, phase: "loading", skipped: 0, error: null });

    const total = request.segments.length;
    const results: (Promise<ArrayBuffer | null> | undefined)[] = new Array(total);
    let nextToFetch = 0;
    const fetchOne = async (index: number): Promise<ArrayBuffer | null> => {
      const text = request.segments[index] ?? "";
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (abort.signal.aborted) return null;
        try {
          return await request.synth(text, abort.signal);
        } catch (error) {
          if (abort.signal.aborted) return null;
          const status = error instanceof HttpError ? error.status : (error as { status?: number }).status;
          if (status !== 429 || attempt === 3) return null;
          await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
        }
      }
      return null;
    };
    const pump = () => {
      while (nextToFetch < total && nextToFetch < playIndex + 2) {
        const index = nextToFetch;
        nextToFetch += 1;
        results[index] = fetchOne(index);
      }
    };

    let playIndex = 0;
    let skipped = 0;
    let played = 0;
    try {
      for (playIndex = 0; playIndex < total; playIndex += 1) {
        pump();
        const slot = results[playIndex];
        const audio = slot ? await slot : null;
        if (this.token !== token) return;
        if (!audio) {
          skipped += 1;
          if (this.state.id === request.id) this.set({ ...this.state, skipped });
          continue;
        }
        this.set({ id: request.id, phase: "playing", skipped, error: null });
        await sink.enqueue(audio);
        played += 1;
        if (this.token !== token) return;
      }
    } finally {
      if (this.token === token) {
        void sink.close();
        this.current = null;
      }
    }

    if (this.token !== token) return;
    if (played === 0) {
      this.set({ id: null, phase: null, skipped, error: "The voice provider could not read this reply aloud." });
    } else {
      this.set(IDLE);
    }
  }
}

/** Process-wide engine: one voice at a time across every Speak control. */
export const ttsEngine = new TtsEngine();

const DEFAULT_TTS_FORMAT = "mp3";

/** base64 → ArrayBuffer for the one-shot voice.tts JSON response (its audio
 * comes back as {mimeType,format,dataBase64}, not raw bytes like the stream
 * route — no shared decoder exists in lib/, so this stays local). */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** One-shot voice.tts fallback (docs/GAPS.md §18 row 1): probed live against
 * a daemon where the only configured TTS provider (Microsoft Edge) reports
 * capabilities ["tts"] with no "tts-stream" — calling voice.tts.stream for
 * it returns a 409 PROVIDER_NOT_CONFIGURED ("Voice streaming TTS provider is
 * unavailable: microsoft"), never a clean 404/501, so the fallback triggers
 * on ANY non-ok stream response, not just method-unavailable ones. The
 * one-shot route DOES work for that same provider and returns the full
 * audio as base64 JSON — decoded here into the same ArrayBuffer shape the
 * WebAudioSink already expects, so it drops into the existing playback
 * pipeline unchanged. */
async function synthSegmentOneShot(text: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const result = await gv.voice.tts({ text, format: DEFAULT_TTS_FORMAT });
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const audio = asRecord(asRecord(result)["audio"]);
  const dataBase64 = audio["dataBase64"];
  if (typeof dataBase64 !== "string" || !dataBase64) {
    throw new Error("voice.tts did not return audio data.");
  }
  return base64ToArrayBuffer(dataBase64);
}

async function synthSegment(text: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const path = gv.voice.ttsStreamPath();
  try {
    const res = await appFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, format: DEFAULT_TTS_FORMAT }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new HttpError(res.status, path, body);
    }
    return await res.arrayBuffer();
  } catch (error) {
    if (signal.aborted) throw error;
    // Stream route unavailable for the active provider — fall back to the
    // one-shot route rather than skipping the segment outright.
    return synthSegmentOneShot(text, signal);
  }
}

export interface UseTtsResult {
  readonly availability: VoiceAvailability;
  readonly state: TtsPlaybackState;
  readonly canPlay: boolean;
  readonly isActive: (id: string) => boolean;
  readonly speak: (id: string, text: string) => void;
  readonly stop: () => void;
}

export function useTts(): UseTtsResult {
  const { availability } = useVoiceStatus();
  const state = useSyncExternalStore(
    useCallback((onChange: () => void) => ttsEngine.subscribe(onChange), []),
    () => ttsEngine.getState(),
    () => ttsEngine.getState(),
  );
  const speak = useCallback((id: string, text: string) => {
    void ttsEngine.speak({ id, segments: coalesceForSpeech(text), synth: synthSegment });
  }, []);
  const stop = useCallback(() => ttsEngine.stop(), []);
  const isActive = useCallback((id: string) => state.id === id, [state.id]);
  return { availability, state, canPlay: canPlayAudio(), isActive, speak, stop };
}

/** Speak a reply outside React (the always-speak toggle path). */
export function speakText(id: string, text: string): void {
  void ttsEngine.speak({ id, segments: coalesceForSpeech(text), synth: synthSegment });
}
