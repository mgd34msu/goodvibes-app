// Dictation control: mic → daemon voice.stt → transcript into the composer
// draft for review before sending (never auto-sent). Every unavailable case
// is an honest, named state — voice.status decides, not hope. Ported from
// goodvibes-webui src/components/voice/MicButton.tsx.

import { Loader, Mic, MicOff, Square } from "lucide-react";
import { useVoiceInput, STT_UNAVAILABLE_MESSAGE } from "./voice.ts";

interface MicButtonProps {
  readonly onTranscript: (text: string) => void;
  readonly disabled?: boolean;
}

export function MicButton({ onTranscript, disabled }: MicButtonProps) {
  const { support, availability, phase, error, start, stopAndTranscribe } = useVoiceInput(onTranscript);

  let icon = <Mic size={15} aria-hidden="true" />;
  let label = "Dictate a message";
  let note = "";
  let onClick: (() => void) | undefined;
  let controlDisabled = Boolean(disabled);
  let recording = false;

  if (support === "insecure-context") {
    icon = <MicOff size={15} aria-hidden="true" />;
    label = "Dictation unavailable — the webview lacks a secure context for microphone capture";
    note = label;
    controlDisabled = true;
  } else if (support === "unsupported") {
    icon = <MicOff size={15} aria-hidden="true" />;
    label = "Dictation unavailable — this webview cannot capture the microphone";
    note = label;
    controlDisabled = true;
  } else if (!availability.sttAvailable) {
    icon = <MicOff size={15} aria-hidden="true" />;
    label = "Dictation unavailable — no speech-to-text provider (voice.status)";
    note = STT_UNAVAILABLE_MESSAGE;
    controlDisabled = true;
  } else if (phase === "recording") {
    icon = <Square size={15} aria-hidden="true" />;
    label = "Stop and transcribe";
    note = "Recording — click to stop and transcribe.";
    onClick = () => void stopAndTranscribe();
    recording = true;
  } else if (phase === "requesting" || phase === "transcribing") {
    icon = <Loader size={15} aria-hidden="true" className="voice-spin" />;
    label = phase === "requesting" ? "Requesting microphone…" : "Transcribing…";
    controlDisabled = true;
  } else if (phase === "error") {
    label = "Dictation failed — click to try again";
    note = `${error || "Dictation failed."} Click the mic to try again.`;
    onClick = () => void start();
  } else {
    onClick = () => void start();
  }

  return (
    <button
      type="button"
      className={`composer-tool voice-mic-btn${recording ? " is-recording" : ""}`}
      title={note || label}
      aria-label={label}
      aria-pressed={recording}
      disabled={controlDisabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
