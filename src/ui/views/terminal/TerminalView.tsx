// Embedded terminal tabs (docs/FEATURES.md §15). Real PTYs via the /app/pty
// Bun service (openpty + `setsid -c` — see src/bun/pty.ts). Reduced terminal
// emulation (emulator.ts) rendered by TerminalScreen. keepAlive view: each tab
// owns a TerminalController whose stream + scrollback survive view switches.
//
// Honest degradation: if the host can't allocate a pty the create call returns
// PTY_UNSUPPORTED and we render an UnavailableState naming the capability —
// never a blank screen, never a fake terminal. Exit codes are always surfaced.
// Closing a tab with a live child goes through ConfirmSurface (busy = alive).

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Plus, X, SquareTerminal, RefreshCw } from "lucide-react";
import { useUrlState } from "../../lib/router.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { EmptyState, ErrorState, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { TerminalScreen } from "./TerminalScreen.tsx";
import { TerminalController } from "./terminal-controller.ts";
import { createSession, listSessions, PtyUnavailableError, type PtySessionSummary } from "./pty-client.ts";

export function TerminalView(): React.ReactElement {
  const controllersRef = useRef<Map<string, TerminalController>>(new Map());
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<{ message: string; detail?: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { setView } = useUrlState();

  const order = useCallback((): TerminalController[] => [...controllersRef.current.values()], []);

  const adopt = useCallback((summary: PtySessionSummary, focus: boolean): void => {
    if (!controllersRef.current.has(summary.id)) {
      controllersRef.current.set(summary.id, new TerminalController(summary));
    }
    if (focus) setActiveId(summary.id);
    else setActiveId((cur) => cur ?? summary.id);
    forceRender();
  }, []);

  const newSession = useCallback(async () => {
    setCreateError(null);
    setUnavailable(null);
    setCreating(true);
    const active = activeId ? controllersRef.current.get(activeId) : undefined;
    try {
      const summary = await createSession({
        cols: active?.emulator.cols,
        rows: active?.emulator.rows,
      });
      adopt(summary, true);
    } catch (err) {
      if (err instanceof PtyUnavailableError) {
        setUnavailable({ message: err.message, detail: err.detail });
      } else {
        setCreateError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setCreating(false);
    }
  }, [activeId, adopt]);

  const removeTab = useCallback(
    (id: string) => {
      const c = controllersRef.current.get(id);
      if (!c) return;
      c.dispose();
      void c.kill().catch(() => {}); // terminate the server child; harmless if already gone
      controllersRef.current.delete(id);
      setConfirmClose((cur) => (cur === id ? null : cur));
      setActiveId((cur) => (cur === id ? order()[0]?.id ?? null : cur));
      forceRender();
    },
    [order],
  );

  const requestClose = useCallback(
    (id: string) => {
      const c = controllersRef.current.get(id);
      if (!c) return;
      if (c.alive) setConfirmClose(id); // busy → confirm
      else removeTab(id);
    },
    [removeTab],
  );

  // ── initial load: adopt any sessions the Bun process already holds ────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await listSessions();
        if (cancelled) return;
        for (const s of existing) adopt(s, false);
      } catch {
        /* list failing just means no sessions to reattach; not fatal */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dispose streams (not the children) when the view finally unmounts.
  useEffect(() => {
    const map = controllersRef.current;
    return () => {
      for (const c of map.values()) c.dispose();
    };
  }, []);

  // ── palette command ──────────────────────────────────────────────────────────
  const newSessionRef = useRef(newSession);
  newSessionRef.current = newSession;
  const setViewRef = useRef(setView);
  setViewRef.current = setView;
  useEffect(() => {
    registerCommand({
      id: "terminal.new",
      title: "Terminal: new session",
      group: "code",
      keywords: ["terminal", "shell", "console", "pty", "bash"],
      run: () => {
        setViewRef.current("terminal");
        void newSessionRef.current();
      },
    });
    return () => unregisterCommand("terminal.new");
  }, []);

  const tabs = order();
  const active = activeId ? controllersRef.current.get(activeId) : undefined;

  // ── render ────────────────────────────────────────────────────────────────────
  if (unavailable) {
    return (
      <div className="terminal-view">
        <UnavailableState
          capability="Embedded terminal (PTY)"
          description={`${unavailable.message}${unavailable.detail ? ` (${unavailable.detail})` : ""}`}
          action={{ label: "Try again", onClick: () => void newSession() }}
        />
      </div>
    );
  }

  return (
    <div className="terminal-view">
      <div className="terminal-tabbar" role="tablist" aria-label="Terminal sessions">
        {tabs.map((c) => (
          <TabButton
            key={c.id}
            controller={c}
            active={c.id === activeId}
            onSelect={() => setActiveId(c.id)}
            onClose={() => requestClose(c.id)}
          />
        ))}
        <button
          type="button"
          className="terminal-newtab"
          title="New terminal session"
          aria-label="New terminal session"
          disabled={creating}
          onClick={() => void newSession()}
        >
          {creating ? <RefreshCw size={15} className="spin" /> : <Plus size={15} />}
        </button>
      </div>

      {createError && (
        <div className="terminal-createerror">
          <ErrorState title="Could not start terminal" error={createError} onRetry={() => void newSession()} />
        </div>
      )}

      <div className="terminal-body">
        {tabs.length === 0 ? (
          loading ? (
            <div className="terminal-loading">Loading terminal sessions…</div>
          ) : (
            <EmptyState
              icon={<SquareTerminal size={28} />}
              title="No terminal sessions"
              description="Open a shell in the workspace directory. Reduced terminal emulation — full-screen apps (vim, htop) may render imperfectly."
              action={{ label: "New session", onClick: () => void newSession() }}
            />
          )
        ) : (
          // Keep every screen mounted (display toggles) so scrollback + focus
          // survive tab switches, just like the view survives navigation.
          tabs.map((c) => (
            <div key={c.id} className="terminal-pane" style={{ display: c.id === activeId ? "flex" : "none" }}>
              {!c.alive && (
                <ExitBanner controller={c} onClose={() => removeTab(c.id)} onNew={() => void newSession()} />
              )}
              <TerminalScreen controller={c} active={c.id === activeId && c.alive} />
            </div>
          ))
        )}
      </div>

      <div className="terminal-caption">
        {active ? (
          <span>
            {active.summary.shell} · pid {active.summary.pid} · {active.emulator.cols}×{active.emulator.rows}
            {active.disconnected ? " · reconnecting…" : active.alive ? " · live" : " · exited"}
          </span>
        ) : (
          <span>Reduced terminal emulation (SGR colors, cursor addressing, alt-screen).</span>
        )}
      </div>

      <ConfirmSurface
        open={confirmClose !== null}
        action="Close terminal session"
        target={confirmClose ? controllersRef.current.get(confirmClose)?.summary.title ?? confirmClose : ""}
        blastRadius="The running shell and any child processes will be terminated (SIGHUP, then SIGKILL)."
        danger
        confirmLabel="Close & terminate"
        onCancel={() => setConfirmClose(null)}
        onConfirm={() => {
          if (confirmClose) removeTab(confirmClose);
        }}
      />
    </div>
  );
}

function TabButton({
  controller,
  active,
  onSelect,
  onClose,
}: {
  controller: TerminalController;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}): React.ReactElement {
  useTerminalVersion(controller); // redraw on title/alive change
  const cls = active ? "terminal-tab terminal-tab--active" : "terminal-tab";
  return (
    <div className={cls} role="tab" aria-selected={active}>
      <button type="button" className="terminal-tab__label" onClick={onSelect}>
        <span
          className={
            controller.alive
              ? "terminal-tab__dot terminal-tab__dot--alive"
              : "terminal-tab__dot terminal-tab__dot--dead"
          }
          aria-hidden="true"
        />
        <span className="terminal-tab__title">{controller.emulator.title || controller.summary.title}</span>
        {!controller.alive && (
          <span className="terminal-tab__exit">
            {controller.signal ? controller.signal : `exit ${controller.exitCode ?? "?"}`}
          </span>
        )}
      </button>
      <button
        type="button"
        className="terminal-tab__close"
        aria-label={`Close ${controller.summary.title}`}
        onClick={onClose}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function ExitBanner({
  controller,
  onClose,
  onNew,
}: {
  controller: TerminalController;
  onClose: () => void;
  onNew: () => void;
}): React.ReactElement {
  const label = controller.signal
    ? `Process terminated by signal ${controller.signal}`
    : `Process exited with code ${controller.exitCode ?? "unknown"}`;
  const errorTone = controller.signal !== null || (controller.exitCode ?? 0) !== 0;
  return (
    <div className={errorTone ? "terminal-exitbanner terminal-exitbanner--error" : "terminal-exitbanner"} role="status">
      <span>{label}</span>
      <div className="terminal-exitbanner__actions">
        <button type="button" onClick={onNew}>
          New session
        </button>
        <button type="button" onClick={onClose}>
          Close tab
        </button>
      </div>
    </div>
  );
}

/** Re-render a component when a controller bumps its version. */
function useTerminalVersion(controller: TerminalController): void {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => controller.subscribe(force), [controller]);
}
