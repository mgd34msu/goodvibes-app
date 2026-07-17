// GitHub panel (docs/FEATURES.md §15 rows 5-7; docs/GAPS.md §15 rows 5-7):
// device-flow + token auth, repo context derived from the existing git
// remotes, and PR/issue list + comment + review against the app-local
// /app/github/* routes the app itself now serves (src/bun/github.ts, built
// in parallel to the contract this file codes against — see github-model.ts
// for the grounding note). Every write action (comment, review) is
// outward-facing and publishes to GitHub, so every one of them is gated
// behind ConfirmSurface, no exceptions.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleDot, Copy, ExternalLink, Github, GitPullRequest, Loader2 } from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock } from "../../components/feedback.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { codeKeys, formatCommitDate, gitApi } from "./git-api.ts";
import {
  formatRateReset,
  githubApi,
  githubAppKeys,
  githubRepoFromRemotes,
  isClientNotConfiguredError,
  isRealIssue,
  isTokenRejectedError,
  type GitHubAuthStatus,
  type GitHubIssue,
  type GitHubPull,
  type GitHubReviewEvent,
  type GitHubStateFilter,
} from "./github-model.ts";

const DEVICE_POLL_FALLBACK_MS = 5_000;
const RATE_LIMIT_POLL_MS = 60_000;

export function GitHubPanel() {
  const authStatus = useQuery({
    queryKey: githubAppKeys.authStatus,
    queryFn: githubApi.authStatus,
    retry: false,
  });

  return (
    <section className="github-panel" aria-label="GitHub">
      <h3 className="git-section-title">
        <Github size={14} aria-hidden="true" /> GitHub
      </h3>

      {authStatus.isPending && <SkeletonBlock variant="text" lines={4} />}
      {authStatus.isError && (
        <ErrorState error={authStatus.error} onRetry={() => void authStatus.refetch()} title="Failed to load GitHub auth status" />
      )}
      {authStatus.isSuccess && !authStatus.data.authenticated && <SignInPanel status={authStatus.data} />}
      {authStatus.isSuccess && authStatus.data.authenticated && <SignedInPanel status={authStatus.data} />}

      <RepoActivitySection authenticated={authStatus.data?.authenticated === true} />
    </section>
  );
}

// ─── sign-in (device flow + token) ───────────────────────────────────────────

type AuthTab = "device" | "token";

function SignInPanel({ status }: { status: GitHubAuthStatus }) {
  const [tab, setTab] = useState<AuthTab>("device");
  return (
    <div className="github-subsection">
      <div className="github-auth-tabs" role="tablist" aria-label="GitHub sign-in method">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "device"}
          className={tab === "device" ? "github-auth-tab github-auth-tab--active" : "github-auth-tab"}
          onClick={() => setTab("device")}
        >
          Sign in with GitHub
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "token"}
          className={tab === "token" ? "github-auth-tab github-auth-tab--active" : "github-auth-tab"}
          onClick={() => setTab("token")}
        >
          Use a token
        </button>
      </div>
      {tab === "device" ? <DeviceFlowTab clientIdConfigured={status.clientIdConfigured} /> : <TokenTab />}
    </div>
  );
}

type DevicePhase = "idle" | "starting" | "pending" | "expired" | "denied" | "error";

