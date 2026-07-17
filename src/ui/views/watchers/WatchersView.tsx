// Watchers — daemon-side event sources (docs/FEATURES.md §5 "Watchers:
// list/create/update/delete/start/stop/run"). Master list + right detail
// column (fleet idiom), selection deep-linked as ?filter[watcher]=<id>.
//
// Listing is authenticated; every mutation is ADMIN-scoped on the wire — a
// 403 surfaces verbatim in a toast, and the toolbar carries the scope note.
// Delete is dangerous-flagged → ConfirmSurface forwarding confirm:true +
// explicitUserRequest. Secret-looking metadata (headers, tokens, keys) is
// masked by default with an explicit per-view reveal toggle.
//
// Realtime: no `watchers` domain exists on the invalidation stream
// (lib/realtime.ts DOMAIN_INVALIDATIONS) — the list polls at 15s while the
// view is mounted (keepAlive:false → unmounts when hidden).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Play, Plus, RefreshCw, Square, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { getCurrentUrlState, replaceState } from "../../lib/router.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { compactJson } from "../../lib/wire.ts";
import { formatAbsolute, formatRelative, humanizeMs } from "../automation/automation-model.ts";
import {
  isSecretKey,
  maskValue,
  WATCHERS_POLL_MS,
  watchersFromResponse,
  watchersKeys,
  type WatcherRow,
} from "./watchers-model.ts";
import { WatcherForm, type WatcherBody } from "./WatcherForm.tsx";

/** Deep-linkable selection: ?view=watchers&filter[watcher]=<id>. */
function writeSelectionToUrl(watcherId: string): void {
  const current = getCurrentUrlState();
  if ((current.filters["watcher"] ?? "") === watcherId) return;
  const filters = { ...current.filters };
  if (watcherId) filters["watcher"] = watcherId;
  else delete filters["watcher"];
  replaceState({ ...current, filters });
}

type WatcherAction = "start" | "stop" | "run";

