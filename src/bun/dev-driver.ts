// Dev-only webview driver: lets local tooling execute JS inside the webview
// and read the result — the app's built-in E2E harness.
// Enabled ONLY when GOODVIBES_APP_DEV=1 (scripts/launch.ts sets it for dev
// runs; release launches never do). Reachable only through the loopback UI
// server, and /app/* is x-gv-app header-gated like everything else.
//
// Flow: POST /app/dev/eval {js} → command is pushed to the webview over the
// /app/dev/commands SSE stream → the UI's dev module evals (awaiting promises)
// and POSTs /app/dev/result → the original eval request resolves.

export interface DevEvalResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface Pending {
  resolve: (r: DevEvalResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface DevDriver {
  enabled: true;
  handle: (req: Request, url: URL) => Promise<Response> | Response;
}

const EVAL_TIMEOUT_MS = 30_000;

export function createDevDriver(): DevDriver {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();

  function push(id: number, js: string): void {
    const frame = `event: eval\ndata: ${JSON.stringify({ id, js })}\n\n`;
    const bytes = encoder.encode(frame);
    for (const sub of subscribers) {
      try {
        sub.enqueue(bytes);
      } catch {
        subscribers.delete(sub);
      }
    }
  }

  async function handle(req: Request, url: URL): Promise<Response> {
    const { pathname } = url;

    if (pathname === "/app/dev/commands") {
      let ctrl: ReadableStreamDefaultController<Uint8Array>;
      const keepalive: { timer?: ReturnType<typeof setInterval> } = {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          ctrl = controller;
          subscribers.add(controller);
          controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));
          keepalive.timer = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(":hb\n\n"));
            } catch {
              if (keepalive.timer) clearInterval(keepalive.timer);
            }
          }, 8_000);
        },
        cancel() {
          if (keepalive.timer) clearInterval(keepalive.timer);
          subscribers.delete(ctrl);
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      });
    }

    if (pathname === "/app/dev/eval" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { js?: string; timeoutMs?: number } | null;
      const js = body?.js;
      if (!js) return Response.json({ ok: false, error: "missing js" }, { status: 400 });
      if (subscribers.size === 0) {
        return Response.json({ ok: false, error: "no webview connected to dev driver" }, { status: 503 });
      }
      const id = nextId++;
      const result = await new Promise<DevEvalResult>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: `eval timed out after ${body.timeoutMs ?? EVAL_TIMEOUT_MS}ms` });
        }, body.timeoutMs ?? EVAL_TIMEOUT_MS);
        pending.set(id, { resolve, timer });
        push(id, js);
      });
      return Response.json(result);
    }

    if (pathname === "/app/dev/result" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as
        | { id?: number; ok?: boolean; value?: unknown; error?: string }
        | null;
      if (!body || typeof body.id !== "number") return new Response("bad result", { status: 400 });
      const p = pending.get(body.id);
      if (p) {
        pending.delete(body.id);
        clearTimeout(p.timer);
        p.resolve({ ok: body.ok === true, value: body.value, error: body.error });
      }
      return Response.json({ received: true });
    }

    return new Response("Not found", { status: 404 });
  }

  return { enabled: true, handle };
}
