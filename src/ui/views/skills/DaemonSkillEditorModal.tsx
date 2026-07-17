// Create/edit form for the daemon-canonical skills store. Name is editable
// only on create (skills.update has no rename — it addresses by name).
// A 409 name-conflict from skills.create renders as an INLINE field error
// under the Name input, never a toast (UX bar: full detail at the moment of
// consent belongs where the conflict is, not in a passing notification).

import { useEffect, useState, type FormEvent } from "react";
import { Eye, Pencil } from "lucide-react";
import { Modal } from "../../components/Modal.tsx";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { metadataToText, parseMetadataText, type DaemonSkill } from "./daemon-skills-wire.ts";

export interface DaemonSkillDraft {
  name: string;
  description: string;
  body: string;
  metadata: Record<string, unknown>;
}

export interface DaemonSkillEditorModalProps {
  open: boolean;
  /** null → create mode. */
  skill: DaemonSkill | null;
  saving: boolean;
  /** Set when the last save attempt hit a 409 name conflict. */
  nameConflict: boolean;
  onClose: () => void;
  onSave: (draft: DaemonSkillDraft) => void;
}

export function DaemonSkillEditorModal({
  open,
  skill,
  saving,
  nameConflict,
  onClose,
  onSave,
}: DaemonSkillEditorModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [metadataText, setMetadataText] = useState("{}");
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  const targetName = skill?.name ?? "";
  useEffect(() => {
    if (!open) return;
    setName(skill?.name ?? "");
    setDescription(skill?.description ?? "");
    setBody(skill?.body ?? "");
    setMetadataText(metadataToText(skill?.metadata));
    setMode("edit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetName]);

  const metadataResult = parseMetadataText(metadataText);
  const nameValid = name.trim().length > 0;
  const descriptionValid = description.trim().length > 0;
  const bodyValid = body.trim().length > 0;
  const valid = nameValid && descriptionValid && bodyValid && metadataResult.ok;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!valid || saving || !metadataResult.ok) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      body,
      metadata: metadataResult.value,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={skill ? `Edit daemon skill: ${skill.name}` : "New daemon skill"}
      size="lg"
    >
      <form className="reg-form" onSubmit={handleSubmit}>
        <label className="reg-form__field">
          <span className="reg-form__label">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="incident-writeup"
            disabled={saving || skill !== null}
            aria-invalid={nameConflict || undefined}
            aria-describedby={nameConflict ? "daemon-skill-name-error" : undefined}
          />
          {skill !== null && (
            <span className="reg-form__help">Name cannot be changed after creation — delete and recreate instead.</span>
          )}
          {nameConflict && (
            <span id="daemon-skill-name-error" className="reg-form__error" role="alert">
              A skill named "{name.trim()}" already exists. Choose a different name, or edit the existing one.
            </span>
          )}
        </label>

        <label className="reg-form__field">
          <span className="reg-form__label">Description</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line: what this skill teaches"
            disabled={saving}
          />
        </label>

        <div className="reg-form__field">
          <div className="reg-form__label-row">
            <span className="reg-form__label">Body (markdown)</span>
            <div className="vibe-panel__modes" role="tablist" aria-label="Body editor mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "edit"}
                className={mode === "edit" ? "reg-button reg-button--active" : "reg-button"}
                onClick={() => setMode("edit")}
              >
                <Pencil size={13} aria-hidden="true" /> Edit
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "preview"}
                className={mode === "preview" ? "reg-button reg-button--active" : "reg-button"}
                onClick={() => setMode("preview")}
              >
                <Eye size={13} aria-hidden="true" /> Preview
              </button>
            </div>
          </div>
          {mode === "edit" ? (
            <textarea
              className="reg-form__textarea reg-form__textarea--body"
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"# Skill\n\nInstructions the assistant follows when this skill applies…"}
              spellCheck={false}
              disabled={saving}
              aria-label="Skill body markdown"
            />
          ) : (
            <div className="reg-form__preview">
              {body.trim() ? <MarkdownMessage content={body} /> : <p className="vibe-panel__empty">Nothing to preview yet.</p>}
            </div>
          )}
        </div>

        <label className="reg-form__field">
          <span className="reg-form__label">Metadata (optional JSON object)</span>
          <textarea
            className="reg-form__textarea"
            rows={4}
            value={metadataText}
            onChange={(e) => setMetadataText(e.target.value)}
            placeholder={"{}"}
            spellCheck={false}
            disabled={saving}
            aria-label="Skill metadata JSON"
            aria-invalid={!metadataResult.ok || undefined}
          />
          {!metadataResult.ok && (
            <span className="reg-form__error" role="alert">
              {metadataResult.error}
            </span>
          )}
        </label>

        <div className="reg-form__actions">
          <button type="button" className="reg-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="reg-button reg-button--primary" disabled={!valid || saving}>
            {saving ? "Saving…" : skill ? "Save changes" : "Create skill"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
