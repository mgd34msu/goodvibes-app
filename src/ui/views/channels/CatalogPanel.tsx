// Catalog browsers (docs/FEATURES.md §13): channel actions (+ confirmed
// invoke), channel tools (+ invoke), agent tools (read-only), capability
// matrix (read-only), and the directory query. Invokes are admin methods on
// the daemon and confirm-gated here — the invoke modal collects an optional
// accountId and a JSON args object, then ConfirmSurface emits confirm +
// explicitUserRequest which are sent in the body (both methods take
// additionalProperties). Results render verbatim as JSON.

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Hammer, ListTree, Play, Search } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { asRecord, compactJson } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock } from "../../components/feedback.tsx";
import { channelsKeys } from "./keys.ts";
import { QueryPanel } from "./QueryPanel.tsx";
import {
  readActionRows,
  readAgentToolRows,
  readCapabilityRows,
  readDirectoryEntries,
  readStatusRows,
  readToolRows,
} from "./channels-wire.ts";

type CatalogSection = "actions" | "tools" | "agent-tools" | "capabilities" | "directory";

const SECTION_LABELS: Record<CatalogSection, string> = {
  actions: "Actions",
  tools: "Tools",
  "agent-tools": "Agent tools",
  capabilities: "Capabilities",
  directory: "Directory",
};

export function CatalogPanel() {
  const [section, setSection] = useState<CatalogSection>("actions");

  return (
    <div className="channels-catalog">
      <div className="channels-subtabs" role="tablist" aria-label="Catalog section">
        {(Object.keys(SECTION_LABELS) as CatalogSection[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            className={section === id ? "channels-subtab channels-subtab--active" : "channels-subtab"}
            onClick={() => setSection(id)}
          >
            {SECTION_LABELS[id]}
          </button>
        ))}
      </div>
      {section === "actions" && <ActionsSection />}
      {section === "tools" && <ToolsSection />}
      {section === "agent-tools" && <AgentToolsSection />}
      {section === "capabilities" && <CapabilitiesSection />}
      {section === "directory" && <DirectorySection />}
    </div>
  );
}

// ─── Shared invoke modal (actions + tools) ───────────────────────────────────

interface InvokeTarget {
  methodId: "channels.actions.invoke" | "channels.tools.invoke";
  /** Path params: surface + actionId | toolId. */
  surface: string;
  targetId: string;
  label: string;
  dangerous: boolean;
}

