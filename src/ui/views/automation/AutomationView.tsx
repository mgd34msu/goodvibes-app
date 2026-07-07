// Automation — jobs, schedules, runs, heartbeat (docs/FEATURES.md §5).
//
// Layout: integration snapshot header (GET /api/automation → totals tiles),
// then tabs. Jobs and Schedules are the SAME daemon store surfaced under two
// method families (verified in goodvibes-sdk runtime-automation-routes.ts) —
// both tabs render through the shared JobsSection with their own method ids
// so this client never invents a distinction the daemon doesn't have.
//
// Realtime: `automation` has no domain on the invalidation stream
// (lib/realtime.ts DOMAIN_INVALIDATIONS) — every query here polls at 15s
// while the view is mounted (keepAlive:false → unmounts when hidden), plus
// refetch-on-mutation via the ["automation"] prefix.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../lib/toast.ts";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { getCurrentUrlState, replaceState } from "../../lib/router.ts";
import { Modal } from "../../components/Modal.tsx";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  AUTOMATION_POLL_MS,
  automationKeys,
  jobsFromResponse,
  normalizeSnapshot,
} from "./automation-model.ts";
import { JobsSection } from "./JobsSection.tsx";
import { RunsSection } from "./RunsSection.tsx";
import { HeartbeatSection } from "./HeartbeatSection.tsx";
import { HooksSection } from "./HooksSection.tsx";
import { ScheduleForm, type ScheduleCreateBody } from "./ScheduleForm.tsx";

type AutomationTab = "jobs" | "schedules" | "runs" | "heartbeat" | "hooks";

const TAB_LABELS: Record<AutomationTab, string> = {
  jobs: "Jobs",
  schedules: "Schedules",
  runs: "Runs",
  heartbeat: "Heartbeat",
  hooks: "Hooks",
};

const TAB_IDS = Object.keys(TAB_LABELS) as AutomationTab[];

function initialTab(): AutomationTab {
  const fromUrl = getCurrentUrlState().filters["tab"] ?? "";
  return (TAB_IDS as string[]).includes(fromUrl) ? (fromUrl as AutomationTab) : "jobs";
}

/** Deep-linkable tab: ?view=automation&filter[tab]=runs. */
function writeTabToUrl(tab: AutomationTab): void {
  const current = getCurrentUrlState();
  if ((current.filters["tab"] ?? "") === tab) return;
  replaceState({ ...current, filters: { ...current.filters, tab } });
}

