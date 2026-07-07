// Root component: theme → error boundary → toasts → shell. The window paints
// this immediately (docs/UX.md §6 — never serialize window creation behind
// network calls); data hydrates in via the boot snapshot and queries.

import type { ReactElement } from "react";
import { ThemeProvider } from "./lib/theme.ts";
import { ToastProvider } from "./lib/toast.ts";
import { ErrorBoundary } from "./components/feedback.tsx";
import { AppShell } from "./components/shell/AppShell.tsx";

export function App(): ReactElement {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
