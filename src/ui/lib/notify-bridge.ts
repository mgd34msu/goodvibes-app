// Desktop-notification bridge (docs/FEATURES.md §24; docs/UX.md §4 "Long-running
// turns trigger desktop notifications"). Mounted ONCE from src/ui/App.tsx.
//
// It does NOT open its own SSE connection. lib/realtime.ts already runs the one
// multiplexed stream and turns every frame into a TanStack Query invalidation;
// this bridge watches that shared query cache for the state transitions worth a
// desktop notification — a new approval prompt, a task/turn completing (with a
// distinct "long" variant past 60s) — and POSTs /app/notifications/notify.
//
// Privacy rule (binding): notifications carry METADATA ONLY — a title like
// "Approval needed" and a viewId deep-link. Message bodies are never sent.
//
// Suppression: nothing fires while the window is visible AND focused (you would
// see the event in-app), and — when the quietWhileTyping pref is on — nothing
// fires within 10s of a keystroke in a text field.
//
// Honest limitation: the native side (notify-send on Linux) has no click-to-focus
// callback wired through electrobun, so the viewId deep-link is informational; a
// notification cannot itself refocus the window here. See the Bun-side note in
// src/bun/notifications.ts.

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { appJson } from "./http.ts";
import { asRecord, bestId, bestStatus, firstArrayAtPath } from "./wire.ts";

// Terminal statuses per domain. Anything not terminal counts as pending/running.
const TERMINAL_APPROVAL: ReadonlySet<string> = new Set([
  "approved",
  "denied",
  "rejected",
  "resolved",
  "expired",
  "cancelled",
  "canceled",
  "done",
  "complete",
  "completed",
]);
const TERMINAL_TASK: ReadonlySet<string> = new Set([
  "completed",
  "complete",
  "done",
  "succeeded",
  "success",
  "failed",
  "error",
  "errored",
  "cancelled",
  "canceled",
  "stopped",
]);
const FAILED_TASK: ReadonlySet<string> = new Set(["failed", "error", "errored"]);

const LONG_TURN_MS = 60_000;
const QUIET_TYPING_MS = 10_000;
const NOTIFY_PATH = "/app/notifications/notify";
const PREFS_PATH = "/app/notifications/prefs";

const LIST_PATHS: string[][] = [["items"], ["tasks"], ["approvals"], ["data"], ["results"]];

interface NotifyPayload {
  title: string;
  viewId: string;
}

interface PrefsResponse {
  prefs: { quietWhileTyping?: boolean };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function countPendingApprovals(data: unknown): number {
  const items = firstArrayAtPath(data, LIST_PATHS);
  let pending = 0;
  for (const item of items) {
    const status = bestStatus(item).toLowerCase();
    if (!TERMINAL_APPROVAL.has(status)) pending += 1;
  }
  return pending;
}

/**
 * The bridge keeps all mutable state in refs so its cache subscription and DOM
 * listeners mount exactly once. useSyncExternal-style stores are overkill here.
 */
export function useNotifyBridge(): void {
  const queryClient = useQueryClient();

  // quietWhileTyping pref (client-enforced — the server can't know typing state).
  const prefsQuery = useQuery({
    queryKey: ["notify-bridge", "prefs"] as const,
    queryFn: () => appJson<PrefsResponse>(PREFS_PATH),
    staleTime: 60_000,
    // Prefs change rarely and only from the settings UI; a slow poll keeps the
    // bridge honest without a wire event for this app-local file.
    refetchInterval: 60_000,
  });
  const quietWhileTypingRef = useRef(true);
  quietWhileTypingRef.current = prefsQuery.data?.prefs.quietWhileTyping ?? true;

  const lastKeystrokeRef = useRef(0);

  useEffect(() => {
    const client: QueryClient = queryClient;

    // Snapshots so we only notify on real transitions, and never on the first
    // load (existing pending approvals / already-finished tasks must stay quiet).
    let approvalsSeeded = false;
    let lastApprovalsPending = 0;
    let tasksSeeded = false;
    const taskStatus = new Map<string, string>();
    const taskStartedAt = new Map<string, number>();

    const windowIdle = (): boolean =>
      typeof document !== "undefined" && (document.hidden || !document.hasFocus());

    const typingNow = (): boolean =>
      quietWhileTypingRef.current && Date.now() - lastKeystrokeRef.current < QUIET_TYPING_MS;

    const surface = (payload: NotifyPayload): void => {
      if (!windowIdle()) return; // visible + focused → the user already sees it
      if (typingNow()) return; // quiet-while-typing
      // Metadata only: title + viewId, never a message body.
      void appJson(NOTIFY_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => undefined);
    };

    const handleApprovals = (data: unknown): void => {
      const pending = countPendingApprovals(data);
      if (!approvalsSeeded) {
        approvalsSeeded = true;
        lastApprovalsPending = pending;
        return;
      }
      if (pending > lastApprovalsPending) {
        const delta = pending - lastApprovalsPending;
        surface({
          title: delta === 1 ? "Approval needed" : `${delta} approvals need review`,
          viewId: "approvals",
        });
      }
      lastApprovalsPending = pending;
    };

    const handleTasks = (data: unknown): void => {
      const items = firstArrayAtPath(data, LIST_PATHS);
      const now = Date.now();
      for (const item of items) {
        const id = bestId(item);
        if (!id) continue;
        const status = bestStatus(item).toLowerCase();
        const terminal = TERMINAL_TASK.has(status);
        if (!terminal && !taskStartedAt.has(id)) taskStartedAt.set(id, now);

        const prev = taskStatus.get(id);
        taskStatus.set(id, status);
        if (!tasksSeeded) continue; // first snapshot: record only, never notify
        if (prev === undefined) continue; // task appeared already-terminal → skip
        if (TERMINAL_TASK.has(prev) || !terminal) continue; // not a fresh completion

        const startedAt = taskStartedAt.get(id);
        const elapsed = startedAt !== undefined ? now - startedAt : 0;
        taskStartedAt.delete(id);
        const title = FAILED_TASK.has(status)
          ? "Task failed"
          : elapsed >= LONG_TURN_MS
            ? "Long task complete"
            : "Task complete";
        surface({ title, viewId: "automation" });
      }
      tasksSeeded = true;
    };

    // Seed from whatever is already cached, then subscribe for changes. The
    // cache is fed by lib/realtime.ts's single stream (plus poll fallbacks) —
    // we add no second connection.
    const readAndHandle = (key: readonly unknown[]): void => {
      const head = Array.isArray(key) ? key[0] : undefined;
      if (key.length !== 1) return;
      const data = client.getQueryData(key);
      if (data === undefined) return;
      if (head === "approvals") handleApprovals(data);
      else if (head === "tasks") handleTasks(data);
    };
    readAndHandle(["approvals"]);
    readAndHandle(["tasks"]);

    const unsubscribe = client.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key.length !== 1) return;
      const head = key[0];
      if (head !== "approvals" && head !== "tasks") return;
      const data = asRecord(event.query.state).data;
      if (data === undefined) return;
      if (head === "approvals") handleApprovals(data);
      else handleTasks(data);
    });

    const onKeydown = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target)) lastKeystrokeRef.current = Date.now();
    };
    document.addEventListener("keydown", onKeydown, true);

    return () => {
      unsubscribe();
      document.removeEventListener("keydown", onKeydown, true);
    };
  }, [queryClient]);
}
