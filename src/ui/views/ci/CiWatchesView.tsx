// CI Watches — ci.status one-shot lookups + persistent ci.watches.* that
// notify (and optionally auto-start a fix session) when a repo/ref/PR's
// checks finish. Crib: goodvibes-webui src/views/ci/CiWatchesView.tsx,
// adapted onto this app's tolerant-parse idiom (./ci.ts, lib/wire.ts) instead
// of webui's OperatorMethodOutput typing, and this app's own master/detail
// conventions (CheckpointsView.tsx / FleetView.tsx) instead of webui's.
// Wave: SDK-1.11 adoption (agent C owns this file).
//
// ci.* is plain HTTP end to end (ws:false on every row in
// generated/operator-routes.ts) — there is no ws-bridge-down state to handle
// here, unlike checkpoints.*/fleet.*.
//
// ci.* emits NO wire event (a standing gap shared with fleet.*/checkpoints.*/
// memory.* — see queryKeys.ciWatches's comment in lib/queries.ts): freshness
// is mutation-driven invalidation + manual refresh ONLY — deliberately no
// poll here (unlike CheckpointsView's 30s poll), since nothing about a
// standing watch changes on its own between explicit checks.
//
// Per this surface's honesty bar (docs/UX.md §4): the detail ALWAYS lists
// every job with its own conclusion — never a bare rollup badge with no job
// list underneath. continue-on-error jobs get a distinct badge when the wire
// reports them, and violations (the daemon's own reasons the verdict is not
// a clean "passed") are listed verbatim, never summarized.
//
// Delivery channel is a free-text field with a hint, not a select: no view
// in this app exports a reusable "list of channel identifiers" query — the
// Channels view's channel/account data (channels.status, channels.accounts.list)
// is fetched under LOCAL query keys owned by that view
// (src/ui/views/channels/keys.ts), not lib/queries.ts's shared registry, so
// there is nothing safe to import from here without reaching into another
// view's internals.

import { useEffect, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, GitBranch, Play, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { useUrlState } from "../../lib/router.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import {
  ciTone,
  parseCiReport,
  parseCiWatch,
  parseCiWatchDeleteResult,
  parseCiWatchList,
  parseCiWatchRunResult,
  reportLabel,
  watchLabel,
  type CiReport,
  type CiWatch,
  type CiWatchRunResult,
} from "./ci.ts";

