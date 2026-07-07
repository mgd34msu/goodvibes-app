import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

// Remove the index.html boot splash once the app is presentable (called after
// the health probe so the Bun-side page-zoom has settled; falls back on a
// timer so a failed probe can never leave the splash stuck).
let splashDismissed = false;
function dismissBootSplash(): void {
  if (splashDismissed) return;
  splashDismissed = true;
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  splash.style.opacity = "0";
  window.setTimeout(() => splash.remove(), 200);
}
window.setTimeout(dismissBootSplash, 4000);

createRoot(rootEl).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);

// Boot-time /app/health probe: display-scale compensation + dev-only E2E driver.
void (async () => {
  try {
    const { appJson } = await import("./lib/http.ts");
    const health = await appJson<{ devDriver?: boolean; display?: { gdkScale: number } }>(
      "/app/health",
    );

    // Display scale is handled at launch (GDK_SCALE stripped from the app
    // process env, Linux-only) — no in-page scaling: CSS zoom blurred text and
    // desynced native controls, and transform-scaling broke vh units + resize.
    // health.display.gdkScale stays for observability.

    dismissBootSplash();

    if (health.devDriver === true) {
      const { startDevDriver } = await import("./lib/dev-driver.ts");
      startDevDriver();
    }
  } catch {
    // health unavailable at boot — compensation and driver are niceties, never fatal
  }
})();
