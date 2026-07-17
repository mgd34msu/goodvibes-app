// Voice settings surface (docs/FEATURES.md §18 rows 3-5): TTS speed/voice/
// provider config, the voice status/doctor row, and the realtime-session
// bootstrap. "Modals are configuration" (docs/UX.md §5) — this whole surface
// lives in one Modal opened from the composer toolbar (voice-controls wiring
// in Composer.tsx). MicButton.tsx / SpeakButton.tsx (Wave A) keep owning the
// per-message dictation/playback controls; this file is purely settings +
// diagnostics, never audio playback itself.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, SlidersHorizontal, Stethoscope, Radio as RadioIcon } from "lucide-react";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { formatError, isMethodUnavailableError, isMethodNotInvokableError } from "../../lib/errors.ts";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { asRecord } from "../../lib/wire.ts";
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
        <LocalVoiceSection />
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

// ─── Local voice — managed piper/whisper.cpp install (voice.local.*) ───────
// Crib (faithfully adopted): goodvibes-webui's VoiceSettings.tsx
// "voice-settings-local" section + lib/voice/voice-local-setup.ts, and
// goodvibes-tui's /voice setup. Independent of the tts.provider dropdown
// above — a fully-unprovisioned 'local' provider has no capabilities yet so
// it never appears there; this section is the only place that offers the
// one-act setup. No wire event exists for this domain — the status query is
// plain fetch-once, except while an install is running: voice.local.status
// then carries an OPTIONAL `installInProgress` section (no separate progress
// stream exists), so the status query polls on a short interval for exactly
// that window (mirrors FleetView's snapshot-poll-while-active idiom).

type VoiceLocalRuntimeState = "not-provisioned" | "partial" | "provisioned" | "unsupported-platform";
const RUNTIME_STATES: readonly VoiceLocalRuntimeState[] = [
  "not-provisioned",
  "partial",
  "provisioned",
  "unsupported-platform",
];

type VoiceLocalInstallPhase = "skip" | "download" | "verify" | "extract" | "done" | "error";
const INSTALL_PHASES: readonly VoiceLocalInstallPhase[] = ["skip", "download", "verify", "extract", "done", "error"];

interface VoiceLocalInstallProgressComponent {
  readonly component: string;
  readonly phase: VoiceLocalInstallPhase;
  readonly message?: string;
  readonly bytesTotal?: number;
  readonly bytesDone?: number;
}

interface VoiceLocalInstallProgress {
  readonly components: readonly VoiceLocalInstallProgressComponent[];
}

interface VoiceLocalStatusSnapshot {
  readonly state: VoiceLocalRuntimeState;
  readonly ttsEngine: string;
  readonly sttEngine: string;
  readonly sttSupported: boolean;
  /** null when no pinned build exists for this platform at all — nothing to offer. */
  readonly offerBytes: number | null;
  readonly installInProgress?: VoiceLocalInstallProgress;
}

/** Defensive wire parse for voice.local.status. Null when the answer does not
 * carry a real runtime state — an honest, retriable error, never a crash or
 * a fabricated label. */
function readVoiceLocalStatus(value: unknown): VoiceLocalStatusSnapshot | null {
  const record = asRecord(value);
  const state = RUNTIME_STATES.find((s) => s === record["state"]);
  if (!state) return null;
  const tts = asRecord(record["tts"]);
  const stt = asRecord(record["stt"]);
  const rawProgress = asRecord(record["installInProgress"]);
  const hasProgress = Object.keys(rawProgress).length > 0;
  const components = (Array.isArray(rawProgress["components"]) ? rawProgress["components"] : [])
    .map((entry): VoiceLocalInstallProgressComponent | null => {
      const step = asRecord(entry);
      const phase = INSTALL_PHASES.find((p) => p === step["phase"]);
      if (!phase || typeof step["component"] !== "string" || !step["component"]) return null;
      return {
        component: step["component"],
        phase,
        ...(typeof step["message"] === "string" && step["message"] ? { message: step["message"] } : {}),
        ...(typeof step["bytesTotal"] === "number" ? { bytesTotal: step["bytesTotal"] } : {}),
        ...(typeof step["bytesDone"] === "number" ? { bytesDone: step["bytesDone"] } : {}),
      };
    })
    .filter((c): c is VoiceLocalInstallProgressComponent => c !== null);
  return {
    state,
    ttsEngine: typeof tts["engine"] === "string" && tts["engine"] ? tts["engine"] : "piper",
    sttEngine: typeof stt["engine"] === "string" && stt["engine"] ? stt["engine"] : "whisper-cpp",
    sttSupported: stt["supported"] === true,
    offerBytes: typeof record["offerBytes"] === "number" ? record["offerBytes"] : null,
    ...(hasProgress ? { installInProgress: { components } } : {}),
  };
}

