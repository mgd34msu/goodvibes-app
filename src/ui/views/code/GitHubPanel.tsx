// GitHub panel (docs/FEATURES.md §15 row 11): device-flow auth, PR list +
// create, issue list + create. See github-model.ts for the grounding note —
// zero "github.*" ids exist in the pinned operator contract today, so this
// entire panel gates every section behind isKnownMethod() and renders a
// single honest UnavailableState in the (currently universal) case where
// none of the candidate ids are known. Nothing here is ever invoked against
// an unknown route.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Github, GitPullRequest, CircleDot, Loader2 } from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { usePeek } from "../../components/PeekPanel.tsx";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import {
  GITHUB_METHOD_IDS,
  anyGitHubMethodKnown,
  deviceStartFromResponse,
  devicePollFromResponse,
  githubApi,
  issuesFromResponse,
  knownGitHubMethods,
  pullsFromResponse,
  type GitHubIssueLike,
} from "./github-model.ts";

const githubKeys = {
  root: ["code", "github"] as const,
  status: ["code", "github", "status"] as const,
  pulls: ["code", "github", "pulls"] as const,
  issues: ["code", "github", "issues"] as const,
};

const DEVICE_POLL_MS = 5_000;

export function GitHubPanel() {
  const known = knownGitHubMethods();
  const anyKnown = anyGitHubMethodKnown();

  return (
    <section className="github-panel" aria-label="GitHub">
      <h3 className="git-section-title">
        <Github size={14} aria-hidden="true" /> GitHub
      </h3>

      {!anyKnown && (
        <UnavailableState
          capability="github.*"
          description={
            "no github.* method is registered in this daemon build's operator contract — " +
            "device-flow auth, and PR/issue list and create for this repo, cannot be wired up yet. " +
            "This needs a daemon-side GitHub REST client and route additions (docs/FEATURES.md §15 row 11), " +
            "outside the UI-only scope of this change."
          }
        />
      )}

      {anyKnown && (
        <div className="github-panel__sections">
          <DeviceFlowSection enabled={known.deviceStart === true && known.devicePoll === true} />
          <PullsSection enabled={known.pullsList === true} createEnabled={known.pullsCreate === true} />
          <IssuesSection enabled={known.issuesList === true} createEnabled={known.issuesCreate === true} />
        </div>
      )}
    </section>
  );
}

// ─── device flow ─────────────────────────────────────────────────────────────

type DeviceFlowPhase = "idle" | "starting" | "pending" | "authorized" | "failed";

