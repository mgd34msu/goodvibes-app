// Same-origin fetch wrapper. Every /api and /app request must carry the app
// header (the proxy rejects requests without it — src/bun/ui-server.ts).

import { APP_HEADER, APP_HEADER_VALUE } from "../../shared/app-contract.ts";

export async function appFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set(APP_HEADER, APP_HEADER_VALUE);
  return fetch(path, { ...init, headers });
}

export async function appJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await appFetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, path, body);
  }
  return (await res.json()) as T;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`HTTP ${status} for ${path}`);
    this.name = "HttpError";
  }
}
