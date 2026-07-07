// Peers — remote.peers.list/disconnect/token.rotate/token.revoke (docs/FEATURES.md
// §21 row 2). Master list + right detail peek (fleet/approvals idiom). All
// four mutations are admin-scoped on the wire; disconnect gets a plain admin
// confirm, token rotate/revoke get a DANGER confirm because both immediately
// break the peer's ability to reconnect (rotate invalidates the OLD token the
// instant the NEW one is issued; revoke has no automatic replacement).
//
// No `remote.peers.get` exists — the detail peek reads the same cached
// `remote.peers.list` query via TanStack Query's `select`, so it updates
// live on every 20s poll and immediately after any mutation invalidates the
// shared "peers" prefix, without a second network call.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Network, RefreshCw, ShieldOff, Unplug } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import {
  compactJson,
  formatAbsolute,
  formatRelative,
  isPeerReachable,
  peersFromResponse,
  peersKeys,
  REMOTE_POLL_MS,
  type PeerRecord,
} from "./peers-model.ts";

const listQueryFn = () => gv.invoke("remote.peers.list");

export function PeersSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const peek = usePeek();

  const [disconnectTarget, setDisconnectTarget] = useState<PeerRecord | null>(null);
  const [rotateTarget, setRotateTarget] = useState<PeerRecord | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ peer: PeerRecord; tokenId: string; tokenLabel: string } | null>(
    null,
  );

  const list = useQuery({
    queryKey: peersKeys.list,
    queryFn: listQueryFn,
    refetchInterval: REMOTE_POLL_MS,
  });
  const rows = peersFromResponse(list.data);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: peersKeys.all });

  const disconnect = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      gv.invoke("remote.peers.disconnect", { params: { peerId: id }, body: { ...meta } }),
    onSuccess: async () => {
      setDisconnectTarget(null);
      await invalidate();
      toast({ title: "Peer disconnected", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Disconnect failed (admin scope required)", description: formatError(error), tone: "danger" });
    },
  });

  const rotate = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: ConfirmMetadata }) =>
      gv.invoke("remote.peers.token.rotate", { params: { peerId: id }, body: { ...meta } }),
    onSuccess: async () => {
      setRotateTarget(null);
      await invalidate();
      toast({ title: "Token rotated — the peer's previous token no longer works", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Token rotation failed (admin scope required)", description: formatError(error), tone: "danger" });
    },
  });

  const revoke = useMutation({
    mutationFn: ({ id, tokenId, meta }: { id: string; tokenId: string; meta: ConfirmMetadata }) =>
      gv.invoke("remote.peers.token.revoke", { params: { peerId: id }, body: { tokenId, ...meta } }),
    onSuccess: async () => {
      setRevokeTarget(null);
      await invalidate();
      toast({ title: "Token revoked — the peer can no longer authenticate", tone: "info" });
    },
    onError: (error: unknown) => {
      toast({ title: "Token revocation failed (admin scope required)", description: formatError(error), tone: "danger" });
    },
  });

  const unavailable = list.isError && isMethodUnavailableError(list.error);

  function openDetail(peer: PeerRecord): void {
    peek.open({
      title: peer.label,
      content: (
        <PeerDetailContent
          peerId={peer.id}
          onRevokeToken={(tokenId, tokenLabel) =>
            setRevokeTarget({ peer, tokenId, tokenLabel: tokenLabel || tokenId })
          }
        />
      ),
    });
  }

  return (
    <section className="peers-section" aria-label="Peers">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Network size={14} aria-hidden="true" /> Peers
          {list.isSuccess ? ` · ${rows.length} paired` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh peers"
          onClick={() => void list.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {list.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState
          capability="remote.peers.list"
          description="paired nodes and devices cannot be listed or managed."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load peers" />
      )}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<Network size={28} aria-hidden="true" />}
          title="No peers connected"
          description="Peers are other goodvibes nodes or companion devices paired to this daemon over the network — they can send status updates and pull queued work. On a single-node install there are none by default; approve a pairing request below to connect one."
        />
      )}

      {list.isSuccess && rows.length > 0 && (
        <ul className="peer-rows">
          {rows.map((peer) => (
            <li key={peer.id}>
              <div className="peer-row">
                <button type="button" className="peer-row__main" onClick={() => openDetail(peer)}>
                  <span className="peer-row__label">{peer.label}</span>
                  <span className="badge neutral">{peer.kind}</span>
                  <StatusBadge value={peer.status} />
                  {peer.platform && <span className="peer-row__meta">{peer.platform}</span>}
                  {peer.version && <span className="peer-row__meta">v{peer.version}</span>}
                  {peer.lastSeenAt !== undefined && (
                    <span className="peer-row__meta" title={formatAbsolute(peer.lastSeenAt)}>
                      seen {formatRelative(peer.lastSeenAt)}
                    </span>
                  )}
                </button>
                <span className="peer-row__actions">
                  <button
                    type="button"
                    className="peers-btn"
                    onClick={() => setRotateTarget(peer)}
                    title="Issue a new token for this peer"
                  >
                    <KeyRound size={13} aria-hidden="true" /> Rotate token
                  </button>
                  {isPeerReachable(peer) && (
                    <button
                      type="button"
                      className="peers-btn peers-btn--danger"
                      onClick={() => setDisconnectTarget(peer)}
                    >
                      <Unplug size={13} aria-hidden="true" /> Disconnect
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmSurface
        open={disconnectTarget !== null}
        action="Disconnect peer"
        target={disconnectTarget ? `${disconnectTarget.label} (${disconnectTarget.id})` : ""}
        blastRadius="The peer's live connection is dropped immediately. Its pairing and tokens stay valid, so it can reconnect and resume pulling work on its own."
        confirmLabel="Disconnect"
        onConfirm={(meta) => {
          if (disconnectTarget) disconnect.mutate({ id: disconnectTarget.id, meta });
        }}
        onCancel={() => setDisconnectTarget(null)}
      />

      <ConfirmSurface
        open={rotateTarget !== null}
        action="Rotate peer token"
        target={rotateTarget ? `${rotateTarget.label} (${rotateTarget.id})` : ""}
        blastRadius="A new token is issued for this peer and its current token is invalidated in the same action. The peer must adopt the new token to reconnect — anything still using the old token starts failing immediately."
        danger
        confirmLabel="Rotate token"
        onConfirm={(meta) => {
          if (rotateTarget) rotate.mutate({ id: rotateTarget.id, meta });
        }}
        onCancel={() => setRotateTarget(null)}
      />

      <ConfirmSurface
        open={revokeTarget !== null}
        action="Revoke peer token"
        target={revokeTarget ? `${revokeTarget.tokenLabel} — ${revokeTarget.peer.label}` : ""}
        blastRadius="This token stops authenticating immediately and permanently — there is no automatic replacement. The peer loses access until an operator rotates a new token for it."
        danger
        confirmLabel="Revoke token"
        onConfirm={(meta) => {
          if (revokeTarget) revoke.mutate({ id: revokeTarget.peer.id, tokenId: revokeTarget.tokenId, meta });
        }}
        onCancel={() => setRevokeTarget(null)}
      />
    </section>
  );
}

// ─── Detail peek — reads the same cached list query, no extra request ──────

function PeerDetailContent({
  peerId,
  onRevokeToken,
}: {
  peerId: string;
  onRevokeToken: (tokenId: string, tokenLabel: string) => void;
}) {
  const query = useQuery({
    queryKey: peersKeys.list,
    queryFn: listQueryFn,
    select: (data) => peersFromResponse(data).find((p) => p.id === peerId) ?? null,
  });

  if (query.isPending) return <SkeletonBlock variant="text" lines={5} />;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Failed to load peer" />;
  }

  const peer = query.data;
  if (!peer) {
    return (
      <p className="peer-detail__note" role="note">
        This peer is no longer in the list — it may have been disconnected or its pairing revoked.
      </p>
    );
  }

  return (
    <div className="peer-detail">
      <dl className="peer-detail__facts">
        <dt>Status</dt>
        <dd>
          <StatusBadge value={peer.status} />
        </dd>
        <dt>Kind</dt>
        <dd>{peer.kind}</dd>
        {peer.platform && (
          <>
            <dt>Platform</dt>
            <dd>
              {peer.platform}
              {peer.deviceFamily ? ` · ${peer.deviceFamily}` : ""}
            </dd>
          </>
        )}
        {peer.version && (
          <>
            <dt>Version</dt>
            <dd>{peer.version}</dd>
          </>
        )}
        {peer.clientMode && (
          <>
            <dt>Client mode</dt>
            <dd>{peer.clientMode}</dd>
          </>
        )}
        {peer.lastRemoteAddress && (
          <>
            <dt>Last address</dt>
            <dd>
              <code>{peer.lastRemoteAddress}</code>
            </dd>
          </>
        )}
        {peer.pairedAt !== undefined && (
          <>
            <dt>Paired</dt>
            <dd>{formatAbsolute(peer.pairedAt)}</dd>
          </>
        )}
        {peer.lastSeenAt !== undefined && (
          <>
            <dt>Last seen</dt>
            <dd>
              {formatRelative(peer.lastSeenAt)} · {formatAbsolute(peer.lastSeenAt)}
            </dd>
          </>
        )}
      </dl>

      {peer.capabilities.length > 0 && (
        <div className="peer-detail__tags">
          <span className="peer-detail__tags-label">Capabilities</span>
          {peer.capabilities.map((c) => (
            <span key={c} className="badge neutral">
              {c}
            </span>
          ))}
        </div>
      )}

      {peer.commands.length > 0 && (
        <div className="peer-detail__tags">
          <span className="peer-detail__tags-label">Commands</span>
          {peer.commands.map((c) => (
            <span key={c} className="badge info">
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="peer-detail__tokens">
        <span className="peer-detail__tokens-label">
          <KeyRound size={13} aria-hidden="true" /> Tokens
        </span>
        {peer.tokens.length === 0 ? (
          <p className="peer-detail__note" role="note">
            No tokens on record for this peer.
          </p>
        ) : (
          <ul className="peer-token-rows">
            {peer.tokens.map((token) => (
              <li key={token.id} className="peer-token-row">
                <div className="peer-token-row__head">
                  <span className="peer-token-row__label">
                    {token.label || token.id}
                    {peer.activeTokenId === token.id && <span className="badge ok">active</span>}
                    {token.revokedAt !== undefined && <span className="badge bad">revoked</span>}
                  </span>
                  {token.revokedAt === undefined && (
                    <button
                      type="button"
                      className="peers-btn peers-btn--danger"
                      onClick={() => onRevokeToken(token.id, token.label)}
                    >
                      <ShieldOff size={12} aria-hidden="true" /> Revoke
                    </button>
                  )}
                </div>
                <code className="peer-token-row__fingerprint">{token.fingerprint}</code>
                <span className="peer-token-row__meta">
                  {token.scopes.length > 0 ? token.scopes.join(", ") : "no scopes"}
                  {token.issuedAt !== undefined ? ` · issued ${formatRelative(token.issuedAt)}` : ""}
                  {token.lastUsedAt !== undefined ? ` · used ${formatRelative(token.lastUsedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="peer-detail__raw">
        <summary>Raw record</summary>
        <pre>{compactJson(peer.raw)}</pre>
      </details>
    </div>
  );
}
