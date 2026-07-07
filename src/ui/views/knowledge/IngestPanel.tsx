// Ingest tab (docs/FEATURES.md §6): single URL, URL batch file, artifact,
// bookmark export file, browser history, and connector-driven imports, plus
// the connectors browser (list / detail / doctor). File-based ingest methods
// (urls/bookmarks) take a DAEMON-side filesystem path on the wire — the form
// says so explicitly instead of pretending to upload. All ingest verbs are
// admin-access on the daemon; failures surface verbatim.

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as LinkIcon, Plug, Stethoscope } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { asRecord, firstArray, firstNumber, firstString } from "../../lib/wire.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState } from "../../components/feedback.tsx";
import { DataBlock, QueryStates } from "./KnowledgeBits.tsx";
import { KnowledgeItemPeekBody } from "./ItemPeek.tsx";
import { KNOWLEDGE_PREFIX, kKeys, knowledgeId, knowledgeList, knowledgeTitle, splitCsv } from "./lib.ts";

const SOURCE_TYPES = ["url", "bookmark", "manual", "document", "repo", "dataset", "image", "other"] as const;

function BatchResult({ value }: { value: unknown }) {
  if (value === undefined || value === null) return null;
  const imported = firstNumber(value, ["imported"]);
  const failed = firstNumber(value, ["failed"]);
  const errors = firstArray(value, ["errors"]);
  return (
    <div className="knowledge-ingest__result" role="status">
      {(imported !== undefined || failed !== undefined) && (
        <p>
          Imported <strong>{imported ?? 0}</strong>
          {failed !== undefined && failed > 0 && (
            <>
              {" "}
              · <span className="knowledge-ingest__failed">{failed} failed</span>
            </>
          )}
        </p>
      )}
      {errors.length > 0 && <DataBlock title={`Errors (${errors.length})`} value={errors} open />}
      <DataBlock title="Raw result" value={value} />
    </div>
  );
}

function IngestForm({
  title,
  icon,
  submitLabel,
  pendingLabel,
  disabled,
  onSubmit,
  error,
  children,
  result,
}: {
  title: string;
  icon: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  disabled: boolean;
  onSubmit: () => void;
  error: unknown;
  children: ReactNode;
  result: ReactNode;
}) {
  return (
    <section className="knowledge-panel" aria-label={title}>
      <header className="knowledge-panel__head">
        <h3>{title}</h3>
        {icon}
      </header>
      <form
        className="knowledge-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
        <button type="submit" className="knowledge-button knowledge-button--primary" disabled={disabled}>
          {disabled && pendingLabel ? pendingLabel : submitLabel}
        </button>
      </form>
      {error !== null && error !== undefined && (
        <p className="knowledge-form__error" role="alert">
          {formatError(error)}
        </p>
      )}
      {result}
    </section>
  );
}

function UrlIngest() {
  const queryClient = useQueryClient();
  const peek = usePeek();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<string>("url");
  const [tags, setTags] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [allowPrivateHosts, setAllowPrivateHosts] = useState(false);

  const ingest = useMutation({
    mutationFn: () =>
      invoke("knowledge.ingest.url", {
        body: {
          url: url.trim(),
          sourceType,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(folderPath.trim() ? { folderPath: folderPath.trim() } : {}),
          ...(splitCsv(tags).length ? { tags: splitCsv(tags) } : {}),
          ...(allowPrivateHosts ? { allowPrivateHosts: true } : {}),
        },
      }),
    onSuccess: async (result) => {
      setUrl("");
      setTitle("");
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      toast({ title: "URL ingested", tone: "success" });
      const sourceId = firstString(asRecord(asRecord(result)["source"]), ["id"]);
      if (sourceId) {
        peek.open({ title: "Ingested source", content: <KnowledgeItemPeekBody itemId={sourceId} /> });
      }
    },
  });

  return (
    <IngestForm
      title="Ingest URL"
      icon={<LinkIcon size={16} aria-hidden="true" />}
      submitLabel="Ingest URL"
      pendingLabel="Ingesting…"
      disabled={ingest.isPending || !url.trim()}
      onSubmit={() => url.trim() && ingest.mutate()}
      error={ingest.error}
      result={<DataBlock title="Ingest result" value={ingest.data} />}
    >
      <label>
        URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
      </label>
      <label>
        Title (optional)
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Display title" />
      </label>
      <div className="knowledge-form__split">
        <label>
          Source type
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Folder (optional)
          <input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="folder/path" />
        </label>
      </div>
      <label>
        Tags (comma separated)
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tag-a, tag-b" />
      </label>
      <label className="knowledge-form__check">
        <input
          type="checkbox"
          checked={allowPrivateHosts}
          onChange={(e) => setAllowPrivateHosts(e.target.checked)}
        />
        Allow private hosts
      </label>
    </IngestForm>
  );
}

