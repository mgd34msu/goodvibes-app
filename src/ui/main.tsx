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

createRoot(rootEl).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);

// Dev-only E2E driver (never active in release — gated by /app/health).
void (async () => {
  try {
    const { appJson } = await import("./lib/http.ts");
    const health = await appJson<{ devDriver?: boolean }>("/app/health");
    if (health.devDriver === true) {
      const { startDevDriver } = await import("./lib/dev-driver.ts");
      startDevDriver();
    }
  } catch {
    // health unavailable at boot — the driver is a dev nicety, never fatal
  }
})();
