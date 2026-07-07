// Read an assistant reply aloud via voice.tts.stream → Web Audio. Honest
// states: unavailable (voice.status / no AudioContext) renders a disabled
// control with the reason; loading click-cancels; playing click-stops
// INSTANTLY. One voice at a time (the engine interrupts). Ported from
// goodvibes-webui src/components/voice/SpeakButton.tsx.

import { Loader, Square, Volume2, VolumeX } from "lucide-react";
import { useTts, TTS_UNAVAILABLE_MESSAGE } from "./voice.ts";

interface SpeakButtonProps {
  readonly messageId: string;
  readonly text: string;
}

export function SpeakButton({ messageId, text }: SpeakButtonProps) {
  const { availability, canPlay, state, isActive, speak, stop } = useTts();

  if (!text.trim()) return null;

  const active = isActive(messageId);
  const loading = active && state.phase === "loading";
  const playing = active && state.phase === "playing";

  if (!availability.ttsAvailable || !canPlay) {
    const reason = !canPlay ? "This webview cannot play synthesised audio." : TTS_UNAVAILABLE_MESSAGE;
    return (
      <button
        type="button"
        className="voice-speak-btn voice-unavailable"
        title={reason}
        aria-label={`Read aloud unavailable — ${reason}`}
        disabled
      >
        <VolumeX size={13} aria-hidden="true" />
      </button>
    );
  }

  if (loading) {
    return (
      <button
        type="button"
        className="voice-speak-btn is-loading"
        title="Preparing spoken reply — click to cancel"
        aria-label="Preparing spoken reply — click to cancel"
        onClick={stop}
      >
        <Loader size={13} aria-hidden="true" className="voice-spin" />
      </button>
    );
  }

  if (playing) {
    return (
      <button
        type="button"
        className="voice-speak-btn is-playing"
        title="Stop reading"
        aria-label="Stop reading aloud"
        onClick={stop}
      >
        <Square size={13} aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="voice-speak-btn"
      title="Read aloud"
      aria-label="Read this reply aloud"
      onClick={() => speak(messageId, text)}
    >
      <Volume2 size={13} aria-hidden="true" />
    </button>
  );
}
