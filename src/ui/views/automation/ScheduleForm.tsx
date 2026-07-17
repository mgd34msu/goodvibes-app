// Create/edit forms for automation jobs & schedules. One shared create form —
// the daemon serves POST /api/automation/jobs and POST /api/automation/schedules
// with the SAME handler and body schema (verified in goodvibes-sdk
// runtime-automation-routes.ts): { prompt (required), kind cron|every|at,
// cron/every/at, timezone, name?, model?, timeoutMs?, enabled?, delivery? }.
// The cron kind gets the app-local helper preview (cron.ts) + IANA timezone
// picker (docs/FEATURES.md §5 "Cron editor with human preview + next-run times").

import { useId, useMemo, useState, type FormEvent } from "react";
import {
  describeCron,
  localTimezone,
  nextCronRuns,
  parseEveryInterval,
  timezoneOptions,
  validateCron,
} from "./cron.ts";
import { formatAbsolute, formatRelative, humanizeMs } from "./automation-model.ts";
import { DeliveryPicker } from "./DeliveryPicker.tsx";
import {
  deliveryPolicyIsConfigured,
  deliveryPolicyProblem,
  deliveryPolicyToWire,
  emptyDeliveryPolicy,
  type DeliveryPolicyDraft,
} from "./delivery-targets.ts";
import { compactJson } from "../../lib/wire.ts";
import { useDraftState } from "../../lib/drafts.ts";

export type ScheduleKind = "cron" | "every" | "at";

export interface ScheduleCreateBody {
  prompt: string;
  kind: ScheduleKind;
  name?: string;
  cron?: string;
  every?: string;
  at?: string;
  timezone?: string;
  model?: string;
  timeoutMs?: number;
  enabled?: boolean;
  delivery?: unknown;
}

export interface ScheduleFormProps {
  /** "job" or "schedule" — wording only; the wire body is identical. */
  noun: string;
  submitting: boolean;
  onSubmit: (body: ScheduleCreateBody) => void;
  onCancel: () => void;
}

const KIND_LABELS: Record<ScheduleKind, string> = {
  cron: "Cron expression",
  every: "Fixed interval",
  at: "Once, at a time",
};

