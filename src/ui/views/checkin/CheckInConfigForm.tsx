// Check-in configuration edit form. checkin.config.set can ENABLE proactive
// contact (the daemon reaching out on its own schedule) — every save is
// gated by ConfirmSurface, not just the specific edit that flips enabled on,
// and the confirm names the exact channel/cadence/quiet-hours that will
// apply. Danger-toned when the save leaves check-in enabled; neutral when it
// leaves check-in disabled.

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import type { CheckinConfig } from "./checkin-wire.ts";

export interface CheckInConfigFormProps {
  config: CheckinConfig;
  onSaved: () => void;
  onCancel: () => void;
}

export function CheckInConfigForm({ config, onSaved, onCancel }: CheckInConfigFormProps) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(config.enabled);
  const [cadence, setCadence] = useState(config.cadence);
  const [deliveryChannel, setDeliveryChannel] = useState(config.deliveryChannel);
  const [quietHours, setQuietHours] = useState(config.quietHours);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const save = useMutation({
    mutationFn: () => gv.checkin.config.set({ enabled, cadence, deliveryChannel, quietHours }),
    onSuccess: () => {
      setConfirmOpen(false);
      onSaved();
      toast({ title: "Check-in configuration saved", tone: "success" });
    },
    onError: (error: unknown) => {
      setConfirmOpen(false);
      toast({ title: "Failed to save", description: formatError(error), tone: "danger" });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setConfirmOpen(true);
  }

  return (
    <>
      <form className="checkin-edit-form" onSubmit={handleSubmit}>
        <label className="checkin-edit-form__checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={save.isPending}
          />
          Enabled
        </label>
        <label>
          Cadence (cron)
          <input type="text" value={cadence} onChange={(e) => setCadence(e.target.value)} disabled={save.isPending} />
        </label>
        <label>
          Delivery channel
          <input
            type="text"
            value={deliveryChannel}
            onChange={(e) => setDeliveryChannel(e.target.value)}
            disabled={save.isPending}
          />
        </label>
        <label>
          Quiet hours
          <input
            type="text"
            value={quietHours}
            onChange={(e) => setQuietHours(e.target.value)}
            disabled={save.isPending}
          />
        </label>
        <div className="checkin-edit-form__actions">
          <button type="submit" className="checkin-button checkin-button--primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
          <button type="button" className="checkin-button" onClick={onCancel} disabled={save.isPending}>
            Cancel
          </button>
        </div>
      </form>

      <ConfirmSurface
        open={confirmOpen}
        action={enabled ? "Save — proactive check-ins will run" : "Save check-in configuration"}
        target={enabled ? deliveryChannel || "the configured channel" : "check-in configuration"}
        blastRadius={
          enabled
            ? `The daemon will contact you via ${deliveryChannel || "(no channel set)"} on schedule "${cadence || "(no cadence set)"}", outside quiet hours "${quietHours || "(none set)"}".`
            : "Check-ins remain disabled — no proactive contact will run on any schedule or channel."
        }
        danger={enabled}
        confirmLabel={save.isPending ? "Saving…" : "Save"}
        onConfirm={() => {
          if (!save.isPending) save.mutate();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
