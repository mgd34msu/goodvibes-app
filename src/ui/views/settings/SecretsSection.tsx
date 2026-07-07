// Secrets manager (docs/FEATURES.md §19): masked list, add/link forms, a
// per-row test button (resolves without ever returning the value), and a
// delete confirm. Backed by src/bun/secrets.ts wrapping the SDK's
// SecretsManager against the SAME shared ~/.goodvibes/tui/secrets.enc the
// TUI/agent use — values NEVER reach this webview; every response here is
// metadata + booleans only.

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { useToast } from "../../lib/toast.ts";
import { formatError } from "../../lib/errors.ts";
import {
  LINK_PROVIDERS,
  isSecretsRouteUnavailable,
  secretsApi,
  secretsKeys,
  type SecretLinkInput,
  type SecretRow,
} from "./secrets-api.ts";
import { SETTINGS_POLL_MS } from "./settings-queries.ts";

type TestOutcome = { ok: boolean; reason?: string } | null;

export function SecretsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestOutcome>>({});

  const list = useQuery({
    queryKey: secretsKeys.list,
    queryFn: () => secretsApi.list(),
    retry: false,
    refetchInterval: SETTINGS_POLL_MS,
  });

  const inspect = useQuery({
    queryKey: secretsKeys.inspect,
    queryFn: () => secretsApi.inspect(),
    retry: false,
    enabled: list.isSuccess,
  });

  const rows = useMemo(() => [...(list.data?.secrets ?? [])].sort((a, b) => a.key.localeCompare(b.key)), [list.data]);

  const setSecret = useMutation({
    mutationFn: (input: { name: string; body: { value: string } | { link: SecretLinkInput }; scope?: "project" | "user" }) =>
      secretsApi.set(input.name, input.body, input.scope),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: secretsKeys.list });
      await queryClient.invalidateQueries({ queryKey: secretsKeys.inspect });
      toast({ title: "Secret saved", description: `"${variables.name}" was stored.`, tone: "success" });
      setAdding(false);
    },
    onError: (error: unknown) => toast({ title: "Failed to save secret", description: formatError(error), tone: "danger" }),
  });

  const testSecret = useMutation({
    mutationFn: (name: string) => secretsApi.test(name),
    onSuccess: (result) => setTestResults((prev) => ({ ...prev, [result.name]: { ok: result.ok, reason: result.reason } })),
    onError: (error: unknown, name) =>
      setTestResults((prev) => ({ ...prev, [name]: { ok: false, reason: formatError(error) } })),
  });

  const removeSecret = useMutation({
    mutationFn: (name: string) => secretsApi.remove(name),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: secretsKeys.list });
      await queryClient.invalidateQueries({ queryKey: secretsKeys.inspect });
      toast({ title: "Secret deleted", description: `"${result.name}" was removed.`, tone: "success" });
      setPendingDelete(null);
    },
    onError: (error: unknown) => toast({ title: "Failed to delete secret", description: formatError(error), tone: "danger" }),
  });

  const unavailable = list.isError && isSecretsRouteUnavailable(list.error);

  return (
    <section className="settings-secrets" aria-label="Secrets manager">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <KeyRound size={14} aria-hidden="true" /> Secrets
          {list.isSuccess ? ` · ${rows.length}` : ""}
        </span>
        <div className="settings-secrets__toolbar-actions">
          <button type="button" className="section-toolbar__refresh" aria-label="Refresh secrets" onClick={() => void list.refetch()}>
            <RefreshCw size={15} aria-hidden="true" className={list.isFetching ? "spinning" : undefined} />
          </button>
          <button type="button" className="settings-secrets__add" onClick={() => setAdding((v) => !v)} disabled={unavailable}>
            <Plus size={13} aria-hidden="true" /> Add secret
          </button>
        </div>
      </div>

      <p className="settings-secrets__note">
        Shared with the TUI and agent — the same <code>~/.goodvibes/tui/secrets.enc</code> store. Values never leave the
        daemon-side process; this list shows names, sources, and flags only. Set a plain value or link to an external
        provider (environment variable, file, command, 1Password, Bitwarden/Vaultwarden, or Bitwarden Secrets Manager).
      </p>

      {inspect.isSuccess && (
        <dl className="settings-secrets__policy">
          <dt>Storage policy</dt>
          <dd>{inspect.data.inspect.policy}</dd>
          <dt>Secure / plaintext</dt>
          <dd>
            {inspect.data.inspect.secureKeys} secure · {inspect.data.inspect.plaintextKeys} plaintext ·{" "}
            {inspect.data.inspect.envBackedKeys} from env
          </dd>
        </dl>
      )}

      {adding && (
        <AddSecretForm
          saving={setSecret.isPending}
          onCancel={() => setAdding(false)}
          onSubmitValue={(name, value, scope) => setSecret.mutate({ name, body: { value }, scope })}
          onSubmitLink={(name, link, scope) => setSecret.mutate({ name, body: { link }, scope })}
        />
      )}

      {list.isPending && <SkeletonBlock variant="text" lines={4} />}

      {unavailable && (
        <UnavailableState
          capability="/app/secrets"
          description="the secrets manager is not part of this build — no secrets can be listed, set, or tested."
        />
      )}

      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load secrets" />
      )}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<KeyRound size={28} aria-hidden="true" />}
          title="No secrets stored"
          description="Nothing in the shared secrets store yet — add one above, or set it from the TUI."
        />
      )}

      {list.isSuccess && rows.length > 0 && (
        <ul className="settings-rows">
          {rows.map((row) => (
            <SecretRowItem
              key={row.key}
              row={row}
              testResult={testResults[row.key] ?? null}
              testing={testSecret.isPending && testSecret.variables === row.key}
              onTest={() => testSecret.mutate(row.key)}
              onDelete={() => setPendingDelete(row.key)}
            />
          ))}
        </ul>
      )}

      <ConfirmSurface
        open={pendingDelete !== null}
        action="Delete secret"
        target={pendingDelete ?? ""}
        blastRadius="Any provider or integration reading this key by name will fail to resolve it until it is re-added."
        danger
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) removeSecret.mutate(pendingDelete);
        }}
      />
    </section>
  );
}