function DeviceFlowSection({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<DeviceFlowPhase>("idle");
  const [userCode, setUserCode] = useState("");
  const [verificationUri, setVerificationUri] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [copied, setCopied] = useState(false);

  const start = useMutation({
    mutationFn: () => githubApi.deviceStart(),
    onMutate: () => setPhase("starting"),
    onSuccess: (raw) => {
      const result = deviceStartFromResponse(raw);
      setUserCode(result.userCode);
      setVerificationUri(result.verificationUri || result.verificationUriComplete);
      setDeviceCode(result.deviceCode);
      setPhase("pending");
    },
    onError: (error: unknown) => {
      setPhase("failed");
      toast({ title: "Could not start device flow", description: formatError(error), tone: "danger" });
    },
  });

  useEffect(() => {
    if (phase !== "pending" || !deviceCode) return;
    let cancelled = false;
    const timer = setInterval(() => {
      githubApi
        .devicePoll(deviceCode)
        .then((raw) => {
          if (cancelled) return;
          const result = devicePollFromResponse(raw);
          if (result.status === "authorized") {
            setPhase("authorized");
            toast({ title: "GitHub linked", description: result.login || undefined, tone: "success" });
          } else if (result.status === "expired" || result.status === "denied") {
            setPhase("failed");
            toast({ title: "Device flow " + result.status, tone: "danger" });
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setPhase("failed");
          toast({ title: "Device flow poll failed", description: formatError(error), tone: "danger" });
        });
    }, DEVICE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, deviceCode, toast]);

  if (!enabled) {
    return (
      <div className="github-subsection">
        <h4 className="github-subsection__title">Sign in</h4>
        <UnavailableState
          capability={GITHUB_METHOD_IDS.deviceStart}
          description="device-flow auth is not registered on this daemon."
        />
      </div>
    );
  }

  return (
    <div className="github-subsection">
      <h4 className="github-subsection__title">Sign in</h4>
      {phase === "idle" && (
        <button type="button" className="git-mini-button" onClick={() => start.mutate()}>
          Connect GitHub
        </button>
      )}
      {phase === "starting" && (
        <span className="github-device__status">
          <Loader2 size={13} className="spinning" aria-hidden="true" /> Requesting a device code…
        </span>
      )}
      {phase === "pending" && (
        <div className="github-device">
          <p className="github-device__code">{userCode || "(no code returned)"}</p>
          <div className="github-device__actions">
            <button
              type="button"
              className="git-mini-button"
              onClick={() => {
                if (!userCode) return;
                void navigator.clipboard.writeText(userCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              <Copy size={12} aria-hidden="true" /> {copied ? "Copied" : "Copy code"}
            </button>
            {verificationUri && (
              <a className="git-mini-button" href={verificationUri} target="_blank" rel="noreferrer">
                <ExternalLink size={12} aria-hidden="true" /> Open verification page
              </a>
            )}
          </div>
          <p className="git-honest-note" role="status">
            <Loader2 size={12} className="spinning" aria-hidden="true" /> Waiting for authorization — polling every{" "}
            {DEVICE_POLL_MS / 1000}s.
          </p>
        </div>
      )}
      {phase === "authorized" && <span className="badge ok">connected</span>}
      {phase === "failed" && (
        <div className="github-device__actions">
          <span className="badge bad">not connected</span>
          <button type="button" className="git-mini-button" onClick={() => setPhase("idle")}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

// ─── PRs ─────────────────────────────────────────────────────────────────────

function PullsSection({ enabled, createEnabled }: { enabled: boolean; createEnabled: boolean }) {
  const peek = usePeek();
  const list = useQuery({
    queryKey: githubKeys.pulls,
    queryFn: () => githubApi.pullsList(),
    enabled,
    select: pullsFromResponse,
    retry: false,
  });
  const [showCreate, setShowCreate] = useState(false);

  if (!enabled) {
    return (
      <div className="github-subsection">
        <h4 className="github-subsection__title">
          <GitPullRequest size={13} aria-hidden="true" /> Pull requests
        </h4>
        <UnavailableState capability={GITHUB_METHOD_IDS.pullsList} description="PR listing is not registered on this daemon." />
      </div>
    );
  }

  return (
    <div className="github-subsection">
      <div className="github-subsection__head">
        <h4 className="github-subsection__title">
          <GitPullRequest size={13} aria-hidden="true" /> Pull requests
        </h4>
        {createEnabled && (
          <button type="button" className="git-mini-button" onClick={() => setShowCreate(true)}>
            New PR
          </button>
        )}
      </div>
      {list.isPending && <SkeletonBlock variant="text" lines={3} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load pull requests" />}
      {list.isSuccess && list.data.length === 0 && <EmptyState title="No open pull requests" />}
      {list.isSuccess && list.data.length > 0 && (
        <IssueLikeRows records={list.data} onOpen={(r) => peek.open({ title: `#${r.number}`, content: <IssueLikePeek record={r} /> })} />
      )}
      {createEnabled && (
        <CreatePrForm open={showCreate} onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

function CreatePrForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [head, setHead] = useState("");
  const [base, setBase] = useState("main");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);

  const create = useMutation({
    mutationFn: (meta: ConfirmMetadata) => githubApi.pullsCreate({ title, head, base, body: body || undefined }, meta),
    onSuccess: async () => {
      setConfirming(false);
      onClose();
      setTitle("");
      setHead("");
      setBody("");
      await queryClient.invalidateQueries({ queryKey: githubKeys.pulls });
      toast({ title: "Pull request created", tone: "success" });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Create PR failed", description: formatError(error), tone: "danger" });
    },
  });

  if (!open) return null;
  const canSubmit = title.trim() !== "" && head.trim() !== "" && base.trim() !== "";

  return (
    <div className="github-form">
      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="github-form__input"
        aria-label="PR title"
      />
      <div className="github-form__row">
        <input
          type="text"
          placeholder="head branch"
          value={head}
          onChange={(e) => setHead(e.target.value)}
          className="github-form__input"
          aria-label="Head branch"
        />
        <input
          type="text"
          placeholder="base branch"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          className="github-form__input"
          aria-label="Base branch"
        />
      </div>
      <textarea
        placeholder="Description (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="github-form__textarea"
        rows={3}
        aria-label="PR description"
      />
      <div className="github-form__actions">
        <button type="button" className="git-mini-button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="git-mini-button" disabled={!canSubmit} onClick={() => setConfirming(true)}>
          Create
        </button>
      </div>
      <ConfirmSurface
        open={confirming}
        action="Create pull request"
        target={title || "(untitled)"}
        blastRadius={`Opens a pull request on GitHub from ${head || "(head)"} into ${base || "(base)"} — an outward-facing, visible-to-others action.`}
        confirmLabel={create.isPending ? "Creating…" : "Create pull request"}
        onConfirm={(meta) => create.mutate(meta)}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

// ─── issues ──────────────────────────────────────────────────────────────────

function IssuesSection({ enabled, createEnabled }: { enabled: boolean; createEnabled: boolean }) {
  const peek = usePeek();
  const list = useQuery({
    queryKey: githubKeys.issues,
    queryFn: () => githubApi.issuesList(),
    enabled,
    select: issuesFromResponse,
    retry: false,
  });
  const [showCreate, setShowCreate] = useState(false);

  if (!enabled) {
    return (
      <div className="github-subsection">
        <h4 className="github-subsection__title">
          <CircleDot size={13} aria-hidden="true" /> Issues
        </h4>
        <UnavailableState capability={GITHUB_METHOD_IDS.issuesList} description="issue listing is not registered on this daemon." />
      </div>
    );
  }

  return (
    <div className="github-subsection">
      <div className="github-subsection__head">
        <h4 className="github-subsection__title">
          <CircleDot size={13} aria-hidden="true" /> Issues
        </h4>
        {createEnabled && (
          <button type="button" className="git-mini-button" onClick={() => setShowCreate(true)}>
            New issue
          </button>
        )}
      </div>
      {list.isPending && <SkeletonBlock variant="text" lines={3} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load issues" />}
      {list.isSuccess && list.data.length === 0 && <EmptyState title="No open issues" />}
      {list.isSuccess && list.data.length > 0 && (
        <IssueLikeRows records={list.data} onOpen={(r) => peek.open({ title: `#${r.number}`, content: <IssueLikePeek record={r} /> })} />
      )}
      {createEnabled && <CreateIssueForm open={showCreate} onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateIssueForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);

  const create = useMutation({
    mutationFn: (meta: ConfirmMetadata) => githubApi.issuesCreate({ title, body: body || undefined }, meta),
    onSuccess: async () => {
      setConfirming(false);
      onClose();
      setTitle("");
      setBody("");
      await queryClient.invalidateQueries({ queryKey: githubKeys.issues });
      toast({ title: "Issue created", tone: "success" });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Create issue failed", description: formatError(error), tone: "danger" });
    },
  });

  if (!open) return null;
  const canSubmit = title.trim() !== "";

  return (
    <div className="github-form">
      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="github-form__input"
        aria-label="Issue title"
      />
      <textarea
        placeholder="Description (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="github-form__textarea"
        rows={3}
        aria-label="Issue description"
      />
      <div className="github-form__actions">
        <button type="button" className="git-mini-button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="git-mini-button" disabled={!canSubmit} onClick={() => setConfirming(true)}>
          Create
        </button>
      </div>
      <ConfirmSurface
        open={confirming}
        action="Create issue"
        target={title || "(untitled)"}
        blastRadius="Opens an issue on GitHub — an outward-facing, visible-to-others action."
        confirmLabel={create.isPending ? "Creating…" : "Create issue"}
        onConfirm={(meta) => create.mutate(meta)}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

// ─── shared rows/peek ─────────────────────────────────────────────────────────

function IssueLikeRows({ records, onOpen }: { records: GitHubIssueLike[]; onOpen: (record: GitHubIssueLike) => void }) {
  return (
    <ul className="github-rows">
      {records.map((record) => (
        <li key={record.id || record.number}>
          <button type="button" className="github-row" onClick={() => onOpen(record)}>
            <span className="github-row__title">{record.title}</span>
            <span className="github-row__meta">
              <span className={`badge ${record.state === "open" ? "ok" : "neutral"}`}>{record.state}</span>
              #{record.number} {record.author ? `· ${record.author}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function IssueLikePeek({ record }: { record: GitHubIssueLike }) {
  return (
    <div className="github-peek">
      <p className="github-peek__title">{record.title}</p>
      <div className="github-peek__badges">
        <span className={`badge ${record.state === "open" ? "ok" : "neutral"}`}>{record.state}</span>
        <span className="badge neutral">#{record.number}</span>
      </div>
      {record.body && <pre className="github-peek__body">{record.body}</pre>}
      {record.url && (
        <a className="git-mini-button" href={record.url} target="_blank" rel="noreferrer">
          <ExternalLink size={12} aria-hidden="true" /> Open on GitHub
        </a>
      )}
    </div>
  );
}
