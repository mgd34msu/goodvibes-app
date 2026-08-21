// Daemon-held credential writes (credentials.set / credentials.delete), the
// write counterpart to the secret-free status table above.
//
// This is NOT the Secrets & Services tab. That tab drives src/bun/secrets.ts,
// this app's handle on the SURFACE secret store (~/.goodvibes/tui/secrets.enc),
// keyed by secret name and shared with the TUI. This section writes a
// credential the DAEMON executes with, keyed by config path, into the daemon's
// own tier, through the daemon. The copy on screen says so, because picking the
// wrong one of the two is a credential that reports saved and is never found:
// the mailbox password that never polls, the bot token the daemon cannot see.
//
// One verb, not two writes. The daemon derives the store key from the config
// path, writes the value at the scope its ownership rules resolve, reads it
// back and compares, and only then replaces the config value with its
// goodvibes://secrets/ reference. A mismatch fails the call and leaves the
// setting untouched, so config never names a reference resolving to nothing.
//
// The value never comes back and never leaves this component: it goes from the
// masked input straight to the verb and is cleared. Every receipt rendered
// below is key names, scopes and the reference, which is what the daemon
// returns on purpose.

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { queryKeys } from "../../lib/queries.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { settingsKeys } from "./settings-queries.ts";
import {
  credentialKeySuggestions,
  daemonCredentialRefusal,
  describeWriteReceipt,
  readCredentialClearReceipt,
  readCredentialWriteReceipt,
  type CredentialWriteReceipt,
} from "./daemon-credentials.ts";

const KEY_DATALIST_ID = "daemon-credential-keys";

