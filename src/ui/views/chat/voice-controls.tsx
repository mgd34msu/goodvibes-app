// Voice settings surface (docs/FEATURES.md §18 rows 3-5): TTS speed/voice/
// provider config, the voice status/doctor row, and the realtime-session
// bootstrap. "Modals are configuration" (docs/UX.md §5) — this whole surface
// lives in one Modal opened from the composer toolbar (voice-controls wiring
// in Composer.tsx). MicButton.tsx / SpeakButton.tsx (Wave A) keep owning the
// per-message dictation/playback controls; this file is purely settings +
// diagnostics, never audio playback itself.

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Stethoscope, Radio as RadioIcon } from "lucide-react";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { formatError, isMethodUnavailableError, isMethodNotInvokableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import {
  TTS_SPEED_MAX,
  TTS_SPEED_MIN,
  TTS_SPEED_STEP,
  deriveRealtimeSessionInfo,
  diffTtsSettings,
  useApplyTtsChanges,
  useBootstrapRealtimeSession,
  useTtsProviderOptions,
  useTtsSettings,
  useVoiceDoctor,
  useVoiceOptions,
  type RealtimeSessionInfo,
} from "./voice-settings.ts";

// ─── Trigger button (composer toolbar) ──────────────────────────────────────

export function VoiceSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="composer-tool"
        title="Voice settings — speed, voice, provider, status"
        aria-label="Open voice settings"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
      </button>
      <VoiceSettingsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ─── Modal: doctor + TTS settings + realtime bootstrap ─────────────────────

interface VoiceSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function VoiceSettingsModal({ open, onClose }: VoiceSettingsModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Voice settings" size="lg">
      <div className="voice-settings">
        <VoiceDoctorSection />
        <TtsSettingsSection />
        <RealtimeSessionSection />
      </div>
    </Modal>
  );
}

// ─── Doctor row (voice.status) ──────────────────────────────────────────────

