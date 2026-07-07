// Advanced "invoke on peer" console — remote.peers.invoke (docs/FEATURES.md
// §21 row 2, the advanced end of it). Free-form: pick a peer, name a command
// (the peer's own command vocabulary — this client has no way to validate it
// beyond what the peer's `commands` list advertises), give it a JSON payload,
// and see the queued work item come back. This is an operator escape hatch,
// not a friendly form — the daemon queues the work for the peer to pull and
// interpret; nothing here confirms the peer actually understood it.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Send, Terminal } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import {
  compactJson,
  formatRelative,
  parseParamsJson,
  peersFromResponse,
  peersKeys,
} from "./peers-model.ts";

interface InvokeHistoryEntry {
  id: string;
  peerId: string;
  command: string;
  status: string;
  workId: string;
  at: number;
  raw: unknown;
}

const PRIORITIES = ["default", "normal", "high"] as const;

export function InvokeConsole() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const peers = useQuery({
    queryKey: peersKeys.list,
    queryFn: () => gv.invoke("remote.peers.list"),
    select: peersFromResponse,
  });

  const [peerId, setPeerId] = useState("");
  const [command, setCommand] = useState("");
  const [paramsText, setParamsText] = useState("{}");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("default");
  const [waitMs, setWaitMs] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [history, setHistory] = useState<InvokeHistoryEntry[]>([]);

  const parsed = parseParamsJson(paramsText);
  const canSubmit = peerId.trim() !== "" && command.trim() !== "" && parsed.error === null;

  const invoke = useMutation({
    mutationFn: (meta: ConfirmMetadata) =>
      gv.invoke("remote.peers.invoke", {
        params: { peerId: peerId.trim() },
        body: {
          command: command.trim(),
          ...(parsed.value !== undefined ? { payload: parsed.value } : {}),
          priority,
          ...(waitMs.trim() ? { waitMs: Number(waitMs) } : {}),
          ...(timeoutMs.trim() ? { timeoutMs: Number(timeoutMs) } : {}),
          ...meta,
        },
      }),
    onSuccess: async (result) => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: peersKeys.work });
      const work = (result as { work?: Record<string, unknown> } | undefined)?.work ?? {};
      setHistory((current) => [
        {
          id: (work["id"] as string) || crypto.randomUUID(),
          peerId: peerId.trim(),
          command: command.trim(),
          status: (work["status"] as string) || "queued",
          workId: (work["id"] as string) || "",
          at: Date.now(),
          raw: result,
        },
        ...current,
      ].slice(0, 10));
      toast({ title: "Invoke queued", description: `${command.trim()} → ${peerId.trim()}`, tone: "success" });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Invoke failed (admin scope required)", description: formatError(error), tone: "danger" });
    },
  });

  const rows = peers.data ?? [];

  return (
    <section className="peers-section" aria-label="Invoke on peer console">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Terminal size={14} aria-hidden="true" /> Invoke on peer
        </span>
      </div>

      <p className="invoke-console__hint">
        <AlertTriangle size={13} aria-hidden="true" /> Advanced: queues a raw command + JSON payload for a peer to
        pull as work. The peer interprets <code>command</code> against its own vocabulary — this console does not
        validate it beyond checking the payload is valid JSON.
      </p>

      <form
        className="invoke-console__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) setConfirming(true);
        }}
      >
        <div className="invoke-console__grid">
          <label className="invoke-console__field">
            <span>Peer</span>
            {rows.length > 0 ? (
              <select value={peerId} onChange={(e) => setPeerId(e.target.value)}>
                <option value="">Select a peer…</option>
                {rows.map((peer) => (
                  <option key={peer.id} value={peer.id}>
                    {peer.label} ({peer.status})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="peer id"
                value={peerId}
                onChange={(e) => setPeerId(e.target.value)}
              />
            )}
          </label>

          <label className="invoke-console__field">
            <span>Command</span>
            <input
              type="text"
              placeholder="e.g. status.request"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </label>

          <label className="invoke-console__field">
            <span>Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className="invoke-console__field">
            <span>Wait (ms, optional)</span>
            <input type="number" min="0" value={waitMs} onChange={(e) => setWaitMs(e.target.value)} />
          </label>

          <label className="invoke-console__field">
            <span>Timeout (ms, optional)</span>
            <input type="number" min="0" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} />
          </label>
        </div>

        <label className="invoke-console__field invoke-console__field--wide">
          <span>Payload (JSON)</span>
          <textarea
            className="invoke-console__json"
            rows={6}
            spellCheck={false}
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            aria-label="Invoke payload JSON"
          />
        </label>
        {parsed.error && <p className="invoke-console__error">{parsed.error}</p>}

        <div className="invoke-console__actions">
          <button type="submit" className="peers-btn peers-btn--primary" disabled={!canSubmit || invoke.isPending}>
            <Send size={13} aria-hidden="true" /> {invoke.isPending ? "Invoking…" : "Invoke"}
          </button>
        </div>
      </form>

      {history.length > 0 && (
        <div className="invoke-console__history">
          <span className="peer-detail__tags-label">Recent invokes (this session)</span>
          <ul className="invoke-console__history-rows">
            {history.map((entry) => (
              <li key={entry.id} className="invoke-console__history-row">
                <span className="badge neutral">{entry.command}</span>
                <span className="invoke-console__history-meta">
                  → {entry.peerId} · {entry.status} · {formatRelative(entry.at)}
                </span>
                <details>
                  <summary>Result</summary>
                  <pre>{compactJson(entry.raw)}</pre>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmSurface
        open={confirming}
        action="Invoke on peer"
        target={`${command.trim()} → ${peerId.trim()}`}
        blastRadius="Queues this command and payload as work for the peer to pull next; the peer decides how (or whether) to act on it. There is no way to recall it once the peer claims it."
        confirmLabel={invoke.isPending ? "Invoking…" : "Invoke"}
        onConfirm={(meta) => invoke.mutate(meta)}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