/** Shared shape for the three daemon-path batch ingests (urls / bookmarks). */
function PathIngest({
  title,
  methodId,
  pathLabel,
  description,
}: {
  title: string;
  methodId: "knowledge.ingest.urls" | "knowledge.ingest.bookmarks";
  pathLabel: string;
  description: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [path, setPath] = useState("");
  const [allowPrivateHosts, setAllowPrivateHosts] = useState(false);

  const ingest = useMutation({
    mutationFn: () =>
      invoke(methodId, {
        body: { path: path.trim(), ...(allowPrivateHosts ? { allowPrivateHosts: true } : {}) },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      toast({ title: `${title} finished`, tone: "success" });
    },
  });

  return (
    <IngestForm
      title={title}
      icon={<LinkIcon size={16} aria-hidden="true" />}
      submitLabel="Import"
      pendingLabel="Importing…"
      disabled={ingest.isPending || !path.trim()}
      onSubmit={() => path.trim() && ingest.mutate()}
      error={ingest.error}
      result={<BatchResult value={ingest.data} />}
    >
      <label>
        {pathLabel}
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/home/you/file" />
      </label>
      <p className="knowledge-form__hint">{description}</p>
      <label className="knowledge-form__check">
        <input
          type="checkbox"
          checked={allowPrivateHosts}
          onChange={(e) => setAllowPrivateHosts(e.target.checked)}
        />
        Allow private hosts
      </label>
    </IngestForm>
  );
}

function ArtifactIngest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [artifactId, setArtifactId] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");

  const ingest = useMutation({
    mutationFn: () =>
      invoke("knowledge.ingest.artifact", {
        body: {
          artifactId: artifactId.trim(),
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(splitCsv(tags).length ? { tags: splitCsv(tags) } : {}),
        },
      }),
    onSuccess: async () => {
      setArtifactId("");
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      toast({ title: "Artifact promoted to knowledge", tone: "success" });
    },
  });

  return (
    <IngestForm
      title="Promote artifact"
      icon={<LinkIcon size={16} aria-hidden="true" />}
      submitLabel="Ingest artifact"
      pendingLabel="Ingesting…"
      disabled={ingest.isPending || !artifactId.trim()}
      onSubmit={() => artifactId.trim() && ingest.mutate()}
      error={ingest.error}
      result={<DataBlock title="Ingest result" value={ingest.data} />}
    >
      <label>
        Artifact id
        <input value={artifactId} onChange={(e) => setArtifactId(e.target.value)} placeholder="artifact id" />
      </label>
      <label>
        Title (optional)
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Tags (comma separated)
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
    </IngestForm>
  );
}

function BrowserHistoryIngest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [daysBack, setDaysBack] = useState("7");
  const [limit, setLimit] = useState("200");
  const [browsers, setBrowsers] = useState("");

  const ingest = useMutation({
    mutationFn: () => {
      const days = Number(daysBack);
      const cap = Number(limit);
      return invoke("knowledge.ingest.browserHistory", {
        body: {
          ...(Number.isFinite(days) && days > 0 ? { sinceMs: Date.now() - days * 86_400_000 } : {}),
          ...(Number.isFinite(cap) && cap > 0 ? { limit: cap } : {}),
          ...(splitCsv(browsers).length ? { browsers: splitCsv(browsers) } : {}),
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      toast({ title: "Browser history import finished", tone: "success" });
    },
  });

  return (
    <IngestForm
      title="Import browser history"
      icon={<LinkIcon size={16} aria-hidden="true" />}
      submitLabel="Import history"
      pendingLabel="Importing…"
      disabled={ingest.isPending}
      onSubmit={() => ingest.mutate()}
      error={ingest.error}
      result={<BatchResult value={ingest.data} />}
    >
      <div className="knowledge-form__split">
        <label>
          Days back
          <input value={daysBack} onChange={(e) => setDaysBack(e.target.value)} inputMode="numeric" />
        </label>
        <label>
          Max entries
          <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" />
        </label>
      </div>
      <label>
        Browsers (comma separated, blank = auto-discover)
        <input value={browsers} onChange={(e) => setBrowsers(e.target.value)} placeholder="chrome, firefox" />
      </label>
      <p className="knowledge-form__hint">
        The daemon reads browser profiles on its own host machine and ingests visited URLs.
      </p>
    </IngestForm>
  );
}

function ConnectorsSection({ active }: { active: boolean }) {
  const queryClient = useQueryClient();
  const peek = usePeek();
  const { toast } = useToast();
  const [connectorId, setConnectorId] = useState("");
  const [input, setInput] = useState("");

  const connectors = useQuery({
    queryKey: kKeys.connectors,
    queryFn: () => invoke("knowledge.connectors.list"),
    // Connector registry has no wire event — slow poll while visible.
    refetchInterval: active ? 60_000 : false,
  });

  const runIngest = useMutation({
    mutationFn: (id: string) =>
      invoke("knowledge.ingest.connector", {
        body: { connectorId: id, ...(input.trim() ? { input: input.trim() } : {}) },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KNOWLEDGE_PREFIX });
      toast({ title: "Connector import finished", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Connector import failed", description: formatError(error), tone: "danger" });
    },
  });

  const openDoctor = (id: string, title: string) =>
    peek.open({ title: `Doctor — ${title}`, content: <ConnectorDoctorPeek connectorId={id} /> });

  const items = knowledgeList(connectors.data, "connectors");

  return (
    <section className="knowledge-panel" aria-label="Connectors">
      <header className="knowledge-panel__head">
        <h3>Connectors</h3>
        <Plug size={16} aria-hidden="true" />
      </header>
      <QueryStates
        query={connectors}
        capability="knowledge.connectors.list"
        unavailableDescription="ingest connectors cannot be listed."
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={<Plug size={24} aria-hidden="true" />}
            title="No connectors"
            description="No ingest connectors are registered on this daemon."
          />
        }
      >
        <label className="knowledge-form__inline">
          Connector input (optional)
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Query / path handed to the connector"
            aria-label="Connector input"
          />
        </label>
        <ul className="knowledge-connectors">
          {items.map((connector, index) => {
            const id = knowledgeId(connector) || firstString(connector, ["connectorId"]);
            const title = knowledgeTitle(connector, id || `Connector ${index + 1}`);
            const status = firstString(connector, ["status", "health"]);
            const busy = runIngest.isPending && connectorId === id;
            return (
              <li key={id || index} className="knowledge-connectors__row">
                <span className="knowledge-connectors__name">
                  <strong>{title}</strong>
                  {status && <StatusBadge value={status} />}
                </span>
                <span className="knowledge-connectors__actions">
                  <button
                    type="button"
                    className="knowledge-button"
                    disabled={!id}
                    onClick={() => id && openDoctor(id, title)}
                  >
                    <Stethoscope size={13} aria-hidden="true" /> Doctor
                  </button>
                  <button
                    type="button"
                    className="knowledge-button knowledge-button--primary"
                    disabled={!id || busy}
                    onClick={() => {
                      if (!id) return;
                      setConnectorId(id);
                      runIngest.mutate(id);
                    }}
                  >
                    {busy ? "Running…" : "Run import"}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        <BatchResult value={runIngest.data} />
      </QueryStates>
    </section>
  );
}

function ConnectorDoctorPeek({ connectorId }: { connectorId: string }) {
  const doctor = useQuery({
    queryKey: kKeys.connectorDoctor(connectorId),
    queryFn: () => invoke("knowledge.connector.doctor", { params: { id: connectorId } }),
  });
  const detail = useQuery({
    queryKey: [...kKeys.connectors, connectorId],
    queryFn: () => invoke("knowledge.connector.get", { params: { id: connectorId } }),
  });

  return (
    <div className="knowledge-peek-body">
      <QueryStates
        query={doctor}
        capability="knowledge.connector.doctor"
        unavailableDescription="connector health checks are not served."
        isEmpty={false}
        empty={null}
      >
        <DataBlock title="Doctor report" value={doctor.data} open />
      </QueryStates>
      {detail.isSuccess && <DataBlock title="Connector" value={detail.data} />}
    </div>
  );
}

export function IngestPanel({ active }: { active: boolean }) {
  return (
    <div className="knowledge-ingest">
      <div className="knowledge-ingest__grid">
        <UrlIngest />
        <ArtifactIngest />
        <PathIngest
          title="Import URL list"
          methodId="knowledge.ingest.urls"
          pathLabel="Path to URL list file (on the daemon host)"
          description="A text file of URLs, one per line, read from the daemon's filesystem."
        />
        <PathIngest
          title="Import bookmarks"
          methodId="knowledge.ingest.bookmarks"
          pathLabel="Path to bookmark export file (on the daemon host)"
          description="A browser bookmark export (HTML/JSON), read from the daemon's filesystem."
        />
        <BrowserHistoryIngest />
        <ConnectorsSection active={active} />
      </div>
    </div>
  );
}
