// "Raise request": put a permission ask into the daemon's shared approval
// broker from this app (approvals.raise), so it becomes a record every surface
// can see and decide and the daemon's attention machinery fans it out.
//
// The verb is ws-only (no REST path) and returns the PENDING record at once
// rather than waiting for an answer. The decision arrives on the
// control.approval_update event in the `permissions` domain, which already
// invalidates the approvals query behind this view, so the new row appears and
// then resolves on its own.
//
// `waitMs` is deliberately not offered. It exists for callers that want one
// round trip and can block; a window that already re-renders from the event
// stream would only be trading a live list for a stalled request.

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { queryKeys } from "../../lib/queries.ts";
import { useToast } from "../../lib/toast.ts";
import { Modal } from "../../components/Modal.tsx";
import {
  APPROVAL_CATEGORIES,
  APPROVAL_RISK_LEVELS,
  EMPTY_RAISE_DRAFT,
  buildRaiseInput,
  describeRaise,
  readRaisedApproval,
  validateRaiseDraft,
  type ApprovalCategory,
  type ApprovalRiskLevel,
  type RaiseApprovalDraft,
} from "./raise-approval.ts";

function newCallId(): string {
  // The broker coalesces on (session, tool, args), not on callId, so a fresh id
  // per raise does not defeat deduplication; it only keeps two genuinely
  // different asks from sharing an identifier.
  return `app-${crypto.randomUUID()}`;
}

export function RaiseApprovalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<RaiseApprovalDraft>(EMPTY_RAISE_DRAFT);
  const [showErrors, setShowErrors] = useState(false);

  const errors = validateRaiseDraft(draft);

  const raise = useMutation({
    mutationFn: (input: RaiseApprovalDraft) => gv.invoke("approvals.raise", { body: buildRaiseInput(input, newCallId()) }),
    onSuccess: async (result) => {
      const raised = readRaisedApproval(result);
      setDraft(EMPTY_RAISE_DRAFT);
      setShowErrors(false);
      onClose();
      await queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
      toast({
        title: raised.coalesced ? "Merged onto an identical ask" : "Approval raised",
        description: describeRaise(raised),
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      const description = isWsBridgeUnavailableError(error)
        ? "approvals.raise is a ws-only verb with no REST route, and the daemon websocket bridge is not connected. Nothing was raised."
        : isMethodUnavailableError(error)
          ? "The connected daemon does not serve approvals.raise, so an ask can only be created by the daemon's own callers."
          : formatError(error);
      toast({ title: "Could not raise the approval", description, tone: "danger" });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    if (!raise.isPending) raise.mutate(draft);
  }

  return (
    <Modal open={open} onClose={onClose} title="Raise an approval request" size="lg">
      <form className="raise-approval" onSubmit={submit}>
        <p className="raise-approval__note">
          Creates a pending record in the daemon's shared broker. Every surface on this daemon can see and decide it,
          and the first real answer wins. An identical ask already in flight merges onto that one instead of prompting
          twice.
        </p>

        <div className="raise-approval__row">
          <label className="raise-approval__field">
            <span>Tool</span>
            <input
              type="text"
              value={draft.tool}
              onChange={(e) => setDraft({ ...draft, tool: e.target.value })}
              placeholder="exec"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="raise-approval__field">
            <span>Category</span>
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as ApprovalCategory })}
            >
              {APPROVAL_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="raise-approval__field">
            <span>Risk</span>
            <select
              value={draft.riskLevel}
              onChange={(e) => setDraft({ ...draft, riskLevel: e.target.value as ApprovalRiskLevel })}
            >
              {APPROVAL_RISK_LEVELS.map((risk) => (
                <option key={risk} value={risk}>
                  {risk}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="raise-approval__field">
          <span>Classification</span>
          <input
            type="text"
            value={draft.classification}
            onChange={(e) => setDraft({ ...draft, classification: e.target.value })}
            placeholder="shell command"
            autoComplete="off"
          />
        </label>

        <label className="raise-approval__field">
          <span>Summary</span>
          <input
            type="text"
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            placeholder="The one line whoever decides this will read"
            autoComplete="off"
          />
        </label>

        <label className="raise-approval__field">
          <span>Reasons (one per line)</span>
          <textarea
            rows={3}
            value={draft.reasons}
            onChange={(e) => setDraft({ ...draft, reasons: e.target.value })}
            placeholder={"Touches files outside the workspace\nCannot be undone"}
          />
        </label>

        <label className="raise-approval__field">
          <span>Arguments (JSON object, optional)</span>
          <textarea
            rows={3}
            value={draft.argsJson}
            onChange={(e) => setDraft({ ...draft, argsJson: e.target.value })}
            placeholder={'{ "command": "rm -rf build" }'}
            spellCheck={false}
          />
        </label>

        <div className="raise-approval__row">
          <label className="raise-approval__field">
            <span>Session id (optional)</span>
            <input
              type="text"
              value={draft.sessionId}
              onChange={(e) => setDraft({ ...draft, sessionId: e.target.value })}
              placeholder="Scope the ask to one session"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="raise-approval__field">
            <span>Expire after (minutes, optional)</span>
            <input
              type="number"
              min={1}
              max={12 * 60}
              value={draft.timeoutMinutes}
              onChange={(e) => setDraft({ ...draft, timeoutMinutes: e.target.value })}
              placeholder="never"
            />
          </label>
        </div>

        {showErrors && errors.length > 0 && (
          <ul className="raise-approval__errors" role="alert">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className="raise-approval__actions">
          <button type="button" className="raise-approval__cancel" onClick={onClose} disabled={raise.isPending}>
            Cancel
          </button>
          <button type="submit" className="raise-approval__submit" disabled={raise.isPending}>
            <Megaphone size={14} aria-hidden="true" />
            {raise.isPending ? "Raising…" : "Raise request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
