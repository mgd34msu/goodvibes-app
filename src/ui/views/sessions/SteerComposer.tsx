// Steer/follow-up composer — the hero flow of the Sessions view. Injects a
// mid-turn steer (sessions.steer) while an agent is bound, or queues a
// follow-up turn (sessions.followUp) otherwise. Fire-and-optimistic: the
// dispatched text reflects locally with an explicit queued → delivered/failed
// state; the authoritative result reconciles off the session-update-driven
// refetch. Ported from goodvibes-webui src/views/sessions/SteerComposer.tsx.

import { useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatCombo } from "../../lib/keybindings.ts";
import { formatError, isSessionClosedError } from "../../lib/errors.ts";
import { APP_SURFACE_ID, APP_SURFACE_KIND } from "./sessions-union.ts";

export type DispatchMode = "steer" | "followUp";
export type DeliveryState = "queued" | "delivered" | "failed";

export interface LocalDispatch {
  id: string;
  mode: DispatchMode;
  text: string;
  state: DeliveryState;
  error?: string;
}

interface SteerComposerProps {
  sessionId: string;
  /** True while an agent is bound and the session is open — steer is available. */
  canSteer: boolean;
  /** True when the session is closed — dispatch disabled with an honest note. */
  closed: boolean;
  /** True while the session-update stream is paused: the send still goes over
   * HTTP, but the delivered/failed confirmation may lag — say so. */
  streamPaused: boolean;
}

let dispatchSeq = 0;

/** Plain Enter sends, Shift+Enter inserts a newline, IME composition is never hijacked. */
function shouldSubmitKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (event.key !== "Enter") return false;
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.nativeEvent.isComposing) return false;
  return true;
}

export function SteerComposer({ sessionId, canSteer, closed, streamPaused }: SteerComposerProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [dispatches, setDispatches] = useState<LocalDispatch[]>([]);

  const mode: DispatchMode = canSteer ? "steer" : "followUp";

  const setState = (id: string, state: DeliveryState, error?: string) => {
    setDispatches((current) => current.map((d) => (d.id === id ? { ...d, state, error } : d)));
  };

  const mutation = useMutation({
    // The daemon steer/follow-up routes read the canonical `body` field only —
    // a `{ message }` envelope 400s with "Missing shared session steer body".
    mutationFn: ({ body }: { id: string; body: string }) => {
      const payload = { body, surfaceKind: APP_SURFACE_KIND, surfaceId: APP_SURFACE_ID };
      return mode === "steer" ? gv.sessions.steer(sessionId, payload) : gv.sessions.followUp(sessionId, payload);
    },
    onSuccess: async (_data, variables) => {
      setState(variables.id, "delivered");
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
    onError: (error, variables) => {
      if (isSessionClosedError(error)) {
        // The chrome (badge, composer enablement) is driven by the sessions
        // query — refresh it so the user cannot keep firing 409s.
        setState(variables.id, "failed", "This session is closed — reopen it to continue.");
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        return;
      }
      setState(variables.id, "failed", formatError(error));
    },
  });

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = text.trim();
    if (!body || closed) return;
    const id = `dispatch-${++dispatchSeq}`;
    setDispatches((current) => [{ id, mode, text: body, state: "queued" as const }, ...current].slice(0, 20));
    setText("");
    mutation.mutate({ id, body });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!shouldSubmitKey(event)) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <div className="steer-composer">
      <div className="steer-composer__mode">
        {closed ? (
          <span className="badge neutral">Session closed — reopen to send</span>
        ) : mode === "steer" ? (
          <span className="badge ok">Steer · agent bound</span>
        ) : (
          <span className="badge warning">Follow-up · no active agent, queues a turn</span>
        )}
      </div>

      {streamPaused && !closed && (
        <p className="steer-composer__stream-note" role="status">
          Live updates paused — your {mode === "steer" ? "steer" : "follow-up"} will still send; the
          delivered/failed result may take a moment to appear.
        </p>
      )}

      <form className="steer-composer__form" onSubmit={submit}>
        <textarea
          className="steer-composer__input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            closed ? "This session is closed." : mode === "steer" ? "Inject a mid-turn steer…" : "Queue a follow-up turn…"
          }
          rows={2}
          disabled={closed}
          aria-label={mode === "steer" ? "Steer message" : "Follow-up message"}
          aria-keyshortcuts="Enter"
          onKeyDown={handleKeyDown}
        />
        <button
          className="steer-composer__send"
          type="submit"
          disabled={closed || !text.trim()}
          aria-label={mode === "steer" ? "Send steer" : "Queue follow-up"}
        >
          <SendHorizontal size={16} aria-hidden="true" />
          {mode === "steer" ? "Steer" : "Queue"}
        </button>
      </form>
      {!closed && (
        <p className="steer-composer__hint">
          <kbd>{formatCombo("enter")}</kbd> to send · <kbd>{formatCombo("shift+enter")}</kbd> for a new line
        </p>
      )}

      {dispatches.length > 0 && (
        <ul className="steer-composer__dispatches" aria-label="Recent dispatches">
          {dispatches.map((dispatch) => (
            <li key={dispatch.id} className={`steer-dispatch steer-dispatch--${dispatch.state}`}>
              <span className="steer-dispatch__text">{dispatch.text}</span>
              <span
                className={`badge ${
                  dispatch.state === "failed" ? "bad" : dispatch.state === "delivered" ? "ok" : "warning"
                }`}
              >
                {dispatch.mode === "steer" ? "steer" : "follow-up"} · {dispatch.state}
              </span>
              {dispatch.error && <span className="steer-dispatch__error">{dispatch.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
