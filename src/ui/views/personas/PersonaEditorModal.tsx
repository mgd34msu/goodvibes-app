// Persona create/edit form: name, description, prompt (the system-prompt
// body). Editing spreads the original raw record so unknown fields survive.

import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../../components/Modal.tsx";
import type { PersonaItem } from "../routines/registries.ts";

export interface PersonaDraft {
  name: string;
  description: string;
  prompt: string;
}

export interface PersonaEditorModalProps {
  open: boolean;
  /** null → create mode. */
  persona: PersonaItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: PersonaDraft) => void;
}

export function PersonaEditorModal({ open, persona, saving, onClose, onSave }: PersonaEditorModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  // Closing a dirty form asks first instead of silently discarding it — item
  // 1 (closing warns) from the friction checklist's registry-editor callout.
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const targetId = persona?.id ?? "";
  useEffect(() => {
    if (!open) return;
    setName(persona?.name ?? "");
    setDescription(persona?.description ?? "");
    setPrompt(persona?.prompt ?? "");
    setConfirmDiscard(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetId]);

  const initialName = persona?.name ?? "";
  const initialDescription = persona?.description ?? "";
  const initialPrompt = persona?.prompt ?? "";
  const dirty = name !== initialName || description !== initialDescription || prompt !== initialPrompt;

  const valid = name.trim().length > 0;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!valid || saving) return;
    onSave({ name: name.trim(), description: description.trim(), prompt });
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
      title={persona ? `Edit persona: ${persona.name}` : "New persona"}
      size="lg"
    >
      {confirmDiscard ? (
        <div className="reg-form__discard">
          <p className="reg-form__discard-text">
            Discard unsaved changes to {persona ? `"${persona.name}"` : "this new persona"}? The edited name,
            description, and prompt will be lost.
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
              placeholder="Concise senior engineer"
              disabled={saving}
            />
          </label>

          <label className="reg-form__field">
            <span className="reg-form__label">Description</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When to use this persona"
              disabled={saving}
            />
          </label>

          <label className="reg-form__field">
            <span className="reg-form__label">Prompt</span>
            <textarea
              className="reg-form__textarea"
              rows={10}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="You are…"
              spellCheck={false}
              disabled={saving}
            />
          </label>

          <div className="reg-form__actions">
            <button type="button" className="reg-button" onClick={requestClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="reg-button reg-button--primary" disabled={!valid || saving}>
              {saving ? "Saving…" : persona ? "Save changes" : "Create persona"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
