// Watcher create/edit form. Field set mirrors what the daemon's POST/PATCH
// /api/watchers handlers actually read from the body (verified in
// goodvibes-sdk system-routes.ts): label (required), kind, intervalMs, and
// the optional source hints url / method / path / endpoint / address /
// headers / metadata — every one tolerated as absent, so the form only sends
// what the user filled in. All watcher mutations are admin-scoped.

import { useId, useMemo, useState, type FormEvent } from "react";
import { WATCHER_KINDS, type WatcherRow } from "./watchers-model.ts";

export interface WatcherBody {
  label: string;
  kind: string;
  intervalMs?: number;
  url?: string;
  method?: string;
  path?: string;
  endpoint?: string;
  address?: string;
  headers?: unknown;
  metadata?: unknown;
  enabled?: boolean;
}

const KIND_HINTS: Record<string, string> = {
  polling: "Checks a target on a fixed interval.",
  webhook: "Receives pushes on the daemon's listener port — url/path describe the source.",
  filesystem: "Watches a path for changes.",
  socket: "Listens on a socket address.",
  integration: "Bridges an external integration endpoint.",
};

function readMetaString(row: WatcherRow | null, key: string): string {
  const value = row?.metadata[key];
  return typeof value === "string" ? value : "";
}

export function WatcherForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  /** null → create; a row → edit (fields prefilled from the live record). */
  initial: WatcherRow | null;
  submitting: boolean;
  onSubmit: (body: WatcherBody) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [kind, setKind] = useState(initial?.kind && (WATCHER_KINDS as readonly string[]).includes(initial.kind) ? initial.kind : "polling");
  const [intervalSeconds, setIntervalSeconds] = useState(
    initial?.intervalMs !== undefined ? String(initial.intervalMs / 1_000) : "",
  );
  const [url, setUrl] = useState(readMetaString(initial, "url"));
  const [method, setMethod] = useState(readMetaString(initial, "method"));
  const [path, setPath] = useState(readMetaString(initial, "path"));
  const [endpoint, setEndpoint] = useState(readMetaString(initial, "endpoint"));
  const [address, setAddress] = useState(readMetaString(initial, "address"));
  const [headersJson, setHeadersJson] = useState(() => {
    const headers = initial?.metadata["headers"];
    return headers && typeof headers === "object" ? JSON.stringify(headers, null, 2) : "";
  });
  const [metadataJson, setMetadataJson] = useState("");
  const [enabled, setEnabled] = useState(initial ? initial.sourceEnabled : true);

  const parsed = useMemo(() => {
    const problems: string[] = [];
    let headers: unknown;
    let metadata: unknown;
    if (headersJson.trim()) {
      try {
        headers = JSON.parse(headersJson);
      } catch {
        problems.push("Headers must be valid JSON (or empty).");
      }
    }
    if (metadataJson.trim()) {
      try {
        metadata = JSON.parse(metadataJson);
      } catch {
        problems.push("Metadata must be valid JSON (or empty).");
      }
    }
    let intervalMs: number | undefined;
    if (intervalSeconds.trim()) {
      const seconds = Number.parseFloat(intervalSeconds);
      if (!(seconds > 0)) problems.push("Interval must be a positive number of seconds.");
      else intervalMs = Math.round(seconds * 1_000);
    }
    return { problems, headers, metadata, intervalMs };
  }, [headersJson, metadataJson, intervalSeconds]);

  const canSubmit = label.trim().length > 0 && parsed.problems.length === 0 && !submitting;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    const body: WatcherBody = {
      label: label.trim(),
      kind,
      ...(parsed.intervalMs !== undefined ? { intervalMs: parsed.intervalMs } : {}),
      ...(url.trim() ? { url: url.trim() } : {}),
      ...(method.trim() ? { method: method.trim() } : {}),
      ...(path.trim() ? { path: path.trim() } : {}),
      ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
      ...(parsed.headers !== undefined ? { headers: parsed.headers } : {}),
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      ...(initial ? { enabled } : {}),
    };
    onSubmit(body);
  }

  return (
    <form className="watcher-form" onSubmit={handleSubmit}>
      <label className="watcher-form__field" htmlFor={`${uid}-label`}>
        <span>Label (required)</span>
        <input
          id={`${uid}-label`}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Deploy webhook"
          autoComplete="off"
        />
      </label>

      <label className="watcher-form__field" htmlFor={`${uid}-kind`}>
        <span>Kind</span>
        <select id={`${uid}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
          {WATCHER_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <p className="watcher-form__hint">{KIND_HINTS[kind] ?? ""}</p>

      <label className="watcher-form__field" htmlFor={`${uid}-interval`}>
        <span>Poll interval in seconds (optional — daemon default when empty)</span>
        <input
          id={`${uid}-interval`}
          type="number"
          min={1}
          step="any"
          value={intervalSeconds}
          onChange={(e) => setIntervalSeconds(e.target.value)}
        />
      </label>

      <div className="watcher-form__source">
        <p className="watcher-form__source-title">Source hints (all optional — stored on the watcher&apos;s source metadata)</p>
        <div className="watcher-form__grid">
          <label className="watcher-form__field" htmlFor={`${uid}-url`}>
            <span>URL</span>
            <input id={`${uid}-url`} type="text" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
          </label>
          <label className="watcher-form__field" htmlFor={`${uid}-method`}>
            <span>HTTP method</span>
            <input
              id={`${uid}-method`}
              type="text"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="GET"
              spellCheck={false}
            />
          </label>
          <label className="watcher-form__field" htmlFor={`${uid}-path`}>
            <span>Path</span>
            <input id={`${uid}-path`} type="text" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
          </label>
          <label className="watcher-form__field" htmlFor={`${uid}-endpoint`}>
            <span>Endpoint</span>
            <input
              id={`${uid}-endpoint`}
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="watcher-form__field" htmlFor={`${uid}-address`}>
            <span>Address</span>
            <input
              id={`${uid}-address`}
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
        <label className="watcher-form__field" htmlFor={`${uid}-headers`}>
          <span>Headers JSON (optional — values are masked in the detail view)</span>
          <textarea
            id={`${uid}-headers`}
            rows={3}
            value={headersJson}
            onChange={(e) => setHeadersJson(e.target.value)}
            spellCheck={false}
            placeholder='{"x-api-key":"…"}'
            className="watcher-form__mono"
          />
        </label>
        <label className="watcher-form__field" htmlFor={`${uid}-metadata`}>
          <span>Extra metadata JSON (optional)</span>
          <textarea
            id={`${uid}-metadata`}
            rows={3}
            value={metadataJson}
            onChange={(e) => setMetadataJson(e.target.value)}
            spellCheck={false}
            className="watcher-form__mono"
          />
        </label>
      </div>

      {initial && (
        <label className="watcher-form__enabled">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Source enabled</span>
        </label>
      )}

      {parsed.problems.map((problem) => (
        <p key={problem} className="watcher-form__problem" role="alert">
          {problem}
        </p>
      ))}

      <div className="watcher-form__actions">
        <button type="button" className="watcher-form__cancel" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="watcher-form__submit" disabled={!canSubmit}>
          {submitting ? "Saving…" : initial ? "Save changes" : "Create watcher"}
        </button>
      </div>
    </form>
  );
}
