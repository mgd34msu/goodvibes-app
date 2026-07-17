// Compact permission-mode selector for the composer toolbar — sessions
// .permissionMode.get/set (contract 1.11). Self-contained (fetches/mutates on
// its own, same pattern as MicButton/VoiceSettingsButton beside it in
// Composer.tsx) so ChatView doesn't have to thread yet another query through
// props. Crib: goodvibes-webui src/components/confirm/PermissionModeSheet.tsx
// — that version is a full modal sheet; this one is the "near the composer"
// compact form the brief asks for, same popover shape as Composer.tsx's own
// ModelPicker.
//
// 'custom' is read-only wire state (a bespoke rule set) — SETTABLE_PERMISSION_
// MODES never includes it as an offered choice, and when the daemon reports
// the session is currently in custom mode, no option in the list is marked
// current (none of them IS the current mode — highlighting one would lie).
//
// TRAP: sessions.permissionMode.get/set answers ONLY for the daemon's own
// live local runtime session — any other session id (including, quite
// possibly, every companion-chat session — see session-runtime.ts's header
// comment) is an honest 404 SESSION_NOT_LOCAL. This control hides entirely
// rather than rendering broken chrome for a session it can never read.

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError } from "../../lib/errors.ts";
import { firstString } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { SETTABLE_PERMISSION_MODES, permissionModeLabel, type SettablePermissionMode } from "./session-runtime.ts";

export function PermissionModeControl({ sessionId }: { sessionId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const mode = useQuery({
    queryKey: queryKeys.sessionPermissionMode(sessionId),
    queryFn: () => gv.sessions.permissionMode.get(sessionId),
    enabled: Boolean(sessionId),
    staleTime: 15_000,
    retry: false,
  });

  const setMode = useMutation({
    mutationFn: (next: SettablePermissionMode) => gv.sessions.permissionMode.set(sessionId, { mode: next }),
    onSuccess: async (result) => {
      const previousMode = firstString(result, ["previousMode"]);
      const newMode = firstString(result, ["mode"]);
      toast({
        title: "Permission mode changed",
        description: previousMode && newMode ? `${permissionModeLabel(previousMode)} → ${permissionModeLabel(newMode)}` : undefined,
        tone: "success",
        durationMs: 3000,
      });
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessionPermissionMode(sessionId) });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not change permission mode", description: formatError(error), tone: "danger" });
    },
  });

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent) {
      if (triggerRef.current?.contains(event.target as Node)) return;
      if (popoverRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!sessionId || !mode.isSuccess) return null;

  const currentMode = firstString(mode.data, ["mode"]);
  const busy = setMode.isPending;
  const pendingMode = setMode.variables;
  const triggerLabel = busy ? "Changing…" : currentMode ? permissionModeLabel(currentMode) : "Permission mode";

  return (
    <div className="permission-mode-control">
      <button
        ref={triggerRef}
        type="button"
        className="composer-tool permission-mode-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={`Permission mode for this chat: ${triggerLabel}`}
        title="Permission mode for this session's live runtime"
        onClick={() => setOpen((prev) => !prev)}
      >
        <ShieldCheck size={13} aria-hidden="true" />
        <span className="permission-mode-trigger-label">{triggerLabel}</span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="listbox"
          aria-label="Set permission mode"
          className="permission-mode-popover"
          tabIndex={-1}
        >
          {SETTABLE_PERMISSION_MODES.map((option) => {
            // None of the settable options is "selected" while the session
            // reports custom — none of them truthfully IS the current mode.
            const selected = currentMode !== "custom" && option === currentMode;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                className="permission-mode-option"
                disabled={busy}
                onClick={() => setMode.mutate(option)}
              >
                <span>{permissionModeLabel(option)}</span>
                {option === pendingMode && busy ? <span className="permission-mode-option-pending">…</span> : null}
                {selected && <Check size={13} className="permission-mode-option-check" aria-hidden="true" />}
              </button>
            );
          })}
          {currentMode === "custom" && (
            <p className="permission-mode-popover-note">
              Currently running a custom rule set — pick a mode above to replace it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