type VoiceLocalInstallEngineState =
  | "provisioned"
  | "unsupported-platform"
  | "download-failed"
  | "checksum-mismatch"
  | "bundle-unavailable"
  | "sideload-mismatch";
const INSTALL_ENGINE_STATES: readonly VoiceLocalInstallEngineState[] = [
  "provisioned",
  "unsupported-platform",
  "download-failed",
  "checksum-mismatch",
  "bundle-unavailable",
  "sideload-mismatch",
];

interface VoiceLocalInstallEngineOutcome {
  readonly engine: string;
  readonly state: VoiceLocalInstallEngineState;
  readonly reason?: string;
}

interface VoiceLocalInstallResult {
  readonly tts: VoiceLocalInstallEngineOutcome;
  readonly stt: VoiceLocalInstallEngineOutcome;
  readonly configuredSet: readonly string[];
  readonly configuredSkipped: readonly string[];
}

function readInstallEngineOutcome(value: unknown, fallbackEngine: string): VoiceLocalInstallEngineOutcome | null {
  const record = asRecord(value);
  const state = INSTALL_ENGINE_STATES.find((s) => s === record["state"]);
  if (!state) return null;
  const reason = record["reason"];
  return {
    engine: typeof record["engine"] === "string" && record["engine"] ? record["engine"] : fallbackEngine,
    state,
    ...(typeof reason === "string" && reason ? { reason } : {}),
  };
}

/** Defensive wire parse for the voice.local.install receipt. Null when either
 * per-engine terminal state is missing — the receipt is meaningless without
 * both. */
function readVoiceLocalInstallResult(value: unknown): VoiceLocalInstallResult | null {
  const record = asRecord(value);
  const tts = readInstallEngineOutcome(record["tts"], "piper");
  const stt = readInstallEngineOutcome(record["stt"], "whisper-cpp");
  if (!tts || !stt) return null;
  const configured = asRecord(record["configured"]);
  const readKeys = (list: unknown): string[] =>
    (Array.isArray(list) ? list : [])
      .map((entry) => asRecord(entry)["key"])
      .filter((key): key is string => typeof key === "string" && key !== "");
  return {
    tts,
    stt,
    configuredSet: readKeys(configured["set"]),
    configuredSkipped: readKeys(configured["skipped"]),
  };
}

/** True when the resting status justifies offering the one-act setup —
 * 'unsupported-platform' gets an honest message instead (no pinned build
 * exists for this platform at all, so an install attempt cannot succeed). */
function voiceLocalNeedsSetup(state: VoiceLocalRuntimeState): boolean {
  return state === "not-provisioned" || state === "partial";
}

function voiceLocalStateLabel(state: VoiceLocalRuntimeState): string {
  switch (state) {
    case "provisioned":
      return "Installed";
    case "partial":
      return "Partially installed";
    case "not-provisioned":
      return "Not set up";
    case "unsupported-platform":
      return "Not supported on this platform";
  }
}

/** Honest enum label — the real wire enum name stays as-is in code (never
 * renamed), only the displayed label softens it. bundle-unavailable reads as
 * "not yet published for this platform" per this round's brief. */
function voiceLocalInstallStateLabel(state: VoiceLocalInstallEngineState): string {
  switch (state) {
    case "provisioned":
      return "Installed";
    case "unsupported-platform":
      return "Not supported on this platform";
    case "download-failed":
      return "Download failed";
    case "checksum-mismatch":
      return "Checksum mismatch";
    case "bundle-unavailable":
      return "Not yet published for this platform";
    case "sideload-mismatch":
      return "Sideloaded file does not match the pinned build";
  }
}

/** Retriable ONLY for download-failed/checksum-mismatch — a platform gap, an
 * unpublished bundle, or a mismatched sideloaded file will not be fixed by
 * clicking the same button again. */
function voiceLocalInstallIsRetriable(state: VoiceLocalInstallEngineState): boolean {
  return state === "download-failed" || state === "checksum-mismatch";
}

function voiceLocalPhaseLabel(phase: VoiceLocalInstallPhase): string {
  switch (phase) {
    case "skip":
      return "Already present";
    case "download":
      return "Downloading";
    case "verify":
      return "Verifying";
    case "extract":
      return "Extracting";
    case "done":
      return "Done";
    case "error":
      return "Failed";
  }
}

function formatVoiceLocalBytes(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function useVoiceLocalStatus(pollForInstallProgress: boolean) {
  return useQuery({
    queryKey: queryKeys.voiceLocal,
    queryFn: () => gv.voice.local.status(),
    retry: false,
    // Poll only while an install this surface kicked off is in flight — the
    // one window the daemon serves installInProgress at all.
    refetchInterval: pollForInstallProgress ? 2_000 : false,
  });
}

function useVoiceLocalInstall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => gv.voice.local.install(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.voiceLocal });
    },
  });
}

