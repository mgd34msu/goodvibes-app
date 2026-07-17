// Add / edit an MCP server registration (docs/FEATURES.md §16, admin-gated).
// JSON-shape editor validated against the contract's upsert input shape
// (mcp-data.ts validateServerDraft) BEFORE the ConfirmSurface opens; the
// confirmed call carries confirm:true + explicitUserRequest (the upsert input
// schema is additionalProperties:true, so the metadata rides the wire).

import { useMemo, useState } from "react";
import { useDraftState } from "../../lib/drafts.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import {
  SERVER_DRAFT_TEMPLATE,
  validateServerDraft,
  type McpConfiguredServer,
  type ServerDraft,
} from "./mcp-data.ts";

export type UpsertScope = "project" | "global";

export interface ServerEditorSubmit {
  scope: UpsertScope;
  server: ServerDraft;
  confirm: true;
  explicitUserRequest: true;
}

interface ServerEditorModalProps {
  open: boolean;
  /** Existing registration when editing; null when adding. */
  existing: McpConfiguredServer | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: ServerEditorSubmit) => void;
}

function draftJsonFor(existing: McpConfiguredServer | null): string {
  if (!existing) return SERVER_DRAFT_TEMPLATE;
  // envKeys are names only (values never round-trip through config.get) —
  // an edit that must change env values re-enters them via "env".
  return JSON.stringify(
    {
      name: existing.name,
      command: existing.command,
      args: existing.args,
      envKeys: existing.envKeys,
      role: existing.role,
      trustMode: existing.trustMode,
      allowedPaths: existing.allowedPaths,
      allowedHosts: existing.allowedHosts,
    },
    null,
    2,
  );
}

export function ServerEditorModal({ open, existing, saving, onClose, onSubmit }: ServerEditorModalProps) {
  // The caller (McpView) keys this component by open-session + target name
  // so it remounts fresh each time it opens — that remount is what makes
  // this per-target draft key safe (see useDraftState's "stable per mount"
  // contract in lib/drafts.ts) and is also why the old re-seed-on-open effect
  // is gone: a remount re-seeds for free. The caller must call
  // clearDraft(`mcp.server-editor.${existing?.name ?? "new"}`) on save success.
  const [text, setText] = useDraftState(`mcp.server-editor.${existing?.name ?? "new"}`, draftJsonFor(existing));
  const [scope, setScope] = useState<UpsertScope>(existing?.source?.scope === "project" ? "project" : "global");
  const [confirming, setConfirming] = useState<ServerDraft | null>(null);

  const validation = useMemo(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { draft: null as ServerDraft | null, errors: [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }
    return validateServerDraft(parsed);
  }, [text]);

  const title = existing ? `Edit MCP server — ${existing.name}` : "Add MCP server";

  return (
    <>
      <Modal open={open && confirming === null} onClose={onClose} title={title} size="lg">
        <div className="mcp-editor">
          <p className="mcp-editor__hint">
            Contract shape: <code>name</code> + <code>command</code> required; optional <code>args</code>,{" "}
            <code>env</code> (values write-only), <code>role</code>, <code>trustMode</code>,{" "}
            <code>allowedPaths</code>, <code>allowedHosts</code>.
          </p>
          <textarea
            className="mcp-editor__json"
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label="Server registration JSON"
          />
          {validation.errors.length > 0 && (
            <ul className="mcp-editor__errors" role="alert">
              {validation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          <div className="mcp-editor__scope" role="radiogroup" aria-label="Write scope">
            <span>Write to:</span>
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                className={scope === s ? "mcp-editor__scope-btn mcp-editor__scope-btn--active" : "mcp-editor__scope-btn"}
                onClick={() => setScope(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="mcp-editor__actions">
            <button type="button" className="mcp-editor__cancel" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="mcp-editor__save"
              disabled={saving || validation.draft === null}
              onClick={() => {
                if (validation.draft) setConfirming(validation.draft);
              }}
            >
              Continue to confirmation
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmSurface
        open={open && confirming !== null}
        action={existing ? "Update MCP server" : "Register MCP server"}
        target={confirming ? `${confirming.name} (${confirming.command})` : ""}
        blastRadius={`Writes the ${scope} MCP config file and reloads the server set — connected agents gain or lose this server's tools immediately.`}
        confirmLabel={saving ? "Saving…" : existing ? "Update server" : "Register server"}
        onCancel={() => setConfirming(null)}
        onConfirm={(meta) => {
          if (confirming) onSubmit({ scope, server: confirming, ...meta });
        }}
      />
    </>
  );
}
