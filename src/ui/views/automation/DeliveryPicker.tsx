// Structured delivery-target picker for ScheduleForm's `delivery` field
// (docs/GAPS.md §5 row 8). Surface options and per-surface directory entries
// ride channels.status / channels.directory.query directly — the same wire
// calls the Channels view uses, never that view's own files. Falls back to
// the static AUTOMATION_SURFACE_KIND_SCHEMA enum and a free-text address
// field whenever those calls are unavailable or come back empty, so the
// picker degrades to "type it yourself" instead of a dead end.

import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { compactJson } from "../../lib/wire.ts";
import {
  DELIVERY_MODES,
  DELIVERY_SURFACE_KINDS,
  DELIVERY_TARGET_KINDS,
  deliveryPolicyToWire,
  directoryOptionsFromResponse,
  emptyDeliveryTarget,
  surfacesFromChannelsStatus,
  targetProblem,
  type DeliveryMode,
  type DeliveryPolicyDraft,
  type DeliverySurfaceOption,
  type DeliveryTargetDraft,
} from "./delivery-targets.ts";

const MODE_LABELS: Record<DeliveryMode, string> = {
  none: "None — don't deliver anywhere",
  webhook: "Webhook",
  surface: "Channel / surface",
  integration: "Integration",
  link: "Link only",
};

export function DeliveryPicker({
  draft,
  onChange,
}: {
  draft: DeliveryPolicyDraft;
  onChange: (next: DeliveryPolicyDraft) => void;
}) {
  const uid = useId();

  // channels.status: enabled surfaces this daemon actually has configured —
  // the fallback enum below covers a daemon where this call 404s or errors.
  const surfaces = useQuery({
    queryKey: ["automation", "deliverySurfaces"],
    queryFn: () => invoke("channels.status"),
    select: surfacesFromChannelsStatus,
    staleTime: 30_000,
  });

  const addTarget = () => onChange({ ...draft, targets: [...draft.targets, emptyDeliveryTarget()] });
  const removeTarget = (index: number) => onChange({ ...draft, targets: draft.targets.filter((_, i) => i !== index) });
  const updateTarget = (index: number, patch: Partial<DeliveryTargetDraft>) =>
    onChange({ ...draft, targets: draft.targets.map((t, i) => (i === index ? { ...t, ...patch } : t)) });

  return (
    <div className="delivery-picker">
      <label className="schedule-form__field" htmlFor={`${uid}-mode`}>
        <span>Delivery mode</span>
        <select
          id={`${uid}-mode`}
          value={draft.mode}
          onChange={(e) => onChange({ ...draft, mode: e.target.value as DeliveryMode })}
        >
          {DELIVERY_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>

      <div className="delivery-picker__targets">
        <div className="delivery-picker__targets-head">
          <span>Targets</span>
          <button type="button" className="delivery-picker__add" onClick={addTarget}>
            <Plus size={13} aria-hidden="true" /> Add target
          </button>
        </div>
        {draft.targets.length === 0 && (
          <p className="delivery-picker__empty" role="note">
            No targets yet — the run's results stay in its own record unless you add one.
          </p>
        )}
        {draft.targets.map((target, index) => (
          <DeliveryTargetRow
            key={index}
            target={target}
            surfaces={surfaces.data ?? []}
            onChange={(patch) => updateTarget(index, patch)}
            onRemove={() => removeTarget(index)}
          />
        ))}
      </div>

      <div className="delivery-picker__flags">
        <label>
          <input
            type="checkbox"
            checked={draft.includeSummary}
            onChange={(e) => onChange({ ...draft, includeSummary: e.target.checked })}
          />
          <span>Include summary</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.includeTranscript}
            onChange={(e) => onChange({ ...draft, includeTranscript: e.target.checked })}
          />
          <span>Include transcript</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.includeLinks}
            onChange={(e) => onChange({ ...draft, includeLinks: e.target.checked })}
          />
          <span>Include links</span>
        </label>
      </div>

      <details className="delivery-picker__preview">
        <summary>Preview resulting JSON</summary>
        <pre>{compactJson(deliveryPolicyToWire(draft))}</pre>
      </details>
    </div>
  );
}

