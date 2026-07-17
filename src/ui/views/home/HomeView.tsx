// Home — the assistant cockpit (docs/UX.md §2 "Assistant", docs/FEATURES.md
// §8/§22 rows): daily briefing card (same sources as the Personal Ops header,
// richer layout), "While you were away" digest, "Coming up" rail, quick
// actions sourced from the LIVE command registry (shortcut hints come from
// lib/keybindings — never hardcoded), and a daemon status card. Every card
// renders an honest empty/degraded state; none of them can go blank.

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  Command,
  Inbox,
  ListTodo,
  MessageSquarePlus,
  Stethoscope,
  Sun,
} from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { getCommand, registerCommand, runCommand, subscribeCommands, unregisterCommand } from "../../lib/commands.ts";
import { displayShortcut } from "../../lib/keybindings.ts";
import { useUrlState } from "../../lib/router.ts";
import {
  authLabel,
  connectionLabel,
  formatLatency,
  sseLabel,
  useDaemonHealth,
  workingLabel,
} from "../../lib/daemon-health.ts";
import { ErrorBoundary, ErrorState } from "../../components/feedback.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { BriefingChips, useBriefing, type BriefingJumpTarget } from "../personal-ops/BriefingChips.tsx";
import { formatTime, poKeys } from "../personal-ops/personal-ops-data.ts";
import { AwayDigest } from "./AwayDigest.tsx";
import { ComingUpRail } from "./ComingUpRail.tsx";
import { QuickCapture } from "./QuickCapture.tsx";

function greeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Re-render when the live command registry changes (views register/unregister). */
function useCommandRegistryVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeCommands(() => setVersion((v) => v + 1)), []);
  return version;
}

