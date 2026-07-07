// Root component: theme → error boundary → toasts → shell. The window paints
// this immediately (docs/UX.md §6 — never serialize window creation behind
// network calls); data hydrates in via the boot snapshot and queries.

import type { ReactElement } from "react";
import { ThemeProvider } from "./lib/theme.ts";
import { ToastProvider } from "./lib/toast.ts";
import { useNotifyBridge } from "./lib/notify-bridge.ts";
import { ErrorBoundary } from "./components/feedback.tsx";
import { AppShell } from "./components/shell/AppShell.tsx";
import { QuickSwitcher } from "./components/QuickSwitcher.tsx";

export function App(): ReactElement {
  // Desktop-notification bridge: watches the shared query cache (no 2nd SSE) and
  // fires metadata-only native notifications when the window is backgrounded.
  useNotifyBridge();

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <ToastProvider>
          <AppShell />
          <QuickSwitcher />
        </ToastProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