function DeviceFlowTab({ clientIdConfigured }: { clientIdConfigured: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [clientId, setClientId] = useState("");

  const saveClientId = useMutation({
    mutationFn: () => githubApi.saveClientId(clientId.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: githubAppKeys.authStatus });
      toast({ title: "Client id saved", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Save failed", description: formatError(error), tone: "danger" }),
  });

  if (!clientIdConfigured) {
    return (
      <div className="github-client-id-form">
        <p className="git-honest-note" role="note">
          GitHub's device flow needs an OAuth app client id you register yourself (GitHub → Settings → Developer
          settings → OAuth Apps). Paste it here once — it is stored app-side and never sent anywhere but GitHub's
          device-flow endpoints.
        </p>
        <div className="github-form__row">
          <input
            type="text"
            className="github-form__input"
            placeholder="OAuth app client id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            aria-label="GitHub OAuth app client id"
            disabled={saveClientId.isPending}
          />
          <button
            type="button"
            className="git-mini-button"
            disabled={clientId.trim() === "" || saveClientId.isPending}
            onClick={() => saveClientId.mutate()}
          >
            {saveClientId.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    );
  }

  return <DeviceFlowRunner />;
}

function DeviceFlowRunner() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [phase, setPhase] = useState<DevicePhase>("idle");
  const [userCode, setUserCode] = useState("");
  const [verificationUri, setVerificationUri] = useState("");
  const [flowId, setFlowId] = useState("");
  const [intervalMs, setIntervalMs] = useState(DEVICE_POLL_FALLBACK_MS);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const start = useMutation({
    mutationFn: () => githubApi.deviceStart(),
    onMutate: () => {
      setErrorMessage("");
      setPhase("starting");
    },
    onSuccess: (result) => {
      setUserCode(result.userCode);
      setVerificationUri(result.verificationUri);
      setFlowId(result.flowId);
      setIntervalMs(result.intervalMs || DEVICE_POLL_FALLBACK_MS);
      setPhase("pending");
    },
    onError: (error: unknown) => {
      setPhase("error");
      setErrorMessage(
        isClientNotConfiguredError(error) ? "No client id saved — reload this section and save one first." : formatError(error),
      );
    },
  });

  useEffect(() => {
    if (phase !== "pending" || !flowId) return;
    let cancelled = false;
    const poll = () => {
      githubApi
        .devicePoll(flowId)
        .then(async (result) => {
          if (cancelled) return;
          if (result.status === "complete") {
            setPhase("idle");
            await queryClient.invalidateQueries({ queryKey: githubAppKeys.authStatus });
            toast({ title: "GitHub connected", description: result.login || undefined, tone: "success" });
          } else if (result.status === "expired") {
            setPhase("expired");
          } else if (result.status === "denied") {
            setPhase("denied");
          } else if (result.status === "error") {
            setPhase("error");
            setErrorMessage(result.error || "Device flow failed");
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setPhase("error");
          setErrorMessage(formatError(error));
        });
    };
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, flowId, intervalMs, queryClient, toast]);

  return (
    <div className="github-device">
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
        <>
          <p className="github-device__code">{userCode || "(no code returned)"}</p>
          <div className="github-device__actions">
            <button
              type="button"
              className="git-mini-button"
              onClick={() => {
                if (!userCode) return;
                void navigator.clipboard?.writeText(userCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}{" "}
              {copied ? "Copied" : "Copy code"}
            </button>
            {verificationUri && (
              <a className="git-mini-button" href={verificationUri} target="_blank" rel="noreferrer">
                <ExternalLink size={12} aria-hidden="true" /> Open verification page
              </a>
            )}
          </div>
          <p className="git-honest-note" role="status">
            <Loader2 size={12} className="spinning" aria-hidden="true" /> Waiting for authorization — polling every{" "}
            {Math.round(intervalMs / 1000)}s.
          </p>
        </>
      )}
      {(phase === "expired" || phase === "denied" || phase === "error") && (
        <div className="github-device__actions">
          <span className="badge bad">
            {phase === "expired" ? "code expired" : phase === "denied" ? "authorization denied" : "failed"}
          </span>
          {errorMessage && <span className="git-honest-note">{errorMessage}</span>}
          <button type="button" className="git-mini-button" onClick={() => setPhase("idle")}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function TokenTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [reveal, setReveal] = useState(false);

  const save = useMutation({
    mutationFn: () => githubApi.saveToken(token.trim()),
    onSuccess: async (result) => {
      setToken("");
      await queryClient.invalidateQueries({ queryKey: githubAppKeys.authStatus });
      toast({ title: "Token saved", description: result.login, tone: "success" });
    },
    onError: (error: unknown) =>
      toast({
        title: "Token rejected",
        description: isTokenRejectedError(error)
          ? "GitHub rejected this token — check it hasn't expired or been revoked."
          : formatError(error),
        tone: "danger",
        durationMs: 0,
      }),
  });

  return (
    <div className="github-token-form">
      <div className="github-form__row">
        <input
          type={reveal ? "text" : "password"}
          className="github-form__input"
          placeholder="ghp_… or a fine-grained PAT"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-label="GitHub personal access token"
          disabled={save.isPending}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="git-mini-button" onClick={() => setReveal((v) => !v)}>
          {reveal ? "Hide" : "Show"}
        </button>
        <button type="button" className="git-mini-button" disabled={token.trim() === "" || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Testing…" : "Test & save"}
        </button>
      </div>
      <p className="git-honest-note" role="note">
        Fine-grained personal access tokens report no scopes over the API — an empty scope list after a successful
        save is expected, not a sign the token lacks permissions.
      </p>
    </div>
  );
}

// ─── signed-in state ──────────────────────────────────────────────────────────

function SignedInPanel({ status }: { status: GitHubAuthStatus }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const signOut = useMutation({
    mutationFn: () => githubApi.signOut(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: githubAppKeys.root });
      toast({ title: "Signed out of GitHub", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Sign out failed", description: formatError(error), tone: "danger" }),
  });

  const noReportedScopes = status.tokenSource === "pat" && (status.scopes ?? []).length === 0;

  return (
    <div className="github-subsection">
      <div className="github-subsection__head">
        <span className="github-subsection__title">
          <span className="badge ok">connected</span> {status.login}
        </span>
        <button type="button" className="git-mini-button" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          {signOut.isPending ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <dl className="github-account-facts">
        <dt>Auth method</dt>
        <dd>{status.tokenSource === "device" ? "Device flow" : status.tokenSource === "pat" ? "Personal access token" : "unknown"}</dd>
        <dt>Scopes</dt>
        <dd>
          {noReportedScopes
            ? "(none reported — expected for fine-grained PATs)"
            : (status.scopes ?? []).length > 0
              ? status.scopes!.join(", ")
              : "(none)"}
        </dd>
      </dl>
      <RateLimitReadout />
    </div>
  );
}

function RateLimitReadout() {
  const rateLimit = useQuery({
    queryKey: githubAppKeys.rateLimit,
    queryFn: githubApi.rateLimit,
    refetchInterval: RATE_LIMIT_POLL_MS,
    retry: false,
  });

  if (rateLimit.isPending) return <SkeletonBlock variant="text" lines={1} />;
  if (rateLimit.isError) {
    return <ErrorState error={rateLimit.error} onRetry={() => void rateLimit.refetch()} title="Rate limit unavailable" />;
  }
  const core = rateLimit.data.resources.core ?? rateLimit.data.rate;
  if (!core) return null;
  return (
    <p className="github-rate" role="status">
      <span className={core.remaining === 0 ? "badge bad" : core.remaining < core.limit * 0.1 ? "badge warning" : "badge neutral"}>
        {core.remaining.toLocaleString()} / {core.limit.toLocaleString()} calls left
      </span>
      resets {formatRateReset(core.reset)}
    </p>
  );
}

// ─── repo context + PRs/issues ───────────────────────────────────────────────

function RepoActivitySection({ authenticated }: { authenticated: boolean }) {
  const remotes = useQuery({
    queryKey: codeKeys.remotes,
    queryFn: gitApi.remotes,
    retry: false,
  });

  if (remotes.isPending) return <SkeletonBlock variant="text" lines={3} />;
  if (remotes.isError) {
    return <ErrorState error={remotes.error} onRetry={() => void remotes.refetch()} title="Failed to load remotes" />;
  }
  const repo = githubRepoFromRemotes(remotes.data.remotes);
  if (!repo) {
    return (
      <EmptyState
        title="No GitHub remote"
        description="None of this repository's remotes point at github.com — add one to see pull requests and issues here."
      />
    );
  }

  return (
    <div className="github-panel__sections">
      <p className="github-repo-context">
        <a href={`https://github.com/${repo.owner}/${repo.repo}`} target="_blank" rel="noreferrer" className="github-repo-context__link">
          {repo.owner}/{repo.repo} <ExternalLink size={11} aria-hidden="true" />
        </a>
      </p>
      <PullsSection owner={repo.owner} repo={repo.repo} authenticated={authenticated} />
      <IssuesSection owner={repo.owner} repo={repo.repo} authenticated={authenticated} />
    </div>
  );
}

function StateFilterSelect({ value, onChange }: { value: GitHubStateFilter; onChange: (value: GitHubStateFilter) => void }) {
  return (
    <select
      className="github-state-select"
      value={value}
      onChange={(e) => onChange(e.target.value as GitHubStateFilter)}
      aria-label="State filter"
    >
      <option value="open">Open</option>
      <option value="closed">Closed</option>
      <option value="all">All</option>
    </select>
  );
}

function PullsSection({ owner, repo, authenticated }: { owner: string; repo: string; authenticated: boolean }) {
  const [state, setState] = useState<GitHubStateFilter>("open");
  const pulls = useQuery({
    queryKey: githubAppKeys.pulls(owner, repo, state),
    queryFn: () => githubApi.pulls(owner, repo, state),
    enabled: authenticated,
    retry: false,
  });

  return (
    <div className="github-subsection">
      <div className="github-subsection__head">
        <h4 className="github-subsection__title">
          <GitPullRequest size={13} aria-hidden="true" /> Pull requests
        </h4>
        {authenticated && <StateFilterSelect value={state} onChange={setState} />}
      </div>
      {!authenticated && (
        <EmptyState title="Sign in to see pull requests" description="Connect a GitHub account above to load this repo's pull requests." />
      )}
      {authenticated && pulls.isPending && <SkeletonBlock variant="text" lines={3} />}
      {authenticated && pulls.isError && (
        <ErrorState error={pulls.error} onRetry={() => void pulls.refetch()} title="Failed to load pull requests" />
      )}
      {authenticated && pulls.isSuccess && pulls.data.length === 0 && <EmptyState title={`No ${state} pull requests`} />}
      {authenticated && pulls.isSuccess && pulls.data.length > 0 && (
        <ul className="github-rows">
          {pulls.data.map((pr) => (
            <PrRow key={pr.id} owner={owner} repo={repo} pr={pr} onChanged={() => void pulls.refetch()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function IssuesSection({ owner, repo, authenticated }: { owner: string; repo: string; authenticated: boolean }) {
  const [state, setState] = useState<GitHubStateFilter>("open");
  const issues = useQuery({
    queryKey: githubAppKeys.issues(owner, repo, state),
    queryFn: () => githubApi.issues(owner, repo, state),
    enabled: authenticated,
    select: (data: GitHubIssue[]) => data.filter(isRealIssue),
    retry: false,
  });

  return (
    <div className="github-subsection">
      <div className="github-subsection__head">
        <h4 className="github-subsection__title">
          <CircleDot size={13} aria-hidden="true" /> Issues
        </h4>
        {authenticated && <StateFilterSelect value={state} onChange={setState} />}
      </div>
      {!authenticated && (
        <EmptyState title="Sign in to see issues" description="Connect a GitHub account above to load this repo's issues." />
      )}
      {authenticated && issues.isPending && <SkeletonBlock variant="text" lines={3} />}
      {authenticated && issues.isError && (
        <ErrorState error={issues.error} onRetry={() => void issues.refetch()} title="Failed to load issues" />
      )}
      {authenticated && issues.isSuccess && issues.data.length === 0 && <EmptyState title={`No ${state} issues`} />}
      {authenticated && issues.isSuccess && issues.data.length > 0 && (
        <ul className="github-rows">
          {issues.data.map((issue) => (
            <IssueRow key={issue.id} owner={owner} repo={repo} issue={issue} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── PR row: expand, comment, review ─────────────────────────────────────────

function PrRow({ owner, repo, pr, onChanged }: { owner: string; repo: string; pr: GitHubPull; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const merged = Boolean(pr.merged_at);
  const stateLabel = merged ? "merged" : pr.state;
  const badgeTone = merged ? "info" : pr.state === "open" ? "ok" : "neutral";

  return (
    <li className="github-item">
      <button type="button" className="github-row" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="github-row__title" title={pr.title}>{pr.title}</span>
        <span className="github-row__meta">
          <span className={`badge ${badgeTone}`}>{stateLabel}</span>
          {pr.draft && <span className="badge neutral">draft</span>}
          #{pr.number}
          {pr.user?.login ? ` · ${pr.user.login}` : ""}
        </span>
      </button>
      {expanded && (
        <div className="github-item__detail">
          <p className="github-item__body">{pr.body?.trim() || "(no description)"}</p>
          <p className="github-item__meta-line">
            {pr.head.ref} → {pr.base.ref} · opened {formatCommitDate(pr.created_at)}
          </p>
          <a className="git-mini-button" href={pr.html_url} target="_blank" rel="noreferrer">
            <ExternalLink size={12} aria-hidden="true" /> View on GitHub
          </a>
          <CommentBox itemLabel={`pull request #${pr.number}`} postComment={(body) => githubApi.prComment(owner, repo, pr.number, body)} />
          <ReviewButtons owner={owner} repo={repo} prNumber={pr.number} prTitle={pr.title} onDone={onChanged} />
        </div>
      )}
    </li>
  );
}

function IssueRow({ owner, repo, issue }: { owner: string; repo: string; issue: GitHubIssue }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="github-item">
      <button type="button" className="github-row" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="github-row__title" title={issue.title}>{issue.title}</span>
        <span className="github-row__meta">
          <span className={`badge ${issue.state === "open" ? "ok" : "neutral"}`}>{issue.state}</span>
          #{issue.number}
          {issue.user?.login ? ` · ${issue.user.login}` : ""}
        </span>
      </button>
      {expanded && (
        <div className="github-item__detail">
          <p className="github-item__body">{issue.body?.trim() || "(no description)"}</p>
          <p className="github-item__meta-line">
            {issue.comments} comment{issue.comments === 1 ? "" : "s"} · opened {formatCommitDate(issue.created_at)}
          </p>
          <a className="git-mini-button" href={issue.html_url} target="_blank" rel="noreferrer">
            <ExternalLink size={12} aria-hidden="true" /> View on GitHub
          </a>
          <CommentBox itemLabel={`issue #${issue.number}`} postComment={(body) => githubApi.issueComment(owner, repo, issue.number, body)} />
        </div>
      )}
    </li>
  );
}

// ─── shared write-action widgets (every submit gated by ConfirmSurface) ─────

function CommentBox({ itemLabel, postComment }: { itemLabel: string; postComment: (body: string) => Promise<unknown> }) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);

  const comment = useMutation({
    mutationFn: (b: string) => postComment(b),
    onSuccess: () => {
      setConfirming(false);
      setBody("");
      toast({ title: "Comment posted", tone: "success" });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Comment failed", description: formatError(error), tone: "danger" });
    },
  });

  const canSubmit = body.trim() !== "";

  return (
    <div className="github-comment-box">
      <textarea
        className="github-form__textarea"
        rows={2}
        placeholder={`Comment on ${itemLabel}…`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={comment.isPending}
        aria-label={`Comment on ${itemLabel}`}
      />
      <div className="github-form__actions">
        <button type="button" className="git-mini-button" disabled={!canSubmit || comment.isPending} onClick={() => setConfirming(true)}>
          {comment.isPending ? "Posting…" : "Post comment"}
        </button>
      </div>
      <ConfirmSurface
        open={confirming}
        action={`Comment on ${itemLabel}`}
        target={itemLabel}
        blastRadius={`Posts a public comment on ${itemLabel} on GitHub — visible to anyone with access to the repo.`}
        confirmLabel={comment.isPending ? "Posting…" : "Post comment"}
        onConfirm={() => comment.mutate(body.trim())}
        onCancel={() => setConfirming(false)}
      >
        {/* Full comment text at the consent moment — never a truncated preview
            hiding what is about to be published. */}
        <pre className="github-confirm-preview">{body.trim() || "(empty)"}</pre>
      </ConfirmSurface>
    </div>
  );
}

function reviewActionLabel(event: GitHubReviewEvent | null): string {
  if (event === "APPROVE") return "Approve pull request";
  if (event === "REQUEST_CHANGES") return "Request changes";
  if (event === "COMMENT") return "Submit review comment";
  return "Submit review";
}

function reviewBlastRadius(event: GitHubReviewEvent | null): string {
  if (event === "APPROVE") return "Approves this pull request on GitHub — a public, outward-facing review visible to every collaborator.";
  if (event === "REQUEST_CHANGES")
    return "Requests changes on this pull request on GitHub — blocks merge until addressed, visible to every collaborator.";
  return "Posts a review comment on this pull request on GitHub without approving or requesting changes.";
}

function ReviewButtons({
  owner,
  repo,
  prNumber,
  prTitle,
  onDone,
}: {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [pendingEvent, setPendingEvent] = useState<GitHubReviewEvent | null>(null);

  const review = useMutation({
    mutationFn: (event: GitHubReviewEvent) => githubApi.prReview(owner, repo, prNumber, body, event),
    onSuccess: () => {
      setPendingEvent(null);
      setBody("");
      toast({ title: "Review submitted", tone: "success" });
      onDone();
    },
    onError: (error: unknown) => {
      setPendingEvent(null);
      toast({ title: "Review failed", description: formatError(error), tone: "danger" });
    },
  });

  return (
    <div className="github-review">
      <textarea
        className="github-form__textarea"
        rows={2}
        placeholder="Review comment (optional for approve/request changes, required for a comment-only review)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={review.isPending}
        aria-label="Review comment"
      />
      <div className="github-review__actions">
        <button type="button" className="git-mini-button" disabled={review.isPending} onClick={() => setPendingEvent("APPROVE")}>
          Approve
        </button>
        <button type="button" className="git-mini-button" disabled={review.isPending} onClick={() => setPendingEvent("REQUEST_CHANGES")}>
          Request changes
        </button>
        <button
          type="button"
          className="git-mini-button"
          disabled={review.isPending || body.trim() === ""}
          onClick={() => setPendingEvent("COMMENT")}
        >
          Comment
        </button>
      </div>
      <ConfirmSurface
        open={pendingEvent !== null}
        action={reviewActionLabel(pendingEvent)}
        target={prTitle}
        blastRadius={reviewBlastRadius(pendingEvent)}
        confirmLabel={review.isPending ? "Submitting…" : reviewActionLabel(pendingEvent)}
        onConfirm={() => {
          if (pendingEvent) review.mutate(pendingEvent);
        }}
        onCancel={() => setPendingEvent(null)}
      >
        {/* Full review comment at the consent moment, when there is one —
            never a truncated preview hiding what is about to be published. */}
        {body.trim() && <pre className="github-confirm-preview">{body.trim()}</pre>}
      </ConfirmSurface>
    </div>
  );
}