export function WatchersView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState(() => getCurrentUrlState().filters["watcher"] ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WatcherRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WatcherRow | null>(null);

  const list = useQuery({
    queryKey: watchersKeys.list,
    // No watchers domain on the invalidation stream — poll while visible.
    queryFn: () => gv.invoke("watchers.list"),
    refetchInterval: WATCHERS_POLL_MS,
  });
  const rows = useMemo(() => watchersFromResponse(list.data), [list.data]);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: watchersKeys.all });

  const selectWatcher = (id: string) => {
    setSelectedId(id);
    writeSelectionToUrl(id);
  };

  const create = useMutation({
    mutationFn: (body: WatcherBody) => gv.invoke("watchers.create", { body }),
    onSuccess: async () => {
      setCreateOpen(false);
      await invalidate();
      toast({ title: "Watcher created", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Failed to create watcher (admin scope required)", description: formatError(error), tone: "danger" });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: WatcherBody }) =>
      gv.invoke("watchers.update", { params: { watcherId: id }, body }),
    onSuccess: async () => {
      setEditTarget(null);
      await invalidate();
      toast({ title: "Watcher updated", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Failed to update watcher (admin scope required)", description: formatError(error), tone: "danger" });
    },
  });

  const action = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: WatcherAction }) =>
      gv.invoke(`watchers.${verb}`, { params: { watcherId: id } }),
    onSuccess: async (_result, variables) => {
      await invalidate();
      toast({
        title: variables.verb === "start" ? "Watcher started" : variables.verb === "stop" ? "Watcher stopped" : "Watcher run triggered",
        tone: variables.verb === "stop" ? "info" : "success",
      });
    },
    onError: (error: unknown, variables) => {
      toast({
        title: `Failed to ${variables.verb} watcher (admin scope required)`,
        description: formatError(error),
        tone: "danger",
      });
    },
  });

  const remove = useMutation({
    // Dangerous-flagged route: forward the ConfirmSurface metadata on the wire.
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      gv.invoke("watchers.delete", { params: { watcherId: id }, body: meta }),
    onSuccess: async (_result, variables) => {
      setDeleteTarget(null);
      if (selectedId === variables.id) selectWatcher("");
      await invalidate();
      toast({ title: "Watcher deleted", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Failed to delete watcher (admin scope required)", description: formatError(error), tone: "danger" });
    },
  });

  // Palette commands — view-scoped, live only while the view is mounted.
  useEffect(() => {
    registerCommand({
      id: "watchers.refresh",
      title: "Refresh Watchers",
      group: "automate",
      keywords: ["watchers", "reload", "sources"],
      run: () => void queryClient.invalidateQueries({ queryKey: watchersKeys.all }),
    });
    registerCommand({
      id: "watchers.new",
      title: "New Watcher",
      group: "automate",
      keywords: ["watchers", "create", "webhook", "polling", "source"],
      run: () => setCreateOpen(true),
    });
    return () => {
      unregisterCommand("watchers.refresh");
      unregisterCommand("watchers.new");
    };
  }, [queryClient]);

  const unavailable = list.isError && isMethodUnavailableError(list.error);
  const runningCount = rows.filter((row) => row.state === "running").length;

  const actionPendingFor = (id: string, verb: WatcherAction) =>
    action.isPending && action.variables?.id === id && action.variables.verb === verb;

  return (
    <div className="watchers-view">
      <div className="watchers-toolbar">
        <span className="watchers-toolbar__summary">
          <Eye size={14} aria-hidden="true" /> Watchers
          {list.isSuccess ? ` · ${rows.length} registered · ${runningCount} running` : ""}
        </span>
        <span className="watchers-toolbar__actions">
          <span className="watchers-scope-note">mutations require admin scope</span>
          <button type="button" className="watchers-btn watchers-btn--primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} aria-hidden="true" /> New watcher
          </button>
          <button
            type="button"
            className="watchers-toolbar__refresh"
            aria-label="Refresh watchers"
            onClick={() => void list.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
        </span>
      </div>

      {list.isPending && <SkeletonBlock variant="text" lines={5} />}

      {unavailable && (
        <UnavailableState
          capability="watchers.list"
          description="daemon event sources (webhook/email/filesystem triggers) cannot be listed or managed."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load watchers" />
      )}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<Eye size={28} aria-hidden="true" />}
          title="No watchers registered"
          description="Watchers feed automations from webhooks, polls, filesystem changes, sockets, and integrations."
          action={{ label: "New watcher", onClick: () => setCreateOpen(true) }}
        />
      )}

      {list.isSuccess && rows.length > 0 && (
        <div className="watchers-layout">
          <ul className="watcher-rows" aria-label="Registered watchers">
            {rows.map((row) => (
              <li key={row.id || row.label}>
                <button
                  type="button"
                  className={
                    selectedId === row.id ? "watcher-row watcher-row--selected" : "watcher-row"
                  }
                  onClick={() => selectWatcher(row.id)}
                  aria-pressed={selectedId === row.id}
                >
                  <span className="watcher-row__label" title={row.label}>{row.label}</span>
                  <span className="badge neutral">{row.kind}</span>
                  <StatusBadge value={row.state} />
                  {row.intervalMs !== undefined && (
                    <span className="watcher-row__interval">every {humanizeMs(row.intervalMs)}</span>
                  )}
                  {row.lastHeartbeatAt !== undefined && (
                    <span className="watcher-row__beat" title={formatAbsolute(row.lastHeartbeatAt)}>
                      beat {formatRelative(row.lastHeartbeatAt)}
                    </span>
                  )}
                  {row.lastError && (
                    <span className="watcher-row__error" title={row.lastError}>
                      {row.lastError}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <aside className="watcher-detail" aria-label="Watcher detail">
            {selected ? (
              <WatcherDetail
                row={selected}
                onStart={() => action.mutate({ id: selected.id, verb: "start" })}
                onStop={() => action.mutate({ id: selected.id, verb: "stop" })}
                onRun={() => action.mutate({ id: selected.id, verb: "run" })}
                onEdit={() => setEditTarget(selected)}
                onDelete={() => setDeleteTarget(selected)}
                starting={actionPendingFor(selected.id, "start")}
                stopping={actionPendingFor(selected.id, "stop")}
                running={actionPendingFor(selected.id, "run")}
              />
            ) : (
              <p className="watcher-detail__placeholder" role="note">
                Select a watcher to inspect its source, interval, heartbeat, and metadata.
              </p>
            )}
          </aside>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New watcher" size="lg">
        <WatcherForm
          initial={null}
          submitting={create.isPending}
          onSubmit={(body) => create.mutate(body)}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      <Modal open={editTarget !== null} onClose={() => setEditTarget(null)} title="Edit watcher" size="lg">
        {editTarget && (
          <WatcherForm
            key={editTarget.id}
            initial={editTarget}
            submitting={update.isPending}
            onSubmit={(body) => update.mutate({ id: editTarget.id, body })}
            onCancel={() => setEditTarget(null)}
          />
        )}
      </Modal>

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete watcher"
        target={deleteTarget ? `${deleteTarget.label} (${deleteTarget.id})` : ""}
        blastRadius="The watcher and its source registration are removed permanently. Anything it triggers (automations, routes) stops receiving events from it."
        danger
        confirmLabel="Delete watcher"
        onConfirm={(meta) => {
          if (deleteTarget) remove.mutate({ id: deleteTarget.id, meta });
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── Detail column ───────────────────────────────────────────────────────────

function WatcherDetail({
  row,
  onStart,
  onStop,
  onRun,
  onEdit,
  onDelete,
  starting,
  stopping,
  running,
}: {
  row: WatcherRow;
  onStart: () => void;
  onStop: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  starting: boolean;
  stopping: boolean;
  running: boolean;
}) {
  const [revealSecrets, setRevealSecrets] = useState(false);
  const metadataEntries = Object.entries(row.metadata).filter(([key]) => key !== "headers");
  const headers = row.metadata["headers"];
  const headerEntries =
    headers && typeof headers === "object" && !Array.isArray(headers)
      ? Object.entries(headers as Record<string, unknown>)
      : [];
  const hasSecrets = headerEntries.length > 0 || metadataEntries.some(([key]) => isSecretKey(key));

  return (
    <div className="watcher-detail__body">
      <div className="watcher-detail__head">
        <h3 className="watcher-detail__title">{row.label}</h3>
        <StatusBadge value={row.state} />
      </div>

      <div className="watcher-detail__actions">
        <button type="button" className="watchers-btn" disabled={starting} onClick={onStart}>
          <Play size={13} aria-hidden="true" /> {starting ? "Starting…" : "Start"}
        </button>
        <button type="button" className="watchers-btn" disabled={stopping} onClick={onStop}>
          <Square size={13} aria-hidden="true" /> {stopping ? "Stopping…" : "Stop"}
        </button>
        <button type="button" className="watchers-btn" disabled={running} onClick={onRun}>
          <Play size={13} aria-hidden="true" /> {running ? "Triggering…" : "Run once"}
        </button>
        <button type="button" className="watchers-btn" onClick={onEdit}>
          <Pencil size={13} aria-hidden="true" /> Edit
        </button>
        <button type="button" className="watchers-btn watchers-btn--danger" onClick={onDelete}>
          <Trash2 size={13} aria-hidden="true" /> Delete
        </button>
      </div>

      <dl className="watcher-detail__facts">
        <dt>Kind</dt>
        <dd>{row.kind}</dd>
        <dt>Source</dt>
        <dd>
          {row.sourceKind || "—"} · {row.sourceEnabled ? "enabled" : "disabled"}
        </dd>
        {row.intervalMs !== undefined && (
          <>
            <dt>Interval</dt>
            <dd>every {humanizeMs(row.intervalMs)}</dd>
          </>
        )}
        {row.lastHeartbeatAt !== undefined && (
          <>
            <dt>Last heartbeat</dt>
            <dd>
              {formatRelative(row.lastHeartbeatAt)} · {formatAbsolute(row.lastHeartbeatAt)}
            </dd>
          </>
        )}
        {row.sourceStatus && (
          <>
            <dt>Source status</dt>
            <dd>
              <StatusBadge value={row.sourceStatus} />
            </dd>
          </>
        )}
        {row.degradedReason && (
          <>
            <dt>Degraded</dt>
            <dd className="watcher-detail__error">{row.degradedReason}</dd>
          </>
        )}
        {row.lastError && (
          <>
            <dt>Last error</dt>
            <dd className="watcher-detail__error">{row.lastError}</dd>
          </>
        )}
        {row.lastCheckpoint && (
          <>
            <dt>Checkpoint</dt>
            <dd>
              <code>{row.lastCheckpoint}</code>
            </dd>
          </>
        )}
      </dl>

      {(metadataEntries.length > 0 || headerEntries.length > 0) && (
        <div className="watcher-detail__meta">
          <div className="watcher-detail__meta-head">
            <span>Metadata</span>
            {hasSecrets && (
              <button
                type="button"
                className="watchers-btn"
                aria-pressed={revealSecrets}
                onClick={() => setRevealSecrets((v) => !v)}
              >
                {revealSecrets ? "Mask secrets" : "Reveal secrets"}
              </button>
            )}
          </div>
          <dl className="watcher-detail__facts">
            {metadataEntries.map(([key, value]) => (
              <MetaRow key={key} name={key} value={value} reveal={revealSecrets} />
            ))}
            {headerEntries.map(([key, value]) => (
              <MetaRow key={`header:${key}`} name={`header ${key}`} value={value} reveal={revealSecrets} secret />
            ))}
          </dl>
        </div>
      )}

      <details className="watcher-detail__raw">
        <summary>Raw record (secret-looking values stay masked until revealed)</summary>
        <pre>{revealSecrets ? compactJson(row.raw) : compactJson(maskRawSecrets(row.raw))}</pre>
      </details>
    </div>
  );
}

function MetaRow({ name, value, reveal, secret }: { name: string; value: unknown; reveal: boolean; secret?: boolean }) {
  const masked = (secret || isSecretKey(name)) && !reveal;
  const text = typeof value === "string" ? value : compactJson(value);
  return (
    <>
      <dt>{name}</dt>
      <dd>
        <code>{masked ? maskValue(value) : text}</code>
      </dd>
    </>
  );
}

/** Deep-mask secret-looking keys in the raw payload for the collapsed view. */
function maskRawSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskRawSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "headers" && item && typeof item === "object" && !Array.isArray(item)) {
        out[key] = Object.fromEntries(Object.keys(item as Record<string, unknown>).map((k) => [k, "••••"]));
      } else if (isSecretKey(key) && (typeof item === "string" || typeof item === "number")) {
        out[key] = maskValue(item);
      } else {
        out[key] = maskRawSecrets(item);
      }
    }
    return out;
  }
  return value;
}