function DeliveryTargetRow({
  target,
  surfaces,
  onChange,
  onRemove,
}: {
  target: DeliveryTargetDraft;
  surfaces: readonly DeliverySurfaceOption[];
  onChange: (patch: Partial<DeliveryTargetDraft>) => void;
  onRemove: () => void;
}) {
  const uid = useId();
  const problem = targetProblem(target);

  // channels.directory.query: real addressable targets (channels/contacts)
  // for the chosen surface — the manual address input below is the fallback
  // when this comes back empty (DM-only surfaces, or an older daemon).
  const directory = useQuery({
    queryKey: ["automation", "deliveryDirectory", target.surfaceKind],
    queryFn: () => invoke("channels.directory.query", { params: { surface: target.surfaceKind } }),
    select: directoryOptionsFromResponse,
    enabled: target.kind === "surface" && target.surfaceKind.length > 0,
    staleTime: 15_000,
  });

  const surfaceOptions = surfaces.length > 0 ? surfaces.map((s) => s.surface) : [...DELIVERY_SURFACE_KINDS];
  const hasDirectory = target.kind === "surface" && (directory.data?.length ?? 0) > 0;

  return (
    <div className="delivery-picker__target">
      <div className="delivery-picker__target-row">
        <label className="delivery-picker__target-field" htmlFor={`${uid}-kind`}>
          <span>Kind</span>
          <select
            id={`${uid}-kind`}
            value={target.kind}
            onChange={(e) =>
              onChange({ kind: e.target.value as DeliveryMode, address: "", surfaceKind: "", routeId: "" })
            }
          >
            {DELIVERY_TARGET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>

        {target.kind === "surface" && (
          <label className="delivery-picker__target-field" htmlFor={`${uid}-surface`}>
            <span>Surface</span>
            <select
              id={`${uid}-surface`}
              value={target.surfaceKind}
              onChange={(e) => onChange({ surfaceKind: e.target.value, address: "" })}
            >
              <option value="">Choose…</option>
              {surfaceOptions.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
        )}

        <label
          className="delivery-picker__target-field delivery-picker__target-field--wide"
          htmlFor={`${uid}-label`}
        >
          <span>Label (optional)</span>
          <input
            id={`${uid}-label`}
            type="text"
            value={target.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="#ops"
          />
        </label>

        <button type="button" className="delivery-picker__remove" onClick={onRemove} aria-label="Remove target">
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>

      {target.kind === "surface" && target.surfaceKind && (
        <div className="delivery-picker__target-row">
          <label
            className="delivery-picker__target-field delivery-picker__target-field--wide"
            htmlFor={`${uid}-address`}
          >
            <span>
              Channel{" "}
              {directory.isFetching
                ? "(loading directory…)"
                : !hasDirectory && "(type the channel id/handle — directory came back empty or unavailable)"}
            </span>
            {hasDirectory ? (
              <select id={`${uid}-address`} value={target.address} onChange={(e) => onChange({ address: e.target.value })}>
                <option value="">Choose…</option>
                {directory.data?.map((entry) => (
                  <option key={entry.id || entry.handle} value={entry.handle || entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`${uid}-address`}
                type="text"
                value={target.address}
                onChange={(e) => onChange({ address: e.target.value })}
                placeholder="channel id / handle"
              />
            )}
          </label>
          <label className="delivery-picker__target-field" htmlFor={`${uid}-route`}>
            <span>or route id</span>
            <input
              id={`${uid}-route`}
              type="text"
              value={target.routeId}
              onChange={(e) => onChange({ routeId: e.target.value })}
              placeholder="existing route"
            />
          </label>
        </div>
      )}

      {(target.kind === "webhook" || target.kind === "integration") && (
        <div className="delivery-picker__target-row">
          <label
            className="delivery-picker__target-field delivery-picker__target-field--wide"
            htmlFor={`${uid}-address2`}
          >
            <span>{target.kind === "webhook" ? "Webhook URL" : "Integration address"}</span>
            <input
              id={`${uid}-address2`}
              type="text"
              value={target.address}
              onChange={(e) => onChange({ address: e.target.value })}
              placeholder={target.kind === "webhook" ? "https://…" : "integration id / address"}
              spellCheck={false}
            />
          </label>
        </div>
      )}

      {problem && (
        <p className="delivery-picker__problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
