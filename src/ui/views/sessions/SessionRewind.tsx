// SessionRewind — the session-detail "Rewind" section (rewind.plan /
// rewind.apply, contract 1.11).
//
// A dry-run/apply flow: pick a recent turn anchor (derived from the
// transcript SessionDetail already loaded — no second query) plus a scope
// (files / conversation / both) -> rewind.plan previews EXACTLY what
// restoring would change, naming each part's `available` flag VERBATIM (a
// part can be unavailable on this runtime — say so, never fake it), and mints
// a single-use confirm token -> a danger ConfirmSurface -> rewind.apply
// consumes the token and returns a receipt whose `undo` block records how to
// reverse it.
//
// TRAP (contract 1.11): both rewind.apply and checkpoints.restore answer 200
// with {receipt:null, refused:true, refusal} / {result:null, refused:true,
// refusal} when unconfirmed — refused is checked BEFORE trusting a receipt.
//
// Undo: the file restore is reversible from the browser — its own
// restorePreview -> confirmToken -> restore flow, behind its own confirm.
// The conversation rewind has NO browser-side undo verb — that is stated
// honestly, never a fabricated button.
//
// Ported in spirit from goodvibes-webui src/views/sessions/SessionRewind.tsx.

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { History, Undo2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { asRecord } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { turnAnchorsFromMessages } from "./rewind-model.ts";

export interface SessionRewindProps {
  sessionId: string;
  /** Raw session message records (SessionDetail already loaded them for the
   * transcript) — turn anchors are derived from these, never a second query. */
  rawMessages: readonly unknown[];
}

type RewindScope = "files" | "conversation" | "both";

const SCOPES: { value: RewindScope; label: string }[] = [
  { value: "both", label: "Files + conversation" },
  { value: "files", label: "Files only" },
  { value: "conversation", label: "Conversation only" },
];

// --- wire result readers (kept local; gv.* returns `unknown` here) --------

interface PlanPart {
  available: boolean;
  affectedFileCount: number;
  checkpointLabel: string | null;
  checkpointId: string | null;
  messagesToDrop: number;
  messagesRemaining: number;
}
function parsePlanPart(value: unknown): PlanPart | null {
  if (value == null) return null;
  const record = asRecord(value);
  return {
    available: record["available"] === true,
    affectedFileCount: typeof record["affectedFileCount"] === "number" ? (record["affectedFileCount"] as number) : 0,
    checkpointLabel: typeof record["checkpointLabel"] === "string" ? (record["checkpointLabel"] as string) : null,
    checkpointId: typeof record["checkpointId"] === "string" ? (record["checkpointId"] as string) : null,
    messagesToDrop: typeof record["messagesToDrop"] === "number" ? (record["messagesToDrop"] as number) : 0,
    messagesRemaining: typeof record["messagesRemaining"] === "number" ? (record["messagesRemaining"] as number) : 0,
  };
}
/** The "this rewind would change" detail — rendered both in the plan preview
 * and again inside the confirm dialog itself (checklist item 3: the full
 * consequence has to be visible at the moment of consent, not just above a
 * modal that may cover it). */
function RewindPlanDetail({ scope, planResult }: { scope: RewindScope; planResult: RewindPlanResult }) {
  return (
    <>
      <ul className="session-rewind__plan-list">
        {(scope === "files" || scope === "both") && (
          <li>
            <strong>Files:</strong>{" "}
            {planResult.files?.available
              ? `restore ${planResult.files.affectedFileCount} file${planResult.files.affectedFileCount === 1 ? "" : "s"} from checkpoint "${planResult.files.checkpointLabel ?? planResult.files.checkpointId ?? "nearest"}"`
              : "unavailable on this runtime — no workspace checkpoint store is wired."}
          </li>
        )}
        {(scope === "conversation" || scope === "both") && (
          <li>
            <strong>Conversation:</strong>{" "}
            {planResult.conversation?.available
              ? `drop ${planResult.conversation.messagesToDrop} message${planResult.conversation.messagesToDrop === 1 ? "" : "s"}, keep ${planResult.conversation.messagesRemaining}`
              : "unavailable on this runtime — no conversation store is wired for a rewind here."}
          </li>
        )}
      </ul>
      {planResult.warnings.length > 0 && (
        <ul className="session-rewind__warnings" role="note">
          {planResult.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </>
  );
}

interface RewindPlanResult {
  token: string | null;
  files: PlanPart | null;
  conversation: PlanPart | null;
  warnings: string[];
}
function parseRewindPlan(value: unknown): RewindPlanResult {
  const record = asRecord(value);
  return {
    token: typeof record["token"] === "string" ? (record["token"] as string) : null,
    files: parsePlanPart(record["files"]),
    conversation: parsePlanPart(record["conversation"]),
    warnings: Array.isArray(record["warnings"]) ? (record["warnings"] as string[]) : [],
  };
}

interface ReceiptFilesPart {
  restored: boolean;
  restoredFileCount: number;
  removedFileCount: number;
}
interface ReceiptConversationPart {
  rewound: boolean;
  droppedMessages: number;
}
interface RewindReceipt {
  files: ReceiptFilesPart | null;
  conversation: ReceiptConversationPart | null;
  undoFilesCheckpointId: string | null;
  undoConversationSnapshotId: string | null;
  warnings: string[];
}
interface RewindApplyResult {
  receipt: RewindReceipt | null;
  refused: boolean;
  refusalReason: string | null;
}
function parseRewindApply(value: unknown): RewindApplyResult {
  const record = asRecord(value);
  const refusal = asRecord(record["refusal"]);
  const receiptRaw = record["receipt"];
  if (record["refused"] === true || receiptRaw == null) {
    return {
      receipt: null,
      refused: record["refused"] === true,
      refusalReason: typeof refusal["reason"] === "string" ? (refusal["reason"] as string) : null,
    };
  }
  const receipt = asRecord(receiptRaw);
  const filesRaw = receipt["files"];
  const conversationRaw = receipt["conversation"];
  const undo = asRecord(receipt["undo"]);
  const undoFiles = asRecord(undo["files"]);
  const undoConversation = asRecord(undo["conversation"]);
  return {
    refused: false,
    refusalReason: null,
    receipt: {
      files:
        filesRaw == null
          ? null
          : (() => {
              const f = asRecord(filesRaw);
              return {
                restored: f["restored"] === true,
                restoredFileCount: typeof f["restoredFileCount"] === "number" ? (f["restoredFileCount"] as number) : 0,
                removedFileCount: typeof f["removedFileCount"] === "number" ? (f["removedFileCount"] as number) : 0,
              };
            })(),
      conversation:
        conversationRaw == null
          ? null
          : (() => {
              const c = asRecord(conversationRaw);
              return {
                rewound: c["rewound"] === true,
                droppedMessages: typeof c["droppedMessages"] === "number" ? (c["droppedMessages"] as number) : 0,
              };
            })(),
      undoFilesCheckpointId:
        typeof undoFiles["restoreCheckpointId"] === "string" ? (undoFiles["restoreCheckpointId"] as string) : null,
      undoConversationSnapshotId:
        typeof undoConversation["undoSnapshotId"] === "string" ? (undoConversation["undoSnapshotId"] as string) : null,
      warnings: Array.isArray(receipt["warnings"]) ? (receipt["warnings"] as string[]) : [],
    },
  };
}

interface RestorePreviewResult {
  token: string | null;
}
function parseRestorePreview(value: unknown): RestorePreviewResult {
  const record = asRecord(value);
  return { token: typeof record["token"] === "string" ? (record["token"] as string) : null };
}
interface RestoreApplyResult {
  restored: boolean;
  refusalReason: string | null;
}
function parseRestoreApply(value: unknown): RestoreApplyResult {
  const record = asRecord(value);
  const refusal = asRecord(record["refusal"]);
  return {
    restored: record["result"] != null,
    refusalReason: typeof refusal["reason"] === "string" ? (refusal["reason"] as string) : null,
  };
}

export function SessionRewind({ sessionId, rawMessages }: SessionRewindProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState<RewindScope>("both");
  const [anchorTurnId, setAnchorTurnId] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [receipt, setReceipt] = useState<RewindReceipt | null>(null);

  const anchors = useMemo(() => turnAnchorsFromMessages(rawMessages), [rawMessages]);

  const plan = useMutation({
    mutationFn: () =>
      gv.rewind.plan({ sessionId, scope, ...(anchorTurnId ? { turnId: anchorTurnId } : {}) }),
  });
  const planResult = plan.data ? parseRewindPlan(plan.data) : null;

  const apply = useMutation({
    mutationFn: (token: string) =>
      gv.rewind.apply({ sessionId, scope, ...(anchorTurnId ? { turnId: anchorTurnId } : {}), confirmToken: token }),
  });
  // Refused is checked BEFORE trusting a receipt — a 200 refusal is not a
  // success just because the HTTP call succeeded.
  const applyResult = apply.data ? parseRewindApply(apply.data) : null;

  const undoPreview = useMutation({
    mutationFn: (checkpointId: string) => gv.checkpoints.restorePreview({ id: checkpointId }),
    onSuccess: (raw) => {
      if (parseRestorePreview(raw).token) setConfirmUndo(true);
    },
  });
  const undoApply = useMutation({
    mutationFn: (input: { checkpointId: string; token: string }) =>
      gv.checkpoints.restore({ id: input.checkpointId, confirmToken: input.token }),
  });
  const undoPreviewResult = undoPreview.data ? parseRestorePreview(undoPreview.data) : null;

  function resetFlow(): void {
    plan.reset();
    apply.reset();
    setReceipt(null);
  }

  function startUndoFiles(checkpointId: string): void {
    undoPreview.reset();
    undoApply.reset();
    undoPreview.mutate(checkpointId);
  }

  return (
    <section className="session-rewind">
      <button
        type="button"
        className="session-rewind__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <History size={15} aria-hidden="true" />
        <span>Rewind</span>
        <span className="session-rewind__toggle-hint">
          {expanded
            ? "Preview, then restore files and/or conversation to a turn"
            : "Roll this session back to an earlier turn"}
        </span>
      </button>

      {expanded && (
        <div className="session-rewind__body">
          <div className="session-rewind__controls">
            <label className="session-rewind__field">
              Scope
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as RewindScope);
                  resetFlow();
                }}
                aria-label="Rewind scope"
              >
                {SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="session-rewind__field">
              Anchor
              <select
                value={anchorTurnId}
                onChange={(e) => {
                  setAnchorTurnId(e.target.value);
                  resetFlow();
                }}
                aria-label="Rewind turn anchor"
              >
                <option value="">Most recent checkpoint (no turn)</option>
                {anchors.map((a) => (
                  <option key={a.turnId} value={a.turnId}>
                    {a.label || a.turnId}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {anchors.length === 0 && (
            <p className="session-rewind__note" role="note">
              No turn-anchored messages retained for this session — you can still rewind to its most recent
              checkpoint.
            </p>
          )}

          <button
            type="button"
            className="session-rewind__preview-btn"
            disabled={plan.isPending}
            onClick={() => {
              setReceipt(null);
              apply.reset();
              plan.mutate();
            }}
          >
            {plan.isPending ? "Previewing…" : "Preview rewind"}
          </button>

          {plan.isError && (
            <p className="session-rewind__error" role="alert">
              {formatError(plan.error)}
            </p>
          )}

          {planResult && !receipt && (
            <div className="session-rewind__plan" role="group" aria-label="Rewind plan preview">
              <h4 className="session-rewind__plan-title">This rewind would change:</h4>
              <RewindPlanDetail scope={scope} planResult={planResult} />
              <button type="button" className="session-rewind__apply-btn" onClick={() => setConfirmApply(true)}>
                <Undo2 size={14} aria-hidden="true" /> Rewind to this point…
              </button>
            </div>
          )}

          {apply.isError && (
            <p className="session-rewind__error" role="alert">
              {formatError(apply.error)}
            </p>
          )}
          {applyResult?.refused && (
            <p className="session-rewind__error" role="alert">
              {applyResult.refusalReason ?? "The rewind was refused — preview it again to mint a fresh confirmation."}
            </p>
          )}

          {receipt && (
            <div className="session-rewind__receipt" role="status">
              <h4 className="session-rewind__receipt-title">Rewind applied</h4>
              <ul className="session-rewind__plan-list">
                {receipt.files && (
                  <li>
                    <strong>Files:</strong>{" "}
                    {receipt.files.restored
                      ? `restored ${receipt.files.restoredFileCount} file${receipt.files.restoredFileCount === 1 ? "" : "s"}${receipt.files.removedFileCount ? `, removed ${receipt.files.removedFileCount}` : ""}`
                      : "not restored"}
                  </li>
                )}
                {receipt.conversation && (
                  <li>
                    <strong>Conversation:</strong>{" "}
                    {receipt.conversation.rewound
                      ? `dropped ${receipt.conversation.droppedMessages} message${receipt.conversation.droppedMessages === 1 ? "" : "s"}`
                      : "not rewound"}
                  </li>
                )}
              </ul>
              {receipt.warnings.length > 0 && (
                <ul className="session-rewind__warnings" role="note">
                  {receipt.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}

              <div className="session-rewind__undo">
                <strong>Undo point recorded.</strong>{" "}
                {receipt.undoFilesCheckpointId ? (
                  <button
                    type="button"
                    className="session-rewind__undo-btn"
                    disabled={undoApply.isPending}
                    onClick={() => startUndoFiles(receipt.undoFilesCheckpointId as string)}
                  >
                    {undoApply.isPending ? "Undoing…" : "Undo the file restore"}
                  </button>
                ) : (
                  <span>No file undo point (nothing was restored).</span>
                )}
                {receipt.undoConversationSnapshotId && (
                  <p className="session-rewind__note" role="note">
                    The conversation rewind is reversible from its captured snapshot (
                    {receipt.undoConversationSnapshotId}), but there is no conversation-restore verb on the wire —
                    this app cannot undo it. Reverse it from the TUI, or another surface that has one.
                  </p>
                )}
              </div>
              {undoPreview.isError && (
                <p className="session-rewind__error" role="alert">
                  {formatError(undoPreview.error)}
                </p>
              )}
              {undoApply.isError && (
                <p className="session-rewind__error" role="alert">
                  {formatError(undoApply.error)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {confirmApply && planResult && (
        <ConfirmSurface
          open
          action="Rewind this session"
          target={`Scope: ${scope}${anchorTurnId ? ` · turn ${anchorTurnId}` : " · most recent checkpoint"}`}
          blastRadius="Restores files and/or truncates the conversation to this point. An undo point is recorded, so it is reversible."
          danger
          confirmLabel="Rewind"
          onConfirm={() => {
            setConfirmApply(false);
            if (!planResult.token) return;
            apply.mutate(planResult.token, {
              onSuccess: (raw) => {
                const result = parseRewindApply(raw);
                if (result.refused) return;
                if (result.receipt) {
                  setReceipt(result.receipt);
                  plan.reset();
                  toast({ title: "Rewind applied", tone: "success" });
                }
              },
              onError: (error) => toast({ title: "Rewind failed", description: formatError(error), tone: "danger" }),
            });
          }}
          onCancel={() => setConfirmApply(false)}
        >
          <RewindPlanDetail scope={scope} planResult={planResult} />
        </ConfirmSurface>
      )}

      {/* Undo-the-file-restore flow: preview mints a token, then its own confirm. */}
      {undoPreview.isPending && (
        <p className="session-rewind__note" role="status">
          Checking the undo restore…
        </p>
      )}
      {confirmUndo && receipt?.undoFilesCheckpointId && undoPreviewResult?.token && (
        <ConfirmSurface
          open
          action="Undo the file restore"
          target={`Restore checkpoint ${receipt.undoFilesCheckpointId}`}
          blastRadius="Restores the working tree to its pre-rewind state (the safety checkpoint taken before the rewind)."
          danger
          confirmLabel="Undo"
          onConfirm={() => {
            const checkpointId = receipt.undoFilesCheckpointId as string;
            const token = undoPreviewResult.token as string;
            setConfirmUndo(false);
            undoApply.mutate(
              { checkpointId, token },
              {
                onSuccess: (raw) => {
                  const result = parseRestoreApply(raw);
                  if (result.restored) toast({ title: "File restore undone", tone: "success" });
                  else
                    toast({
                      title: "Undo refused",
                      description: result.refusalReason ?? "the restore was refused",
                      tone: "danger",
                    });
                },
                onError: (error) => toast({ title: "Undo failed", description: formatError(error), tone: "danger" }),
              },
            );
          }}
          onCancel={() => {
            setConfirmUndo(false);
            undoPreview.reset();
          }}
        />
      )}
    </section>
  );
}
