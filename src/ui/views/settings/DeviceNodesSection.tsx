// Paired device nodes, and the form that asks one of them for a capability
// (devices.nodes.list / devices.capability.request).
//
// The phone SERVES capabilities; this window CONSUMES them. So this surface is
// the asking end: which devices are paired, what each one announced it can do,
// what it announced but cannot serve right now and why, and one form that puts
// a request to a chosen device with a reason the person holding it will read
// word for word.
//
// A refusal renders as an answer, not as an error. The daemon returns 200 with
// ok:false when someone declines, and the useful part is what they said, so the
// outcome panel shows the daemon's own refusal code and detail rather than a
// red failure banner that loses both.
//
// Capabilities that ACTUATE (a notification, a link opened, a buzz) are confirm-
// gated here, and captures are not. The asymmetry is deliberate: a capture
// always reaches the device's own prompt unless a durable grant is in place,
// while an actuate capability with a durable grant fires on someone's phone with
// no prompt anywhere. That is the case a misclick in a settings window should
// not be able to cause on its own.

import { useMemo, useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Send, Smartphone } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import {
  availabilityNote,
  buildCapabilityRequest,
  capabilityAvailability,
  capabilityCatalogEntry,
  capabilityInputFields,
  authorityLine,
  formatWhen,
  nodeContractLine,
  readCapabilityOutcome,
  readDeviceNodesSnapshot,
  refusalLine,
  type DeviceCapabilityOutcome,
  type DeviceNode,
} from "./devices.ts";

