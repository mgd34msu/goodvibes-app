// Status board (docs/FEATURES.md §13 "Status overview (all 17 surfaces)"):
// master/detail over channels.status — the daemon's surface rows render
// VERBATIM (id/label/state/enabled straight off the wire, tones via the
// presentation bridge's classifyBadgeTone → StatusBadge; no invented
// vocabulary, no hardcoded surface list). Selecting a surface opens the
// health panel: doctor + repairs + lifecycle + setup, each an independent
// query that degrades to UnavailableState on its own.
//
// Repairs: the contract exposes repair actions per surface
// (channels.repairs.list / doctor.repairActions) but names no dedicated
// "run repair" method — the documented lifecycle-action path is
// channels.accounts.action.default (POST /accounts/{surface}/actions/{action}).
// Running a repair goes through ConfirmSurface (admin verb) and sends the
// repair action id down that path with confirm metadata.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, Stethoscope, Wrench } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { compactJson, formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { channelsKeys } from "./keys.ts";
import { QueryPanel } from "./QueryPanel.tsx";
import {
  readDoctor,
  readLifecycle,
  readRepairActions,
  readSetup,
  readStatusRows,
  type RepairAction,
  type SurfaceStatusRow,
} from "./channels-wire.ts";

/** The `communication` domain invalidation is the fast signal; this poll is
 * the slow floor because surface state can drift without any inbound message
 * (e.g. a socket silently dropping). */
const STATUS_POLL_MS = 30_000;

export function StatusBoard() {
  const [selectedSurface, setSelectedSurface] = useState("");

  const status = useQuery({
    queryKey: channelsKeys.status,
    queryFn: () => invoke("channels.status"),
    refetchInterval: STATUS_POLL_MS,
    select: readStatusRows,
  });

  return (
    <div className="channels-board">
      <div className="channels-board__list">
        <QueryPanel
          query={status}
          capability="channels.status"
          unavailableDescription="channel surface health cannot be shown."
          errorTitle="Failed to load channel status"
          isEmpty={(rows) => rows.length === 0}
          emptyIcon={<Radio size={28} aria-hidden="true" />}
          emptyTitle="No channel surfaces reported"
          emptyDescription="The daemon reported an empty surface list — no channel plugins or provider-backed channels are registered."
          skeletonLines={8}
        >
          {(rows) => (
            <ul className="channels-surface-list" aria-label="Channel surfaces">
              {rows.map((row) => (
                <SurfaceRow
                  key={row.id || row.surface}
                  row={row}
                  selected={selectedSurface === row.surface}
                  onSelect={() => setSelectedSurface(row.surface === selectedSurface ? "" : row.surface)}
                />
              ))}
            </ul>
          )}
        </QueryPanel>
      </div>
      <div className="channels-board__detail">
        {selectedSurface ? (
          <SurfaceHealthPanel surface={selectedSurface} />
        ) : (
          <div className="channels-board__hint" role="note">
            <Stethoscope size={18} aria-hidden="true" />
            Select a surface to run its doctor and see setup, lifecycle, and repair actions.
          </div>
        )}
      </div>
    </div>
  );
}

function SurfaceRow({
  row,
  selected,
  onSelect,
}: {
  row: SurfaceStatusRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={selected ? "channels-surface channels-surface--selected" : "channels-surface"}
        onClick={onSelect}
        aria-pressed={selected}
      >
        <span className="channels-surface__label">{row.label}</span>
        <span className="channels-surface__meta">
          <code className="channels-surface__id">{row.surface}</code>
          {row.accountId && <code className="channels-surface__account">{row.accountId}</code>}
        </span>
        <span className="channels-surface__badges">
          <StatusBadge value={row.state} />
          <span className={row.enabled ? "badge ok" : "badge neutral"}>
            {row.enabled ? "enabled" : "disabled"}
          </span>
        </span>
      </button>
    </li>
  );
}

// ─── Per-surface health panel: doctor / repairs / lifecycle / setup ──────────

