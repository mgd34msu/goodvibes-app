// Webview half of the dev-only driver (src/bun/dev-driver.ts). Activated by
// main.tsx ONLY when /app/health reports devDriver: true (never in release).
// Evals arrive over SSE, results return over POST. `js` runs in an async
// function scope — `return` a JSON-serializable value; promises are awaited.

import { appFetch } from "./http.ts";
import { openSse } from "./sse.ts";

export function startDevDriver(): void {
  openSse("/app/dev/commands", {
    onEvent: (event, data) => {
      if (event !== "eval") return;
      const { id, js } = (data ?? {}) as { id?: number; js?: string };
      if (typeof id !== "number" || typeof js !== "string") return;
      void runEval(id, js);
    },
  });
}

async function runEval(id: number, js: string): Promise<void> {
  let payload: { id: number; ok: boolean; value?: unknown; error?: string };
  try {
    // eslint-disable-next-line no-new-func -- dev-only harness, loopback-gated
    const fn = new Function(`return (async () => { ${js} })()`);
    const value: unknown = await fn();
    payload = { id, ok: true, value: sanitize(value) };
  } catch (err) {
    payload = { id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
  await appFetch("/app/dev/result", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

function sanitize(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return String(value);
  }
}
