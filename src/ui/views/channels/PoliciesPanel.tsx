// Policies (docs/FEATURES.md §13 "Policies: list / audit / update"):
// channels.policies.list rendered per surface with the gating switches and
// allowlist counts; edits open a modal (modals are configuration) and the
// admin-scoped channels.policies.update only fires after ConfirmSurface —
// confirm + explicitUserRequest ride the body (the method takes
// additionalProperties). The audit sub-tab renders channels.policies.audit
// decisions verbatim (allowed/denied + reason).

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Pencil } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { channelsKeys } from "./keys.ts";
import { QueryPanel } from "./QueryPanel.tsx";
import { readPolicies, readPolicyAudit, type SurfacePolicy } from "./channels-wire.ts";

type PoliciesSection = "policies" | "audit";

export function PoliciesPanel() {
  const [section, setSection] = useState<PoliciesSection>("policies");
  const [editing, setEditing] = useState<SurfacePolicy | null>(null);

  return (
    <div className="channels-policies">
      <div className="channels-subtabs" role="tablist" aria-label="Policies section">
        {(["policies", "audit"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            className={section === id ? "channels-subtab channels-subtab--active" : "channels-subtab"}
            onClick={() => setSection(id)}
          >
            {id === "policies" ? "Policies" : "Audit log"}
          </button>
        ))}
      </div>

      {section === "policies" && <PoliciesList onEdit={setEditing} />}
      {section === "audit" && <AuditList />}

      <PolicyEditModal
        key={editing?.surface ?? "none"}
        policy={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function PoliciesList({ onEdit }: { onEdit: (policy: SurfacePolicy) => void }) {
  const policies = useQuery({
    queryKey: channelsKeys.policies,
    queryFn: () => invoke("channels.policies.list"),
    select: readPolicies,
  });

  return (
    <QueryPanel
      query={policies}
      capability="channels.policies.list"
      unavailableDescription="per-surface reply policies cannot be shown."
      errorTitle="Failed to load policies"
      isEmpty={(rows) => rows.length === 0}
      emptyIcon={<ShieldCheck size={28} aria-hidden="true" />}
      emptyTitle="No channel policies"
      emptyDescription="Reply gating policies for connected surfaces appear here."
      skeletonLines={6}
    >
      {(rows) => (
        <ul className="channels-catalog__list" aria-label="Channel policies">
          {rows.map((policy) => (
            <li key={policy.surface} className="channels-catalog__row">
              <div className="channels-catalog__text">
                <span className="channels-catalog__label">
                  <code>{policy.surface}</code>
                  <span className={policy.enabled ? "badge ok" : "badge neutral"}>
                    {policy.enabled ? "enabled" : "disabled"}
                  </span>
                </span>
                <span className="channels-policy__flags">
                  <PolicyFlag on={policy.allowDirectMessages} label="DMs" />
                  <PolicyFlag on={policy.allowGroupMessages} label="groups" />
                  <PolicyFlag on={policy.allowThreadMessages} label="threads" />
                  <PolicyFlag on={policy.requireMention} label="mention required" />
                  {policy.dmPolicy && <code>dm: {policy.dmPolicy}</code>}
                  {policy.groupPolicy && <code>group: {policy.groupPolicy}</code>}
                </span>
                <span className="channels-catalog__desc">
                  allowlists: {policy.allowlistUserIds.length} users · {policy.allowlistChannelIds.length}{" "}
                  channels · {policy.allowlistGroupIds.length} groups
                  {policy.allowedCommands.length > 0 && ` · ${policy.allowedCommands.length} commands`}
                  {policy.groupPolicyCount > 0 &&
                    ` · ${policy.groupPolicyCount} group override${policy.groupPolicyCount === 1 ? "" : "s"} (edited on the daemon)`}
                </span>
              </div>
              <button type="button" className="channels-btn" onClick={() => onEdit(policy)}>
                <Pencil size={13} aria-hidden="true" /> Edit
              </button>
            </li>
          ))}
        </ul>
      )}
    </QueryPanel>
  );
}

function PolicyFlag({ on, label }: { on: boolean; label: string }) {
  return <span className={on ? "badge ok" : "badge neutral"}>{label}</span>;
}

// ─── Edit modal ──────────────────────────────────────────────────────────────

function splitIds(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function PolicyEditModal({ policy, onClose }: { policy: SurfacePolicy | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  const [enabled, setEnabled] = useState(policy?.enabled ?? false);
  const [requireMention, setRequireMention] = useState(policy?.requireMention ?? false);
  const [allowDm, setAllowDm] = useState(policy?.allowDirectMessages ?? false);
  const [allowGroup, setAllowGroup] = useState(policy?.allowGroupMessages ?? false);
  const [allowThread, setAllowThread] = useState(policy?.allowThreadMessages ?? false);
  const [allowBareCommands, setAllowBareCommands] = useState(policy?.allowTextCommandsWithoutMention ?? false);
  const [dmPolicy, setDmPolicy] = useState(policy?.dmPolicy ?? "");
  const [groupPolicy, setGroupPolicy] = useState(policy?.groupPolicy ?? "");
  const [userIds, setUserIds] = useState((policy?.allowlistUserIds ?? []).join("\n"));
  const [channelIds, setChannelIds] = useState((policy?.allowlistChannelIds ?? []).join("\n"));
  const [groupIds, setGroupIds] = useState((policy?.allowlistGroupIds ?? []).join("\n"));
  const [commands, setCommands] = useState((policy?.allowedCommands ?? []).join("\n"));

  const update = useMutation({
    mutationFn: (meta: ConfirmMetadata) => {
      if (!policy) throw new Error("No policy selected");
      return invoke("channels.policies.update", {
        params: { surface: policy.surface },
        body: {
          enabled,
          requireMention,
          allowDirectMessages: allowDm,
          allowGroupMessages: allowGroup,
          allowThreadMessages: allowThread,
          allowTextCommandsWithoutMention: allowBareCommands,
          ...(dmPolicy ? { dmPolicy } : {}),
          ...(groupPolicy ? { groupPolicy } : {}),
          allowlistUserIds: splitIds(userIds),
          allowlistChannelIds: splitIds(channelIds),
          allowlistGroupIds: splitIds(groupIds),
          allowedCommands: splitIds(commands),
          ...meta,
        },
      });
    },
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: channelsKeys.all });
      toast({ title: `Policy updated for ${policy?.surface ?? ""}`, tone: "success" });
      onClose();
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Policy update failed", description: formatError(error), tone: "danger" });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (update.isPending) return;
    setConfirming(true);
  }

  return (
    <>
      <Modal open={policy !== null} onClose={onClose} title={`Edit policy: ${policy?.surface ?? ""}`} size="lg">
        {policy && (
          <form className="channels-policy-form" onSubmit={handleSubmit}>
            <div className="channels-policy-form__checks">
              <CheckField label="Enabled" checked={enabled} onChange={setEnabled} />
              <CheckField label="Require mention" checked={requireMention} onChange={setRequireMention} />
              <CheckField label="Allow direct messages" checked={allowDm} onChange={setAllowDm} />
              <CheckField label="Allow group messages" checked={allowGroup} onChange={setAllowGroup} />
              <CheckField label="Allow thread messages" checked={allowThread} onChange={setAllowThread} />
              <CheckField
                label="Allow text commands without mention"
                checked={allowBareCommands}
                onChange={setAllowBareCommands}
              />
            </div>
            <div className="channels-policy-form__grid">
              <label className="channels-field">
                <span>DM policy</span>
                <input
                  type="text"
                  value={dmPolicy}
                  onChange={(e) => setDmPolicy(e.target.value)}
                  placeholder="daemon default"
                  spellCheck={false}
                />
              </label>
              <label className="channels-field">
                <span>Group policy</span>
                <input
                  type="text"
                  value={groupPolicy}
                  onChange={(e) => setGroupPolicy(e.target.value)}
                  placeholder="daemon default"
                  spellCheck={false}
                />
              </label>
            </div>
            <div className="channels-policy-form__grid">
              <IdListField label="Allowlisted user ids" value={userIds} onChange={setUserIds} />
              <IdListField label="Allowlisted channel ids" value={channelIds} onChange={setChannelIds} />
              <IdListField label="Allowlisted group ids" value={groupIds} onChange={setGroupIds} />
              <IdListField label="Allowed commands" value={commands} onChange={setCommands} />
            </div>
            {policy.groupPolicyCount > 0 && (
              <p className="channels-policy-form__note" role="note">
                This surface also has {policy.groupPolicyCount} per-group override
                {policy.groupPolicyCount === 1 ? "" : "s"} not edited here — this form leaves them untouched.
              </p>
            )}
            <div className="channels-invoke__actions">
              <button type="button" className="channels-btn" onClick={onClose} disabled={update.isPending}>
                Cancel
              </button>
              <button type="submit" className="channels-btn channels-btn--primary" disabled={update.isPending}>
                {update.isPending ? "Saving…" : "Save policy…"}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <ConfirmSurface
        open={confirming && policy !== null}
        action="Update channel policy"
        target={policy?.surface ?? ""}
        blastRadius="Changes who this surface will answer — every agent replying on this channel obeys the new gating immediately."
        confirmLabel="Update policy"
        onConfirm={(meta) => update.mutate(meta)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="channels-filter channels-filter--check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function IdListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="channels-field">
      <span>{label} (one per line)</span>
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="channels-field__code"
      />
    </label>
  );
}

// ─── Audit log ───────────────────────────────────────────────────────────────

function AuditList() {
  const audit = useQuery({
    queryKey: channelsKeys.policiesAudit,
    queryFn: () => invoke("channels.policies.audit", { query: { limit: 100 } }),
    select: readPolicyAudit,
  });

  return (
    <QueryPanel
      query={audit}
      capability="channels.policies.audit"
      unavailableDescription="policy decisions cannot be audited."
      errorTitle="Failed to load policy audit"
      isEmpty={(rows) => rows.length === 0}
      emptyTitle="No policy decisions yet"
      emptyDescription="Each inbound message's allow/deny decision is recorded here with its reason."
      skeletonLines={6}
    >
      {(rows) => (
        <ul className="channels-audit" aria-label="Policy audit log">
          {rows.map((entry) => (
            <li key={entry.id} className="channels-audit__row">
              <span className={entry.allowed ? "badge ok" : "badge bad"}>
                {entry.allowed ? "allowed" : "denied"}
              </span>
              <div className="channels-audit__text">
                <span className="channels-audit__reason">
                  <code>{entry.surface}</code> {entry.reason}
                </span>
                <span className="channels-audit__meta">
                  {entry.createdAt !== undefined && <span>{formatRelative(entry.createdAt)}</span>}
                  {entry.userId && <code>user {entry.userId}</code>}
                  {entry.channelId && <code>channel {entry.channelId}</code>}
                  {entry.conversationKind && <span>{entry.conversationKind}</span>}
                </span>
                {entry.text && <span className="channels-audit__snippet">{entry.text}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </QueryPanel>
  );
}