/** The honesty-bar detail: EVERY job listed individually, never a rollup alone. */
function CiReportDetail({ report }: { report: CiReport }) {
  return (
    <div className="ci-report">
      <div className="ci-report__header">
        <span className={`badge ${ciTone(report.overall)}`}>{report.overall}</span>
        <span className="ci-report__meta">{reportLabel(report)}</span>
        <span className="ci-report__meta">checked {formatRelative(report.checkedAt)}</span>
      </div>
      {report.violations.length > 0 && (
        <ul className="ci-report__violations">
          {report.violations.map((violation, index) => (
            <li key={index}>{violation}</li>
          ))}
        </ul>
      )}
      {report.jobs.length === 0 ? (
        <p className="ci-report__empty" role="note">
          No jobs reported.
        </p>
      ) : (
        <ul className="ci-report__jobs">
          {report.jobs.map((job, index) => (
            <li key={`${job.name}-${index}`} className="ci-report__job">
              <span className="ci-report__job-name">{job.name || "unnamed job"}</span>
              <span className={`badge ${ciTone(job.conclusion ?? job.status)}`}>{job.conclusion ?? job.status}</span>
              {job.continueOnError && <span className="badge warning">continue-on-error</span>}
              {job.url && (
                <a href={job.url} target="_blank" rel="noreferrer" className="ci-report__job-link">
                  details
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateWatchForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [prNumber, setPrNumber] = useState("");
  const [deliveryChannel, setDeliveryChannel] = useState("");
  const [triggerFixSession, setTriggerFixSession] = useState(false);

  const create = useMutation({
    mutationFn: async () =>
      parseCiWatch(
        ((await gv.ci.watches.create({
          repo: repo.trim(),
          ...(ref.trim() ? { ref: ref.trim() } : {}),
          ...(prNumber.trim() ? { prNumber: Number(prNumber.trim()) } : {}),
          deliveryChannel: deliveryChannel.trim(),
          triggerFixSession,
        })) as Record<string, unknown> | undefined)?.["watch"],
      ),
    onSuccess: (watch) => {
      setRepo("");
      setRef("");
      setPrNumber("");
      setDeliveryChannel("");
      setTriggerFixSession(false);
      onCreated();
      toast({ title: "Watch created", description: watch.id ? watchLabel(watch) : undefined, tone: "success" });
    },
    onError: (error: unknown) => {
      toast({
        title: isMethodUnavailableError(error) ? "CI watches unavailable on this daemon" : "Failed to create watch",
        description: isMethodUnavailableError(error) ? undefined : formatError(error),
        tone: "danger",
      });
    },
  });

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!repo.trim() || !deliveryChannel.trim()) return;
    create.mutate();
  }

  return (
    <form className="ci-create-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="owner/repo"
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        aria-label="Repository"
        disabled={create.isPending}
        required
      />
      <input
        type="text"
        placeholder="ref (optional)"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        aria-label="Ref"
        disabled={create.isPending}
      />
      <input
        type="number"
        placeholder="PR # (optional)"
        value={prNumber}
        onChange={(e) => setPrNumber(e.target.value)}
        aria-label="PR number"
        disabled={create.isPending}
        min={0}
      />
      <input
        type="text"
        placeholder="Delivery channel (e.g. slack:#eng)"
        value={deliveryChannel}
        onChange={(e) => setDeliveryChannel(e.target.value)}
        aria-label="Delivery channel"
        disabled={create.isPending}
        required
      />
      <p className="ci-create-form__hint">
        Any channel identifier the daemon's delivery router recognizes for this workspace — validated when the watch
        actually fires, not here.
      </p>
      <label className="ci-create-form__checkbox">
        <input
          type="checkbox"
          checked={triggerFixSession}
          onChange={(e) => setTriggerFixSession(e.target.checked)}
          disabled={create.isPending}
        />
        Start a fix session on failure
      </label>
      <button
        type="submit"
        className="ci-create-form__submit"
        disabled={create.isPending || !repo.trim() || !deliveryChannel.trim()}
      >
        <Plus size={14} aria-hidden="true" /> {create.isPending ? "Creating…" : "Create watch"}
      </button>
    </form>
  );
}

/** Ad hoc ci.status lookup — check any repo/ref/PR without creating a standing watch. */
function AdHocStatusLookup({ repoInputRef }: { repoInputRef: RefObject<HTMLInputElement | null> }) {
  const { toast } = useToast();
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [prNumber, setPrNumber] = useState("");
  const [report, setReport] = useState<CiReport | null>(null);

  const check = useMutation({
    mutationFn: async () =>
      parseCiReport(
        await gv.ci.status({
          repo: repo.trim(),
          ...(ref.trim() ? { ref: ref.trim() } : {}),
          ...(prNumber.trim() ? { prNumber: Number(prNumber.trim()) } : {}),
        }),
      ),
    onSuccess: (result) => setReport(result),
    onError: (error: unknown) => {
      setReport(null);
      toast({
        title: isMethodUnavailableError(error) ? "CI status unavailable on this daemon" : "Look-up failed",
        description: isMethodUnavailableError(error) ? undefined : formatError(error),
        tone: "danger",
      });
    },
  });

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!repo.trim()) return;
    check.mutate();
  }

  return (
    <div className="ci-lookup">
      <h3 className="ci-lookup__title">
        <Search size={14} aria-hidden="true" /> Look up status
      </h3>
      <p className="ci-lookup__hint">Check any repo/ref/PR's CI status right now, without creating a standing watch.</p>
      <form className="ci-create-form" onSubmit={handleSubmit}>
        <input
          ref={repoInputRef}
          type="text"
          placeholder="owner/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          aria-label="Repository"
          disabled={check.isPending}
          required
        />
        <input
          type="text"
          placeholder="ref (optional)"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          aria-label="Ref"
          disabled={check.isPending}
        />
        <input
          type="number"
          placeholder="PR # (optional)"
          value={prNumber}
          onChange={(e) => setPrNumber(e.target.value)}
          aria-label="PR number"
          disabled={check.isPending}
          min={0}
        />
        <button type="submit" className="ci-create-form__submit" disabled={check.isPending || !repo.trim()}>
          {check.isPending ? "Checking…" : "Check status"}
        </button>
      </form>
      {report && <CiReportDetail report={report} />}
    </div>
  );
}

export function CiWatchesView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setUrlState } = useUrlState();
  const [selectedId, setSelectedId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CiWatch | null>(null);
  const [runResult, setRunResult] = useState<CiWatchRunResult | null>(null);
  const lookupRepoInputRef = useRef<HTMLInputElement>(null);

  const list = useQuery({
    queryKey: queryKeys.ciWatches,
    queryFn: async () => parseCiWatchList(await gv.ci.watches.list()),
    retry: false,
  });

  const watches = list.data ?? [];
  const selected = watches.find((w) => w.id === selectedId) ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.ciWatches });

  function selectWatch(watch: CiWatch): void {
    setSelectedId(watch.id);
    setRunResult(null);
  }

  function backToList(): void {
    setSelectedId("");
    setRunResult(null);
  }

  const run = useMutation({
    mutationFn: async (watchId: string) => parseCiWatchRunResult(await gv.ci.watches.run(watchId)),
    onSuccess: async (result) => {
      setRunResult(result);
      await invalidate();
    },
    onError: (error: unknown) => {
      toast({
        title: isMethodUnavailableError(error) ? "CI watches unavailable on this daemon" : "Check failed",
        description: isMethodUnavailableError(error) ? undefined : formatError(error),
        tone: "danger",
      });
    },
  });

  const remove = useMutation({
    mutationFn: async (watchId: string) => ({
      watchId,
      ...parseCiWatchDeleteResult(await gv.ci.watches.delete(watchId)),
    }),
    onSuccess: async (result) => {
      setDeleteTarget(null);
      toast(
        result.deleted
          ? { title: "Watch deleted", tone: "success" }
          : { title: "Watch already gone", description: "No watch with that id existed.", tone: "info" },
      );
      if (selectedId === result.watchId) backToList();
      await invalidate();
    },
    onError: (error: unknown) => {
      setDeleteTarget(null);
      toast({ title: "Failed to delete watch", description: formatError(error), tone: "danger" });
    },
  });

  // Palette entries (docs/UX.md §2 — every user-invocable action gets one).
  useEffect(() => {
    registerCommand({
      id: "ci.createWatch",
      title: "CI: Create Watch",
      group: "code",
      keywords: ["ci", "watch", "create", "github", "actions"],
      run: () => {
        backToList();
        setShowCreate(true);
      },
    });
    registerCommand({
      id: "ci.lookupStatus",
      title: "CI: Look Up Status",
      group: "code",
      keywords: ["ci", "status", "lookup", "github", "actions", "check"],
      run: () => {
        setShowCreate(false);
        backToList();
        requestAnimationFrame(() => lookupRepoInputRef.current?.focus());
      },
    });
    return () => {
      unregisterCommand("ci.createWatch");
      unregisterCommand("ci.lookupStatus");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unavailable = list.isError && isMethodUnavailableError(list.error);

  return (
    <div className={selected ? "ci-view has-selection" : "ci-view"}>
      <div className="ci-list-pane">
        <div className="ci-toolbar">
          <button type="button" className="ci-icon-button" title="New watch" onClick={() => setShowCreate((v) => !v)}>
            <Plus size={15} aria-hidden="true" /> New watch
          </button>
          <button
            type="button"
            className="ci-icon-button"
            title="Refresh"
            aria-label="Refresh CI watches"
            onClick={() => void list.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
        </div>

        {showCreate && (
          <CreateWatchForm
            onCreated={() => {
              setShowCreate(false);
              void invalidate();
            }}
          />
        )}

        {list.isPending && <SkeletonBlock variant="text" lines={4} />}

        {unavailable && (
          <UnavailableState
            capability="ci.watches.list"
            description="this daemon cannot list, create, run, or delete CI watches."
            action={{ label: "Retry", onClick: () => void list.refetch() }}
          />
        )}

        {list.isError && !unavailable && (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load CI watches" />
        )}

        {list.isSuccess && watches.length === 0 && (
          <EmptyState
            icon={<GitBranch size={28} aria-hidden="true" />}
            title="No CI watches yet"
            description="Create one to get notified when a repo/ref/PR's checks finish."
            action={{ label: "New watch", onClick: () => setShowCreate(true) }}
          />
        )}

        {watches.length > 0 && (
          <ul className="ci-rows">
            {watches.map((watch) => (
              <li key={watch.id} className="ci-rows__item">
                <button
                  type="button"
                  className={watch.id === selectedId ? "ci-row active" : "ci-row"}
                  onClick={() => selectWatch(watch)}
                >
                  <span className="ci-row__title">{watchLabel(watch)}</span>
                  <span className="ci-row__badges">
                    {watch.lastOverall && <span className={`badge ${ciTone(watch.lastOverall)}`}>{watch.lastOverall}</span>}
                    {watch.triggerFixSession && <span className="badge warning">fix-session on failure</span>}
                    <span className="ci-row__meta">→ {watch.deliveryChannel}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="ci-icon-button ci-row__delete"
                  title="Delete this watch"
                  aria-label={`Delete watch for ${watchLabel(watch)}`}
                  onClick={() => setDeleteTarget(watch)}
                  disabled={remove.isPending}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ci-detail-pane">
        {selected ? (
          <div className="ci-detail">
            <button type="button" className="ci-detail__back" onClick={backToList}>
              <ChevronLeft size={16} aria-hidden="true" />
              Back to watches
            </button>
            <header className="ci-detail__header">
              <h2>{watchLabel(selected)}</h2>
              <div className="ci-detail__meta">
                <small>Delivers to {selected.deliveryChannel}</small>
                <small>· created {formatRelative(selected.createdAt)}</small>
                {selected.triggerFixSession && <small>· starts a fix session on failure</small>}
              </div>
              <div className="ci-detail__actions">
                <button
                  type="button"
                  className="ci-action"
                  onClick={() => run.mutate(selected.id)}
                  disabled={run.isPending}
                >
                  <Play size={13} aria-hidden="true" /> {run.isPending ? "Checking…" : "Check now"}
                </button>
                <button
                  type="button"
                  className="ci-action ci-action--danger"
                  onClick={() => setDeleteTarget(selected)}
                  disabled={remove.isPending}
                >
                  <Trash2 size={13} aria-hidden="true" /> Delete
                </button>
              </div>
            </header>

            {runResult && (
              <div className="ci-detail__result">
                {runResult.retired && (
                  <p className="ci-detail__retired" role="note">
                    This watch has been retired — no further checks or notifications will run for it.
                  </p>
                )}
                <CiReportDetail report={runResult.report} />
                <p className="ci-detail__outcome">
                  {runResult.notified ? "A notification was sent." : "No notification was sent."}
                  {/* fixSessionId / fixSessionError are mutually exclusive on the wire
                      when fixSessionTriggered is true: a real attachable session, or
                      an honest failure reason — never both, never a dead id. */}
                  {runResult.fixSessionTriggered && runResult.fixSessionId && " A fix session was started."}
                  {runResult.fixSessionTriggered &&
                    runResult.fixSessionError &&
                    ` The fix session could not start — ${runResult.fixSessionError}`}
                </p>
                {runResult.fixSessionTriggered && runResult.fixSessionId && (
                  <button
                    type="button"
                    className="ci-detail__open-session"
                    onClick={() => setUrlState({ view: "sessions", session: runResult.fixSessionId })}
                  >
                    <ExternalLink size={14} aria-hidden="true" /> Open fix session
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="ci-detail-empty">Select a watch to check its status, or look up any repo below.</div>
            <AdHocStatusLookup repoInputRef={lookupRepoInputRef} />
          </>
        )}
      </div>

      <ConfirmSurface
        open={deleteTarget !== null}
        danger
        action="Delete CI watch"
        target={deleteTarget ? watchLabel(deleteTarget) : ""}
        blastRadius="Stops notifications and (if opted in) fix-session starts for this repo/ref/PR. Past status checks are not affected; nothing else is deleted."
        confirmLabel={remove.isPending ? "Deleting…" : "Delete watch"}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
