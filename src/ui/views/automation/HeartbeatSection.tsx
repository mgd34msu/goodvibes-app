// Heartbeat (docs/FEATURES.md §5 "Heartbeat: list/run"). The daemon's
// GET /api/automation/heartbeat answers { pending: [...] } (verified in
// goodvibes-sdk runtime-automation-routes.ts — often an empty list);
// POST triggers a heartbeat sweep and returns the manager's result verbatim.

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartPulse, RefreshCw } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { bestId, bestStatus, bestTitle, compactJson, firstArray } from "../../lib/wire.ts";
import { AUTOMATION_POLL_MS, automationKeys } from "./automation-model.ts";

export function HeartbeatSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const list = useQuery({
    queryKey: automationKeys.heartbeat,
    // No automation domain on the invalidation stream — poll while visible.
    queryFn: () => gv.invoke("automation.heartbeat.list"),
    refetchInterval: AUTOMATION_POLL_MS,
  });
  const pending = useMemo(() => firstArray(list.data, ["pending", "items", "heartbeats"]), [list.data]);

  const run = useMutation({
    mutationFn: () => gv.invoke("automation.heartbeat.run", { body: { source: "goodvibes-app" } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: automationKeys.all });
      toast({
        title: "Heartbeat triggered",
        description: result !== undefined ? compactJson(result).slice(0, 200) : undefined,
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Heartbeat failed", description: formatError(error), tone: "danger" });
    },
  });

  const unavailable = list.isError && isMethodUnavailableError(list.error);

  return (
    <section className="automation-section" aria-label="Heartbeat">
      <div className="automation-toolbar">
        <span className="automation-toolbar__summary">
          <HeartPulse size={14} aria-hidden="true" /> Heartbeat
          {list.isSuccess ? ` · ${pending.length} pending` : ""}
        </span>
        <span className="automation-toolbar__actions">
          <button
            type="button"
            className="automation-btn automation-btn--primary"
            disabled={run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending ? "Triggering…" : "Run heartbeat now"}
          </button>
          <button
            type="button"
            className="automation-toolbar__refresh"
            aria-label="Refresh heartbeat"
            onClick={() => void list.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
        </span>
      </div>

      <p className="automation-note" role="note">
        The heartbeat sweep wakes the daemon&apos;s automation manager to evaluate due work immediately instead of
        waiting for its own timer.
      </p>

      {list.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState
          capability="automation.heartbeat.list"
          description="pending heartbeat work cannot be listed."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load heartbeat state" />
      )}

      {list.isSuccess && pending.length === 0 && (
        <EmptyState
          icon={<HeartPulse size={28} aria-hidden="true" />}
          title="Nothing pending"
          description="The daemon reports no heartbeat work waiting to run."
        />
      )}

      {list.isSuccess && pending.length > 0 && (
        <ul className="heartbeat-rows">
          {pending.map((item, index) => (
            <li key={bestId(item) || index} className="heartbeat-row">
              <span className="heartbeat-row__title">{bestTitle(item, `pending #${index + 1}`)}</span>
              <StatusBadge value={bestStatus(item)} />
              <details className="heartbeat-row__raw">
                <summary>Raw</summary>
                <pre>{compactJson(item)}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