function VoiceDoctorSection() {
  const { doctor, isLoading, isError, error, refetch } = useVoiceDoctor();

  return (
    <section className="voice-settings__section" aria-label="Voice status">
      <h3 className="voice-settings__heading">
        <Stethoscope size={14} aria-hidden="true" /> Status
      </h3>
      {isLoading && <SkeletonBlock variant="text" lines={2} />}
      {isError && isMethodUnavailableError(error) && (
        <UnavailableState capability="voice.status" description="voice diagnostics cannot be read from this daemon." />
      )}
      {isError && !isMethodUnavailableError(error) && (
        <ErrorState error={error} onRetry={() => void refetch()} title="Voice status failed to load" />
      )}
      {!isLoading && !isError && (
        <>
          <p className="voice-doctor__summary" role="status">
            <span className={doctor.enabled ? "badge ok" : "badge neutral"}>
              {doctor.enabled ? "enabled" : "disabled"}
            </span>
            {doctor.note && <span className="voice-doctor__note">{doctor.note}</span>}
          </p>
          {doctor.providers.length === 0 ? (
            <p className="voice-doctor__note">No voice providers reported by this daemon.</p>
          ) : (
            <ul className="voice-doctor__providers">
              {doctor.providers.map((provider) => (
                <li key={provider.id} className="voice-doctor__provider">
                  <span className={provider.configured ? "badge ok" : "badge warning"}>
                    {provider.configured ? "configured" : "not configured"}
                  </span>
                  <span className="voice-doctor__provider-id">{provider.id}</span>
                  {provider.capabilities.length > 0 && (
                    <span className="voice-doctor__caps">{provider.capabilities.join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ─── TTS settings (speed/voice/provider → tts.* config.set, admin confirm) ──

function TtsSettingsSection() {
  const { toast } = useToast();
  const { settings, isLoading, isError, error } = useTtsSettings();
  const providers = useTtsProviderOptions();
  const [draftProvider, setDraftProvider] = useState("");
  const [draftVoice, setDraftVoice] = useState("");
  const [draftSpeed, setDraftSpeed] = useState(1);
  const voices = useVoiceOptions(draftProvider);
  const { apply, isPending } = useApplyTtsChanges();
  const [pendingChanges, setPendingChanges] = useState<Array<{ key: string; value: unknown }> | null>(null);

  // Seed drafts from the loaded settings exactly once per successful load —
  // never fights the user's in-progress edit on a background refetch.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || isLoading || isError) return;
    setDraftProvider(settings.provider);
    setDraftVoice(settings.voice);
    setDraftSpeed(settings.speed);
    setSeeded(true);
  }, [seeded, isLoading, isError, settings]);

  const changes = useMemo(
    () => diffTtsSettings(settings, { provider: draftProvider, voice: draftVoice, speed: draftSpeed }),
    [settings, draftProvider, draftVoice, draftSpeed],
  );

  async function confirmAndApply(meta: ConfirmMetadata): Promise<void> {
    const batch = pendingChanges ?? [];
    setPendingChanges(null);
    try {
      await apply(batch, meta);
      toast({ title: "Voice settings saved", tone: "success" });
    } catch (applyError) {
      toast({ title: "Failed to save voice settings", description: formatError(applyError), tone: "danger" });
    }
  }

  return (
    <section className="voice-settings__section" aria-label="Text-to-speech settings">
      <h3 className="voice-settings__heading">
        <SlidersHorizontal size={14} aria-hidden="true" /> Speech settings
      </h3>

      {isLoading && <SkeletonBlock variant="text" lines={3} />}
      {isError && (
        <ErrorState error={error} title="Could not load current tts.* config — edits below start from blank." />
      )}

      {!isLoading && (
        <form
          className="voice-settings__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (changes.length > 0) setPendingChanges(changes);
          }}
        >
          <label className="voice-settings__field">
            <span>Provider</span>
            <select
              value={draftProvider}
              onChange={(event) => {
                setDraftProvider(event.target.value);
                setDraftVoice("");
              }}
              disabled={providers.isLoading}
              aria-label="TTS provider"
            >
              <option value="">daemon default</option>
              {providers.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {providers.isError && isMethodUnavailableError(providers.error) && (
              <span className="voice-settings__hint">voice.providers.list is not available on this daemon.</span>
            )}
          </label>

          <label className="voice-settings__field">
            <span>Voice</span>
            <select
              value={draftVoice}
              onChange={(event) => setDraftVoice(event.target.value)}
              disabled={voices.isLoading}
              aria-label="TTS voice"
            >
              <option value="">daemon default</option>
              {voices.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {voices.isError && isMethodUnavailableError(voices.error) && (
              <span className="voice-settings__hint">voice.voices.list is not available on this daemon.</span>
            )}
          </label>

          <label className="voice-settings__field voice-settings__field--speed">
            <span>Speed: {draftSpeed.toFixed(2)}×</span>
            <input
              type="range"
              min={TTS_SPEED_MIN}
              max={TTS_SPEED_MAX}
              step={TTS_SPEED_STEP}
              value={draftSpeed}
              onChange={(event) => setDraftSpeed(Number(event.target.value))}
              aria-label="TTS speed"
              aria-valuetext={`${draftSpeed.toFixed(2)} times`}
            />
            <span className="voice-settings__speed-bounds">
              <span>{TTS_SPEED_MIN.toFixed(2)}×</span>
              <span>{TTS_SPEED_MAX.toFixed(2)}×</span>
            </span>
          </label>

          <div className="voice-settings__actions">
            <button type="submit" disabled={changes.length === 0 || isPending}>
              {isPending ? "Saving…" : changes.length > 0 ? `Save ${changes.length} change${changes.length === 1 ? "" : "s"}` : "No changes"}
            </button>
          </div>
        </form>
      )}

      <ConfirmSurface
        open={pendingChanges !== null}
        action="Write voice config"
        target={(pendingChanges ?? []).map((c) => c.key).join(", ") || "tts.*"}
        blastRadius="Changes speech settings (provider/voice/speed) for every surface sharing this daemon config — admin-scoped config.set."
        confirmLabel="Save voice settings"
        onCancel={() => setPendingChanges(null)}
        onConfirm={(meta) => void confirmAndApply(meta)}
      >
        <ul className="voice-settings__confirm-list">
          {(pendingChanges ?? []).map((change) => (
            <li key={change.key}>
              <code>{change.key}</code> → <code>{JSON.stringify(change.value)}</code>
            </li>
          ))}
        </ul>
      </ConfirmSurface>
    </section>
  );
}

// ─── Realtime voice session — bootstrap only (explicit stretch caption) ────

function RealtimeSessionSection() {
  const bootstrap = useBootstrapRealtimeSession();
  const info: RealtimeSessionInfo | null = bootstrap.isSuccess ? deriveRealtimeSessionInfo(bootstrap.data) : null;
  const unavailable = bootstrap.isError && isMethodUnavailableError(bootstrap.error);
  const notInvokable = bootstrap.isError && isMethodNotInvokableError(bootstrap.error);

  return (
    <section className="voice-settings__section" aria-label="Realtime voice session">
      <h3 className="voice-settings__heading">
        <RadioIcon size={14} aria-hidden="true" /> Realtime session
      </h3>
      <p className="voice-settings__stretch-caption">
        Stretch: this bootstraps a realtime voice session and shows its status only. Full duplex
        voice conversation is out of scope for this app.
      </p>

      <button
        type="button"
        className="voice-settings__realtime-btn"
        onClick={() => bootstrap.mutate()}
        disabled={bootstrap.isPending}
      >
        {bootstrap.isPending ? "Starting…" : "Start session"}
      </button>

      {unavailable && (
        <UnavailableState
          capability="voice.realtime.session"
          description="realtime voice sessions are not exposed by this daemon."
        />
      )}
      {notInvokable && (
        <UnavailableState
          capability="voice.realtime.session"
          description="this daemon knows the method but has no live handler wired for it."
        />
      )}
      {bootstrap.isError && !unavailable && !notInvokable && (
        <ErrorState error={bootstrap.error} title="Could not bootstrap a realtime session" />
      )}
      {info && (
        <dl className="voice-settings__realtime-facts">
          <dt>Session</dt>
          <dd><code>{info.sessionId || "(daemon did not return an id)"}</code></dd>
          <dt>Status</dt>
          <dd>{info.status}</dd>
          {info.note && (
            <>
              <dt>Note</dt>
              <dd>{info.note}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
