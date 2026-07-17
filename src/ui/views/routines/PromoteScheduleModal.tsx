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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { automationKeys } from "../automation/automation-model.ts";
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
  at: { label: "Run at", placeholder: "2026-07-08T09:00", help: "One-shot date-time in this machine's local time (sent to the daemon as UTC)." },
};

/** Per-kind expression problem, or null when submittable. Mirrors the wire
 * schema the Automation view verified against goodvibes-sdk
 * runtime-automation-routes.ts: cron = 5 fields, every = duration string,
 * at = ISO date-time (we normalize local input via Date → toISOString). */
function expressionProblem(kind: ScheduleKind, expression: string): string | null {
  if (!expression) return "Required.";
  if (kind === "cron") {
    return expression.split(/\s+/).length === 5 ? null : "Cron needs exactly 5 fields.";
  }
  if (kind === "every") {
    return /^\d+\s*(ms|s|m|h|d)$/i.test(expression) ? null : "Use a duration like 30m, 4h, or 1d.";
  }
  return Number.isNaN(new Date(expression).getTime()) ? "Unparseable date/time." : null;
}

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
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ScheduleKind>("cron");
  const [expression, setExpression] = useState("");
  const [timezone, setTimezone] = useState("");
  const [initialTimezone, setInitialTimezone] = useState("");
  const [confirming, setConfirming] = useState<ScheduleDraft | null>(null);
  // Closing a dirty form asks first instead of silently discarding it — same
  // guard the sibling registry editors (RoutineEditorModal etc.) use.
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const routineId = routine?.id ?? "";
  useEffect(() => {
    if (!routine) return;
    setKind("cron");
    setExpression("");
    setConfirming(null);
    setConfirmDiscard(false);
    let tz = "UTC";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      tz = "UTC";
    }
    setTimezone(tz);
    setInitialTimezone(tz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routineId]);

  const dirty = kind !== "cron" || expression.trim() !== "" || timezone !== initialTimezone;

  const taskBody = useMemo(
    () => (routine ? routineStepsText(routine.name, routine.steps) : ""),
    [routine],
  );

  const create = useMutation({
    mutationFn: ({ draft, meta }: { draft: ScheduleDraft; meta: ConfirmMetadata }) => {
      if (!routine) throw new Error("No routine selected");
      // Wire shape mirrors the Automation view's verified ScheduleCreateBody:
      // `at` normalized to an ISO/UTC string, `timezone` only with cron.
      const expression =
        draft.kind === "at" ? new Date(draft.expression).toISOString() : draft.expression;
      const body: Record<string, unknown> = {
        name: routine.name,
        prompt: taskBody,
        kind: draft.kind,
        [draft.kind]: expression,
        ...(draft.kind === "cron" ? { timezone: draft.timezone } : {}),
        // ConfirmSurface metadata forwarded verbatim — the daemon-side
        // confirmation gate the agent's promotion flow also satisfies.
        ...meta,
      };
      return gv.invoke("automation.schedules.create", { body });
    },
    onSuccess: (result) => {
      // automation.* has no realtime invalidation stream — the Automation view
      // refreshes via manual invalidation + poll. Promoting from here writes the
      // same schedule store, so invalidate it too or the new schedule is absent
      // from the Schedules tab until the next poll tick.
      void queryClient.invalidateQueries({ queryKey: automationKeys.all });
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

  const trimmedExpression = expression.trim();
  const problem = expressionProblem(kind, trimmedExpression);

  function requestClose(): void {
    if (create.isPending) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!routine || problem !== null || create.isPending) return;
    setConfirming({ kind, expression: trimmedExpression, timezone: timezone.trim() || "UTC" });
  }

  const kindHelp = KIND_HELP[kind];

  return (
    <>
      <Modal
        open={routine !== null && confirming === null}
        onClose={requestClose}
        title={routine ? `Promote to schedule: ${routine.name}` : "Promote to schedule"}
        size="lg"
      >
        {confirmDiscard ? (
          <div className="reg-form__discard">
            <p className="reg-form__discard-text">
              Discard unsaved changes to this schedule promotion? The schedule kind, expression, and timezone will
              be lost.
            </p>
            <div className="reg-form__actions">
              <button type="button" className="reg-button" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </button>
              <button type="button" className="reg-button reg-button--danger" onClick={onClose}>
                Discard changes
              </button>
            </div>
          </div>
        ) : (
          <>
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
                aria-invalid={trimmedExpression.length > 0 && problem !== null}
              />
              <span className="reg-form__help">
                {trimmedExpression.length > 0 && problem !== null ? problem : kindHelp.help}
              </span>
            </label>

            {kind === "cron" && (
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
            )}

            <div className="reg-form__field">
              <span className="reg-form__label">Task body (the routine&apos;s steps)</span>
              <pre className="reg-promote__body">{taskBody}</pre>
            </div>

            <div className="reg-form__actions">
              <button type="button" className="reg-button" onClick={requestClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="reg-button reg-button--primary"
                disabled={problem !== null || create.isPending}
              >
                Continue to confirmation
              </button>
            </div>
          </form>
        )}
          </>
        )}
      </Modal>

      <ConfirmSurface
        open={routine !== null && confirming !== null}
        action="Create daemon schedule"
        target={
          routine && confirming
            ? `${routine.name} — ${confirming.kind} ${confirming.expression}${confirming.kind === "cron" ? ` (${confirming.timezone})` : ""}`
            : ""
        }
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
