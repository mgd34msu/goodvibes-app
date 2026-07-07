// Persona discovery from VIBE.md — parses persona-like sections client-side
// (vibe-discovery.ts) and offers them as import candidates. Creating never
// touches VIBE.md itself; candidates become app-registry personas with
// source:"vibe", inactive until explicitly activated.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wand2 } from "lucide-react";
import { Modal } from "../../components/Modal.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { useToast } from "../../lib/toast.ts";
import { formatError } from "../../lib/errors.ts";
import {
  createRegistryItem,
  fetchVibe,
  isRegistryUnavailable,
  regKeys,
  type PersonaItem,
} from "../routines/registries.ts";
import { discoverPersonaCandidates } from "./vibe-discovery.ts";

export interface VibeDiscoveryModalProps {
  open: boolean;
  existing: readonly PersonaItem[];
  onClose: () => void;
}

export function VibeDiscoveryModal({ open, existing, onClose }: VibeDiscoveryModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  const vibe = useQuery({
    queryKey: regKeys.vibe,
    queryFn: fetchVibe,
    enabled: open,
    retry: false,
  });

  const candidates = useMemo(
    () => (vibe.data ? discoverPersonaCandidates(vibe.data.content) : []),
    [vibe.data],
  );
  const existingNames = useMemo(
    () => new Set(existing.map((p) => p.name.toLowerCase())),
    [existing],
  );

  const create = useMutation({
    mutationFn: async (names: string[]) => {
      let created = 0;
      for (const name of names) {
        const candidate = candidates.find((c) => c.name === name);
        if (!candidate) continue;
        await createRegistryItem("personas", {
          name: candidate.name,
          description: "Discovered from VIBE.md",
          prompt: candidate.prompt,
          active: false,
          source: "vibe",
        });
        created += 1;
      }
      return created;
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: regKeys.collection("personas") });
      toast({
        title: `Created ${created} ${created === 1 ? "persona" : "personas"} from VIBE.md`,
        description: "They start inactive — activate one from the list.",
        tone: "success",
      });
      setChecked(new Set());
      onClose();
    },
    onError: (error: unknown) => {
      toast({ title: "Persona creation failed", description: formatError(error), tone: "danger" });
    },
  });

  function toggle(name: string): void {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const unavailable = vibe.isError && isRegistryUnavailable(vibe.error);

  return (
    <Modal open={open} onClose={onClose} title="Discover personas from VIBE.md" size="lg">
      <div className="reg-import">
        <p className="reg-import__caption">
          Heading sections of your VIBE.md that read like personas are offered below. Creating them
          copies the text into the persona registry — VIBE.md itself is not changed.
        </p>

        {vibe.isPending && open && <SkeletonBlock variant="text" lines={4} />}

        {unavailable && (
          <UnavailableState
            capability="/app/registries/vibe"
            description="the VIBE.md file bridge is not part of this build, so there is nothing to discover from."
          />
        )}

        {vibe.isError && !unavailable && (
          <ErrorState error={vibe.error} onRetry={() => void vibe.refetch()} title="Failed to read VIBE.md" />
        )}

        {vibe.isSuccess && candidates.length === 0 && (
          <EmptyState
            icon={<Wand2 size={28} aria-hidden="true" />}
            title="No persona-like sections found"
            description="Add ## heading sections with personality text to VIBE.md and try again."
          />
        )}

        {vibe.isSuccess && candidates.length > 0 && (
          <>
            <ul className="reg-import__collections">
              {candidates.map((candidate) => {
                const duplicate = existingNames.has(candidate.name.toLowerCase());
                return (
                  <li key={candidate.name} className="reg-import__collection">
                    <label className="reg-import__check">
                      <input
                        type="checkbox"
                        checked={checked.has(candidate.name)}
                        disabled={duplicate || create.isPending}
                        onChange={() => toggle(candidate.name)}
                      />
                      <span className="reg-import__name">{candidate.name}</span>
                      {candidate.likely && <span className="badge info">likely persona</span>}
                      {duplicate && <span className="badge neutral">already exists</span>}
                    </label>
                    <p className="reg-import__samples">{candidate.prompt.slice(0, 160)}…</p>
                  </li>
                );
              })}
            </ul>
            <div className="reg-form__actions">
              <button type="button" className="reg-button" onClick={onClose} disabled={create.isPending}>
                Cancel
              </button>
              <button
                type="button"
                className="reg-button reg-button--primary"
                disabled={checked.size === 0 || create.isPending}
                onClick={() => create.mutate([...checked])}
              >
                {create.isPending
                  ? "Creating…"
                  : checked.size > 0
                    ? `Create ${checked.size} ${checked.size === 1 ? "persona" : "personas"}`
                    : "Create"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