function SecretRowItem({
  row,
  testResult,
  testing,
  onTest,
  onDelete,
}: {
  row: SecretRow;
  testResult: TestOutcome;
  testing: boolean;
  onTest: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="settings-row">
      <div className="settings-row__main">
        <div className="settings-row__head">
          <code className="settings-row__key">{row.key}</code>
          {row.refSource && <span className="badge info">{row.refSource}</span>}
          {row.overriddenByEnv && <span className="badge info">env override</span>}
        </div>
        <span className="settings-row__value settings-row__value--secret">
          {row.source} · {row.scope}
          {row.secure ? " · secure" : row.source !== "env" ? " · plaintext" : ""}
        </span>
        {testResult && (
          <span className={testResult.ok ? "badge ok" : "badge bad"} role="status">
            {testResult.ok ? "resolves" : `failed${testResult.reason ? `: ${testResult.reason}` : ""}`}
          </span>
        )}
      </div>
      <div className="settings-row__actions">
        <button type="button" className="settings-row__edit" onClick={onTest} disabled={testing}>
          {testing ? "Testing…" : "Test"}
        </button>
        {row.source !== "env" && (
          <button type="button" className="settings-row__reset settings-row__reset--danger" onClick={onDelete}>
            <Trash2 size={13} aria-hidden="true" /> Delete
          </button>
        )}
      </div>
    </li>
  );
}

