// AppShell — the whole chrome: sidebar (6 groups, icon-rail collapse), topbar
// (eyebrow + title + view actions slot), keep-alive view outlet, bottom
// StatusStrip, right peek outlet, command palette, toasts, announcer, and the
// DaemonGate overlay (over the mounted shell, never a remount). Provider
// nesting ported from goodvibes-webui AppShell; view keep-alive per
// docs/UX.md §4 ("view switches never destroy state").

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUrlState, type ViewId } from "../../lib/router.ts";
import { fetchAppHealth, loadBootSnapshot, queryKeys } from "../../lib/queries.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useCommandHotkeys } from "../../lib/hotkeys.ts";
import { useTheme } from "../../lib/theme.ts";
import { useRealtimeInvalidation, useSessionRealtime } from "../../lib/realtime.ts";
import { AnnouncerRegion, announce } from "../../lib/announcer.ts";
import { PeekProvider } from "../PeekPanel.tsx";
import { ToastViewport } from "../Toasts.tsx";
import { CommandPalette, ShortcutCheatsheet } from "../CommandPalette.tsx";
import { SkeletonBlock } from "../feedback.tsx";
import { VIEW_REGISTRY, ALL_VIEWS } from "../../views/registry.tsx";
import { ApprovalsNotifier } from "../../views/approvals/ApprovalsNotifier.tsx";
import { Sidebar, readSidebarCollapsed, writeSidebarCollapsed } from "./Sidebar.tsx";
import { Topbar, ViewActionsProvider } from "./Topbar.tsx";
import { StatusStrip } from "./StatusStrip.tsx";
import { DaemonGate, shouldGate } from "./DaemonGate.tsx";
import { CHAT_NEW_EVENT, dispatchChatEvent } from "../../views/chat/chat-events.ts";
import { OnboardingOverlay, type OnboardingMode } from "../../views/onboarding/OnboardingOverlay.tsx";
import { useFirstRunOnboarding } from "../../views/onboarding/useFirstRun.ts";