export function ScheduleForm({ noun, submitting, onSubmit, onCancel }: ScheduleFormProps) {
  const uid = useId();
  const [name, setName] = useState("");
  // Prompt and raw delivery JSON are the fields a user would grieve losing to
  // an accidental modal close — persisted as drafts; cleared by the caller on
  // successful create (see AutomationView's `create` mutation onSuccess).
  const [prompt, setPrompt] = useDraftState(`automation.schedule-form.${noun}.prompt`, "");
  const [kind, setKind] = useState<ScheduleKind>("cron");
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState(localTimezone());
  const [every, setEvery] = useState("1h");
  const [at, setAt] = useState("");
  const [model, setModel] = useState("");
  const [timeoutMinutes, setTimeoutMinutes] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [deliveryDraft, setDeliveryDraft] = useState<DeliveryPolicyDraft>(emptyDeliveryPolicy);
  const [deliveryRawMode, setDeliveryRawMode] = useState(false);
  const [deliveryJson, setDeliveryJson] = useDraftState(`automation.schedule-form.${noun}.delivery-json`, "");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const timezones = useMemo(() => timezoneOptions(), []);

  // ── Per-kind validation + preview ──
  const cronProblem = kind === "cron" ? validateCron(cron) : null;
  const cronDescription = kind === "cron" && !cronProblem ? describeCron(cron) : "";
  const cronNextRuns = useMemo(
    () => (kind === "cron" && !cronProblem ? nextCronRuns(cron, timezone, 3) : []),
    [kind, cron, timezone, cronProblem],
  );

  let everyProblem: string | null = null;
  let everyMs: number | undefined;
  if (kind === "every") {
    try {
      everyMs = parseEveryInterval(every);
    } catch (error) {
      everyProblem = error instanceof Error ? error.message : String(error);
    }
  }

  const atEpoch = kind === "at" && at ? new Date(at).getTime() : Number.NaN;
  const atProblem =
    kind === "at" ? (!at ? "Pick a date and time." : Number.isNaN(atEpoch) ? "Unparseable date/time." : null) : null;

  let deliveryProblem: string | null = null;
  let delivery: unknown;
  if (deliveryRawMode) {
    if (deliveryJson.trim()) {
      try {
        delivery = JSON.parse(deliveryJson);
      } catch {
        deliveryProblem = "Delivery must be valid JSON (or empty).";
      }
    }
  } else {
    deliveryProblem = deliveryPolicyProblem(deliveryDraft);
    if (!deliveryProblem && deliveryPolicyIsConfigured(deliveryDraft)) {
      delivery = deliveryPolicyToWire(deliveryDraft);
    }
  }

  /** Switching to raw JSON hands the structured draft over verbatim so nothing typed so far is lost. */
  function toggleDeliveryRawMode(): void {
    if (!deliveryRawMode && !deliveryJson.trim() && deliveryPolicyIsConfigured(deliveryDraft)) {
      setDeliveryJson(compactJson(deliveryPolicyToWire(deliveryDraft)));
    }
    setDeliveryRawMode((v) => !v);
  }

  const timeoutProblem =
    timeoutMinutes.trim() && !(Number.parseFloat(timeoutMinutes) > 0) ? "Timeout must be a positive number of minutes." : null;

  const kindProblem = kind === "cron" ? cronProblem : kind === "every" ? everyProblem : atProblem;
  const canSubmit = prompt.trim().length > 0 && !kindProblem && !deliveryProblem && !timeoutProblem && !submitting;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    const timeoutMs = timeoutMinutes.trim() ? Math.round(Number.parseFloat(timeoutMinutes) * 60_000) : undefined;
    const body: ScheduleCreateBody = {
      prompt: prompt.trim(),
      kind,
      enabled,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(kind === "cron" ? { cron: cron.trim(), ...(timezone.trim() ? { timezone: timezone.trim() } : {}) } : {}),
      ...(kind === "every" ? { every: every.trim() } : {}),
      ...(kind === "at" ? { at: new Date(at).toISOString() } : {}),
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(delivery !== undefined ? { delivery } : {}),
    };
    onSubmit(body);
  }

  return (
    <form className="schedule-form" onSubmit={handleSubmit}>
      <label className="schedule-form__field" htmlFor={`${uid}-name`}>
        <span>Name (optional — defaults to the prompt)</span>
        <input
          id={`${uid}-name`}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Morning briefing"
          autoComplete="off"
        />
      </label>

      <label className="schedule-form__field" htmlFor={`${uid}-prompt`}>
        <span>Prompt (required — what the agent does each run)</span>
        <textarea
          id={`${uid}-prompt`}
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Summarize overnight inbox and post to #ops"
        />
      </label>

      <fieldset className="schedule-form__kinds">
        <legend>Schedule kind</legend>
        {(Object.keys(KIND_LABELS) as ScheduleKind[]).map((k) => (
          <label key={k} className={kind === k ? "schedule-kind schedule-kind--active" : "schedule-kind"}>
            <input type="radio" name={`${uid}-kind`} checked={kind === k} onChange={() => setKind(k)} />
            <span>{KIND_LABELS[k]}</span>
          </label>
        ))}
      </fieldset>

      {kind === "cron" && (
        <div className="schedule-form__kind-body">
          <label className="schedule-form__field" htmlFor={`${uid}-cron`}>
            <span>Expression (minute hour day month weekday)</span>
            <input
              id={`${uid}-cron`}
              type="text"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="schedule-form__mono"
            />
          </label>
          <label className="schedule-form__field" htmlFor={`${uid}-tz`}>
            <span>Timezone (IANA)</span>
            <input
              id={`${uid}-tz`}
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              list={timezones.length > 0 ? `${uid}-tz-list` : undefined}
              spellCheck={false}
              autoComplete="off"
            />
            {timezones.length > 0 && (
              <datalist id={`${uid}-tz-list`}>
                {timezones.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            )}
          </label>
          {cronProblem ? (
            <p className="schedule-form__problem" role="alert">
              {cronProblem}
            </p>
          ) : (
            <div className="schedule-form__preview" aria-live="polite">
              <p className="schedule-form__preview-text">{cronDescription}</p>
              {cronNextRuns.length > 0 ? (
                <ul className="schedule-form__preview-runs">
                  {cronNextRuns.map((ts) => (
                    <li key={ts}>
                      <span className="schedule-form__preview-rel">{formatRelative(ts)}</span>
                      <span className="schedule-form__preview-abs">{formatAbsolute(ts)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="schedule-form__preview-text">No matching time in the next ~400 days.</p>
              )}
              <p className="schedule-form__preview-note">
                Estimated client-side; the daemon&apos;s scheduler is authoritative once saved.
              </p>
            </div>
          )}
        </div>
      )}

      {kind === "every" && (
        <div className="schedule-form__kind-body">
          <label className="schedule-form__field" htmlFor={`${uid}-every`}>
            <span>Interval (e.g. 30s, 5m, 1h, 1d)</span>
            <input
              id={`${uid}-every`}
              type="text"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="schedule-form__mono"
            />
          </label>
          {everyProblem ? (
            <p className="schedule-form__problem" role="alert">
              {everyProblem}
            </p>
          ) : (
            everyMs !== undefined && (
              <p className="schedule-form__preview-text" aria-live="polite">
                Runs every {humanizeMs(everyMs)} — first run {formatRelative(Date.now() + everyMs)} (
                {formatAbsolute(Date.now() + everyMs)}).
              </p>
            )
          )}
        </div>
      )}

      {kind === "at" && (
        <div className="schedule-form__kind-body">
          <label className="schedule-form__field" htmlFor={`${uid}-at`}>
            <span>Run once at (your local time, {localTimezone()})</span>
            <input id={`${uid}-at`} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </label>
          {atProblem ? (
            <p className="schedule-form__problem" role="alert">
              {atProblem}
            </p>
          ) : (
            <p className="schedule-form__preview-text" aria-live="polite">
              {formatRelative(atEpoch)} — {formatAbsolute(atEpoch)}. One-shot {noun}s can self-delete after running
              via the daemon&apos;s deleteAfterRun policy.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        className="schedule-form__advanced-toggle"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide advanced options" : "Advanced options"}
      </button>

      {showAdvanced && (
        <div className="schedule-form__advanced">
          <label className="schedule-form__field" htmlFor={`${uid}-model`}>
            <span>Model (optional — daemon default when empty)</span>
            <input
              id={`${uid}-model`}
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="schedule-form__field" htmlFor={`${uid}-timeout`}>
            <span>Timeout in minutes (optional, max 1440)</span>
            <input
              id={`${uid}-timeout`}
              type="number"
              min={1}
              max={1440}
              value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(e.target.value)}
            />
          </label>
          {timeoutProblem && (
            <p className="schedule-form__problem" role="alert">
              {timeoutProblem}
            </p>
          )}
          <div className="schedule-form__delivery">
            <div className="schedule-form__delivery-head">
              <span>Delivery (optional — where results get sent when a run finishes)</span>
              <button type="button" className="schedule-form__advanced-toggle" onClick={toggleDeliveryRawMode}>
                {deliveryRawMode ? "Use structured picker" : "Advanced: edit raw JSON"}
              </button>
            </div>

            {deliveryRawMode ? (
              <label className="schedule-form__field" htmlFor={`${uid}-delivery`}>
                <span>Delivery policy JSON</span>
                <textarea
                  id={`${uid}-delivery`}
                  rows={4}
                  value={deliveryJson}
                  onChange={(e) => setDeliveryJson(e.target.value)}
                  spellCheck={false}
                  placeholder='{"mode":"surface","targets":[{"kind":"surface","surfaceKind":"slack","address":"#ops"}],"fallbackTargets":[],"includeSummary":true,"includeTranscript":false,"includeLinks":true}'
                  className="schedule-form__mono"
                />
              </label>
            ) : (
              <DeliveryPicker draft={deliveryDraft} onChange={setDeliveryDraft} />
            )}
          </div>
          {deliveryProblem && (
            <p className="schedule-form__problem" role="alert">
              {deliveryProblem}
            </p>
          )}
        </div>
      )}

      <label className="schedule-form__enabled">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Enabled immediately</span>
      </label>

      <div className="schedule-form__actions">
        <button type="button" className="schedule-form__cancel" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="schedule-form__submit" disabled={!canSubmit}>
          {submitting ? "Creating…" : `Create ${noun}`}
        </button>
      </div>
    </form>
  );
}

// ─── Edit (PATCH) — name + prompt only; enable/disable and schedule changes
// have dedicated daemon verbs (enable/disable) or a delete+recreate path. ────

export interface JobEditBody {
  name?: string;
  prompt?: string;
}

export function EditJobForm({
  entityId,
  initialName,
  initialPrompt,
  submitting,
  onSubmit,
  onCancel,
}: {
  /** The job/schedule id — scopes the persisted prompt draft to this entity. */
  entityId: string;
  initialName: string;
  initialPrompt: string;
  submitting: boolean;
  onSubmit: (body: JobEditBody) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [name, setName] = useState(initialName);
  // Prompt is the field worth persisting across an accidental close; name is
  // short enough that losing it is no loss. Cleared by the caller on
  // successful update (see JobsSection's `update` mutation onSuccess).
  const [prompt, setPrompt] = useDraftState(`automation.job-edit.${entityId}.prompt`, initialPrompt);

  const dirty = name !== initialName || prompt !== initialPrompt;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!dirty || submitting) return;
    const body: JobEditBody = {};
    if (name !== initialName) body.name = name;
    if (prompt !== initialPrompt) body.prompt = prompt;
    onSubmit(body);
  }

  return (
    <form className="schedule-form" onSubmit={handleSubmit}>
      <label className="schedule-form__field" htmlFor={`${uid}-edit-name`}>
        <span>Name</span>
        <input id={`${uid}-edit-name`} type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="schedule-form__field" htmlFor={`${uid}-edit-prompt`}>
        <span>Prompt</span>
        <textarea id={`${uid}-edit-prompt`} rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="schedule-form__actions">
        <button type="button" className="schedule-form__cancel" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="schedule-form__submit" disabled={!dirty || submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