export function DeviceNodesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [nodeId, setNodeId] = useState("");
  const [capabilityId, setCapabilityId] = useState("");
  const [reason, setReason] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  const [outcome, setOutcome] = useState<DeviceCapabilityOutcome | null>(null);
  const [malformed, setMalformed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const nodes = useQuery({
    queryKey: queryKeys.deviceNodes,
    queryFn: () => gv.devices.nodes.list(),
    retry: false,
  });

  const snapshot = useMemo(() => readDeviceNodesSnapshot(nodes.data), [nodes.data]);

  // The chosen node, re-resolved from the live list each render so a device that
  // unpaired between the selection and the click cannot be asked for anything.
  const selectedNode: DeviceNode | null = useMemo(
    () => snapshot?.nodes.find((node) => node.nodeId === nodeId) ?? null,
    [snapshot, nodeId],
  );

  const selectedCapability = useMemo(
    () => snapshot?.capabilities.find((capability) => capability.id === capabilityId) ?? null,
    [snapshot, capabilityId],
  );

  const inputFields = capabilityInputFields(capabilityId);
  const catalogEntry = capabilityCatalogEntry(capabilityId);

  // Global in-flight count for the shared mutation key: a request blocks for
  // up to the daemon's dispatch timeout, and a tab-switch remount must not
  // re-enable the submit button while the phone still shows the first prompt.
  const requestsInFlight = useIsMutating({ mutationKey: ["devices", "capability-request"] });
  const requestPending = requestsInFlight > 0;
  const request = useMutation({
    mutationKey: ["devices", "capability-request"],
    mutationFn: (body: Record<string, unknown>) => gv.devices.capabilityRequest(body),
    onSuccess: (result) => {
      const parsed = readCapabilityOutcome(result);
      setOutcome(parsed);
      setMalformed(parsed === null);
      // A confirmed-always answer mints a durable grant and a capture is
      // retained, so grants, captures and the ledger all move together.
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      if (parsed === null) {
        toast({
          title: "The daemon did not say what happened",
          description: "The request was accepted but the answer carried no outcome. Do not assume it ran.",
          tone: "warning",
        });
        return;
      }
      toast({
        title: parsed.ok ? `${parsed.capabilityTitle} returned` : `${parsed.capabilityTitle} refused`,
        description: parsed.ok ? authorityLine(parsed.authority) : refusalLine(parsed),
        tone: parsed.ok ? "success" : "info",
      });
    },
    onError: (error: unknown) => {
      toast({ title: "Request failed", description: formatError(error), tone: "danger" });
    },
  });

  function submit(): void {
    const build = buildCapabilityRequest({ nodeId, capabilityId, reason, inputs });
    if (!build.ok) {
      setProblem(build.problem);
      return;
    }
    setProblem("");
    setOutcome(null);
    setMalformed(false);
    request.mutate(build.body);
  }

  function onSubmit(event: React.FormEvent): void {
    event.preventDefault();
    // Validate before the confirm dialog so a missing reason is caught in the
    // form rather than behind a modal the operator then has to back out of.
    const build = buildCapabilityRequest({ nodeId, capabilityId, reason, inputs });
    if (!build.ok) {
      setProblem(build.problem);
      return;
    }
    setProblem("");
    // The pinned catalog decides whether this actuates, not the wire: a skewed
    // daemon omitting `effect` must not turn a phone-side action into a
    // one-click fire. Anything neither read nor capture confirms.
    const effect = capabilityCatalogEntry(capabilityId)?.effect ?? selectedCapability?.effect ?? "";
    if (effect !== "read" && effect !== "capture") {
      setConfirmOpen(true);
      return;
    }
    submit();
  }

  const unavailable = nodes.isError && isMethodUnavailableError(nodes.error);
  const availability = selectedNode && capabilityId ? capabilityAvailability(selectedNode, capabilityId) : null;

  return (
    <section className="settings-devices" aria-label="Paired devices">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Smartphone size={14} aria-hidden="true" /> Paired devices
        </span>
        <button
          type="button"
          onClick={() => void nodes.refetch()}
          disabled={nodes.isFetching}
          title="Re-read the paired device list"
        >
          <RefreshCw size={14} aria-hidden="true" className={nodes.isFetching ? "spinning" : undefined} /> Refresh
        </button>
      </div>

      {nodes.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState
          capability="devices.nodes.list"
          description="this daemon does not serve the paired-device verbs. Update it to use a phone as an agent tool from here."
        />
      )}

      {nodes.isError && !unavailable && (
        <ErrorState
          error={nodes.error}
          onRetry={() => void nodes.refetch()}
          title="Failed to read the paired devices"
        />
      )}

      {nodes.isSuccess && snapshot === null && (
        <div className="settings-devices__malformed" role="status">
          <strong>The daemon answered without a device list</strong>
          <span>
            devices.nodes.list returned a body with no `nodes` array. Nothing is being shown rather than
            reporting zero paired devices, which would be a different claim.
          </span>
        </div>
      )}

      {snapshot !== null && (
        <>
          <dl className="settings-devices__policy">
            <dt>Confirmation</dt>
            <dd>{snapshot.mode || "unreported"}</dd>
            <dt>Always allow</dt>
            <dd>{snapshot.allowAlwaysOffer || "unreported"}</dd>
            <dt>Captures kept</dt>
            <dd>{snapshot.captureRetentionHours} hours</dd>
          </dl>

          {snapshot.nodes.length === 0 ? (
            <EmptyState
              title="No paired devices"
              description="Nothing is paired as a device node yet. Pair a phone from its own app, then it appears here with the capabilities it offers."
            />
          ) : (
            <ul className="settings-devices__nodes">
              {snapshot.nodes.map((node) => (
                <li key={node.nodeId} className="settings-devices__node">
                  <div className="settings-devices__node-head">
                    <strong>{node.label}</strong>
                    <span
                      className={
                        node.contractCompatible
                          ? "settings-devices__contract"
                          : "settings-devices__contract settings-devices__contract--bad"
                      }
                    >
                      {nodeContractLine(node)}
                    </span>
                  </div>
                  <div className="settings-devices__node-detail">
                    {node.platform || "platform unreported"}
                    {node.appVersion ? ` · app ${node.appVersion}` : ""}
                  </div>

                  {node.supported.length > 0 && (
                    <p className="settings-devices__caps">
                      <span className="settings-devices__caps-label">Offers</span>
                      {node.supported.map((id) => (
                        <span key={id} className="settings-devices__cap">
                          {capabilityCatalogEntry(id)?.title ?? id}
                        </span>
                      ))}
                    </p>
                  )}

                  {node.gatedBySecureContext.length > 0 && (
                    <p className="settings-devices__caps settings-devices__caps--gated">
                      <span className="settings-devices__caps-label">Cannot serve right now</span>
                      {node.gatedBySecureContext.map((id) => (
                        <span key={id} className="settings-devices__cap">
                          {capabilityCatalogEntry(id)?.title ?? id}
                        </span>
                      ))}
                      <span className="settings-devices__caps-why">
                        Its connection is not a secure context. Reach it over https, or loopback, and these work.
                      </span>
                    </p>
                  )}

                  {node.unknownDeclared.length > 0 && (
                    <p className="settings-devices__caps settings-devices__caps--unknown">
                      <span className="settings-devices__caps-label">Offers, but this daemon has no definition for</span>
                      {node.unknownDeclared.map((id) => (
                        <span key={id} className="settings-devices__cap">
                          {id}
                        </span>
                      ))}
                      <span className="settings-devices__caps-why">
                        The device is newer than the daemon. Update the daemon to use them.
                      </span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {snapshot.nodes.length > 0 && (
            <form className="settings-devices__request" onSubmit={onSubmit}>
              <h3>Ask a device for something</h3>

              <label className="settings-devices__field">
                <span>Device</span>
                <select
                  value={nodeId}
                  onChange={(event) => {
                    setNodeId(event.target.value);
                    setProblem("");
                  }}
                >
                  <option value="">Choose a device…</option>
                  {snapshot.nodes.map((node) => (
                    <option key={node.nodeId} value={node.nodeId}>
                      {node.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-devices__field">
                <span>Capability</span>
                <select
                  value={capabilityId}
                  onChange={(event) => {
                    setCapabilityId(event.target.value);
                    setInputs({});
                    setProblem("");
                  }}
                  disabled={selectedNode === null}
                >
                  <option value="">Choose a capability…</option>
                  {snapshot.capabilities.map((capability) => {
                    const state = selectedNode ? capabilityAvailability(selectedNode, capability.id) : "unknown";
                    return (
                      <option key={capability.id} value={capability.id} disabled={state !== "supported"}>
                        {capability.title}
                        {state === "supported" ? "" : state === "gated" ? " (cannot serve right now)" : " (not offered)"}
                      </option>
                    );
                  })}
                </select>
              </label>

              {selectedCapability && (
                <p className="settings-devices__purpose">{selectedCapability.purpose}</p>
              )}

              {availability !== null && availability !== "supported" && selectedNode && (
                <p className="settings-devices__note" role="status">
                  {availabilityNote(availability, selectedNode)}
                </p>
              )}

              <label className="settings-devices__field">
                <span>Reason</span>
                <textarea
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setProblem("");
                  }}
                  rows={2}
                  placeholder="Why you need it"
                />
                <span className="settings-devices__hint">
                  Shown word for word on the device, so whoever is holding it sees what you said it was for.
                </span>
              </label>

              {inputFields.map((field) => (
                <label key={field.name} className="settings-devices__field">
                  <span>
                    {field.name}
                    {field.required ? "" : " (optional)"}
                  </span>
                  <input
                    type={field.type === "number" ? "number" : "text"}
                    value={inputs[field.name] ?? ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      setInputs((current) => ({ ...current, [field.name]: next }));
                      setProblem("");
                    }}
                  />
                  <span className="settings-devices__hint">{field.description}</span>
                </label>
              ))}

              {catalogEntry === null && capabilityId !== "" && (
                <p className="settings-devices__note" role="status">
                  This app's pinned capability catalog has no entry for {capabilityId}, so no typed arguments are
                  being sent with it. If the daemon needs one, its refusal will name the field.
                </p>
              )}

              {problem && (
                <p className="settings-devices__problem" role="alert">
                  {problem}
                </p>
              )}

              <button type="submit" disabled={requestPending}>
                <Send size={14} aria-hidden="true" /> {requestPending ? "Asking…" : "Ask"}
              </button>

              {/* The call really does wait: the daemon holds it open while the
                  confirmation is put to a person and the device does the work,
                  up to its own dispatch timeout. Saying so beats a spinner that
                  looks stuck. The confirmation is an ordinary approval record
                  (tool "phone"), so it can also be answered in Approvals. */}
              <p className="settings-devices__hint">
                {requestPending
                  ? "Waiting for the device. The confirmation is put to whoever is holding it, and this call stays open until they answer or it times out. It also shows up in Approvals."
                  : "Unless a durable grant already covers it, this asks the person holding the device first. The prompt also arrives as an approval, so it can be answered in Approvals."}
              </p>
            </form>
          )}

          {malformed && (
            <div className="settings-devices__outcome settings-devices__outcome--warning" role="status">
              <strong>The daemon did not say what happened</strong>
              <span>
                The call was accepted but its answer carried no `ok`. Whether the capability ran is unknown, so
                nothing here reports it as done or refused.
              </span>
            </div>
          )}

          {outcome && (
            <div
              className={
                outcome.ok
                  ? "settings-devices__outcome settings-devices__outcome--ok"
                  : "settings-devices__outcome settings-devices__outcome--info"
              }
              role="status"
            >
              <strong>{outcome.capabilityTitle}</strong>
              <span>{outcome.ok ? authorityLine(outcome.authority) : refusalLine(outcome)}</span>
              {outcome.ok && outcome.artifact && (
                <span className="settings-devices__outcome-artifact">
                  Kept a {outcome.artifact.mediaType || "capture"} taken {formatWhen(outcome.artifact.capturedAt)}.
                  Open it under Retained captures below.
                </span>
              )}
              {outcome.ok && outcome.data !== undefined && (
                // The daemon's non-artifact payload (a location fix, clipboard
                // text). Rendered as text in a <pre>, never as markup, because it
                // is content that came off someone's phone.
                <pre className="settings-devices__outcome-data">{JSON.stringify(outcome.data, null, 2)}</pre>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmSurface
        open={confirmOpen}
        action={`Run ${selectedCapability?.title ?? "this capability"}`}
        target={selectedNode?.label ?? nodeId}
        blastRadius={
          "This does something on that device: it may show a notification, open a link, or buzz it. If a durable grant is already in place, it happens with no prompt on the device at all."
        }
        confirmLabel="Run it"
        onConfirm={() => {
          setConfirmOpen(false);
          submit();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
