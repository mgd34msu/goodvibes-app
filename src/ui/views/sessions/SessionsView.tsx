// SessionsView — the cross-surface session union (docs/FEATURES.md §2).
//
// Master/detail over sessions.list (GET /api/sessions → {totals, sessions}),
// the spine union over every surface kind, with honest badges: kind (verbatim
// for unknown kinds, never dropped), project ('unknown' for home-scoped
// surfaces), status (active / closed-as-history / reaped), and the
// retainedMessageCount truncation marker where the wire reports it.
//
// Freshness is the raw session-update SSE stream (AppShell mounts it; every
// frame invalidates the 'sessions' prefix) — never rendered from frames.
// Honest limits: GET /api/sessions ignores ?limit/?cursor and the daemon caps
// the union at 50 — the view says "50 most recent", never fakes completeness.
// Full-history search is sessions.search [ws]: it rides the /app/ws bridge and
// degrades honestly when the bridge is down.
// Ported from goodvibes-webui src/views/sessions/SessionsView.tsx.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Download, ListTodo, Plus, RefreshCw, Search, Stethoscope, Unlink } from "lucide-react";
import { gv, invoke } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import {
  formatError,
  isDaemonUnreachableError,
  isMethodUnavailableError,
  isSessionNotFoundError,
  isWsBridgeUnavailableError,
} from "../../lib/errors.ts";
import { compactJson, formatRelative } from "../../lib/wire.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { getCurrentUrlState, replaceState } from "../../lib/router.ts";
import { useSessionStreamPaused } from "../../lib/realtime.ts";
import { announce } from "../../lib/announcer.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  APP_SURFACE_ID,
  APP_SURFACE_KIND,
  SESSIONS_SNAPSHOT_CAP,
  type UnionSessionRecord,
  canSteer,
  isClosedStatus,
  isKnownKind,
  isPendingInputState,
  isReapedStatus,
  kindLabel,
  projectLabel,
  retentionLabel,
  searchSessionsFromResponse,
  sessionInputsFromResponse,
  sessionMessagesFromResponse,
  sortUnionSessions,
  statusLabel,
  unionSessionsFromListResponse,
  unionSessionsTotal,
} from "./sessions-union.ts";
import { SteerComposer } from "./SteerComposer.tsx";

const SEARCH_DEBOUNCE_MS = 300;

function KindBadge({ kind }: { kind: string }) {
  const known = isKnownKind(kind);
  return (
    <span
      className={`badge ${known ? "neutral" : "warning"}`}
      title={known ? undefined : "Kind not known to this client — shown verbatim"}
    >
      {kindLabel(kind)}
    </span>
  );
}

/** Reaped-as-reaped: an idle-reaped close is GC housekeeping (auto-reopens on
 * the next heartbeat), not a deliberate close — its own tone and wording. */
function SessionStatusBadge({ record }: { record: Pick<UnionSessionRecord, "status" | "closeReason"> }) {
  const reaped = isReapedStatus(record);
  const closed = isClosedStatus(record.status);
  const tone = reaped ? "info" : closed ? "neutral" : "ok";
  const label = reaped ? "reaped" : closed ? "closed · history" : statusLabel(record.status);
  return (
    <span
      className={`badge ${tone}`}
      title={reaped ? "Closed by the idle-session sweep — reopens automatically on the next activity" : undefined}
    >
      {label}
    </span>
  );
}

