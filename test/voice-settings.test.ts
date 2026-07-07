// Pure-logic coverage for src/ui/views/chat/voice-settings.ts: speed
// clamping, defensive config/status/catalog readers, and the change-set
// diff that drives the confirm-gated tts.* config.set batch.

import { describe, expect, test } from "bun:test";
import {
  TTS_SPEED_MAX,
  TTS_SPEED_MIN,
  clampTtsSpeed,
  deriveRealtimeSessionInfo,
  deriveVoiceDoctor,
  diffTtsSettings,
  readTtsSettingsFromConfig,
  ttsProviderOptionsFrom,
  voiceOptionsFrom,
} from "../src/ui/views/chat/voice-settings.ts";

describe("clampTtsSpeed", () => {
  test("passes through in-range values", () => {
    expect(clampTtsSpeed(1.5)).toBe(1.5);
  });
  test("clamps below the minimum", () => {
    expect(clampTtsSpeed(0)).toBe(TTS_SPEED_MIN);
  });
  test("clamps above the maximum", () => {
    expect(clampTtsSpeed(10)).toBe(TTS_SPEED_MAX);
  });
  test("falls back to the default for non-finite input", () => {
    expect(clampTtsSpeed(Number.NaN)).toBe(1);
  });
});

describe("readTtsSettingsFromConfig", () => {
  test("reads flat dotted keys", () => {
    const settings = readTtsSettingsFromConfig({
      config: { "tts.provider": "elevenlabs", "tts.voice": "rachel", "tts.speed": 1.25 },
    });
    expect(settings).toEqual({ provider: "elevenlabs", voice: "rachel", speed: 1.25 });
  });

  test("reads a nested tts object", () => {
    const settings = readTtsSettingsFromConfig({ tts: { provider: "openai", voice: "alloy", speed: 2 } });
    expect(settings).toEqual({ provider: "openai", voice: "alloy", speed: 2 });
  });

  test("defaults speed to 1 and empty strings when unset", () => {
    const settings = readTtsSettingsFromConfig({});
    expect(settings).toEqual({ provider: "", voice: "", speed: 1 });
  });

  test("clamps an out-of-range stored speed", () => {
    const settings = readTtsSettingsFromConfig({ config: { "tts.speed": 9 } });
    expect(settings.speed).toBe(TTS_SPEED_MAX);
  });
});

describe("deriveVoiceDoctor", () => {
  test("reads enabled + note + provider rows", () => {
    const doctor = deriveVoiceDoctor({
      enabled: true,
      note: "one provider configured",
      providers: [
        { id: "elevenlabs", configured: true, capabilities: ["tts", "tts-stream"] },
        { id: "whisper", configured: false, capabilities: ["stt"] },
      ],
    });
    expect(doctor.enabled).toBe(true);
    expect(doctor.note).toBe("one provider configured");
    expect(doctor.providers).toHaveLength(2);
    expect(doctor.providers[0]).toEqual({ id: "elevenlabs", configured: true, capabilities: ["tts", "tts-stream"] });
  });

  test("degrades honestly on a garbage payload", () => {
    const doctor = deriveVoiceDoctor(null);
    expect(doctor).toEqual({ enabled: false, note: "", providers: [] });
  });
});

describe("catalog readers", () => {
  test("ttsProviderOptionsFrom keeps only tts-capable providers", () => {
    const options = ttsProviderOptionsFrom({
      providers: [
        { id: "elevenlabs", label: "ElevenLabs", capabilities: ["tts"] },
        { id: "whisper", label: "Whisper", capabilities: ["stt"] },
        { id: "legacy" },
      ],
    });
    expect(options.map((o) => o.id)).toEqual(["elevenlabs", "legacy"]);
  });

  test("voiceOptionsFrom filters by providerId when present on entries", () => {
    const options = voiceOptionsFrom(
      {
        voices: [
          { id: "rachel", providerId: "elevenlabs" },
          { id: "alloy", providerId: "openai" },
          { id: "narrator" }, // no providerId — stays selectable for any provider
        ],
      },
      "elevenlabs",
    );
    expect(options.map((o) => o.id)).toEqual(["rachel", "narrator"]);
  });
});

describe("diffTtsSettings", () => {
  const current = { provider: "elevenlabs", voice: "rachel", speed: 1 };

  test("empty when the draft matches", () => {
    expect(diffTtsSettings(current, { provider: "elevenlabs", voice: "rachel", speed: 1 })).toEqual([]);
  });

  test("emits only the changed keys", () => {
    const changes = diffTtsSettings(current, { provider: "elevenlabs", voice: "alloy", speed: 1.5 });
    expect(changes).toEqual([
      { key: "tts.voice", value: "alloy" },
      { key: "tts.speed", value: 1.5 },
    ]);
  });

  test("clamps the draft speed before diffing", () => {
    const changes = diffTtsSettings(current, { provider: "elevenlabs", voice: "rachel", speed: 99 });
    expect(changes).toEqual([{ key: "tts.speed", value: TTS_SPEED_MAX }]);
  });
});

describe("deriveRealtimeSessionInfo", () => {
  test("reads a nested session object", () => {
    const info = deriveRealtimeSessionInfo({ session: { sessionId: "sess_1", status: "active" } });
    expect(info).toEqual({ sessionId: "sess_1", status: "active", note: "" });
  });

  test("falls back to a bare id/status payload and a default status", () => {
    const info = deriveRealtimeSessionInfo({ id: "sess_2" });
    expect(info).toEqual({ sessionId: "sess_2", status: "created", note: "" });
  });
});
