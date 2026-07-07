// SubscriptionsPanel — OAuth-backed provider subscriptions (docs/GAPS.md §14
// row 11), driven entirely against the app-local /app/subscriptions/* routes
// (src/bun/subscriptions.ts), which are themselves built on
// @pellux/goodvibes-sdk's SubscriptionManager and subscription-provider
// helpers — the same SDK primitives the TUI uses in-process, sharing the same
// storage file (~/.goodvibes/tui/subscriptions.json) so a login made in
// either surface shows up in both. This is an app-local Bun route, not a
// daemon wire method, so isMethodUnavailableError doesn't apply here —
// network/transport failures just get an honest ErrorState.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, LogOut, RefreshCw, ShieldCheck, X } from "lucide-react";
import { appFetch, appJson } from "../../lib/http.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock } from "../../components/feedback.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";

// ─── contract (mirrors src/bun/subscriptions.ts's safe-field shapes) ───────

interface SafeSubscription {
  provider: string;
  tokenType: string;
  expiresAt?: number;
  scopes?: string[];
  authMode: "oauth";
  overrideAmbientApiKeys: boolean;
  createdAt: number;
  updatedAt: number;
  hasRefreshToken: boolean;
}

interface SafePending {
  provider: string;
  redirectUri: string;
  createdAt: number;
}

interface AvailableProvider {
  provider: string;
  displayName: string;
  source: "builtin" | "service";
  redirectUri: string;
  builtin: boolean;
}

interface SubscriptionsListResponse {
  subscriptions: SafeSubscription[];
  pending: SafePending[];
  available: AvailableProvider[];
}

// ─── query keys ("subscriptionsApp" prefix — never queryKeys.*) ────────────

const subscriptionsAppKeys = {
  root: ["subscriptionsApp"] as const,
  list: ["subscriptionsApp", "list"] as const,
};

const PENDING_POLL_MS = 3_000;

// ─── typed client ────────────────────────────────────────────────────────────