function LocalVoiceSection() {
  const install = useVoiceLocalInstall();
  const status = useVoiceLocalStatus(install.isPending);

  // Skip the whole section — not even a note — only when the base status
  // verb itself is unavailable on this daemon build; genuinely nothing to
  // offer there (same honest-omission call as webui's own local section).
  if (status.isError && (isMethodUnavailableError(status.error) || isMethodNotInvokableError(status.error))) {
    return null;
  }

  const snapshot = status.isSuccess ? readVoiceLocalStatus(status.data) : null;
  const installResult = install.isSuccess ? readVoiceLocalInstallResult(install.data) : null;
  const retriable =
    installResult !== null &&
    (voiceLocalInstallIsRetriable(installResult.tts.state) || voiceLocalInstallIsRetriable(installResult.stt.state));
  const needsSetup = snapshot ? voiceLocalNeedsSetup(snapshot.state) : false;

  return (
    <section className="voice-settings__section" aria-label="Local voice">
      <h3 className="voice-settings__heading">
        <Download size={14} aria-hidden="true" /> Local voice (free, offline)
      </h3>

      {status.isPending && <SkeletonBlock variant="text" lines={2} />}

      {status.isError && (
        <p className="voice-settings__hint" role="alert">
          Local voice status unavailable — {formatError(status.error)}
        </p>
      )}

      {snapshot && (
        <>
          {!needsSetup && (
            <p className="voice-doctor__note" role="status">
              {snapshot.state === "provisioned"
                ? `Installed — TTS: ${snapshot.ttsEngine}${snapshot.sttSupported ? `, STT: ${snapshot.sttEngine}` : ""}.`
                : `${voiceLocalStateLabel(snapshot.state)} — no pinned engine build exists for this host.`}
            </p>
          )}

          {needsSetup && !retriable && (
            <button type="button" className="voice-settings__realtime-btn" disabled={install.isPending} onClick={() => install.mutate()}>
              {install.isPending
                ? "Installing…"
                : `Set up local voice${typeof snapshot.offerBytes === "number" ? ` (~${formatVoiceLocalBytes(snapshot.offerBytes)})` : ""}`}
            </button>
          )}

          {/* Live per-component progress of the ACTIVE install run. Bytes
              render only where the wire genuinely carries them (downloads
              verify whole-file — completion boundaries, never a fabricated
              live percentage). */}
          {install.isPending && snapshot.installInProgress && snapshot.installInProgress.components.length > 0 && (
            <ul className="voice-local-progress" role="status">
              {snapshot.installInProgress.components.map((component) => (
                <li key={component.component}>
                  <span className="voice-local-progress__name">{component.component}</span>
                  <span className="voice-local-progress__phase">
                    {voiceLocalPhaseLabel(component.phase)}
                    {typeof component.bytesDone === "number" && typeof component.bytesTotal === "number"
                      ? ` — ${formatVoiceLocalBytes(component.bytesDone)} of ${formatVoiceLocalBytes(component.bytesTotal)}`
                      : typeof component.bytesTotal === "number"
                        ? ` — ${formatVoiceLocalBytes(component.bytesTotal)}`
                        : ""}
                  </span>
                  {component.phase === "error" && component.message && (
                    <span className="voice-local-progress__error">{component.message}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {install.isError && (
            <p className="voice-settings__hint" role="alert">
              {formatError(install.error)}
            </p>
          )}

          {/* The install receipt — rendered outside the needs-setup gate so a
              successful attempt's receipt survives the resting-state flip to
              "Installed" (the whole point of a receipt). */}
          {installResult && (
            <div className="voice-local-receipt" role="status">
              <p>
                TTS ({installResult.tts.engine}): {voiceLocalInstallStateLabel(installResult.tts.state)}
                {installResult.tts.reason ? ` — ${installResult.tts.reason}` : ""}
              </p>
              <p>
                STT ({installResult.stt.engine}): {voiceLocalInstallStateLabel(installResult.stt.state)}
                {installResult.stt.reason ? ` — ${installResult.stt.reason}` : ""}
              </p>
              {installResult.configuredSet.length > 0 && (
                <p className="voice-doctor__note">Configured: {installResult.configuredSet.join(", ")}</p>
              )}
              {installResult.configuredSkipped.length > 0 && (
                <p className="voice-doctor__note">Left as you set them: {installResult.configuredSkipped.join(", ")}</p>
              )}
              {retriable && needsSetup && (
                <button
                  type="button"
                  className="voice-settings__realtime-btn"
                  disabled={install.isPending}
                  onClick={() => install.mutate()}
                >
                  {install.isPending ? "Installing…" : "Retry"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
