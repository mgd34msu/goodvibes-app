// Local-auth panel (docs/FEATURES.md §20, webui AdminView patterns):
// local_auth.status (admin) + users create / delete (D) / password rotate /
// sessions delete (D) / bootstrap-file delete (D). Every mutation is
// admin-scoped; the destructive ones go through ConfirmSurface (the delete
// methods' input schemas are additionalProperties:false, so the confirm
// metadata stays a client-side gate rather than a wire field).

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw, ShieldCheck, UserPlus } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, errorStatus, isMethodUnavailableError } from "../../lib/errors.ts";
import { asArray, asRecord, firstNumber, firstString } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { Modal } from "../../components/Modal.tsx";
import { settingsKeys, SETTINGS_POLL_MS } from "./settings-queries.ts";

interface LocalUser {
  username: string;
  roles: string[];
}

interface LocalSession {
  tokenFingerprint: string;
  username: string;
  expiresAt: number | undefined;
}

function readUsers(data: unknown): LocalUser[] {
  return asArray(asRecord(data)["users"]).map((raw) => ({
    username: firstString(raw, ["username"]),
    roles: asArray(asRecord(raw)["roles"]).filter((r): r is string => typeof r === "string"),
  }));
}

function readSessions(data: unknown): LocalSession[] {
  return asArray(asRecord(data)["sessions"]).map((raw) => ({
    tokenFingerprint: firstString(raw, ["tokenFingerprint"]),
    username: firstString(raw, ["username"]),
    expiresAt: firstNumber(raw, ["expiresAt"]),
  }));
}

type ConfirmTarget =
  | { kind: "user-delete"; username: string }
  | { kind: "session-delete"; session: LocalSession }
  | { kind: "bootstrap-delete" };