function post<T>(path: string, body: unknown): Promise<T> {
  return appJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function del(path: string): Promise<{ ok: true }> {
  const res = await appFetch(path, { method: "DELETE" });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${path}${bodyText ? `: ${bodyText}` : ""}`);
  }
  return { ok: true };
}

const subscriptionsApi = {
  list: () => appJson<SubscriptionsListResponse>("/app/subscriptions"),
  loginStart: (provider: string) => post<{ authorizationUrl: string }>("/app/subscriptions/login/start", { provider }),
  loginFinish: (provider: string, code: string) =>
    post<{ subscription: SafeSubscription }>("/app/subscriptions/login/finish", { provider, code }),
  refresh: (provider: string) => post<{ subscription: SafeSubscription }>("/app/subscriptions/refresh", { provider }),
  cancelPending: (provider: string) => del(`/app/subscriptions/login/pending?provider=${encodeURIComponent(provider)}`),
  logout: (provider: string) => del(`/app/subscriptions?provider=${encodeURIComponent(provider)}`),
};

// ─── panel ───────────────────────────────────────────────────────────────────

export function SubscriptionsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pendingLogout, setPendingLogout] = useState<string | null>(null);
  // authorizationUrl for a just-started login, keyed by provider — carried
  // across the transition from "available" to "pending" so the "Open sign-in
  // page" link doesn't vanish the moment the pending record shows up.
  const [authUrls, setAuthUrls] = useState<Record<string, string>>({});

  const list = useQuery({
    queryKey: subscriptionsAppKeys.list,
    queryFn: subscriptionsApi.list,
    // A loopback listener may complete a login server-side between user
    // actions — poll gently while any login is pending so the panel notices.
    refetchInterval: (query) => ((query.state.data?.pending.length ?? 0) > 0 ? PENDING_POLL_MS : false),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: subscriptionsAppKeys.list });

  function clearAuthUrl(provider: string): void {
    setAuthUrls((prev) => {
      if (!(provider in prev)) return prev;
      const next = { ...prev };
      delete next[provider];
      return next;
    });
  }

  const startLogin = useMutation({
    mutationFn: (provider: string) => subscriptionsApi.loginStart(provider),
    onSuccess: async (result, provider) => {
      setAuthUrls((prev) => ({ ...prev, [provider]: result.authorizationUrl }));
      await invalidate();
    },
    onError: (error: unknown) => toast({ title: "Sign-in failed to start", description: formatError(error), tone: "danger" }),
  });

  const finishLogin = useMutation({
    mutationFn: ({ provider, code }: { provider: string; code: string }) => subscriptionsApi.loginFinish(provider, code),
    onSuccess: async (_result, { provider }) => {
      clearAuthUrl(provider);
      await invalidate();
      toast({ title: "Signed in", description: provider, tone: "success" });
    },
    onError: (error: unknown, { provider }) =>
      toast({ title: `Sign-in failed: ${provider}`, description: formatError(error), tone: "danger" }),
  });

  const cancelPending = useMutation({
    mutationFn: (provider: string) => subscriptionsApi.cancelPending(provider),
    onSuccess: async (_result, provider) => {
      clearAuthUrl(provider);
      await invalidate();
    },
    onError: (error: unknown) => toast({ title: "Cancel failed", description: formatError(error), tone: "danger" }),
  });

  const refresh = useMutation({
    mutationFn: (provider: string) => subscriptionsApi.refresh(provider),
    onSuccess: async (_result, provider) => {
      await invalidate();
      toast({ title: "Subscription refreshed", description: provider, tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Refresh failed", description: formatError(error), tone: "danger" }),
  });

  const logout = useMutation({
    mutationFn: (provider: string) => subscriptionsApi.logout(provider),
    onSuccess: async () => {
      setPendingLogout(null);
      await invalidate();
      toast({ title: "Signed out", tone: "info" });
    },
    onError: (error: unknown) => {
      setPendingLogout(null);
      toast({ title: "Sign out failed", description: formatError(error), tone: "danger" });
    },
  });

  const data = list.data;
  const isEmpty = list.isSuccess && data && data.subscriptions.length === 0 && data.pending.length === 0 && data.available.length === 0;
  const knownProviders = new Set([...(data?.subscriptions ?? []).map((s) => s.provider), ...(data?.pending ?? []).map((p) => p.provider)]);

  return (
    <section className="providers-panel providers-subscriptions" aria-label="Provider subscriptions">
      <div className="providers-panel__title">
        <h3>Subscriptions</h3>
        <div className="providers-custom__title-actions">
          <button
            type="button"
            className="providers-icon-button"
            aria-label="Refresh subscriptions"
            onClick={() => void list.refetch()}
          >
            <RefreshCw size={14} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
          <ShieldCheck size={16} aria-hidden="true" />
        </div>
      </div>

      <p className="providers-custom__note">
        OAuth-backed provider logins, shared with the TUI via <code>~/.goodvibes/tui/subscriptions.json</code> — sign
        in here or in the TUI and both surfaces see it. OpenAI (Codex) works out of the box (bundled client id);
        other providers need their OAuth config registered under Settings &gt; Secrets &amp; Services first.
      </p>

      {list.isPending && <SkeletonBlock variant="block" height={80} />}

      {list.isError && (
        <ErrorState error={list.error} title="Failed to load subscriptions" onRetry={() => void list.refetch()} />
      )}

      {list.isSuccess && isEmpty && (
        <EmptyState
          icon={<ShieldCheck size={24} aria-hidden="true" />}
          title="No subscription providers"
          description="No OAuth-backed subscription providers are configured or built in."
        />
      )}

      {list.isSuccess && data && !isEmpty && (
        <div className="providers-model-grid" role="list" aria-label="Subscriptions">
          {data.subscriptions.map((sub) => (
            <SubscriptionRow
              key={sub.provider}
              subscription={sub}
              refreshing={refresh.isPending && refresh.variables === sub.provider}
              onRefresh={() => refresh.mutate(sub.provider)}
              onSignOut={() => setPendingLogout(sub.provider)}
            />
          ))}

          {data.pending.map((p) => (
            <PendingLoginRow
              key={p.provider}
              pending={p}
              authorizationUrl={authUrls[p.provider]}
              finishing={finishLogin.isPending && finishLogin.variables?.provider === p.provider}
              cancelling={cancelPending.isPending && cancelPending.variables === p.provider}
              onFinish={(code) => finishLogin.mutate({ provider: p.provider, code })}
              onCancel={() => cancelPending.mutate(p.provider)}
            />
          ))}

          {data.available
            .filter((a) => !knownProviders.has(a.provider))
            .map((a) => (
              <AvailableProviderRow
                key={a.provider}
                provider={a}
                starting={startLogin.isPending && startLogin.variables === a.provider}
                onStart={() => startLogin.mutate(a.provider)}
              />
            ))}
        </div>
      )}

      <ConfirmSurface
        open={pendingLogout !== null}
        action="Sign out"
        target={pendingLogout ?? ""}
        blastRadius="Removes this provider's stored OAuth tokens from ~/.goodvibes/tui/subscriptions.json — shared with the TUI, so it signs out there too. Any override of ambient API keys for this provider stops applying."
        danger
        confirmLabel={logout.isPending ? "Signing out…" : "Sign out"}
        onCancel={() => setPendingLogout(null)}
        onConfirm={() => {
          if (pendingLogout) logout.mutate(pendingLogout);
        }}
      />
    </section>
  );
}

// ─── rows ────────────────────────────────────────────────────────────────────

function SubscriptionRow({
  subscription,
  refreshing,
  onRefresh,
  onSignOut,
}: {
  subscription: SafeSubscription;
  refreshing: boolean;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  return (
    <article className="providers-model-row" role="listitem">
      <div className="providers-model-row__copy">
        <strong>{subscription.provider}</strong>
        <span>
          {subscription.tokenType} token
          {subscription.expiresAt !== undefined
            ? ` · expires ${new Date(subscription.expiresAt).toLocaleString()}`
            : " · no expiry reported"}
          {subscription.hasRefreshToken ? "" : " · no refresh token stored"}
        </span>
        {subscription.scopes && subscription.scopes.length > 0 && (
          <span className="providers-accounts__routes">Scopes: {subscription.scopes.join(", ")}</span>
        )}
      </div>
      <div className="providers-model-row__actions">
        <StatusBadge value={subscription.overrideAmbientApiKeys ? "overrides ambient keys" : "subscription only"} />
        <button
          type="button"
          className="providers-button"
          disabled={refreshing || !subscription.hasRefreshToken}
          title={subscription.hasRefreshToken ? undefined : "No refresh token stored for this provider"}
          onClick={onRefresh}
        >
          <RefreshCw size={13} aria-hidden="true" className={refreshing ? "spinning" : undefined} />{" "}
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        <button type="button" className="providers-button providers-button--danger" onClick={onSignOut}>
          <LogOut size={13} aria-hidden="true" /> Sign out
        </button>
      </div>
    </article>
  );
}

function PendingLoginRow({
  pending,
  authorizationUrl,
  finishing,
  cancelling,
  onFinish,
  onCancel,
}: {
  pending: SafePending;
  authorizationUrl?: string;
  finishing: boolean;
  cancelling: boolean;
  onFinish: (code: string) => void;
  onCancel: () => void;
}) {
  const [codeInput, setCodeInput] = useState("");

  return (
    <article className="providers-model-row providers-subscriptions__pending" role="listitem">
      <div className="providers-model-row__copy">
        <strong>{pending.provider}</strong>
        <span className="providers-custom__note" role="status">
          <Loader2 size={12} className="spinning" aria-hidden="true" /> Waiting for automatic redirect capture — or
          paste the code (or the full redirect URL) below.
        </span>
        {authorizationUrl && (
          <a className="providers-button" href={authorizationUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={13} aria-hidden="true" /> Open sign-in page
          </a>
        )}
        <div className="providers-subscriptions__row">
          <input
            type="text"
            className="providers-subscriptions__input"
            placeholder="Authorization code or redirect URL"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            disabled={finishing}
            aria-label={`${pending.provider} authorization code or redirect URL`}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="providers-button providers-button--primary"
            disabled={!codeInput.trim() || finishing}
            onClick={() => {
              onFinish(codeInput.trim());
              setCodeInput("");
            }}
          >
            {finishing ? "Finishing…" : "Finish sign-in"}
          </button>
        </div>
      </div>
      <button type="button" className="providers-button" disabled={cancelling} onClick={onCancel}>
        <X size={13} aria-hidden="true" /> {cancelling ? "Cancelling…" : "Cancel"}
      </button>
    </article>
  );
}

function AvailableProviderRow({
  provider,
  starting,
  onStart,
}: {
  provider: AvailableProvider;
  starting: boolean;
  onStart: () => void;
}) {
  return (
    <article className="providers-model-row" role="listitem">
      <div className="providers-model-row__copy">
        <strong>{provider.displayName || provider.provider}</strong>
        <span>
          {provider.builtin
            ? "Built in — works out of the box, no setup required."
            : "Needs an OAuth service config registered under Settings > Secrets & Services."}
        </span>
      </div>
      <div className="providers-model-row__actions">
        <button type="button" className="providers-button providers-button--primary" disabled={starting} onClick={onStart}>
          {starting ? "Starting…" : "Sign in"}
        </button>
      </div>
    </article>
  );
}
