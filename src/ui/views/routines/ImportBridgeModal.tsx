// Import bridge modal — "Import from goodvibes-agent". ONE implementation
// shared by the Routines / Personas / Skills views (all owned by the same
// wave agent; the other two import from views/routines/).
//
// Flow: POST /app/registries/import/preview {source:"agent"} reads the
// ~/.goodvibes/agent/* stores READ-ONLY and returns per-collection counts +
// samples → user checks collections → POST /app/registries/import/apply →
// receipt toast with imported counts. Source stores are NEVER mutated (the
// caption says so, verbatim from the contract).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadCloud } from "lucide-react";
import { Modal } from "../../components/Modal.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { useToast } from "../../lib/toast.ts";
import { formatError } from "../../lib/errors.ts";
import { bestTitle } from "../../lib/wire.ts";
import {
  IMPORTABLE_COLLECTIONS,
  applyImport,
  isRegistryUnavailable,
  previewImport,
  regKeys,
} from "./registries.ts";

const IMPORT_SOURCE = "agent";

export interface ImportBridgeModalProps {
  open: boolean;
  onClose: () => void;
  /** The collection the opening view cares about — pre-checked by default. */
  defaultCollection?: string;
}

export function ImportBridgeModal({ open, onClose, defaultCollection }: ImportBridgeModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [touched, setTouched] = useState(false);

  const preview = useQuery({
    queryKey: regKeys.importPreview(IMPORT_SOURCE),
    queryFn: () => previewImport(IMPORT_SOURCE),
    enabled: open,
    staleTime: 0,
    retry: false,
  });

  const availableCollections = useMemo(() => {
    if (!preview.data) return [];
    // Stable order: the known importable collections first, then anything
    // extra the bridge reports (superset-tolerant).
    const reported = Object.keys(preview.data.collections);
    const known = IMPORTABLE_COLLECTIONS.filter((name) => reported.includes(name));
    const extra = reported.filter((name) => !(IMPORTABLE_COLLECTIONS as readonly string[]).includes(name));
    return [...known, ...extra];
  }, [preview.data]);

  // Default selection once the preview loads: the opener's collection when it
  // has anything to import, untouched afterwards so user unchecks stick.
  useEffect(() => {
    if (!open) {
      setChecked(new Set());
      setTouched(false);
      return;
    }
    if (touched || !preview.data) return;
    const next = new Set<string>();
    if (defaultCollection && (preview.data.collections[defaultCollection] ?? 0) > 0) {
      next.add(defaultCollection);
    }
    setChecked(next);
  }, [open, preview.data, defaultCollection, touched]);

  const apply = useMutation({
    mutationFn: (collections: string[]) => applyImport(IMPORT_SOURCE, collections),
    onSuccess: async (imported) => {
      await queryClient.invalidateQueries({ queryKey: regKeys.all });
      const parts = Object.entries(imported).map(([name, count]) => `${name}: ${count}`);
      toast({
        title: "Import complete",
        description: parts.length ? `Imported ${parts.join(", ")}.` : "Nothing was imported.",
        tone: "success",
      });
      onClose();
    },
    onError: (error: unknown) => {
      toast({ title: "Import failed", description: formatError(error), tone: "danger" });
    },
  });

  function toggle(name: string): void {
    setTouched(true);
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const unavailable = preview.isError && isRegistryUnavailable(preview.error);
  const totalAvailable = availableCollections.reduce(
    (sum, name) => sum + (preview.data?.collections[name] ?? 0),
    0,
  );

  return (
    <Modal open={open} onClose={onClose} title="Import from goodvibes-agent" size="lg">
      <div className="reg-import">
        <p className="reg-import__caption">
          Reads your <code>~/.goodvibes/agent</code> stores and copies the selected collections into
          this app&apos;s own registries. The agent&apos;s stores are never modified.
        </p>

        {preview.isPending && open && <SkeletonBlock variant="text" lines={4} />}

        {unavailable && (
          <UnavailableState
            capability="/app/registries/import"
            description="the app-local import bridge is not part of this build, so agent stores cannot be previewed or imported."
          />
        )}

        {preview.isError && !unavailable && (
          <ErrorState
            error={preview.error}
            onRetry={() => void preview.refetch()}
            title="Failed to preview agent stores"
          />
        )}

        {preview.isSuccess && availableCollections.length === 0 && (
          <EmptyState
            icon={<DownloadCloud size={28} aria-hidden="true" />}
            title="Nothing to import"
            description="No goodvibes-agent registries were found on this machine."
          />
        )}

        {preview.isSuccess && availableCollections.length > 0 && (
          <>
            <ul className="reg-import__collections">
              {availableCollections.map((name) => {
                const count = preview.data.collections[name] ?? 0;
                const samples = preview.data.samples[name] ?? [];
                return (
                  <li key={name} className="reg-import__collection">
                    <label className="reg-import__check">
                      <input
                        type="checkbox"
                        checked={checked.has(name)}
                        disabled={count === 0 || apply.isPending}
                        onChange={() => toggle(name)}
                      />
                      <span className="reg-import__name">{name}</span>
                      <span className="badge neutral">{count}</span>
                    </label>
                    {samples.length > 0 && (
                      <p className="reg-import__samples">
                        {samples
                          .slice(0, 3)
                          .map((sample) => bestTitle(sample))
                          .join(" · ")}
                        {count > 3 ? ` · +${count - 3} more` : ""}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {totalAvailable === 0 && (
              <p className="reg-import__note">All collections are empty — nothing to bring over.</p>
            )}
            <div className="reg-form__actions">
              <button type="button" className="reg-button" onClick={onClose} disabled={apply.isPending}>
                Cancel
              </button>
              <button
                type="button"
                className="reg-button reg-button--primary"
                disabled={checked.size === 0 || apply.isPending}
                onClick={() => apply.mutate([...checked])}
              >
                {apply.isPending
                  ? "Importing…"
                  : checked.size > 0
                    ? `Import ${checked.size} ${checked.size === 1 ? "collection" : "collections"}`
                    : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