export function LocalAuthSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<string | null>(null);

  const status = useQuery({
    queryKey: settingsKeys.localAuth,
    queryFn: () => gv.invoke("local_auth.status"),
    retry: false,
    // No wire event covers local-auth churn — targeted poll.
    refetchInterval: SETTINGS_POLL_MS,
  });

  const users = useMemo(() => readUsers(status.data), [status.data]);
  const sessions = useMemo(() => readSessions(status.data), [status.data]);
  const record = asRecord(status.data);
  const bootstrapPresent = record["bootstrapCredentialPresent"] === true;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: settingsKeys.localAuth });

  // The local_auth delete methods declare additionalProperties:false input
  // schemas (no confirm passthrough on the wire) — the ConfirmSurface gate is
  // client-side, same as sessions.delete.
  const deleteUser = useMutation({
    mutationFn: ({ username }: { username: string }) =>
      gv.invoke("local_auth.users.delete", { params: { username } }),
    onSuccess: async (_r, v) => {
      setConfirmTarget(null);
      await invalidate();
      toast({ title: "User deleted", description: `"${v.username}" removed from the local user store.`, tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Delete failed", description: formatError(error), tone: "danger" }),
  });

  const deleteSession = useMutation({
    mutationFn: ({ session }: { session: LocalSession }) =>
      gv.invoke("local_auth.sessions.delete", {
        params: { sessionId: session.tokenFingerprint },
      }),
    onSuccess: async (_r, v) => {
      setConfirmTarget(null);
      await invalidate();
      toast({ title: "Session revoked", description: `Session for "${v.session.username}" revoked.`, tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Revoke failed", description: formatError(error), tone: "danger" }),
  });

  const deleteBootstrap = useMutation({
    mutationFn: () => gv.invoke("local_auth.bootstrap.delete"),
    onSuccess: async () => {
      setConfirmTarget(null);
      await invalidate();
      toast({ title: "Bootstrap file removed", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Remove failed", description: formatError(error), tone: "danger" }),
  });

  const refused = status.isError && errorStatus(status.error) === 403;
  const unavailable = status.isError && !refused && isMethodUnavailableError(status.error);

  return (
    <section className="settings-auth" aria-label="Local authentication">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <ShieldCheck size={14} aria-hidden="true" /> Local auth
          {status.isSuccess ? ` · ${users.length} users · ${sessions.length} sessions` : ""}
        </span>
        <span className="settings-auth__toolbar-actions">
          <button type="button" className="settings-auth__add" onClick={() => setCreateOpen(true)}>
            <UserPlus size={13} aria-hidden="true" /> New user
          </button>
          <button
            type="button"
            className="section-toolbar__refresh"
            aria-label="Refresh local auth"
            onClick={() => void status.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" className={status.isFetching ? "spinning" : undefined} />
          </button>
        </span>
      </div>

      {status.isPending && <SkeletonBlock variant="text" lines={4} />}

      {refused && (
        <div className="settings-refused" role="status">
          <strong>Admin access required</strong>
          <span>Local-auth administration needs an admin-scoped principal.</span>
        </div>
      )}

      {unavailable && (
        <UnavailableState capability="local_auth.status" description="local user/session administration is not served." />
      )}

      {status.isError && !refused && !unavailable && (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} title="Failed to load local auth" />
      )}

      {status.isSuccess && (
        <>
          <div className="settings-auth__facts">
            <span>
              User store: <code>{firstString(record, ["userStorePath"]) || "unknown"}</code>
            </span>
            <span>
              Bootstrap credential:{" "}
              {bootstrapPresent ? (
                <>
                  <strong className="settings-auth__warn">present</strong> at{" "}
                  <code>{firstString(record, ["bootstrapCredentialPath"]) || "unknown"}</code>{" "}
                  <button
                    type="button"
                    className="settings-auth__danger-btn"
                    onClick={() => setConfirmTarget({ kind: "bootstrap-delete" })}
                  >
                    Remove file
                  </button>
                </>
              ) : (
                "absent"
              )}
            </span>
          </div>

          <h3 className="settings-auth__subhead">Users</h3>
          {users.length === 0 ? (
            <EmptyState
              title="No local users"
              description="Create a username/password pair for browser or remote sign-in."
              action={{ label: "New user", onClick: () => setCreateOpen(true) }}
            />
          ) : (
            <ul className="settings-auth__list">
              {users.map((user) => (
                <li key={user.username} className="settings-auth__item">
                  <span className="settings-auth__name">{user.username}</span>
                  <span className="settings-auth__roles">{user.roles.join(", ") || "no roles"}</span>
                  <span className="settings-auth__item-actions">
                    <button type="button" className="settings-auth__btn" onClick={() => setRotateTarget(user.username)}>
                      <KeyRound size={12} aria-hidden="true" /> Rotate password
                    </button>
                    <button
                      type="button"
                      className="settings-auth__danger-btn"
                      onClick={() => setConfirmTarget({ kind: "user-delete", username: user.username })}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="settings-auth__subhead">Active sessions</h3>
          {sessions.length === 0 ? (
            <EmptyState title="No active sessions" description="Browser/remote login sessions appear here." />
          ) : (
            <ul className="settings-auth__list">
              {sessions.map((session) => (
                <li key={session.tokenFingerprint} className="settings-auth__item">
                  <code className="settings-auth__fingerprint">{session.tokenFingerprint}</code>
                  <span className="settings-auth__name">{session.username}</span>
                  <span className="settings-auth__expiry">
                    {session.expiresAt !== undefined
                      ? `expires ${new Date(session.expiresAt).toLocaleString()}`
                      : "no expiry recorded"}
                  </span>
                  <button
                    type="button"
                    className="settings-auth__danger-btn"
                    onClick={() => setConfirmTarget({ kind: "session-delete", session })}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void invalidate();
        }}
      />

      <RotatePasswordModal
        username={rotateTarget}
        onClose={() => setRotateTarget(null)}
        onRotated={() => {
          setRotateTarget(null);
          void invalidate();
        }}
      />

      <ConfirmSurface
        open={confirmTarget?.kind === "user-delete"}
        action="Delete local user"
        target={confirmTarget?.kind === "user-delete" ? confirmTarget.username : ""}
        blastRadius="The user can no longer sign in; their existing sessions stop authenticating. This does not touch daemon data or agent work."
        danger
        requireTypedText={confirmTarget?.kind === "user-delete" ? confirmTarget.username : undefined}
        confirmLabel="Delete user"
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          if (confirmTarget?.kind === "user-delete") deleteUser.mutate({ username: confirmTarget.username });
        }}
      />

      <ConfirmSurface
        open={confirmTarget?.kind === "session-delete"}
        action="Revoke login session"
        target={
          confirmTarget?.kind === "session-delete"
            ? `${confirmTarget.session.username} (${confirmTarget.session.tokenFingerprint})`
            : ""
        }
        blastRadius="The surface holding this session is signed out immediately and must log in again."
        danger
        confirmLabel="Revoke session"
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          if (confirmTarget?.kind === "session-delete") deleteSession.mutate({ session: confirmTarget.session });
        }}
      />

      <ConfirmSurface
        open={confirmTarget?.kind === "bootstrap-delete"}
        action="Remove bootstrap credential file"
        target={firstString(record, ["bootstrapCredentialPath"]) || "bootstrap credential file"}
        blastRadius="The one-time bootstrap credential is deleted from disk. Anything still relying on it can no longer sign in; existing users and sessions are unaffected."
        danger
        confirmLabel="Remove file"
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => deleteBootstrap.mutate()}
      />
    </section>
  );
}

// ─── Create user ─────────────────────────────────────────────────────────────

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const create = useMutation({
    mutationFn: () => gv.invoke("local_auth.users.create", { body: { username: username.trim(), password } }),
    onSuccess: () => {
      toast({ title: "User created", description: `"${username.trim()}" can now sign in.`, tone: "success" });
      setUsername("");
      setPassword("");
      onCreated();
    },
    onError: (error: unknown) => toast({ title: "Create failed", description: formatError(error), tone: "danger" }),
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!username.trim() || !password || create.isPending) return;
    create.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title="New local user">
      <form className="settings-auth__form" onSubmit={handleSubmit}>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <div className="settings-auth__form-actions">
          <button type="button" onClick={onClose} disabled={create.isPending}>
            Cancel
          </button>
          <button type="submit" className="settings-auth__primary" disabled={!username.trim() || !password || create.isPending}>
            {create.isPending ? "Creating…" : "Create user"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Rotate password ─────────────────────────────────────────────────────────

function RotatePasswordModal({
  username,
  onClose,
  onRotated,
}: {
  username: string | null;
  onClose: () => void;
  onRotated: () => void;
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");

  const rotate = useMutation({
    mutationFn: (user: string) =>
      gv.invoke("local_auth.users.password.rotate", { params: { username: user }, body: { password } }),
    onSuccess: (_r, user) => {
      toast({ title: "Password rotated", description: `New password set for "${user}".`, tone: "success" });
      setPassword("");
      onRotated();
    },
    onError: (error: unknown) => toast({ title: "Rotate failed", description: formatError(error), tone: "danger" }),
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!username || !password || rotate.isPending) return;
    rotate.mutate(username);
  }

  return (
    <Modal open={username !== null} onClose={onClose} title={`Rotate password — ${username ?? ""}`}>
      <form className="settings-auth__form" onSubmit={handleSubmit}>
        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <p className="settings-auth__form-note">Existing sessions for this user keep working until they expire or are revoked.</p>
        <div className="settings-auth__form-actions">
          <button type="button" onClick={onClose} disabled={rotate.isPending}>
            Cancel
          </button>
          <button type="submit" className="settings-auth__primary" disabled={!password || rotate.isPending}>
            {rotate.isPending ? "Rotating…" : "Rotate password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
