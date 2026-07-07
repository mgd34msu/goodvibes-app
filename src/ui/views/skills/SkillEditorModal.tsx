// Skill create/edit form: name, description, markdown body (edit/preview
// toggle), requirements, enabled toggle. Editing spreads the original raw
// record so unknown fields survive the round-trip.

import { useEffect, useState, type FormEvent } from "react";
import { Eye, Pencil } from "lucide-react";
import { Modal } from "../../components/Modal.tsx";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import type { SkillItem } from "../routines/registries.ts";

export interface SkillDraft {
  name: string;
  description: string;
  body: string;
  requirements: string[];
  enabled: boolean;
}

export interface SkillEditorModalProps {
  open: boolean;
  /** null → create mode. */
  skill: SkillItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: SkillDraft) => void;
}

export function SkillEditorModal({ open, skill, saving, onClose, onSave }: SkillEditorModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [requirementsText, setRequirementsText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  const targetId = skill?.id ?? "";
  useEffect(() => {
    if (!open) return;
    setName(skill?.name ?? "");
    setDescription(skill?.description ?? "");
    setBody(skill?.body ?? "");
    setRequirementsText(skill?.requirements.join(", ") ?? "");
    setEnabled(skill ? skill.enabled : true);
    setMode("edit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetId]);

  const valid = name.trim().length > 0;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!valid || saving) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      body,
      requirements: requirementsText
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
      enabled,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={skill ? `Edit skill: ${skill.name}` : "New skill"} size="lg">
      <form className="reg-form" onSubmit={handleSubmit}>
        <label className="reg-form__field">
          <span className="reg-form__label">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekly report writer"
            disabled={saving}
          />
        </label>

        <label className="reg-form__field">
          <span className="reg-form__label">Description</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this skill teaches the assistant"
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
          <span className="reg-form__label">Requirements (comma-separated)</span>
          <input
            type="text"
            value={requirementsText}
            onChange={(e) => setRequirementsText(e.target.value)}
            placeholder="browser tool, email connector"
            disabled={saving}
          />
        </label>

        <label className="reg-form__toggle">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={saving} />
          <span>Enabled</span>
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
