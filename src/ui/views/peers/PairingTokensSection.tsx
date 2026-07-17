// Per-device pairing tokens (pairing.tokens.*, SDK ≥1.8). A token's secret is
// never re-served after mint — this list only ever shows name/created/last
// seen. migrate() is the one affordance here that mints a fresh secret, for a
// device still relying on the legacy shared token: it renders exactly once,
// with an explicit reveal + copy, then is gone from this app's memory for
// good (kept in local state only, never in the query cache).
//
// Unlike a browser client, this desktop app cannot swap its OWN live auth
// token client-side (the bearer token lives in the Bun main process — see
// lib/gv.ts's docblock — the webview never holds credentials), so migrate()
// here is purely "mint a token to hand to some other device", not a
// self-upgrade ceremony.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Pencil, RefreshCw, ShieldAlert, Smartphone, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { pairingKeys, readPairingTokens, type PairingTokenRow } from "./pairing-model.ts";

function isCapabilityGap(error: unknown): boolean {
  return isMethodUnavailableError(error) || isWsBridgeUnavailableError(error);
}

export function PairingTokensSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<PairingTokenRow | null>(null);
  const [revokeSharedOpen, setRevokeSharedOpen] = useState(false);
  const [mintedSecret, setMintedSecret] = useState<{ name: string; token: string } | null>(null);

  const tokens = useQuery({
    queryKey: pairingKeys.tokens,
    queryFn: () => gv.pairing.tokens.list(),
    select: readPairingTokens,
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: pairingKeys.tokens });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      gv.pairing.tokens.rename({ id, name }) as Promise<{ renamed?: boolean }>,
    onSuccess: async (result: { renamed?: boolean } | undefined) => {
      setEditingId(null);
      await invalidate();
      if (result?.renamed === false) {
        toast({ title: "Rename failed", description: "The daemon reported no such token.", tone: "danger" });
      }
    },
    onError: (error: unknown) => toast({ title: "Rename failed", description: formatError(error), tone: "danger" }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => gv.pairing.tokens.delete({ id }) as Promise<{ revoked?: boolean }>,
    onSuccess: async (result: { revoked?: boolean } | undefined) => {
      setRevokeTarget(null);
      await invalidate();
      toast(
        result?.revoked === false
          ? { title: "Already revoked", description: "The daemon reported no such token.", tone: "info" }
          : {
              title: "Device revoked",
              description: "That device is signed out immediately and must pair again.",
              tone: "info",
            },
      );
    },
    onError: (error: unknown) => toast({ title: "Revoke failed", description: formatError(error), tone: "danger" }),
  });

  const migrate = useMutation({
    mutationFn: (name: string) =>
      gv.pairing.tokens.migrate({ name }) as Promise<{ token?: { name?: string; token?: string } }>,
    onSuccess: async (result: { token?: { name?: string; token?: string } } | undefined) => {
      await invalidate();
      if (result?.token?.token) {
        setMintedSecret({ name: result.token.name ?? "New device", token: result.token.token });
      }
    },
    onError: (error: unknown) => toast({ title: "Migrate failed", description: formatError(error), tone: "danger" }),
  });

  const revokeShared = useMutation({
    mutationFn: () => gv.pairing.tokens.revokeShared(),
    onSuccess: async () => {
      setRevokeSharedOpen(false);
      await invalidate();
      toast({ title: "Shared token revoked", description: "Any device still using it is now signed out.", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Revoke failed", description: formatError(error), tone: "danger" }),
  });

  async function copyMintedSecret(): Promise<void> {
    if (!mintedSecret) return;
    try {
      await navigator.clipboard.writeText(mintedSecret.token);
      toast({ title: "Token copied", description: "Treat it like a password.", tone: "info" });
    } catch (error) {
      toast({ title: "Copy failed", description: formatError(error), tone: "danger" });
    }
  }

  function startRename(row: PairingTokenRow): void {
    setEditingId(row.id);
    setDraftName(row.name);
  }

  function saveRename(id: string): void {
    const name = draftName.trim();
    if (!name) return;
    rename.mutate({ id, name });
  }

  const unavailable = tokens.isError && isCapabilityGap(tokens.error);
  const rows = tokens.data?.tokens ?? [];
  const legacySharedRevoked = tokens.data?.legacySharedRevoked ?? false;

  return (
    <section className="peers-section" aria-label="Devices and pairing tokens">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <KeyRound size={14} aria-hidden="true" /> Devices &amp; pairing
          {tokens.isSuccess ? ` · ${rows.length} device${rows.length === 1 ? "" : "s"}` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh paired devices"
          onClick={() => void tokens.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={tokens.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      <p className="peer-detail__note">
        Every paired device — a phone, another browser — has its own token. The token itself is
        shown only once, at the moment it is minted; this list never shows one again.
      </p>

      {mintedSecret && (
        <div className="pairing-secret-reveal" role="note">
          <span className="pairing-secret-reveal__label">
            New token for &quot;{mintedSecret.name}&quot; — copy it now, it will not be shown again:
          </span>
          <code className="pairing-secret-reveal__value">{mintedSecret.token}</code>
          <div className="pairing-secret-reveal__actions">
            <button type="button" className="peers-btn" onClick={() => void copyMintedSecret()}>
              <Copy size={13} aria-hidden="true" /> Copy
            </button>
            <button type="button" className="peers-btn" onClick={() => setMintedSecret(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {tokens.isPending && <SkeletonBlock variant="text" lines={3} />}

      {unavailable && (
        <UnavailableState capability="pairing.tokens.list" description="paired devices cannot be listed, renamed, or revoked." />
      )}

      {tokens.isError && !unavailable && (
        <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} title="Failed to load paired devices" />
      )}

      {tokens.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<Smartphone size={28} aria-hidden="true" />}
          title="No per-device tokens yet"
          description="Pairing a device (the hand-off link below) mints one automatically."
        />
      )}

      {tokens.isSuccess && rows.length > 0 && (
        <ul className="peer-rows" aria-label="Paired devices">
          {rows.map((token) => (
            <li key={token.id} className="peer-row">
              {editingId === token.id ? (
                <form
                  className="peer-row__main"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveRename(token.id);
                  }}
                >
                  <label className="visually-hidden" htmlFor={`pairing-token-name-${token.id}`}>
                    Device name
                  </label>
                  <input
                    id={`pairing-token-name-${token.id}`}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="peers-btn" disabled={rename.isPending || !draftName.trim()}>
                    Save
                  </button>
                  <button type="button" className="peers-btn" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="peer-row__main">
                  <span className="peer-row__label">{token.name}</span>
                  <span className="peer-row__meta">
                    created {formatRelative(token.createdAt)} ·{" "}
                    {token.lastSeenAt !== undefined ? `last seen ${formatRelative(token.lastSeenAt)}` : "never seen"}
                  </span>
                </div>
              )}
              {editingId !== token.id && (
                <div className="peer-row__actions">
                  <button type="button" className="peers-btn" aria-label={`Rename ${token.name}`} onClick={() => startRename(token)}>
                    <Pencil size={13} aria-hidden="true" /> Rename
                  </button>
                  <button
                    type="button"
                    className="peers-btn peers-btn--danger"
                    disabled={revoke.isPending && revoke.variables === token.id}
                    onClick={() => setRevokeTarget(token)}
                  >
                    <Trash2 size={13} aria-hidden="true" /> {revoke.isPending && revoke.variables === token.id ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {tokens.isSuccess && !legacySharedRevoked && (
        <div className="pairing-legacy">
          <div className="pairing-legacy__head">
            <ShieldAlert size={16} aria-hidden="true" />
            <strong>Shared token</strong>
          </div>
          <p className="peer-detail__note">
            Older devices may still be signed in with one shared token. Give each its own token
            before revoking the shared one — revoking it signs out anything still using it.
          </p>
          <div className="pairing-legacy__actions">
            <button type="button" className="peers-btn" disabled={migrate.isPending} onClick={() => migrate.mutate("Legacy device")}>
              {migrate.isPending ? "Minting…" : "Mint a token for a legacy device"}
            </button>
            <button type="button" className="peers-btn peers-btn--danger" onClick={() => setRevokeSharedOpen(true)}>
              Revoke the shared token
            </button>
          </div>
        </div>
      )}

      <ConfirmSurface
        open={revokeTarget !== null}
        danger
        action="Revoke this device"
        target={revokeTarget?.name ?? ""}
        blastRadius="That device is signed out immediately and must pair again to reconnect."
        confirmLabel={revoke.isPending ? "Revoking…" : "Revoke"}
        onConfirm={() => {
          if (revokeTarget) revoke.mutate(revokeTarget.id);
        }}
        onCancel={() => setRevokeTarget(null)}
      />

      <ConfirmSurface
        open={revokeSharedOpen}
        danger
        action="Revoke the shared token"
        target="the legacy shared pairing token"
        blastRadius="This permanently disables it. Any device that has not yet migrated to its own token is signed out immediately. This cannot be undone."
        confirmLabel={revokeShared.isPending ? "Revoking…" : "Revoke the shared token"}
        onConfirm={() => revokeShared.mutate()}
        onCancel={() => setRevokeSharedOpen(false)}
      />
    </section>
  );
}