function SurfaceHealthPanel({ surface }: { surface: string }) {
  return (
    <div className="channels-health" aria-label={`${surface} health`}>
      <h3 className="channels-health__title">
        <code>{surface}</code>
      </h3>
      <DoctorSection surface={surface} />
      <RepairsSection surface={surface} />
      <LifecycleSection surface={surface} />
      <SetupSection surface={surface} />
    </div>
  );
}

function DoctorSection({ surface }: { surface: string }) {
  const doctor = useQuery({
    queryKey: channelsKeys.surfaceSection(surface, "doctor"),
    queryFn: () => invoke("channels.doctor.get", { params: { surface } }),
    select: readDoctor,
  });

  return (
    <section className="channels-health__section" aria-label="Doctor">
      <h4 className="channels-health__heading">Doctor</h4>
      <QueryPanel
        query={doctor}
        capability="channels.doctor.get"
        unavailableDescription="per-surface diagnostics cannot run."
        errorTitle="Doctor run failed"
        skeletonLines={4}
      >
        {(report) => (
          <>
            <div className="channels-health__summary">
              <StatusBadge value={report.state} />
              <span>{report.summary || "No summary."}</span>
              {report.checkedAt !== undefined && (
                <span className="channels-health__checked">checked {formatRelative(report.checkedAt)}</span>
              )}
            </div>
            {report.checks.length > 0 && (
              <ul className="channels-checks">
                {report.checks.map((check) => (
                  <li key={check.id} className="channels-check">
                    <StatusBadge value={check.status} />
                    <span className="channels-check__label">{check.label}</span>
                    {check.detail && <span className="channels-check__detail">{check.detail}</span>}
                    {check.repairActionId && (
                      <code className="channels-check__repair">repair: {check.repairActionId}</code>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {report.repairActions.length > 0 && (
              <RepairButtons surface={surface} actions={report.repairActions} sourceLabel="doctor" />
            )}
          </>
        )}
      </QueryPanel>
    </section>
  );
}

function RepairsSection({ surface }: { surface: string }) {
  const repairs = useQuery({
    queryKey: channelsKeys.surfaceSection(surface, "repairs"),
    queryFn: () => invoke("channels.repairs.list", { params: { surface } }),
    select: readRepairActions,
  });

  return (
    <section className="channels-health__section" aria-label="Repair actions">
      <h4 className="channels-health__heading">Repair actions</h4>
      <QueryPanel
        query={repairs}
        capability="channels.repairs.list"
        unavailableDescription="repair actions cannot be listed."
        errorTitle="Failed to load repair actions"
        isEmpty={(actions) => actions.length === 0}
        emptyTitle="No repair actions"
        emptyDescription="This surface offers no repair actions right now."
        skeletonLines={2}
      >
        {(actions) => <RepairButtons surface={surface} actions={actions} sourceLabel="catalog" />}
      </QueryPanel>
    </section>
  );
}

/** Repair execution — confirm-gated lifecycle action on the surface's default account. */
function RepairButtons({
  surface,
  actions,
  sourceLabel,
}: {
  surface: string;
  actions: RepairAction[];
  sourceLabel: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState<RepairAction | null>(null);

  const run = useMutation({
    mutationFn: (action: RepairAction) =>
      invoke("channels.accounts.action.default", {
        params: { surface, action: action.id },
        body: { confirm: true, explicitUserRequest: true },
      }),
    onSuccess: async (result, action) => {
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: channelsKeys.all });
      toast({
        title: `Repair "${action.label}" ran`,
        description: compactJson(result).slice(0, 200),
        tone: "success",
      });
    },
    onError: (error: unknown, action) => {
      setPending(null);
      toast({ title: `Repair "${action.label}" failed`, description: formatError(error), tone: "danger" });
    },
  });

  return (
    <>
      <ul className="channels-repairs" aria-label={`Repair actions (${sourceLabel})`}>
        {actions.map((action) => (
          <li key={action.id} className="channels-repair">
            <div className="channels-repair__text">
              <span className="channels-repair__label">
                {action.label}
                {action.dangerous && <span className="badge bad">dangerous</span>}
              </span>
              {action.description && <span className="channels-repair__desc">{action.description}</span>}
            </div>
            <button
              type="button"
              className="channels-btn"
              onClick={() => setPending(action)}
              disabled={run.isPending}
            >
              <Wrench size={13} aria-hidden="true" /> Run
            </button>
          </li>
        ))}
      </ul>
      <ConfirmSurface
        open={pending !== null}
        action={`Run repair: ${pending?.label ?? ""}`}
        target={`${surface} (default account)`}
        blastRadius={
          pending?.dangerous
            ? "Marked dangerous by the daemon — it may reset credentials or restart this channel surface."
            : "Runs a lifecycle action on this surface's default channel account."
        }
        danger={pending?.dangerous ?? false}
        confirmLabel="Run repair"
        onConfirm={() => {
          if (pending) run.mutate(pending);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function LifecycleSection({ surface }: { surface: string }) {
  const lifecycle = useQuery({
    queryKey: channelsKeys.surfaceSection(surface, "lifecycle"),
    queryFn: () => invoke("channels.lifecycle.get", { params: { surface } }),
    select: readLifecycle,
  });

  return (
    <section className="channels-health__section" aria-label="Lifecycle">
      <h4 className="channels-health__heading">Lifecycle</h4>
      <QueryPanel
        query={lifecycle}
        capability="channels.lifecycle.get"
        unavailableDescription="setup version tracking cannot be shown."
        errorTitle="Failed to load lifecycle"
        skeletonLines={2}
      >
        {(info) => {
          const current = info.currentVersion ?? 0;
          const target = info.targetVersion ?? 0;
          const upToDate = current >= target;
          return (
            <div className="channels-lifecycle">
              <span className={upToDate ? "badge ok" : "badge warning"}>
                {upToDate ? "up to date" : "setup pending"}
              </span>
              <span>
                setup version <code>{current}</code> of <code>{target}</code>
              </span>
              {info.accountId && <code className="channels-surface__account">{info.accountId}</code>}
            </div>
          );
        }}
      </QueryPanel>
    </section>
  );
}

/** Setup guide — read-only render of the daemon's ordered field list. Writing
 * values happens through config/secrets flows the guide references; this panel
 * shows exactly what each field needs and never prints secret values (there
 * are none on this wire — only field descriptors). */
function SetupSection({ surface }: { surface: string }) {
  const setup = useQuery({
    queryKey: channelsKeys.surfaceSection(surface, "setup"),
    queryFn: () => invoke("channels.setup.get", { params: { surface } }),
    select: readSetup,
  });

  return (
    <section className="channels-health__section" aria-label="Setup guide">
      <h4 className="channels-health__heading">Setup guide</h4>
      <QueryPanel
        query={setup}
        capability="channels.setup.get"
        unavailableDescription="the ordered setup guide cannot be shown."
        errorTitle="Failed to load setup guide"
        skeletonLines={3}
      >
        {(guide) => (
          <div className="channels-setup">
            {guide.description && <p className="channels-setup__desc">{guide.description}</p>}
            {guide.setupMode && (
              <p className="channels-setup__mode">
                Mode: <code>{guide.setupMode}</code>
              </p>
            )}
            {guide.fields.length === 0 ? (
              <p className="channels-setup__desc">This surface needs no configuration fields.</p>
            ) : (
              <ol className="channels-setup__fields">
                {guide.fields.map((field) => (
                  <li key={field.id} className="channels-setup__field">
                    <span className="channels-setup__field-label">
                      {field.label}
                      {field.required && <span className="badge warning">required</span>}
                      <code className="channels-setup__field-kind">{field.kind}</code>
                    </span>
                    {field.detail && <span className="channels-setup__field-detail">{field.detail}</span>}
                    {field.configKey && (
                      <code className="channels-setup__field-key">config: {field.configKey}</code>
                    )}
                    {field.secretTargetId && (
                      <code className="channels-setup__field-key">secret: {field.secretTargetId}</code>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </QueryPanel>
    </section>
  );
}
