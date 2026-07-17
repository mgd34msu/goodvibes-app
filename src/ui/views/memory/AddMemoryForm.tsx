// The add-a-memory composer (memory.records.add). New records default to
// confidence 60 (the recall floor) and reviewState 'fresh' on the daemon
// side — this form does not offer to override either, keeping "add" honest
// about what a freshly-stored fact starts as. Ported from goodvibes-webui
// views/memory/AddMemoryForm.tsx.

import { useState, type FormEvent } from "react";
import { PlusCircle } from "lucide-react";
import { useDraftState } from "../../lib/drafts.ts";
import { ErrorState } from "../../components/feedback.tsx";
import {
  MEMORY_CLASSES,
  MEMORY_SCOPES,
  splitTags,
  type MemoryClass,
  type MemoryScope,
} from "./memory-wire.ts";

export interface MemoryAddDraft {
  cls: MemoryClass;
  summary: string;
  scope: MemoryScope;
  detail?: string;
  tags?: string[];
}

interface AddMemoryFormProps {
  isPending: boolean;
  error: unknown;
  onSubmit: (input: MemoryAddDraft) => void;
}

/** The DOM id palette command "memory.add" focuses. */
export const ADD_MEMORY_SUMMARY_INPUT_ID = "memory-add-summary";

export function AddMemoryForm({ isPending, error, onSubmit }: AddMemoryFormProps) {
  const [cls, setCls] = useState<MemoryClass>("fact");
  const [scope, setScope] = useState<MemoryScope>("project");
  const [summary, setSummary] = useState("");
  // Detail is the body field worth persisting — a longer explanation a user
  // would grieve losing to an accidental view switch.
  const [detail, setDetail, detailDraft] = useDraftState("memory.add.detail", "");
  const [tags, setTags] = useState("");

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!summary.trim() || isPending) return;
    const tagList = splitTags(tags);
    onSubmit({
      cls,
      summary: summary.trim(),
      scope,
      ...(detail.trim() ? { detail: detail.trim() } : {}),
      ...(tagList.length ? { tags: tagList } : {}),
    });
    setSummary("");
    setDetail("");
    detailDraft.clear();
    setTags("");
  }

  return (
    <section className="memory-panel" aria-label="Add memory">
      <div className="memory-panel__title">
        <h2>Add memory</h2>
        <PlusCircle size={16} aria-hidden="true" />
      </div>
      <form className="memory-form" onSubmit={submit}>
        <div className="memory-form__split">
          <label>
            Type
            <select value={cls} onChange={(event) => setCls(event.target.value as MemoryClass)} aria-label="Memory type">
              {MEMORY_CLASSES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scope
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as MemoryScope)}
              aria-label="Memory scope"
            >
              {MEMORY_SCOPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Summary
          <input
            id={ADD_MEMORY_SUMMARY_INPUT_ID}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="A one-line fact, decision, or constraint"
            aria-label="Memory summary"
            required
          />
        </label>
        <label>
          Detail
          <textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="Optional longer explanation"
            aria-label="Memory detail"
            rows={3}
          />
        </label>
        <label>
          Tags
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="Comma separated"
            aria-label="Tags, comma separated"
          />
        </label>
        <button
          className="memory-button memory-button--primary"
          type="submit"
          disabled={isPending || !summary.trim()}
          aria-busy={isPending}
        >
          {isPending ? "Saving…" : "Add memory"}
        </button>
      </form>
      {Boolean(error) && <ErrorState error={error} title="Could not save the memory" />}
    </section>
  );
}