function SessionRow({
  record,
  active,
  onSelect,
}: {
  record: UnionSessionRecord;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const retention = retentionLabel(record);
  return (
    <li>
      <button
        type="button"
        className={`sessions-row${active ? " active" : ""}`}
        onClick={() => onSelect(record.id)}
      >
        <span className="sessions-row__title">{record.title}</span>
        <span className="sessions-row__badges">
          <KindBadge kind={record.kind} />
          <SessionStatusBadge record={record} />
          {retention && (
            <span className="badge warning" title="Older message bodies were dropped from retention">
              {retention}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** Diagnostics peek content — sessions.integration.snapshot rendered verbatim. */
function IntegrationSnapshotPeek() {
  const snapshot = useQuery({
    queryKey: queryKeys.sessionDetail("integration-snapshot"),
    queryFn: () => gv.sessions.integrationSnapshot(),
  });
  if (snapshot.isPending) return <SkeletonBlock variant="text" lines={6} />;
  if (snapshot.isError) {
    return <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} title="Snapshot failed" />;
  }
  return <pre className="sessions-diagnostics__raw">{compactJson(snapshot.data)}</pre>;
}

/** Persist master/detail selection into ?session= so deep links compose.
 * replaceState (not pushState) — selection is not a history-worthy step. */
function writeSelectionToUrl(sessionId: string): void {
  const current = getCurrentUrlState();
  if (current.session === sessionId) return;
  replaceState({ ...current, session: sessionId });
}

export function SessionsView() {
  const queryClient = useQueryClient();
  const peek = usePeek();
  const streamPaused = useSessionStreamPaused();
  const [selectedId, setSelectedId] = useState(() => getCurrentUrlState().session);
  const [kindFilter, setKindFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [includeClosed, setIncludeClosed] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchText.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const list = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => gv.sessions.list(),
  });

  const searching = searchQuery.length > 0;
  const search = useQuery({
    queryKey: queryKeys.sessionSearch(searchQuery, includeClosed),
    queryFn: () => gv.sessions.search({ query: searchQuery, includeClosed }),
    enabled: searching,
    retry: false,
  });

  // DELETE-MEANS-DELETE capability probe, honest quad-state: 'available' /
  // 'unavailable' (the daemon genuinely lacks the verb) / 'uncertain' (the
  // probe itself failed — never claim absence off a network blip) / 'checking'.
  const deleteCapability = useQuery({
    queryKey: ["capability", "sessions.delete"],
    queryFn: () => gv.probeMethod("sessions.delete"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const deleteCapabilityState: "available" | "unavailable" | "uncertain" | "checking" = deleteCapability.isSuccess
    ? deleteCapability.data
      ? "available"
      : "unavailable"
    : deleteCapability.isError
      ? "uncertain"
      : "checking";

  // Re-probe when the session-update stream recovers — the daemon is reachable
  // again (or was upgraded) at exactly that moment.
  const { refetch: refetchDeleteCapability } = deleteCapability;
  const prevPausedRef = useRef(streamPaused);
  useEffect(() => {
    if (prevPausedRef.current && !streamPaused) void refetchDeleteCapability();
    prevPausedRef.current = streamPaused;
  }, [streamPaused, refetchDeleteCapability]);

  const records = useMemo(() => sortUnionSessions(unionSessionsFromListResponse(list.data)), [list.data]);
  const total = useMemo(() => unionSessionsTotal(list.data), [list.data]);
  const searchPage = useMemo(() => searchSessionsFromResponse(search.data), [search.data]);
  const searchRecords = useMemo(() => sortUnionSessions(searchPage.records), [searchPage]);

  const kinds = useMemo(() => [...new Set(records.map((r) => r.kind).filter(Boolean))].sort(), [records]);
  const projects = useMemo(() => [...new Set(records.map((r) => r.project).filter(Boolean))].sort(), [records]);

  // When a search fails (bridge down / capability missing) the honest note
  // renders AND the HTTP-backed union list stays usable underneath.
  const searchUsable = searching && search.isSuccess;
  const filtered = useMemo(
    () =>
      (searchUsable ? searchRecords : records).filter((r) => {
        if (kindFilter && r.kind !== kindFilter) return false;
        if (projectFilter && r.project !== projectFilter) return false;
        if (!includeClosed && isClosedStatus(r.status)) return false;
        return true;
      }),
    [searchUsable, searchRecords, records, kindFilter, projectFilter, includeClosed],
  );

  // Group by project, preserving newest-first order within each group.
  const groups = useMemo(() => {
    const byProject = new Map<string, UnionSessionRecord[]>();
    for (const record of filtered) {
      const key = projectLabel(record.project);
      const bucket = byProject.get(key) ?? [];
      bucket.push(record);
      byProject.set(key, bucket);
    }
    return [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const selected = useMemo(
    () => [...records, ...searchRecords].find((r) => r.id === selectedId) ?? null,
    [records, searchRecords, selectedId],
  );

  const selectSession = (id: string) => {
    setSelectedId(id);
    writeSelectionToUrl(id);
  };

  // Palette commands — view-scoped, live only while the view is mounted.
  useEffect(() => {
    registerCommand({
      id: "sessions.refresh",
      title: "Refresh Sessions",
      group: "work",
      keywords: ["sessions", "reload", "union"],
      run: () => void queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
    });
    registerCommand({
      id: "sessions.new",
      title: "New Operator Session",
      group: "work",
      keywords: ["sessions", "create", "operator"],
      run: () => setCreateOpen(true),
    });
    return () => {
      unregisterCommand("sessions.refresh");
      unregisterCommand("sessions.new");
    };
  }, [queryClient]);

  const listUnavailable = list.isError && isMethodUnavailableError(list.error);
  const atCap = !searching && records.length >= SESSIONS_SNAPSHOT_CAP;

  let searchStateNode: ReactNode = null;
  if (searching) {
    if (search.isPending) {
      searchStateNode = <SkeletonBlock variant="text" lines={4} />;
    } else if (search.isError) {
      if (isWsBridgeUnavailableError(search.error)) {
        searchStateNode = (
          <div className="sessions-cap-note" role="status">
            Search runs over the live bridge (sessions.search is ws-only) and the bridge is down right now.
            The 50 most recent sessions below still load over HTTP.
            <button type="button" className="sessions-empty__clear" onClick={() => void search.refetch()}>
              Retry search
            </button>
          </div>
        );
      } else if (isMethodUnavailableError(search.error)) {
        searchStateNode = (
          <UnavailableState
            capability="sessions.search"
            description="this daemon cannot search the full session history; the 50 most recent sessions below still load"
          />
        );
      } else {
        searchStateNode = (
          <ErrorState error={search.error} onRetry={() => void search.refetch()} title="Search failed" />
        );
      }
    } else if (search.isSuccess && filtered.length === 0) {
      searchStateNode = <EmptyState title="No sessions match this search" description={`Query: “${searchQuery}”`} />;
    }
  }

  return (
    <div className={selected ? "sessions-view has-selection" : "sessions-view"}>
      <div className="sessions-list-pane">
        <div className="sessions-toolbar">
          <label className="sessions-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search all sessions…"
              aria-label="Search sessions"
            />
          </label>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Filter by kind">
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            aria-label="Filter by project"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <label className="sessions-toggle">
            <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
            Closed
          </label>
          <button
            className="sessions-icon-button"
            type="button"
            title="New operator session"
            aria-label="New operator session"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={15} />
          </button>
          <button
            className="sessions-icon-button"
            type="button"
            title="Session integration diagnostics"
            aria-label="Session integration diagnostics"
            onClick={() => peek.open({ title: "Session integration snapshot", content: <IntegrationSnapshotPeek /> })}
          >
            <Stethoscope size={15} />
          </button>
          <button
            className="sessions-icon-button"
            type="button"
            title="Refresh"
            aria-label="Refresh sessions"
            onClick={() => void list.refetch()}
          >
            <RefreshCw size={15} className={list.isFetching ? "spinning" : undefined} />
          </button>
        </div>

        {searchStateNode}

        {!searching && list.isPending && <SkeletonBlock variant="text" lines={6} />}

        {!searching && list.isError && listUnavailable && (
          <UnavailableState
            capability="sessions.list"
            description="the cross-surface session union cannot load from this daemon"
          />
        )}
        {!searching && list.isError && !listUnavailable && (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load sessions" />
        )}

        {atCap && (
          <div className="sessions-cap-note" role="note">
            Showing the {records.length} most recent
            {total !== null && total > records.length ? ` of ${total}` : ""} — the daemon caps this union at{" "}
            {SESSIONS_SNAPSHOT_CAP}. Use search above to reach the full history.
          </div>
        )}

        {!searching && list.isSuccess && records.length === 0 && (
          <EmptyState
            icon={<ListTodo size={28} />}
            title="No sessions in the union yet"
            description="Sessions from every surface — TUI, agent, webui, this app, automations — appear here as they run."
            action={{ label: "New operator session", onClick: () => setCreateOpen(true) }}
          />
        )}

        {!searching && list.isSuccess && records.length > 0 && filtered.length === 0 && (
          <div className="sessions-empty">
            No sessions match the current filters.
            <button
              type="button"
              className="sessions-empty__clear"
              onClick={() => {
                setKindFilter("");
                setProjectFilter("");
                setIncludeClosed(true);
              }}
            >
              Clear filters
            </button>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="sessions-groups">
            {searching && search.isSuccess && (
              <div className="sessions-cap-note" role="status">
                {filtered.length} search result{filtered.length === 1 ? "" : "s"}
                {searchPage.nextCursor ? " — more pages exist; refine the query to narrow further" : ""}
              </div>
            )}
            {groups.map(([project, bucket]) => (
              <section key={project} className="sessions-group">
                <div className="sessions-group__header">
                  <span className="badge neutral">{project}</span>
                  <small>{bucket.length}</small>
                </div>
                <ul className="sessions-rows">
                  {bucket.map((record) => (
                    <SessionRow
                      key={record.id}
                      record={record}
                      active={record.id === selectedId}
                      onSelect={selectSession}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="sessions-detail-pane">
        {selected ? (
          <SessionDetail
            record={selected}
            deleteCapabilityState={deleteCapabilityState}
            onRetryDeleteCapability={() => void refetchDeleteCapability()}
            streamPaused={streamPaused}
            onBack={() => selectSession("")}
          />
        ) : (
          <div className="sessions-detail-empty">Select a session to view and steer it.</div>
        )}
      </div>

      <CreateSessionModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          if (id) selectSession(id);
        }}
      />
    </div>
  );
}

function CreateSessionModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");

  const create = useMutation({
    mutationFn: (nextTitle: string) =>
      gv.sessions.create({
        title: nextTitle || undefined,
        surfaceKind: APP_SURFACE_KIND,
        surfaceId: APP_SURFACE_ID,
      }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      const created = unionSessionsFromListResponse({ sessions: [(data as { session?: unknown })?.session] });
      announce("Operator session created");
      setTitle("");
      onCreated(created[0]?.id ?? "");
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New operator session" size="md">
      <form
        className="sessions-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!create.isPending) create.mutate(title.trim());
        }}
      >
        <label className="sessions-create-form__field">
          <span>Title (optional)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is this session for?"
            autoComplete="off"
          />
        </label>
        {create.isError && <div className="banner warning" role="alert">{formatError(create.error)}</div>}
        <div className="sessions-create-form__actions">
          <button type="button" className="sessions-action" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sessions-action sessions-action--primary" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create session"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SessionDetail({
  record,
  deleteCapabilityState,
  onRetryDeleteCapability,
  streamPaused,
  onBack,
}: {
  record: UnionSessionRecord;
  deleteCapabilityState: "available" | "unavailable" | "uncertain" | "checking";
  onRetryDeleteCapability: () => void;
  streamPaused: boolean;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const messages = useQuery({
    queryKey: queryKeys.sessionMessages(record.id),
    queryFn: () => gv.sessions.messages(record.id),
    enabled: Boolean(record.id),
  });
  const inputs = useQuery({
    queryKey: queryKeys.sessionInputs(record.id),
    queryFn: () => gv.sessions.inputs.list(record.id),
    enabled: Boolean(record.id),
  });

  const items = useMemo(() => sessionMessagesFromResponse(messages.data), [messages.data]);
  const queuedInputs = useMemo(() => sessionInputsFromResponse(inputs.data), [inputs.data]);
  const pendingInputs = useMemo(() => queuedInputs.filter((i) => isPendingInputState(i.state)), [queuedInputs]);
  const retention = retentionLabel(record);
  const closed = isClosedStatus(record.status);

  const invalidateSessions = () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions });

  // Close/Reopen: distinct, reversible, history-preserving actions — both
  // idempotent on the daemon.
  const closeSession = useMutation({
    mutationFn: (sessionId: string) => gv.sessions.close(sessionId),
    onSuccess: invalidateSessions,
  });
  const reopenSession = useMutation({
    mutationFn: (sessionId: string) => gv.sessions.reopen(sessionId),
    onSuccess: invalidateSessions,
  });

  // Delete: PERMANENT, distinct from close. The verb requires close-first
  // (409 SESSION_ACTIVE otherwise) and its 200 is never trusted at face value:
  // reconcile against a fresh sessions.list and succeed only once the record
  // is genuinely absent (proof-of-gone, ported from webui).
  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      try {
        await gv.sessions.close(sessionId);
      } catch (error) {
        if (!isSessionNotFoundError(error)) throw error;
      }
      try {
        await gv.sessions.delete(sessionId);
      } catch (error) {
        if (!isSessionNotFoundError(error)) throw error;
      }
      const reconciled = await gv.sessions.list();
      const stillPresent = unionSessionsFromListResponse(reconciled).some((r) => r.id === sessionId);
      if (stillPresent) {
        throw Object.assign(new Error("Delete did not complete — the record still exists"), {
          code: "DELETE_INCOMPLETE",
        });
      }
    },
    onSuccess: async () => {
      await invalidateSessions();
      toast({ title: "Session deleted", tone: "info" });
      onBack();
    },
  });

  // Detach: remove THIS APP's participant entry — never closes, never kills,
  // other attached surfaces are unaffected. Idempotent when not attached.
  const detach = useMutation({
    mutationFn: (sessionId: string) =>
      invoke("sessions.detach", { params: { sessionId }, body: { sessionId, surfaceId: APP_SURFACE_ID } }),
    onSuccess: async () => {
      await invalidateSessions();
      toast({ title: "Detached — this app stops following this session; the session keeps running", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Detach failed", description: formatError(error), tone: "danger" }),
  });

  const deliverInput = useMutation({
    mutationFn: (inputId: string) => gv.sessions.inputs.deliver(record.id, inputId),
    onSuccess: invalidateSessions,
    onError: (error: unknown) => toast({ title: "Deliver failed", description: formatError(error), tone: "danger" }),
  });
  const cancelInput = useMutation({
    mutationFn: (inputId: string) => gv.sessions.inputs.cancel(record.id, inputId),
    onSuccess: invalidateSessions,
    onError: (error: unknown) => toast({ title: "Cancel failed", description: formatError(error), tone: "danger" }),
  });

  // App-local transcript export — a JSON file built from what the daemon
  // retained (the retention badge already discloses any truncation).
  function exportTranscript() {
    const payload = { exportedAt: new Date().toISOString(), session: record.raw, messages: items.map((m) => m.raw) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `session-${record.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    announce("Transcript exported");
  }

  const actionError = closeSession.error ?? reopenSession.error ?? deleteSession.error;

  return (
    <div className="session-detail">
      <button type="button" className="session-detail__back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        Back to sessions
      </button>
      <header className="session-detail__header">
        <h2>{record.title}</h2>
        <div className="session-detail__badges">
          <KindBadge kind={record.kind} />
          <span className="badge neutral">{projectLabel(record.project)}</span>
          <SessionStatusBadge record={record} />
          <span className="badge neutral">{record.messageCount} msgs</span>
          {retention && <span className="badge warning">{retention}</span>}
        </div>
        {record.surfaceKinds.length > 0 && (
          <div className="session-detail__surfaces">
            <small>Surfaces:</small>
            {record.surfaceKinds.map((s) => (
              <span key={s} className="badge neutral">
                {s}
              </span>
            ))}
          </div>
        )}
        <div className="session-detail__meta">
          <small>Updated {formatRelative(record.updatedAt)}</small>
          {record.activeAgentId && <small>· agent {record.activeAgentId}</small>}
          {record.pendingInputCount > 0 && <small>· {record.pendingInputCount} pending</small>}
        </div>
        <div className="session-detail__actions">
          {!closed && (
            <button
              type="button"
              className="sessions-action"
              disabled={closeSession.isPending}
              title="Close — keeps history, reopenable"
              onClick={() => closeSession.mutate(record.id)}
            >
              {closeSession.isPending ? "Closing…" : "Close"}
            </button>
          )}
          {closed && (
            <button
              type="button"
              className="sessions-action"
              disabled={reopenSession.isPending}
              title="Reopen this session"
              onClick={() => reopenSession.mutate(record.id)}
            >
              {reopenSession.isPending ? "Reopening…" : "Reopen"}
            </button>
          )}
          <button
            type="button"
            className="sessions-action"
            disabled={detach.isPending}
            title="Stop this app from following this session — never stops the session itself"
            onClick={() => detach.mutate(record.id)}
          >
            <Unlink size={13} aria-hidden="true" /> {detach.isPending ? "Detaching…" : "Detach"}
          </button>
          <button type="button" className="sessions-action" title="Export the retained transcript as JSON" onClick={exportTranscript}>
            <Download size={13} aria-hidden="true" /> Export
          </button>
          {deleteCapabilityState === "checking" && (
            <small className="session-detail__action-note">Checking delete availability…</small>
          )}
          {deleteCapabilityState === "available" && (
            <button
              type="button"
              className="sessions-action sessions-action--danger"
              disabled={deleteSession.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              {deleteSession.isPending ? "Deleting…" : "Delete"}
            </button>
          )}
          {deleteCapabilityState === "unavailable" && (
            <small className="session-detail__action-note">
              Permanent delete is not available on this daemon — close is the only removal.
            </small>
          )}
          {deleteCapabilityState === "uncertain" && (
            <span className="session-detail__action-note">
              Could not check whether permanent delete is available.{" "}
              <button type="button" className="sessions-empty__clear" onClick={onRetryDeleteCapability}>
                Retry
              </button>
            </span>
          )}
        </div>
        {actionError != null && (
          <div className="banner warning" role="alert">
            {formatError(actionError)}
          </div>
        )}
        {record.lastError && (
          <div className="banner warning" role="alert">
            Last error: {record.lastError}
          </div>
        )}
      </header>

      {pendingInputs.length > 0 && (
        <section className="session-detail__inputs" aria-label="Queued inputs">
          <strong>Input queue ({pendingInputs.length})</strong>
          <ul className="session-inputs">
            {pendingInputs.map((input) => (
              <li key={input.id} className="session-input">
                <span className="session-input__body">{input.body || input.id}</span>
                <span className="badge neutral">
                  {input.intent} · {input.state}
                </span>
                <span className="session-input__actions">
                  <button
                    type="button"
                    className="sessions-action"
                    disabled={deliverInput.isPending}
                    title="Deliver this queued input now"
                    onClick={() => deliverInput.mutate(input.id)}
                  >
                    Deliver
                  </button>
                  <button
                    type="button"
                    className="sessions-action"
                    disabled={cancelInput.isPending}
                    title="Cancel this queued input"
                    onClick={() => cancelInput.mutate(input.id)}
                  >
                    Cancel
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {inputs.isError && !isDaemonUnreachableError(inputs.error) && (
        <div className="banner warning" role="alert">
          Input queue unavailable: {formatError(inputs.error)}
        </div>
      )}

      <div className="session-detail__transcript" aria-label="Transcript">
        {messages.isPending && <SkeletonBlock variant="text" lines={5} />}
        {messages.isError && (
          <ErrorState error={messages.error} onRetry={() => void messages.refetch()} title="Transcript failed to load" />
        )}
        {messages.isSuccess && items.length === 0 && (
          <EmptyState title="No retained messages" description="This session has no transcript retained on the daemon." />
        )}
        {items.map((message) => (
          <div key={message.id} className="session-message">
            <span className="session-message__role">
              {message.role}
              {message.surfaceKind ? ` · ${message.surfaceKind}` : ""}
            </span>
            <span className="session-message__body">{message.body}</span>
          </div>
        ))}
      </div>

      <SteerComposer sessionId={record.id} canSteer={canSteer(record)} closed={closed} streamPaused={streamPaused} />

      <ConfirmSurface
        open={confirmDelete}
        action="Delete session"
        target={`${record.title} (${record.id})`}
        blastRadius="Removes the session record and its retained transcript from the daemon permanently, for every surface (TUI, agent, webui, this app). It cannot be reopened. An open session is closed first."
        danger
        requireTypedText="delete"
        confirmLabel="Delete permanently"
        onConfirm={() => {
          setConfirmDelete(false);
          deleteSession.mutate(record.id);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
