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
