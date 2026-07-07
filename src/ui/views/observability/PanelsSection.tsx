// Remote-open TUI panels (docs/FEATURES.md §17 — "delightful cross-surface
// trick"): panels.list + panels.open. Honest UnavailableState if this pin's
// daemon doesn't serve panels at all, rather than a dead button.

import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { asRecord, bestId, bestTitle, firstArray } from "../../lib/wire.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { obsKeys } from "./keys.ts";

export function PanelsSection() {
  const { toast } = useToast();

  const panels = useQuery({
    queryKey: obsKeys.panels,
    queryFn: () => gv.invoke("panels.list"),
    retry: false,
  });

  const rows = useMemo(() => firstArray(panels.data, ["items", "panels", "data"]), [panels.data]);
  const unavailable = panels.isError && isMethodUnavailableError(panels.error);

  const openPanel = useMutation({
    mutationFn: (panelId: string) => gv.invoke("panels.open", { body: { panelId } }),
    onSuccess: (_result, panelId) => toast({ title: `Opened panel "${panelId}"`, tone: "success" }),
    onError: (error: unknown) => toast({ title: "Failed to open panel", description: formatError(error), tone: "danger" }),
  });

  return (
    <div className="obs-panels">
      <div className="obs-panel-toolbar">
        <span className="obs-panel-toolbar__summary">Remote-open TUI panels{panels.isSuccess ? ` · ${rows.length}` : ""}</span>
        <button type="button" className="obs-btn" aria-label="Refresh panels" onClick={() => void panels.refetch()}>
          <RefreshCw size={14} aria-hidden="true" className={panels.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {panels.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState
          capability="panels.list"
          description="this daemon build does not serve remote-open TUI panels."
        />
      )}

      {panels.isError && !unavailable && (
        <ErrorState error={panels.error} onRetry={() => void panels.refetch()} title="Failed to load panels" />
      )}

      {panels.isSuccess && rows.length === 0 && (
        <EmptyState title="No panels available" description="The connected daemon reported no remote-openable TUI panels." />
      )}

      {panels.isSuccess && rows.length > 0 && (
        <ul className="obs-simple-rows">
          {rows.map((row, i) => {
            const record = asRecord(row);
            const id = bestId(record) || String(i);
            return (
              <li key={id} className="obs-simple-row">
                <span>{bestTitle(record, id)}</span>
                <button
                  type="button"
                  className="obs-btn obs-btn--primary"
                  onClick={() => openPanel.mutate(id)}
                  disabled={openPanel.isPending}
                >
                  <ExternalLink size={13} aria-hidden="true" /> Open
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
