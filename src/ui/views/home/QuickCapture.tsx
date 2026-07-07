// Home rail quick-capture (docs/FEATURES.md §8 row 11) — a one-line note
// composer over the same app-local "notes" registry collection the
// Scratchpad panel (Routines view) manages fully. This widget only adds
// notes; edit/promote/delete live in Routines → Scratchpad, linked below.

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, StickyNote } from "lucide-react";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { createRegistryItem, isRegistryUnavailable, regKeys } from "../routines/registries.ts";
import { UnavailableState } from "../../components/feedback.tsx";

export function QuickCapture({ onOpenScratchpad }: { onOpenScratchpad: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  const add = useMutation({
    mutationFn: (input: string) => createRegistryItem("notes", { text: input, tags: [], promoted: false }),
    onSuccess: async () => {
      setText("");
      await queryClient.invalidateQueries({ queryKey: regKeys.collection("notes") });
      toast({ title: "Note captured", tone: "success" });
    },
    onError: (error: unknown) => {
      if (isRegistryUnavailable(error)) {
        setUnavailable(true);
        return;
      }
      toast({ title: "Capture failed", description: formatError(error), tone: "danger" });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!text.trim() || add.isPending) return;
    add.mutate(text.trim());
  }

  if (unavailable) {
    return (
      <section className="home-card home-quick-capture" aria-label="Quick capture">
        <UnavailableState
          capability="/app/registries/notes"
          description="the app-local notes registry is not part of this build, so quick capture is unavailable."
        />
      </section>
    );
  }

  return (
    <section className="home-card home-quick-capture" aria-label="Quick capture">
      <div className="home-card__header">
        <span className="home-card__title">
          <StickyNote size={14} aria-hidden="true" /> Quick capture
        </span>
        <button type="button" className="home-quick-capture__link" onClick={onOpenScratchpad}>
          Open scratchpad <ArrowRight size={12} aria-hidden="true" />
        </button>
      </div>
      <form className="home-quick-capture__form" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Jot something down…"
          aria-label="Quick capture note text"
        />
        <button type="submit" className="home-quick-capture__submit" disabled={add.isPending || !text.trim()}>
          {add.isPending ? "Saving…" : "Add"}
        </button>
      </form>
    </section>
  );
}
