// TTS settings (speed/voice/provider), the voice status/doctor row, and the
// realtime-session BOOTSTRAP (docs/FEATURES.md §18). Sibling to voice.ts
// (which owns mic dictation + Web Audio TTS playback) — this file owns the
// *configuration* and *diagnostics* surface: reading/writing the daemon's
// `tts.*` config keys, listing voice/provider catalogs, and the honest
// "stretch" realtime-session bootstrap. Every reader is defensive (lib/wire)
// because the exact voice.voices.list / voice.providers.list payload shape
// is not pinned across daemon versions.

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gv, invoke } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import type { ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { asRecord, firstArrayAtPath, firstString } from "../../lib/wire.ts";

// ─── tts.* config keys (config.get/.set) ────────────────────────────────────
// Confirmed against goodvibes-tui's settings-modal-data.ts: tts.provider,
// tts.voice, tts.speed (0.25-4.0, synthetic — not yet a schema ConfigKey on
// every daemon build), tts.llmProvider/tts.llmModel (spoken-turn routing,
// out of this row's scope).

export const TTS_PROVIDER_KEY = "tts.provider";
export const TTS_VOICE_KEY = "tts.voice";
export const TTS_SPEED_KEY = "tts.speed";

export const TTS_SPEED_MIN = 0.25;
export const TTS_SPEED_MAX = 4.0;
export const TTS_SPEED_DEFAULT = 1.0;
export const TTS_SPEED_STEP = 0.05;

/** Clamp any raw value into the daemon's accepted TTS speed range. */
export function clampTtsSpeed(value: number): number {
  if (!Number.isFinite(value)) return TTS_SPEED_DEFAULT;
  return Math.min(TTS_SPEED_MAX, Math.max(TTS_SPEED_MIN, value));
}

export interface TtsSettings {
  readonly provider: string;
  readonly voice: string;
  readonly speed: number;
}

/** Read tts.* out of a config.get() payload — flat dotted keys OR nested
 * {tts:{provider,voice,speed}}, whichever this daemon build serializes. */
export function readTtsSettingsFromConfig(config: unknown): TtsSettings {
  const root = asRecord(config);
  const flat = asRecord(root["config"] ?? root);
  const nested = asRecord(flat["tts"] ?? root["tts"]);

  const provider = firstString(flat, [TTS_PROVIDER_KEY]) || firstString(nested, ["provider"]);
  const voice = firstString(flat, [TTS_VOICE_KEY]) || firstString(nested, ["voice"]);
  const rawSpeed = flat[TTS_SPEED_KEY] ?? nested["speed"];
  const speed = typeof rawSpeed === "number" && Number.isFinite(rawSpeed) ? clampTtsSpeed(rawSpeed) : TTS_SPEED_DEFAULT;

  return { provider, voice, speed };
}

export function useTtsSettings(): { settings: TtsSettings; isLoading: boolean; isError: boolean; error: unknown } {
  const query = useQuery({ queryKey: queryKeys.configAll, queryFn: () => gv.config.get() });
  const settings = useMemo(() => readTtsSettingsFromConfig(query.data), [query.data]);
  return { settings, isLoading: query.isLoading, isError: query.isError, error: query.error };
}

/** One config.set write for a single tts.* key, confirm-gated (admin scope —
 * matches docs/FEATURES.md §18's "config tts.* keys (config.set admin
 * confirm)"). Invalidates the shared config query so every reader refreshes. */
export function useSetTtsConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value, meta }: { key: string; value: unknown; meta: ConfirmMetadata }) =>
      gv.config.set({ key, value, ...meta }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.configAll }),
  });
}

// ─── Voice status / doctor row (voice.status) ───────────────────────────────

export interface VoiceProviderRow {
  readonly id: string;
  readonly configured: boolean;
  readonly capabilities: readonly string[];
}

export interface VoiceDoctorInfo {
  readonly enabled: boolean;
  readonly note: string;
  readonly providers: readonly VoiceProviderRow[];
}

function readCapabilityList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Full provider table for the doctor row — id/configured/capabilities per
 * entry, unlike voice.ts's deriveVoiceAvailability which only needs a single
 * best match per capability. */
export function deriveVoiceDoctor(status: unknown): VoiceDoctorInfo {
  const record = asRecord(status);
  const rawProviders = Array.isArray(record["providers"]) ? record["providers"] : [];
  const providers = rawProviders.map((entry): VoiceProviderRow => {
    const p = asRecord(entry);
    return {
      id: firstString(p, ["id", "providerId", "name"]),
      configured: p["configured"] === true,
      capabilities: readCapabilityList(p["capabilities"]),
    };
  });
  return {
    enabled: record["enabled"] === true,
    note: firstString(record, ["note", "message"]),
    providers,
  };
}

export function useVoiceDoctor() {
  const query = useQuery({
    queryKey: [...queryKeys.voice, "doctor"],
    queryFn: () => gv.voice.status(),
    staleTime: 15_000,
    retry: false,
  });
  const doctor = useMemo(() => deriveVoiceDoctor(query.data), [query.data]);
  return { doctor, ...query };
}