export function AutomationView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<AutomationTab>(initialTab);
  const [createNoun, setCreateNoun] = useState<"job" | "schedule" | null>(null);

  const selectTab = (next: AutomationTab) => {
    setTab(next);
    writeTabToUrl(next);
  };

  // Jobs load at view level so the Runs tab can resolve jobId → name from the
  // same cache entry the Jobs tab uses.
  const jobs = useQuery({
    queryKey: automationKeys.jobs,
    // No automation domain on the invalidation stream — poll while visible.
    queryFn: () => gv.invoke("automation.jobs.list"),
    refetchInterval: AUTOMATION_POLL_MS,
  });
  const jobNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const job of jobsFromResponse(jobs.data)) {
      if (job.id) map.set(job.id, job.name);
    }
    return map;
  }, [jobs.data]);

  const create = useMutation({
    mutationFn: ({ noun, body }: { noun: "job" | "schedule"; body: ScheduleCreateBody }) =>
      gv.invoke(noun === "job" ? "automation.jobs.create" : "automation.schedules.create", { body }),
    onSuccess: async (_result, variables) => {
      setCreateNoun(null);
      await queryClient.invalidateQueries({ queryKey: automationKeys.all });
      toast({ title: `Created ${variables.noun}`, tone: "success" });
    },
    onError: (error: unknown, variables) => {
      toast({ title: `Failed to create ${variables.noun}`, description: formatError(error), tone: "danger" });
    },
  });

  // Palette commands — view-scoped, live only while the view is mounted.
  useEffect(() => {
    registerCommand({
      id: "automation.refresh",
      title: "Refresh Automation",
      group: "automate",
      keywords: ["automation", "jobs", "schedules", "runs", "reload"],
      run: () => void queryClient.invalidateQueries({ queryKey: automationKeys.all }),
    });
    registerCommand({
      id: "automation.new-job",
      title: "New Automation Job",
      group: "automate",
      keywords: ["automation", "job", "create", "cron"],
      run: () => setCreateNoun("job"),
    });
    registerCommand({
      id: "automation.new-schedule",
      title: "New Schedule",
      group: "automate",
      keywords: ["automation", "schedule", "create", "cron", "reminder"],
      run: () => setCreateNoun("schedule"),
    });
    registerCommand({
      id: "automation.open-hooks",
      title: "Automation: Open Hooks",
      group: "automate",
      keywords: ["hooks", "hooks.json", "events", "automation"],
      run: () => selectTab("hooks"),
    });
    return () => {
      unregisterCommand("automation.refresh");
      unregisterCommand("automation.new-job");
      unregisterCommand("automation.open-hooks");
      unregisterCommand("automation.new-schedule");
    };
  }, [queryClient]);

  return (
    <div className="automation-view">
      <SnapshotHeader />

      <div className="automation-tabs" role="tablist" aria-label="Automation sections">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "automation-tab automation-tab--active" : "automation-tab"}
            onClick={() => selectTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {tab === "jobs" && (
        <JobsSection
          noun="job"
          paramName="jobId"
          queryKey={automationKeys.jobs}
          methods={{
            list: "automation.jobs.list",
            enable: "automation.jobs.enable",
            disable: "automation.jobs.disable",
            run: "automation.jobs.run",
            delete: "automation.jobs.delete",
            update: "automation.jobs.update",
          }}
          onCreate={() => setCreateNoun("job")}
        />
      )}

      {tab === "schedules" && (
        <JobsSection
          noun="schedule"
          paramName="scheduleId"
          queryKey={automationKeys.schedules}
          methods={{
            list: "automation.schedules.list",
            enable: "automation.schedules.enable",
            disable: "automation.schedules.disable",
            run: "automation.schedules.run",
            delete: "automation.schedules.delete",
          }}
          onCreate={() => setCreateNoun("schedule")}
          note="Schedules share the daemon's job store — the same entries appear under Jobs, where they can also be edited."
        />
      )}

      {tab === "runs" && <RunsSection jobNames={jobNames} />}

      {tab === "heartbeat" && <HeartbeatSection />}

      {tab === "hooks" && <HooksSection />}

      <Modal
        open={createNoun !== null}
        onClose={() => setCreateNoun(null)}
        title={createNoun === "schedule" ? "New schedule" : "New automation job"}
        size="lg"
      >
        {createNoun !== null && (
          <ScheduleForm
            noun={createNoun}
            submitting={create.isPending}
            onSubmit={(body) => create.mutate({ noun: createNoun, body })}
            onCancel={() => setCreateNoun(null)}
          />
        )}
      </Modal>
    </div>
  );
}

// ─── Integration snapshot header — GET /api/automation ──────────────────────
// { totals: { jobs, enabled, paused, runs }, jobs, recentRuns } (verified in
// goodvibes-sdk integration helpers getAutomationSnapshot()).

function SnapshotHeader() {
  const snapshot = useQuery({
    queryKey: automationKeys.snapshot,
    // No automation domain on the invalidation stream — poll while visible.
    queryFn: () => gv.invoke("automation.integration.snapshot"),
    refetchInterval: AUTOMATION_POLL_MS,
  });

  if (snapshot.isPending) {
    return (
      <div className="automation-snapshot" aria-label="Automation snapshot loading">
        <SkeletonBlock height={64} />
      </div>
    );
  }

  if (snapshot.isError) {
    if (isMethodUnavailableError(snapshot.error)) {
      return (
        <UnavailableState
          capability="automation.integration.snapshot"
          description="the totals header is hidden; jobs, schedules, and runs below still work if their own methods are served."
          className="automation-snapshot__state"
        />
      );
    }
    return (
      <ErrorState
        error={snapshot.error}
        onRetry={() => void snapshot.refetch()}
        title="Failed to load automation snapshot"
        className="automation-snapshot__state"
      />
    );
  }

  const data = normalizeSnapshot(snapshot.data);
  const runningNow = data.recentRuns.filter((run) => run.status === "running").length;

  const tiles: Array<{ label: string; value: number | undefined; hint?: string }> = [
    { label: "Jobs", value: data.totals.jobs },
    { label: "Enabled", value: data.totals.enabled },
    { label: "Paused", value: data.totals.paused },
    { label: "Recent runs", value: data.totals.runs, hint: "last 50 kept by the daemon" },
    { label: "Running now", value: runningNow, hint: "within those recent runs" },
  ];

  return (
    <div className="automation-snapshot" role="group" aria-label="Automation totals">
      {tiles.map(({ label, value, hint }) => (
        <div key={label} className="automation-tile" title={hint}>
          <span className="automation-tile__value">{value ?? "—"}</span>
          <span className="automation-tile__label">{label}</span>
        </div>
      ))}
    </div>
  );
}