export function DaemonCredentialsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [configKey, setConfigKey] = useState("");
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState<"store" | "clear" | null>(null);
  // Kept on screen after the toast fades: which store took the credential, and
  // what the config key now points at, is a thing to be able to re-read.
  const [receipt, setReceipt] = useState<CredentialWriteReceipt | null>(null);
  const [refusalNote, setRefusalNote] = useState<{ title: string; description: string } | null>(null);

  const suggestions = useMemo(() => credentialKeySuggestions(), []);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: settingsKeys.credentials }),
      queryClient.invalidateQueries({ queryKey: queryKeys.configAll }),
    ]);

  function reportRefusal(error: unknown, fallbackTitle: string): void {
    const refusal = daemonCredentialRefusal(error);
    const description = refusal ? refusal.description : formatError(error);
    setRefusalNote({ title: refusal ? refusal.title : fallbackTitle, description });
    toast({ title: refusal ? refusal.title : fallbackTitle, description, tone: "danger" });
  }

  const store = useMutation({
    // credentials.set is dangerous-flagged, and its input schema is
    // additionalProperties:false with only {key, value}: the confirm gate is
    // this surface's ConfirmSurface, and nothing but the two contract fields
    // rides the wire (an extra `confirm` key would fail validation).
    mutationFn: (input: { key: string; value: string }) => gv.config.credentialSet(input.key, input.value),
    onSuccess: async (result, input) => {
      setConfirming(null);
      setValue("");
      setRefusalNote(null);
      const parsed = readCredentialWriteReceipt(result);
      setReceipt(parsed);
      await invalidate();
      toast({
        title: `Credential stored for ${input.key}`,
        description: describeWriteReceipt(parsed),
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      setConfirming(null);
      setReceipt(null);
      reportRefusal(error, "Credential write failed");
    },
  });

  const clear = useMutation({
    mutationFn: (key: string) => gv.config.credentialDelete(key),
    onSuccess: async (result, key) => {
      setConfirming(null);
      setRefusalNote(null);
      setReceipt(null);
      const parsed = readCredentialClearReceipt(result);
      await invalidate();
      toast({
        // cleared:false means nothing was stored under that key. Asking for a
        // credential to be gone when it already is has succeeded.
        title: parsed.cleared ? `Credential cleared for ${key}` : "Nothing was stored under that key",
        description: parsed.cleared
          ? `${parsed.secretKey || "The stored secret"} was removed from the ${parsed.scope || "resolved"} tier and the config reference with it.`
          : `${key} had no stored credential to remove.`,
        tone: "info",
      });
    },
    onError: (error: unknown) => {
      setConfirming(null);
      reportRefusal(error, "Credential clear failed");
    },
  });

  const keyValid = configKey.trim().length > 0;
  const canStore = keyValid && value.length > 0 && !store.isPending;

  return (
    <section className="settings-daemon-credentials" aria-label="Daemon-held credentials">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <ShieldCheck size={14} aria-hidden="true" /> Store a credential on the daemon
        </span>
      </div>

      <p className="settings-daemon-credentials__note">
        For settings the <strong>daemon</strong> executes with (<code>surfaces.*</code> bot tokens and mailbox
        passwords, <code>payments.*</code> card fields), named by their <strong>config key</strong>. The daemon writes
        the value into its own store, reads it back to check, and only then points the config key at it, so the
        setting and the credential can never end up in different trees. The value is never returned, logged, or shown
        again.
      </p>
      <p className="settings-daemon-credentials__note settings-daemon-credentials__note--aside">
        Credentials this <strong>app</strong> uses (and the shared surface store the TUI reads) are a different store,
        keyed by secret name, on the Secrets &amp; Services tab. Neither is a fallback for the other.
      </p>

      <form
        className="settings-daemon-credentials__form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (canStore) setConfirming("store");
        }}
      >
        <label className="settings-daemon-credentials__field">
          <span className="settings-daemon-credentials__field-label">Config key</span>
          <input
            type="text"
            list={KEY_DATALIST_ID}
            value={configKey}
            onChange={(e) => {
              setConfigKey(e.target.value);
              setRefusalNote(null);
            }}
            placeholder="surfaces.telegram.botToken"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="daemon-credential-key-hint"
          />
          <datalist id={KEY_DATALIST_ID}>
            {suggestions.map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>
          <span className="settings-daemon-credentials__hint" id="daemon-credential-key-hint">
            Suggestions come from the pinned config schema. The daemon decides what counts as credential-bearing and
            refuses anything else by name, so a key that is missing here is still worth trying.
          </span>
        </label>

        <label className="settings-daemon-credentials__field">
          <span className="settings-daemon-credentials__field-label">Value</span>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste the credential"
            autoComplete="off"
            spellCheck={false}
            aria-label="Credential value"
          />
          <span className="settings-daemon-credentials__hint">
            Masked here and secret-free on the wire back. Paste a <code>goodvibes://secrets/…</code> reference into the
            config key itself instead: this verb refuses one, because there would be nothing to store.
          </span>
        </label>

        <div className="settings-daemon-credentials__actions">
          <button type="submit" className="settings-daemon-credentials__submit" disabled={!canStore}>
            <KeyRound size={14} aria-hidden="true" />
            {store.isPending ? "Storing…" : "Store on the daemon…"}
          </button>
          <button
            type="button"
            className="settings-daemon-credentials__submit settings-daemon-credentials__submit--danger"
            disabled={!keyValid || clear.isPending}
            onClick={() => setConfirming("clear")}
          >
            <Trash2 size={14} aria-hidden="true" />
            {clear.isPending ? "Clearing…" : "Clear this credential…"}
          </button>
        </div>
      </form>

      {refusalNote && (
        <div className="settings-refused" role="status">
          <strong>{refusalNote.title}</strong>
          <span>{refusalNote.description}</span>
        </div>
      )}

      {receipt && (
        <dl className="settings-daemon-credentials__receipt" aria-label="Last credential write">
          <dt>Config key</dt>
          <dd>
            <code>{receipt.key}</code>
          </dd>
          <dt>Store key</dt>
          <dd>
            <code>{receipt.secretKey}</code>
          </dd>
          <dt>Credential tier</dt>
          <dd>{receipt.scope || "unreported"}</dd>
          {receipt.configScope && (
            <>
              <dt>Config tier</dt>
              <dd>{receipt.configScope}</dd>
            </>
          )}
          <dt>Reference in config</dt>
          <dd>
            <code>{receipt.reference}</code>
          </dd>
          {/* The daemon's own two sentences about where each half is filed,
              rendered verbatim rather than paraphrased. */}
          {receipt.ownership && (
            <>
              <dt>Setting</dt>
              <dd>{receipt.ownership}</dd>
            </>
          )}
          {receipt.credentialScope && (
            <>
              <dt>Credential</dt>
              <dd>{receipt.credentialScope}</dd>
            </>
          )}
        </dl>
      )}

      <ConfirmSurface
        open={confirming === "store"}
        action="Store a credential on the daemon"
        // The KEY only. Echoing the value into a confirmation surface would put
        // the credential on screen, which is the one thing this flow avoids.
        target={configKey.trim()}
        blastRadius="The daemon writes the value into its own credential store, verifies it reads back, and replaces this config key's value with a goodvibes://secrets/ reference. Every surface sharing this daemon starts using it on the next run."
        confirmLabel={store.isPending ? "Storing…" : "Store credential"}
        onCancel={() => setConfirming(null)}
        onConfirm={() => store.mutate({ key: configKey.trim(), value })}
      />

      <ConfirmSurface
        open={confirming === "clear"}
        action="Clear a daemon credential"
        target={configKey.trim()}
        blastRadius="Removes the stored secret and then the config reference that pointed at it. Anything the daemon does with this setting stops working until a new credential is stored."
        danger
        requireTypedText={configKey.trim()}
        confirmLabel={clear.isPending ? "Clearing…" : "Clear credential"}
        onCancel={() => setConfirming(null)}
        onConfirm={() => clear.mutate(configKey.trim())}
      />
    </section>
  );
}