function AddSecretForm({
  saving,
  onCancel,
  onSubmitValue,
  onSubmitLink,
}: {
  saving: boolean;
  onCancel: () => void;
  onSubmitValue: (name: string, value: string, scope: "project" | "user") => void;
  onSubmitLink: (name: string, link: SecretLinkInput, scope: "project" | "user") => void;
}) {
  const [mode, setMode] = useState<"value" | "link">("value");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<"project" | "user">("user");
  const [provider, setProvider] = useState<SecretLinkInput["source"]>("env");
  const [linkFields, setLinkFields] = useState<Record<string, string>>({});

  function buildLink(): SecretLinkInput | null {
    const f = linkFields;
    switch (provider) {
      case "env":
      case "goodvibes":
        return f["id"] ? { source: provider, id: f["id"] } : null;
      case "file":
        return f["path"] ? { source: "file", path: f["path"], selector: f["selector"] || undefined } : null;
      case "exec":
        return f["command"] ? { source: "exec", command: f["command"] } : null;
      case "1password":
      case "onepassword":
        return { source: provider, ref: f["ref"] || undefined, vault: f["vault"] || undefined, item: f["item"] || undefined, field: f["field"] || undefined };
      case "bitwarden":
      case "vaultwarden":
        return f["item"] ? { source: provider, item: f["item"], field: f["field"] || undefined, server: f["server"] || undefined } : null;
      case "bitwarden-secrets-manager":
      case "bws":
        return f["id"] ? { source: provider, id: f["id"], field: f["field"] || undefined } : null;
      default:
        return null;
    }
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!name.trim() || saving) return;
    if (mode === "value") {
      if (!value) return;
      onSubmitValue(name.trim(), value, scope);
      return;
    }
    const link = buildLink();
    if (!link) return;
    onSubmitLink(name.trim(), link, scope);
  }

  return (
    <form className="settings-secrets__form" onSubmit={handleSubmit}>
      <div className="settings-secrets__form-row">
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="OPENAI_API_KEY" autoComplete="off" />
        </label>
        <label>
          <span>Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value === "project" ? "project" : "user")}>
            <option value="user">User (~/.goodvibes)</option>
            <option value="project">Project</option>
          </select>
        </label>
      </div>

      <div className="settings-secrets__mode" role="radiogroup" aria-label="Secret kind">
        <button type="button" className={mode === "value" ? "settings-pref__option settings-pref__option--active" : "settings-pref__option"} onClick={() => setMode("value")}>
          Plain value
        </button>
        <button type="button" className={mode === "link" ? "settings-pref__option settings-pref__option--active" : "settings-pref__option"} onClick={() => setMode("link")}>
          <Link2 size={12} aria-hidden="true" /> Link to provider
        </button>
      </div>

      {mode === "value" && (
        <label className="settings-secrets__value-field">
          <span>Value</span>
          <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      )}

      {mode === "link" && (
        <div className="settings-secrets__link-fields">
          <label>
            <span>Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as SecretLinkInput["source"])}>
              {LINK_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {LINK_FIELD_SPECS[provider]?.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              <input
                value={linkFields[field.key] ?? ""}
                onChange={(e) => setLinkFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
              />
            </label>
          ))}
        </div>
      )}

      <div className="settings-editor__actions">
        <button type="button" className="settings-editor__cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="settings-editor__save" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

const LINK_FIELD_SPECS: Record<string, ReadonlyArray<{ key: string; label: string; placeholder?: string }>> = {
  env: [{ key: "id", label: "Environment variable name", placeholder: "OPENAI_API_KEY" }],
  goodvibes: [{ key: "id", label: "Other secret key to alias" }],
  file: [
    { key: "path", label: "File path", placeholder: "~/.secrets/openai.key" },
    { key: "selector", label: "Selector (optional, e.g. JSON path)" },
  ],
  exec: [{ key: "command", label: "Command", placeholder: "op read op://vault/item/field" }],
  "1password": [
    { key: "ref", label: "op:// reference (optional)" },
    { key: "vault", label: "Vault" },
    { key: "item", label: "Item" },
    { key: "field", label: "Field" },
  ],
  bitwarden: [
    { key: "item", label: "Item name" },
    { key: "field", label: "Field (default: password)" },
    { key: "server", label: "Server URL (optional)" },
  ],
  vaultwarden: [
    { key: "item", label: "Item name" },
    { key: "field", label: "Field (default: password)" },
    { key: "server", label: "Server URL" },
  ],
  "bitwarden-secrets-manager": [
    { key: "id", label: "Secret ID" },
    { key: "field", label: "Field (optional)" },
  ],
};