export function AppShell() {
  const { view, setView } = useUrlState();
  const queryClient = useQueryClient();
  const { toggleTheme, toggleDensity } = useTheme();
  const [collapsed, setCollapsed] = useState<boolean>(readSidebarCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  // Onboarding/Doctor overlay — null = closed; renders OVER the mounted shell
  // so drafts and view state survive (docs/UX.md §1.2).
  const [onboardingMode, setOnboardingMode] = useState<OnboardingMode | null>(null);

  // --- daemon health (drives the gate + realtime enablement) ---------------
  const health = useQuery({
    queryKey: queryKeys.appHealth,
    queryFn: fetchAppHealth,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    retry: 0,
  });
  const daemonReady = health.data?.daemon.mode === "external" || health.data?.daemon.mode === "spawned";
  const gated = shouldGate(health.data, health.isError);

  // --- boot snapshot: one allSettled sweep, once per daemon adoption -------
  const bootedRef = useRef(false);
  useEffect(() => {
    if (!daemonReady || bootedRef.current) return;
    bootedRef.current = true;
    void loadBootSnapshot(queryClient);
  }, [daemonReady, queryClient]);

  // --- realtime: invalidation stream + raw session-update stream -----------
  const realtimeError = useRealtimeInvalidation(daemonReady);
  useSessionRealtime(daemonReady);

  // --- navigation + shell commands -----------------------------------------
  const navigate = useCallback(
    (next: ViewId) => {
      setView(next);
      announce(`${VIEW_REGISTRY[next].title} view`);
    },
    [setView],
  );

  // --- onboarding / doctor overlay ------------------------------------------
  const openDoctor = useCallback(() => setOnboardingMode("doctor"), []);
  const openFirstRun = useCallback(() => setOnboardingMode((cur) => cur ?? "first-run"), []);
  const closeOnboarding = useCallback(() => setOnboardingMode(null), []);
  // Auto-show only when the daemon was just spawned first-time or no provider
  // is configured; otherwise the flag is set silently (zero friction).
  useFirstRunOnboarding(health.data, openFirstRun);

  useEffect(() => {
    for (const def of ALL_VIEWS) {
      registerCommand({
        id: `nav.${def.id}`,
        title: `Go to ${def.title}`,
        group: "navigation",
        keywords: [def.id, def.group, def.title.toLowerCase()],
        run: () => navigate(def.id),
      });
    }
    registerCommand({
      id: "system.palette",
      title: "Open Command Palette",
      group: "system",
      keywords: ["command", "palette", "search"],
      run: () => setPaletteOpen((open) => !open),
    });
    registerCommand({
      id: "system.shortcuts",
      title: "Show Keyboard Shortcuts",
      group: "system",
      keywords: ["shortcuts", "hotkeys", "help", "cheatsheet"],
      run: () => setCheatsheetOpen((open) => !open),
    });
    registerCommand({
      id: "system.toggleTheme",
      title: "Toggle Theme",
      group: "system",
      keywords: ["theme", "dark", "light", "color"],
      run: toggleTheme,
    });
    registerCommand({
      id: "view.toggleDensity",
      title: "Toggle Density",
      group: "view",
      keywords: ["density", "compact", "comfortable"],
      run: toggleDensity,
    });
    registerCommand({
      id: "view.toggleSidebar",
      title: "Toggle Sidebar",
      group: "view",
      keywords: ["sidebar", "collapse", "rail"],
      run: () =>
        setCollapsed((prev) => {
          writeSidebarCollapsed(!prev);
          return !prev;
        }),
    });
    registerCommand({
      id: "chat.new",
      title: "New Chat",
      group: "work",
      keywords: ["new", "create", "chat", "session"],
      run: () => {
        navigate("chat");
        // Reaches into the keep-alive ChatView to start a fresh draft.
        dispatchChatEvent(CHAT_NEW_EVENT);
      },
    });
    registerCommand({
      id: "system.doctor",
      title: "Doctor",
      group: "system",
      keywords: ["doctor", "health", "checks", "onboarding", "setup", "diagnose", "repair"],
      run: openDoctor,
    });
    return () => {
      for (const def of ALL_VIEWS) unregisterCommand(`nav.${def.id}`);
      unregisterCommand("system.palette");
      unregisterCommand("system.shortcuts");
      unregisterCommand("system.toggleTheme");
      unregisterCommand("view.toggleDensity");
      unregisterCommand("view.toggleSidebar");
      unregisterCommand("chat.new");
      unregisterCommand("system.doctor");
    };
  }, [navigate, toggleTheme, toggleDensity, openDoctor]);

  // Every command with an effective keybinding fires from anywhere.
  useCommandHotkeys();

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      writeSidebarCollapsed(!prev);
      return !prev;
    });
  }, []);

  // --- keep-alive view outlet ----------------------------------------------
  // Active view is always mounted; keepAlive views stay mounted (display:none)
  // once visited so drafts/scrollback survive view switches.
  const [mounted, setMounted] = useState<ViewId[]>([view]);
  useEffect(() => {
    setMounted((prev) => (prev.includes(view) ? prev : [...prev, view]));
  }, [view]);
  const renderedViews = mounted.filter((id) => id === view || VIEW_REGISTRY[id].keepAlive);

  return (
    <PeekProvider>
      <ViewActionsProvider>
        <div className={collapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
          <Sidebar
            activeView={view}
            collapsed={collapsed}
            onNavigate={navigate}
            onToggleCollapsed={toggleCollapsed}
          />
          <div className="workspace">
            <Topbar activeView={view} />
            {realtimeError && daemonReady && (
              <div className="banner warning" role="status">
                {realtimeError}
              </div>
            )}
            <main className="view-outlet-host">
              {renderedViews.map((id) => {
                const def = VIEW_REGISTRY[id];
                const ViewComponent = def.Component;
                const active = id === view;
                return (
                  <div
                    key={id}
                    className="view-frame"
                    style={active ? undefined : { display: "none" }}
                    aria-hidden={active ? undefined : true}
                    // inert prevents hidden keep-alive views from trapping focus
                    inert={active ? undefined : true}
                  >
                    <Suspense fallback={<SkeletonBlock height={240} />}>
                      <ViewComponent />
                    </Suspense>
                  </div>
                );
              })}
            </main>
            <StatusStrip onNavigate={navigate} onOpenDoctor={openDoctor} />
          </div>
        </div>

        {onboardingMode !== null && (
          <OnboardingOverlay
            mode={onboardingMode}
            onClose={closeOnboarding}
            onStartChat={() => navigate("chat")}
          />
        )}

        {/* The Doctor overlay supersedes the gate while open — it renders the
            same daemon failure with retry + fix guidance; the gate returns the
            moment the doctor closes if the daemon is still down. The workspace
            stays mounted under both. */}
        {gated && onboardingMode === null && (
          <DaemonGate health={health.data} appUnreachable={health.isError} onOpenDoctor={openDoctor} />
        )}

        {/* Global approvals toast bridge + palette commands (renders nothing). */}
        <ApprovalsNotifier enabled={daemonReady} />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <ShortcutCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
        <ToastViewport />
        <AnnouncerRegion />
      </ViewActionsProvider>
    </PeekProvider>
  );
}
