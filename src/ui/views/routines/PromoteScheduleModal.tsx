// "Promote to schedule" — mirrors goodvibes-agent's routine-schedule-promotion
// semantics: routines are LOCAL recipes; only an explicit, confirmed promotion
// creates a daemon schedule (automation.schedules.create, kind cron|every|at,
// timezone, the routine's steps as the task body). Two stages:
//   1. schedule form (kind + expression + timezone + task-body preview)
//   2. shared ConfirmSurface naming action/target/blast-radius; the confirmed
//      call carries confirm:true + explicitUserRequest verbatim.
// Receipt: toast with the created schedule id + a jump link to the Automation
// view (the agent's "redacted local receipt" reimagined as a toast receipt).

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, firstString } from "../../lib/wire.ts";
import { runCommand } from "../../lib/commands.ts";
import { useToast } from "../../lib/toast.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { UnavailableState } from "../../components/feedback.tsx";
import { routineStepsText, type RoutineItem } from "./registries.ts";

type ScheduleKind = "cron" | "every" | "at";

const KIND_HELP: Record<ScheduleKind, { label: string; placeholder: string; help: string }> = {
  cron: { label: "Cron expression", placeholder: "0 9 * * 1-5", help: "Standard 5-field cron, evaluated in the timezone below." },
  every: { label: "Interval", placeholder: "4h", help: "Repeat interval, e.g. 30m, 4h, 1d." },
  at: { label: "Run at", placeholder: "2026-07-08T09:00", help: "One-shot ISO date-time, interpreted in the timezone below." },
};

export type PromoteCapability = "available" | "unavailable" | "uncertain" | "checking";

export interface PromoteScheduleModalProps {
  routine: RoutineItem | null;
  capability: PromoteCapability;
  onClose: () => void;
}

interface ScheduleDraft {
  kind: ScheduleKind;
  expression: string;
  timezone: string;
}

export function PromoteScheduleModal({ routine, capability, onClose }: PromoteScheduleModalProps) {
  const { toast } = useToast();
  const [kind, setKind] = useState<ScheduleKind>("cron");
  const [expression, setExpression] = useState("");
  const [timezone, setTimezone] = useState("");
  const [confirming, setConfirming] = useState<ScheduleDraft | null>(null);

  const routineId = routine?.id ?? "";
  useEffect(() => {
    if (!routine) return;
    setKind("cron");
    setExpression("");
    setConfirming(null);
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    } catch {
      setTimezone("UTC");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routineId]);

  const taskBody = useMemo(
    () => (routine ? routineStepsText(routine.name, routine.steps) : ""),
    [routine],
  );

  const create = useMutation({
    mutationFn: ({ draft, meta }: { draft: ScheduleDraft; meta: ConfirmMetadata }) => {
      if (!routine) throw new Error("No routine selected");
      const body: Record<string, unknown> = {
        name: routine.name,
        prompt: taskBody,
        kind: draft.kind,
        [draft.kind]: draft.expression,
        timezone: draft.timezone,
        // ConfirmSurface metadata forwarded verbatim — the daemon-side
        // confirmation gate the agent's promotion flow also satisfies.
        ...meta,
      };
      return gv.invoke("automation.schedules.create", { body });
    },
    onSuccess: (result) => {
      const record = asRecord(result);
      const scheduleId =
        firstString(record, ["id", "scheduleId", "jobId"]) ||
        firstString(asRecord(record["schedule"] ?? record["job"] ?? record["item"]), ["id", "scheduleId", "jobId"]);
      toast({
        title: "Schedule created",
        description: scheduleId ? `Daemon schedule ${scheduleId} now runs this routine.` : "The daemon accepted the schedule.",
        tone: "success",
        action: { label: "Open Automation", onClick: () => runCommand("nav.automation") },
      });
      setConfirming(null);
      onClose();
    },
    onError: (error: unknown) => {
      setConfirming(null);
      toast({
        title: "Promotion failed",
        description: isMethodUnavailableError(error)
          ? "The connected daemon does not serve automation.schedules.create."
          : formatError(error),
        tone: "danger",
      });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = expression.trim();
    if (!routine || !trimmed || create.isPending) return;
    setConfirming({ kind, expression: trimmed, timezone: timezone.trim() || "UTC" });
  }

  const kindHelp = KIND_HELP[kind];

  return (
    <>
      <Modal
        open={routine !== null && confirming === null}
        onClose={onClose}
        title={routine ? `Promote to schedule: ${routine.name}` : "Promote to schedule"}
        size="lg"
      >
        {routine && capability === "unavailable" && (
          <UnavailableState
            capability="automation.schedules.create"
            description="routines stay local recipes — this daemon cannot host schedules for them."
          />
        )}
        {routine && capability !== "unavailable" && (
          <form className="reg-form" onSubmit={handleSubmit}>
            <p className="reg-promote__intro">
              Creates a schedule on the connected daemon that runs this routine&apos;s steps as its task.
              The routine itself stays a local recipe.
              {capability === "uncertain" && " (Capability probe failed — the daemon may still reject this.)"}
              {capability === "checking" && " (Checking daemon capability…)"}
            </p>

            <div className="reg-form__field">
              <span className="reg-form__label">Schedule kind</span>
              <div className="reg-promote__kinds" role="radiogroup" aria-label="Schedule kind">
                {(Object.keys(KIND_HELP) as ScheduleKind[]).map((id) => (
                  <label key={id} className="reg-promote__kind">
                    <input
                      type="radio"
                      name="schedule-kind"
                      value={id}
                      checked={kind === id}
                      onChange={() => setKind(id)}
                    />
                    <span>{id}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="reg-form__field">
              <span className="reg-form__label">{kindHelp.label}</span>
              <input
                type="text"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder={kindHelp.placeholder}
                spellCheck={false}
              />
              <span className="reg-form__help">{kindHelp.help}</span>
            </label>

            <label className="reg-form__field">
              <span className="reg-form__label">Timezone</span>
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="UTC"
                spellCheck={false}
              />
            </label>

            <div className="reg-form__field">
              <span className="reg-form__label">Task body (the routine&apos;s steps)</span>
              <pre className="reg-promote__body">{taskBody}</pre>
            </div>

            <div className="reg-form__actions">
              <button type="button" className="reg-button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="reg-button reg-button--primary"
                disabled={!expression.trim() || create.isPending}
              >
                Continue to confirmation
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmSurface
        open={routine !== null && confirming !== null}
        action="Create daemon schedule"
        target={routine ? `${routine.name} — ${confirming?.kind ?? ""} ${confirming?.expression ?? ""} (${confirming?.timezone ?? ""})` : ""}
        blastRadius="The daemon will run this routine's steps on the schedule above, unattended, until the schedule is disabled or deleted from the Automation view."
        confirmLabel={create.isPending ? "Creating…" : "Create schedule"}
        onCancel={() => setConfirming(null)}
        onConfirm={(meta) => {
          if (confirming && !create.isPending) create.mutate({ draft: confirming, meta });
        }}
      />
    </>
  );
}