export function HomeView(): ReactElement {
  const queryClient = useQueryClient();
  const { setView, setFilters, setUrlState } = useUrlState();
  const briefing = useBriefing();
  const health = useDaemonHealth();
  useCommandRegistryVersion();

  const openPersonalOps = useCallback(
    (tab?: "calendar" | "reminders") =>
      setUrlState({ view: "personal-ops", filters: tab ? { tab } : {} }),
    [setUrlState],
  );

  const jump = (target: BriefingJumpTarget) => {
    if (target === "approvals" || target === "tasks") {
      setView("approvals");
      return;
    }
    if (target === "deliveries") {
      setView("channels");
      return;
    }
    openPersonalOps(target === "events" ? "calendar" : undefined);
  };

  // View-scoped palette command.
  useEffect(() => {
    registerCommand({
      id: "home.refresh",
      title: "Refresh Home",
      group: "assistant",
      keywords: ["home", "briefing", "digest", "reload"],
      run: () => {
        void queryClient.invalidateQueries({ queryKey: poKeys.emailRoot });
        void queryClient.invalidateQueries({ queryKey: poKeys.calendarRoot });
        void queryClient.invalidateQueries({ queryKey: queryKeys.automation });
        void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries });
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
      },
    });
    return () => unregisterCommand("home.refresh");
  }, [queryClient]);

  const today = new Date();
  const dateLine = today.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const nextEvents = briefing.todayEvents.items
    .filter((event) => Date.parse(event.start) >= Date.now() || Date.parse(event.end) >= Date.now())
    .slice(0, 3);
  const runningTasks = briefing.tasks.items.slice(0, 3);
  const topUnread = briefing.inbox.items.filter((m) => m.unread).slice(0, 3);

  // Quick actions come from the LIVE registry — an id that is not registered
  // (or whose when-guard fails) simply does not render; nothing is faked.
  const quickActions = [
    { id: "chat.new", label: "New chat", icon: <MessageSquarePlus size={15} aria-hidden="true" /> },
    { id: "system.doctor", label: "Doctor", icon: <Stethoscope size={15} aria-hidden="true" /> },
    { id: "system.palette", label: "Command palette", icon: <Command size={15} aria-hidden="true" /> },
  ].filter((action) => {
    const def = getCommand(action.id);
    return def !== undefined && (!def.when || def.when());
  });

  return (
    <ErrorBoundary fallback={(error, reset) => <ErrorState error={error} onRetry={reset} title="Home failed" />}>
      <div className="home-view">
        <div className="home-view__main">
          {/* ── Daily briefing ─────────────────────────────────────────── */}
          <section className="home-card home-briefing" aria-label="Daily briefing">
            <div className="home-card__header">
              <span className="home-card__title">
                <Sun size={14} aria-hidden="true" /> {greeting(today.getHours())} — {dateLine}
              </span>
            </div>

            <BriefingChips briefing={briefing} onJump={jump} />

            <div className="home-briefing__columns">
              <div className="home-briefing__column">
                <h3 className="home-briefing__subtitle">
                  <CalendarDays size={13} aria-hidden="true" /> Today
                </h3>
                {briefing.todayEvents.count === null && !briefing.todayEvents.loading ? (
                  <p className="home-briefing__degraded">{briefing.todayEvents.degradedNote}</p>
                ) : nextEvents.length === 0 ? (
                  <p className="home-briefing__quiet">No more events today.</p>
                ) : (
                  <ul className="home-briefing__list">
                    {nextEvents.map((event, index) => (
                      <li key={event.id || index}>
                        <button type="button" className="home-briefing__row" onClick={() => openPersonalOps("calendar")}>
                          <span className="home-briefing__row-time">{formatTime(event.start)}</span>
                          <span className="home-briefing__row-label" title={event.title}>
                            {event.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="home-briefing__column">
                <h3 className="home-briefing__subtitle">
                  <ListTodo size={13} aria-hidden="true" /> Running
                </h3>
                {briefing.tasks.count === null && !briefing.tasks.loading ? (
                  <p className="home-briefing__degraded">{briefing.tasks.degradedNote}</p>
                ) : runningTasks.length === 0 ? (
                  <p className="home-briefing__quiet">No tasks running right now.</p>
                ) : (
                  <ul className="home-briefing__list">
                    {runningTasks.map((task) => (
                      <li key={task.id}>
                        <button type="button" className="home-briefing__row" onClick={() => setView("approvals")}>
                          <span className="home-briefing__row-label" title={task.title || task.kind}>
                            {task.title || task.kind}
                          </span>
                          <StatusBadge value={task.status} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="home-briefing__column">
                <h3 className="home-briefing__subtitle">
                  <Inbox size={13} aria-hidden="true" /> Unread
                </h3>
                {briefing.inbox.count === null && !briefing.inbox.loading ? (
                  <p className="home-briefing__degraded">{briefing.inbox.degradedNote}</p>
                ) : topUnread.length === 0 ? (
                  <p className="home-briefing__quiet">Inbox is clear.</p>
                ) : (
                  <ul className="home-briefing__list">
                    {topUnread.map((message) => (
                      <li key={message.uid}>
                        <button type="button" className="home-briefing__row" onClick={() => openPersonalOps()}>
                          <span className="home-briefing__row-label" title={message.subject}>
                            {message.subject}
                          </span>
                          <span className="home-briefing__row-time">{message.from}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <AwayDigest />
        </div>

        <div className="home-view__rail">
          <QuickCapture onOpenScratchpad={() => setUrlState({ view: "routines", filters: { rtab: "scratchpad" } })} />

          <ComingUpRail
            onOpenCalendar={() => openPersonalOps("calendar")}
            onOpenAutomation={() => setView("automation")}
          />

          {/* ── Quick actions (live registry + live keybinding hints) ──── */}
          <section className="home-card home-quick" aria-label="Quick actions">
            <div className="home-card__header">
              <span className="home-card__title">
                <Command size={14} aria-hidden="true" /> Quick actions
              </span>
            </div>
            <div className="home-quick__grid">
              {quickActions.map((action) => {
                const shortcut = displayShortcut(action.id);
                return (
                  <button
                    key={action.id}
                    type="button"
                    className="home-quick__action"
                    onClick={() => runCommand(action.id)}
                  >
                    {action.icon}
                    <span className="home-quick__label">{action.label}</span>
                    {shortcut && <kbd className="home-quick__kbd">{shortcut}</kbd>}
                  </button>
                );
              })}
              {quickActions.length === 0 && (
                <p className="home-briefing__quiet">No commands registered yet — the shell is still booting.</p>
              )}
            </div>
            <p className="home-card__footnote">
              Every action lives in the palette
              {displayShortcut("system.palette") ? ` (${displayShortcut("system.palette")})` : ""} — views add their
              own commands while open.
            </p>
          </section>

          {/* ── Daemon status ──────────────────────────────────────────── */}
          <section className="home-card home-daemon" aria-label="Daemon status">
            <div className="home-card__header">
              <span className="home-card__title">
                <Activity size={14} aria-hidden="true" /> Daemon
              </span>
              {health.daemonVersion && <span className="home-card__hint">v{health.daemonVersion}</span>}
            </div>
            <dl className="home-daemon__facts">
              <dt>Reachable</dt>
              <dd>
                <StatusBadge value={connectionLabel(health.connection)} />
                {health.daemonMode ? ` (${health.daemonMode})` : ""}
              </dd>
              <dt>Signed in</dt>
              <dd>
                <StatusBadge value={authLabel(health.signedIn)} />
              </dd>
              <dt>Working</dt>
              <dd>
                <StatusBadge value={workingLabel(health.working)} />
              </dd>
              <dt>Live updates</dt>
              <dd>{sseLabel(health.sse)}</dd>
              <dt>Latency</dt>
              <dd>{formatLatency(health.latencyMs)}</dd>
              <dt>Active turns</dt>
              <dd>
                {health.activeTurns} running · {health.queuedTasks} queued
              </dd>
            </dl>
            {health.detail && (
              <p className="home-card__footnote" role="status">
                {health.detail}
              </p>
            )}
            {getCommand("system.doctor") && (
              <button type="button" className="home-quick__action" onClick={() => runCommand("system.doctor")}>
                <Stethoscope size={15} aria-hidden="true" />
                <span className="home-quick__label">Open Doctor</span>
              </button>
            )}
          </section>
        </div>
      </div>
    </ErrorBoundary>
  );
}