// ─── Provider / voice catalogs (voice.providers.list, voice.voices.list) ────

export interface VoiceCatalogOption {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
}

/** voice.providers.list → options usable in a <select>, filtered to
 * providers that actually advertise a TTS capability. */
export function ttsProviderOptionsFrom(value: unknown): VoiceCatalogOption[] {
  return firstArrayAtPath(value, [["providers"], ["items"], ["data"], ["results"]])
    .map((entry) => {
      const p = asRecord(entry);
      const id = firstString(p, ["id", "providerId", "name"]);
      const capabilities = readCapabilityList(p["capabilities"]);
      return { id, label: firstString(p, ["label", "name", "id"]) || id, providerId: id, capabilities };
    })
    .filter((p) => p.id && (p.capabilities.length === 0 || p.capabilities.some((c) => c.startsWith("tts"))))
    .map(({ id, label, providerId }) => ({ id, label, providerId }));
}

/** voice.voices.list → options, optionally narrowed to one provider when the
 * entry carries a providerId field (daemons that return a flat cross-provider
 * catalog report no providerId and every voice stays selectable). */
export function voiceOptionsFrom(value: unknown, providerId?: string): VoiceCatalogOption[] {
  const all = firstArrayAtPath(value, [["voices"], ["items"], ["data"], ["results"]]).map((entry) => {
    const v = asRecord(entry);
    const id = firstString(v, ["id", "voiceId", "name"]);
    return {
      id,
      label: firstString(v, ["label", "name", "id"]) || id,
      providerId: firstString(v, ["providerId", "provider"]),
    };
  });
  const filtered = providerId ? all.filter((v) => !v.providerId || v.providerId === providerId) : all;
  return filtered.filter((v) => v.id);
}

export function useTtsProviderOptions() {
  const query = useQuery({
    queryKey: [...queryKeys.voice, "providers"],
    queryFn: () => gv.voice.providers(),
    staleTime: 60_000,
    retry: false,
  });
  const options = useMemo(() => ttsProviderOptionsFrom(query.data), [query.data]);
  return { options, ...query };
}

export function useVoiceOptions(providerId: string) {
  const query = useQuery({
    queryKey: [...queryKeys.voice, "voices"],
    queryFn: () => gv.voice.voices(),
    staleTime: 60_000,
    retry: false,
  });
  const options = useMemo(() => voiceOptionsFrom(query.data, providerId || undefined), [query.data, providerId]);
  return { options, ...query };
}

// ─── Realtime voice session — BOOTSTRAP ONLY ────────────────────────────────
// docs/FEATURES.md §18: "full duplex UI is explicitly out of scope; render
// the honest 'stretch' caption." voice.realtime.session is not on the gv.voice
// facade (Wave A didn't wrap it) — invoked directly by method id.

export interface RealtimeSessionInfo {
  readonly sessionId: string;
  readonly status: string;
  readonly note: string;
}

export function deriveRealtimeSessionInfo(value: unknown): RealtimeSessionInfo {
  const record = asRecord(value);
  const session = asRecord(record["session"] ?? record);
  return {
    sessionId: firstString(session, ["sessionId", "id"]),
    status: firstString(session, ["status", "state"]) || "created",
    note: firstString(record, ["note", "message"]),
  };
}

export function useBootstrapRealtimeSession() {
  return useMutation({
    mutationFn: () => invoke("voice.realtime.session", { body: {} }),
  });
}

// ─── Change-set helper for the settings save flow ───────────────────────────

export interface TtsSettingsDraft {
  readonly provider: string;
  readonly voice: string;
  readonly speed: number;
}

/** Diff a draft against the loaded settings — only keys that actually
 * changed get written (one config.set per changed key, webui doctrine). */
export function diffTtsSettings(current: TtsSettings, draft: TtsSettingsDraft): Array<{ key: string; value: unknown }> {
  const changes: Array<{ key: string; value: unknown }> = [];
  if (draft.provider !== current.provider) changes.push({ key: TTS_PROVIDER_KEY, value: draft.provider });
  if (draft.voice !== current.voice) changes.push({ key: TTS_VOICE_KEY, value: draft.voice });
  const nextSpeed = clampTtsSpeed(draft.speed);
  if (nextSpeed !== current.speed) changes.push({ key: TTS_SPEED_KEY, value: nextSpeed });
  return changes;
}

/** Apply an already-confirmed change set sequentially; callers pass the SAME
 * ConfirmMetadata to every write in the batch (one confirm covers the batch). */
export function useApplyTtsChanges() {
  const setConfig = useSetTtsConfig();
  const apply = useCallback(
    async (changes: Array<{ key: string; value: unknown }>, meta: ConfirmMetadata) => {
      for (const change of changes) {
        // eslint-disable-next-line no-await-in-loop -- one-key-at-a-time config.set is intentional (webui doctrine).
        await setConfig.mutateAsync({ ...change, meta });
      }
    },
    [setConfig],
  );
  return { apply, isPending: setConfig.isPending, error: setConfig.error };
}
