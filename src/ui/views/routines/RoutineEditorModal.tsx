// Routine create/edit form: name, ORDERED steps editor (add / remove /
// move up / move down), tags, requirements, enabled toggle. Editing spreads
// the original raw record first so unknown fields survive the round-trip
// (superset-tolerant contract).

import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Modal } from "../../components/Modal.tsx";
import type { RoutineItem } from "./registries.ts";

export interface RoutineDraft {
  name: string;
  steps: string[];
  tags: string[];
  requirements: string[];
  enabled: boolean;
}

export interface RoutineEditorModalProps {
  open: boolean;
  /** null → create mode. */
  routine: RoutineItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: RoutineDraft) => void;
}

function splitCsv(text: string): string[] {
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function RoutineEditorModal({ open, routine, saving, onClose, onSave }: RoutineEditorModalProps) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);
  const [tagsText, setTagsText] = useState("");
  const [requirementsText, setRequirementsText] = useState("");
  const [enabled, setEnabled] = useState(true);
  // Closing a dirty form asks first instead of silently discarding it — item
  // 1 (closing warns) from the friction checklist's registry-editor callout.
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Re-seed the form whenever the modal opens for a (different) target.
  const targetId = routine?.id ?? "";
  useEffect(() => {
    if (!open) return;
    setName(routine?.name ?? "");
    setSteps(routine && routine.steps.length > 0 ? [...routine.steps] : [""]);
    setTagsText(routine?.tags.join(", ") ?? "");
    setRequirementsText(routine?.requirements.join(", ") ?? "");
    setEnabled(routine ? routine.enabled : true);
    setConfirmDiscard(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetId]);

  const initialSteps = routine && routine.steps.length > 0 ? routine.steps : [""];
  const dirty =
    name !== (routine?.name ?? "") ||
    steps.length !== initialSteps.length ||
    steps.some((step, i) => step !== initialSteps[i]) ||
    tagsText !== (routine?.tags.join(", ") ?? "") ||
    requirementsText !== (routine?.requirements.join(", ") ?? "") ||
    enabled !== (routine ? routine.enabled : true);

  function setStep(index: number, value: string): void {
    setSteps((current) => current.map((step, i) => (i === index ? value : step)));
  }

  function removeStep(index: number): void {
    setSteps((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current));
  }

  function moveStep(index: number, delta: -1 | 1): void {
    setSteps((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const a = next[index];
      const b = next[target];
      if (a === undefined || b === undefined) return current;
      next[index] = b;
      next[target] = a;
      return next;
    });
  }

  const cleanSteps = steps.map((step) => step.trim()).filter(Boolean);
  const valid = name.trim().length > 0 && cleanSteps.length > 0;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!valid || saving) return;
    onSave({
      name: name.trim(),
      steps: cleanSteps,
      tags: splitCsv(tagsText),
      requirements: splitCsv(requirementsText),
      enabled,
    });
  }

  function requestClose(): void {
    if (saving) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title={routine ? `Edit routine: ${routine.name}` : "New routine"}
      size="lg"
    >
      {confirmDiscard ? (
        <div className="reg-form__discard">
          <p className="reg-form__discard-text">
            Discard unsaved changes to {routine ? `"${routine.name}"` : "this new routine"}? The edited name,
            steps, tags, and requirements will be lost.
          </p>
          <div className="reg-form__actions">
            <button type="button" className="reg-button" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </button>
            <button type="button" className="reg-button reg-button--danger" onClick={onClose}>
              Discard changes
            </button>
          </div>
        </div>
      ) : (
        <form className="reg-form" onSubmit={handleSubmit}>
        <label className="reg-form__field">
          <span className="reg-form__label">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Morning triage"
            disabled={saving}
          />
        </label>

        <fieldset className="reg-form__field reg-steps" disabled={saving}>
          <legend className="reg-form__label">Steps (ordered)</legend>
          <ol className="reg-steps__list">
            {steps.map((step, index) => (
              // Index keys are correct here: rows are positional slots.
              // eslint-disable-next-line react/no-array-index-key
              <li key={index} className="reg-steps__row">
                <input
                  type="text"
                  value={step}
                  onChange={(e) => setStep(index, e.target.value)}
                  placeholder={`Step ${index + 1}`}
                  aria-label={`Step ${index + 1}`}
                />
                <button
                  type="button"
                  className="reg-icon-button"
                  aria-label={`Move step ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => moveStep(index, -1)}
                >
                  <ArrowUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="reg-icon-button"
                  aria-label={`Move step ${index + 1} down`}
                  disabled={index === steps.length - 1}
                  onClick={() => moveStep(index, 1)}
                >
                  <ArrowDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="reg-icon-button"
                  aria-label={`Remove step ${index + 1}`}
                  disabled={steps.length === 1}
                  onClick={() => removeStep(index)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="reg-button" onClick={() => setSteps((s) => [...s, ""])}>
            <Plus size={14} aria-hidden="true" /> Add step
          </button>
        </fieldset>

        <label className="reg-form__field">
          <span className="reg-form__label">Tags (comma-separated)</span>
          <input
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="daily, inbox"
            disabled={saving}
          />
        </label>

        <label className="reg-form__field">
          <span className="reg-form__label">Requirements (comma-separated)</span>
          <input
            type="text"
            value={requirementsText}
            onChange={(e) => setRequirementsText(e.target.value)}
            placeholder="email connector, calendar"
            disabled={saving}
          />
        </label>

        <label className="reg-form__toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={saving}
          />
          <span>Enabled</span>
        </label>

        <div className="reg-form__actions">
          <button type="button" className="reg-button" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="reg-button reg-button--primary" disabled={!valid || saving}>
            {saving ? "Saving…" : routine ? "Save changes" : "Create routine"}
          </button>
        </div>
      </form>
      )}
    </Modal>
  );
}
