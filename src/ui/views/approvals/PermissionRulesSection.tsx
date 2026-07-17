// Durable approval rules — every remembered decision at a generalizing tier
// (permissions.rules.list), with revocation (permissions.rules.delete).
// Write-only from decisions: nothing here mints a rule — a rule is created
// only by approving with a remember scope elsewhere. A `deleted:false`
// response is the daemon's honest "no such rule" (already gone) — surfaced
// as info, never as an error, same posture as the principals/channel-profile
// deletes in the Channels view.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";

interface PermissionRule {
  id: string;
  effect: string;
  tier: string;
  tool: string;
  description: string;
  createdAt: number | undefined;
}

function readRules(data: unknown): PermissionRule[] {
  return asArray(asRecord(data)["rules"]).map((row) => ({
    id: firstString(row, ["id"]),
    effect: firstString(row, ["effect"]) || "allow",
    tier: firstString(row, ["tier"]) || "tool",
    tool: firstString(row, ["tool"]),
    description: firstString(row, ["description"]),
    createdAt: firstNumber(row, ["createdAt"]),
  }));
}

function ruleSummary(rule: PermissionRule): string {
  const effect = rule.effect === "deny" ? "Deny" : "Allow";
  return `${effect} · ${rule.tier} · ${rule.tool}`;
}

export function PermissionRulesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const rules = useQuery({
    queryKey: queryKeys.permissionRules,
    queryFn: () => gv.permissions.rules.list(),
    select: readRules,
  });

  const remove = useMutation({
    mutationFn: (ruleId: string) => gv.permissions.rules.delete({ ruleId }) as Promise<{ deleted?: boolean }>,
    onSuccess: async (result: { deleted?: boolean } | undefined) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.permissionRules });
      toast(
        result?.deleted === false
          ? { title: "Rule already gone", description: "The daemon reported no such rule.", tone: "info" }
          : { title: "Rule deleted", description: "Matching asks will prompt again.", tone: "info" },
      );
    },
    onError: (error: unknown) => toast({ title: "Delete failed", description: formatError(error), tone: "danger" }),
  });

  const unavailable = rules.isError && isMethodUnavailableError(rules.error);
  const rows = rules.data ?? [];

  return (
    <section className="permission-rules-section" aria-label="Durable approval rules">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <ShieldCheck size={14} aria-hidden="true" /> Durable rules
          {rules.isSuccess ? ` · ${rows.length}` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh durable approval rules"
          onClick={() => void rules.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={rules.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {rules.isPending && <SkeletonBlock variant="text" lines={2} />}

      {unavailable && (
        <UnavailableState capability="permissions.rules.list" description="durable approval rules cannot be listed or revoked." />
      )}

      {rules.isError && !unavailable && (
        <ErrorState error={rules.error} onRetry={() => void rules.refetch()} title="Failed to load approval rules" />
      )}

      {rules.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<ShieldCheck size={28} aria-hidden="true" />}
          title="No durable approval rules"
          description="Approving with a remember scope (exact command, command class, path, or tool) records a rule here; deleting one makes matching asks prompt again."
        />
      )}

      {rules.isSuccess && rows.length > 0 && (
        <ul className="permission-rules-rows">
          {rows.map((rule) => (
            <li key={rule.id} className="permission-rule-row" data-rule-id={rule.id}>
              <div className="permission-rule-row__main">
                <span className={rule.effect === "deny" ? "badge bad" : "badge ok"}>{rule.effect}</span>
                <span className="permission-rule-row__summary">{ruleSummary(rule)}</span>
                {rule.description && <small className="permission-rule-row__desc">{rule.description}</small>}
                <small className="permission-rule-row__age">created {formatRelative(rule.createdAt)}</small>
              </div>
              <button
                type="button"
                className="approval-card__btn approval-card__btn--deny"
                disabled={remove.isPending && remove.variables === rule.id}
                aria-label={`Delete rule: ${ruleSummary(rule)}`}
                title="Delete this rule — matching asks will prompt again"
                onClick={() => remove.mutate(rule.id)}
              >
                <Trash2 size={13} aria-hidden="true" /> {remove.isPending && remove.variables === rule.id ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
