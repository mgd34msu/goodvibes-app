// Channel accounts (docs/FEATURES.md §13 "Accounts: list / per-surface / get
// + actions"): channels.accounts.list rendered as cards with configured/
// linked/auth badges and the secret CHECKLIST (field + configured flag — the
// wire carries no secret values, so nothing needs masking here). Account
// lifecycle actions are admin-gated on the daemon and confirm-gated here:
// every invoke goes through ConfirmSurface and sends confirm +
// explicitUserRequest metadata (channels.accounts.action.named when the
// account has an id, .default otherwise).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Users } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { compactJson } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { channelsKeys } from "./keys.ts";
import { QueryPanel } from "./QueryPanel.tsx";
import { readAccounts, type AccountActionDef, type ChannelAccount } from "./channels-wire.ts";

interface PendingAccountAction {
  account: ChannelAccount;
  action: AccountActionDef;
}

export function AccountsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState<PendingAccountAction | null>(null);

  const accounts = useQuery({
    queryKey: channelsKeys.accounts,
    queryFn: () => invoke("channels.accounts.list"),
    select: readAccounts,
  });

  const runAction = useMutation({
    mutationFn: ({ account, action }: PendingAccountAction) => {
      const body = { confirm: true, explicitUserRequest: true };
      // Named route when the daemon gave the account a concrete id; default
      // account route otherwise (both are contract methods).
      return account.accountId
        ? invoke("channels.accounts.action.named", {
            params: { surface: account.surface, accountId: account.accountId, action: action.id },
            body,
          })
        : invoke("channels.accounts.action.default", {
            params: { surface: account.surface, action: action.id },
            body,
          });
    },
    onSuccess: async (result, variables) => {
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: channelsKeys.all });
      toast({
        title: `${variables.action.label} ran on ${variables.account.label}`,
        description: compactJson(result).slice(0, 200),
        tone: "success",
      });
    },
    onError: (error: unknown, variables) => {
      setPending(null);
      toast({
        title: `${variables.action.label} failed`,
        description: formatError(error),
        tone: "danger",
      });
    },
  });

  return (
    <div className="channels-accounts">
      <QueryPanel
        query={accounts}
        capability="channels.accounts.list"
        unavailableDescription="channel accounts cannot be listed."
        errorTitle="Failed to load accounts"
        isEmpty={(rows) => rows.length === 0}
        emptyIcon={<Users size={28} aria-hidden="true" />}
        emptyTitle="No channel accounts"
        emptyDescription="Accounts appear here once a channel surface is configured on the daemon."
        skeletonLines={6}
      >
        {(rows) => (
          <ul className="channels-accounts__list" aria-label="Channel accounts">
            {rows.map((account) => (
              <AccountCard
                key={`${account.surface}:${account.id}`}
                account={account}
                busy={runAction.isPending}
                onRunAction={(action) => setPending({ account, action })}
              />
            ))}
          </ul>
        )}
      </QueryPanel>

      <ConfirmSurface
        open={pending !== null}
        action={`${pending?.action.label ?? "Run account action"}`}
        target={`${pending?.account.label ?? ""} (${pending?.account.surface ?? ""}${
          pending?.account.accountId ? ` · ${pending.account.accountId}` : " · default account"
        })`}
        blastRadius="Admin lifecycle action on this channel account — it can connect, disconnect, or re-authenticate the surface for every consumer of this daemon."
        confirmLabel={pending?.action.label ?? "Run"}
        onConfirm={() => {
          if (pending) runAction.mutate(pending);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function AccountCard({
  account,
  busy,
  onRunAction,
}: {
  account: ChannelAccount;
  busy: boolean;
  onRunAction: (action: AccountActionDef) => void;
}) {
  return (
    <li className="channels-account">
      <div className="channels-account__head">
        <span className="channels-account__label">{account.label}</span>
        <code className="channels-surface__id">{account.surface}</code>
        {account.accountId && <code className="channels-surface__account">{account.accountId}</code>}
      </div>
      <div className="channels-account__badges">
        <StatusBadge value={account.state} />
        <StatusBadge value={`auth: ${account.authState}`} />
        <span className={account.enabled ? "badge ok" : "badge neutral"}>
          {account.enabled ? "enabled" : "disabled"}
        </span>
        <span className={account.configured ? "badge ok" : "badge warning"}>
          {account.configured ? "configured" : "not configured"}
        </span>
        <span className={account.linked ? "badge ok" : "badge neutral"}>
          {account.linked ? "linked" : "not linked"}
        </span>
      </div>
      {account.secrets.length > 0 && (
        <ul className="channels-account__secrets" aria-label="Credential checklist">
          {account.secrets.map((secret) => (
            <li key={secret.field} className="channels-account__secret">
              <KeyRound size={12} aria-hidden="true" />
              <span>{secret.label}</span>
              <span className={secret.configured ? "badge ok" : "badge warning"}>
                {secret.configured ? "set" : "missing"}
              </span>
              {secret.source && <code>{secret.source}</code>}
            </li>
          ))}
        </ul>
      )}
      {account.actions.length > 0 && (
        <div className="channels-account__actions">
          {account.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="channels-btn"
              disabled={!action.available || busy}
              title={action.available ? undefined : "Reported unavailable by the daemon"}
              onClick={() => onRunAction(action)}
            >
              {action.label}
              {action.kind && <span className="channels-btn__kind">{action.kind}</span>}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