function InvokeModal({ target, onClose }: { target: InvokeTarget | null; onClose: () => void }) {
  const { toast } = useToast();
  const [accountId, setAccountId] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);

  const parsed = useMemo(() => {
    const trimmed = argsText.trim() || "{}";
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false as const, error: "Arguments must be a JSON object" };
      }
      return { ok: true as const, value: asRecord(value) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Invalid JSON" };
    }
  }, [argsText]);

  const run = useMutation({
    mutationFn: (meta: ConfirmMetadata) => {
      if (!target || !parsed.ok) throw new Error("Nothing to invoke");
      const paramKey = target.methodId === "channels.actions.invoke" ? "actionId" : "toolId";
      return invoke(target.methodId, {
        params: { surface: target.surface, [paramKey]: target.targetId },
        body: { ...parsed.value, ...(accountId ? { accountId } : {}), ...meta },
      });
    },
    onSuccess: (value) => {
      setConfirming(false);
      setResult(value);
      toast({ title: `${target?.label ?? "Invoke"} succeeded`, tone: "success" });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: `${target?.label ?? "Invoke"} failed`, description: formatError(error), tone: "danger" });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!parsed.ok || run.isPending) return;
    setConfirming(true);
  }

  // Keyed remount resets local state per target (see call sites).
  return (
    <>
      <Modal open={target !== null} onClose={onClose} title={`Invoke: ${target?.label ?? ""}`}>
        {target && (
          <form className="channels-invoke" onSubmit={handleSubmit}>
            <p className="channels-invoke__context">
              <code>{target.targetId}</code> on <code>{target.surface}</code>
              {target.dangerous && <span className="badge bad">dangerous</span>}
            </p>
            <label className="channels-field">
              <span>Account id (optional)</span>
              <input
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="default account"
                spellCheck={false}
              />
            </label>
            <label className="channels-field">
              <span>Arguments (JSON object)</span>
              <textarea
                rows={6}
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                spellCheck={false}
                className="channels-field__code"
              />
            </label>
            {!parsed.ok && <p className="channels-invoke__error">{parsed.error}</p>}
            {result !== undefined && (
              <div className="channels-invoke__result">
                <span className="channels-health__heading">Result</span>
                <pre>{compactJson(result)}</pre>
              </div>
            )}
            <div className="channels-invoke__actions">
              <button type="button" className="channels-btn" onClick={onClose}>
                Close
              </button>
              <button type="submit" className="channels-btn channels-btn--primary" disabled={!parsed.ok || run.isPending}>
                <Play size={13} aria-hidden="true" /> {run.isPending ? "Invoking…" : "Invoke…"}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <ConfirmSurface
        open={confirming && target !== null}
        action={`Invoke ${target?.label ?? ""}`}
        target={`${target?.targetId ?? ""} on ${target?.surface ?? ""}${accountId ? ` · ${accountId}` : ""}`}
        blastRadius={
          target?.dangerous
            ? "Marked dangerous by the daemon — this can send real messages or mutate the channel surface."
            : "Executes on the live channel surface — a send action reaches real recipients."
        }
        danger={target?.dangerous ?? false}
        confirmLabel="Invoke"
        onConfirm={(meta) => run.mutate(meta)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function ActionsSection() {
  const [target, setTarget] = useState<InvokeTarget | null>(null);
  const actions = useQuery({
    queryKey: channelsKeys.actions,
    queryFn: () => invoke("channels.actions.list"),
    select: readActionRows,
  });

  return (
    <>
      <QueryPanel
        query={actions}
        capability="channels.actions.list"
        unavailableDescription="channel actions cannot be browsed or invoked."
        errorTitle="Failed to load actions"
        isEmpty={(rows) => rows.length === 0}
        emptyIcon={<Hammer size={28} aria-hidden="true" />}
        emptyTitle="No channel actions"
        emptyDescription="Connected surfaces publish their send/manage actions here."
        skeletonLines={6}
      >
        {(rows) => (
          <ul className="channels-catalog__list" aria-label="Channel actions">
            {rows.map((row) => (
              <li key={`${row.surface}:${row.id}`} className="channels-catalog__row">
                <div className="channels-catalog__text">
                  <span className="channels-catalog__label">
                    {row.label}
                    <span className="badge neutral">{row.surface}</span>
                    {row.dangerous && <span className="badge bad">dangerous</span>}
                  </span>
                  {row.description && <span className="channels-catalog__desc">{row.description}</span>}
                  <code className="channels-catalog__id">{row.id}</code>
                </div>
                <button
                  type="button"
                  className="channels-btn"
                  onClick={() =>
                    setTarget({
                      methodId: "channels.actions.invoke",
                      surface: row.surface,
                      targetId: row.id,
                      label: row.label,
                      dangerous: row.dangerous,
                    })
                  }
                >
                  <Play size={13} aria-hidden="true" /> Invoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </QueryPanel>
      <InvokeModal
        key={target ? `${target.surface}:${target.targetId}` : "none"}
        target={target}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

// ─── Tools ───────────────────────────────────────────────────────────────────

function ToolsSection() {
  const [target, setTarget] = useState<InvokeTarget | null>(null);
  const tools = useQuery({
    queryKey: channelsKeys.tools,
    queryFn: () => invoke("channels.tools.list"),
    select: readToolRows,
  });

  return (
    <>
      <QueryPanel
        query={tools}
        capability="channels.tools.list"
        unavailableDescription="channel tools cannot be browsed or invoked."
        errorTitle="Failed to load tools"
        isEmpty={(rows) => rows.length === 0}
        emptyTitle="No channel tools"
        emptyDescription="Composite channel tools published by surfaces appear here."
        skeletonLines={6}
      >
        {(rows) => (
          <ul className="channels-catalog__list" aria-label="Channel tools">
            {rows.map((row) => (
              <li key={`${row.surface}:${row.id}`} className="channels-catalog__row">
                <div className="channels-catalog__text">
                  <span className="channels-catalog__label">
                    {row.name}
                    <span className="badge neutral">{row.surface}</span>
                  </span>
                  {row.description && <span className="channels-catalog__desc">{row.description}</span>}
                  {row.actionIds.length > 0 && (
                    <code className="channels-catalog__id">actions: {row.actionIds.join(", ")}</code>
                  )}
                </div>
                <button
                  type="button"
                  className="channels-btn"
                  onClick={() =>
                    setTarget({
                      methodId: "channels.tools.invoke",
                      surface: row.surface,
                      targetId: row.id,
                      label: row.name,
                      dangerous: false,
                    })
                  }
                >
                  <Play size={13} aria-hidden="true" /> Invoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </QueryPanel>
      <InvokeModal
        key={target ? `${target.surface}:${target.targetId}` : "none"}
        target={target}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

// ─── Agent tools (read-only) ─────────────────────────────────────────────────

function AgentToolsSection() {
  const agentTools = useQuery({
    queryKey: channelsKeys.agentTools,
    queryFn: () => invoke("channels.agent_tools.list"),
    select: readAgentToolRows,
  });

  return (
    <QueryPanel
      query={agentTools}
      capability="channels.agent_tools.list"
      unavailableDescription="the agent-facing channel toolset cannot be shown."
      errorTitle="Failed to load agent tools"
      isEmpty={(rows) => rows.length === 0}
      emptyTitle="No agent tools"
      emptyDescription="Channel tools exposed to agents appear here (read-only — agents invoke them, not this view)."
      skeletonLines={6}
    >
      {(rows) => (
        <ul className="channels-catalog__list" aria-label="Agent tools">
          {rows.map((row) => (
            <li key={row.name} className="channels-catalog__row">
              <div className="channels-catalog__text">
                <span className="channels-catalog__label">
                  <code>{row.name}</code>
                  {row.concurrency && <span className="badge neutral">{row.concurrency}</span>}
                  {row.supportsProgress && <span className="badge info">progress</span>}
                  {row.supportsStreamingOutput && <span className="badge info">streaming</span>}
                </span>
                {row.description && <span className="channels-catalog__desc">{row.description}</span>}
                {row.sideEffects.length > 0 && (
                  <code className="channels-catalog__id">side effects: {row.sideEffects.join(", ")}</code>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </QueryPanel>
  );
}

// ─── Capabilities (read-only matrix) ─────────────────────────────────────────

function CapabilitiesSection() {
  const capabilities = useQuery({
    queryKey: channelsKeys.capabilities,
    queryFn: () => invoke("channels.capabilities.list"),
    select: readCapabilityRows,
  });

  return (
    <QueryPanel
      query={capabilities}
      capability="channels.capabilities.list"
      unavailableDescription="the per-surface capability matrix cannot be shown."
      errorTitle="Failed to load capabilities"
      isEmpty={(rows) => rows.length === 0}
      emptyIcon={<ListTree size={28} aria-hidden="true" />}
      emptyTitle="No capabilities reported"
      emptyDescription="Surfaces declare what they support (reactions, threads, media, …) here."
      skeletonLines={6}
    >
      {(rows) => (
        <div className="channels-table-wrap">
          <table className="channels-table" aria-label="Channel capabilities">
            <thead>
              <tr>
                <th scope="col">Surface</th>
                <th scope="col">Capability</th>
                <th scope="col">Scope</th>
                <th scope="col">Supported</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.surface}:${row.id}`}>
                  <td>
                    <code>{row.surface}</code>
                  </td>
                  <td>{row.label}</td>
                  <td>{row.scope}</td>
                  <td>
                    <span className={row.supported ? "badge ok" : "badge neutral"}>
                      {row.supported ? "yes" : "no"}
                    </span>
                  </td>
                  <td className="channels-table__detail">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </QueryPanel>
  );
}

// ─── Directory query ─────────────────────────────────────────────────────────

function DirectorySection() {
  const [surface, setSurface] = useState("");
  const [text, setText] = useState("");
  const [live, setLive] = useState(false);
  const [submitted, setSubmitted] = useState<{ surface: string; q: string; live: boolean } | null>(null);

  // Surface options come from channels.status (same daemon vocabulary).
  const status = useQuery({
    queryKey: channelsKeys.status,
    queryFn: () => invoke("channels.status"),
    select: readStatusRows,
  });
  const surfaces = (status.data ?? []).map((row) => row.surface).filter(Boolean);

  const results = useQuery({
    queryKey: channelsKeys.directory(submitted?.surface ?? "", submitted?.q ?? "", submitted?.live ?? false),
    queryFn: () =>
      invoke("channels.directory.query", {
        params: { surface: submitted?.surface ?? "" },
        query: { q: submitted?.q || undefined, live: submitted?.live || undefined, limit: 50 },
      }),
    enabled: submitted !== null,
    select: readDirectoryEntries,
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!surface) return;
    setSubmitted({ surface, q: text.trim(), live });
  }

  return (
    <div className="channels-directory">
      <form className="channels-filter-row" onSubmit={handleSubmit}>
        <label className="channels-filter">
          <span>Surface</span>
          <select value={surface} onChange={(e) => setSurface(e.target.value)} required>
            <option value="">Pick a surface…</option>
            {surfaces.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="channels-filter channels-filter--grow">
          <span>Query</span>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="name, handle, channel…"
            spellCheck={false}
          />
        </label>
        <label className="channels-filter channels-filter--check">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          <span>Live lookup</span>
        </label>
        <button type="submit" className="channels-btn" disabled={!surface}>
          <Search size={13} aria-hidden="true" /> Query
        </button>
      </form>

      {submitted === null && (
        <EmptyState
          icon={<Search size={28} aria-hidden="true" />}
          title="Query a surface directory"
          description="Look up users, groups, and channels known to a connected surface."
        />
      )}
      {submitted !== null && results.isPending && <SkeletonBlock variant="text" lines={5} />}
      {submitted !== null && results.isError && (
        <ErrorState
          error={results.error}
          onRetry={() => void results.refetch()}
          title="Directory query failed"
        />
      )}
      {submitted !== null && results.isSuccess && results.data.length === 0 && (
        <EmptyState title="No directory entries" description={`Nothing matched on ${submitted.surface}.`} />
      )}
      {submitted !== null && results.isSuccess && results.data.length > 0 && (
        <ul className="channels-catalog__list" aria-label="Directory entries">
          {results.data.map((entry) => (
            <li key={entry.id} className="channels-catalog__row">
              <div className="channels-catalog__text">
                <span className="channels-catalog__label">
                  {entry.label}
                  <span className="badge neutral">{entry.kind}</span>
                  {entry.isDirect && <span className="badge info">direct</span>}
                  {entry.isGroupConversation && <span className="badge info">group</span>}
                </span>
                <span className="channels-catalog__desc">
                  {entry.handle && <code>{entry.handle}</code>}
                  {entry.memberCount !== undefined && <span> · {entry.memberCount} members</span>}
                </span>
                <code className="channels-catalog__id">{entry.id}</code>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
