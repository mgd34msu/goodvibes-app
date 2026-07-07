// Notification targets (ntfy/webhook) manage + test (docs/GAPS.md §19 row 14,
// PARTIAL). The generic schema-driven Settings editor (ConfigSettingsSection)
// already reads/writes surfaces.ntfy.*/surfaces.webhook.* — this card curates
// just those keys into one focused view, plus the one thing the generic
// editor cannot do: send a REAL test notification through the outbound ntfy
// or webhook target. That requires an actual channel-surface action, not a
// config write, so it probes channels.actions.list for a registered
// ntfy/webhook action whose id/label reads as a test/send action and invokes
// it through channels.actions.invoke (admin-scoped). If no such action is
// registered on this daemon, the button honestly falls back to firing the
// app's own local notification bridge (/app/notifications/notify) instead of
// pretending to reach the real target.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, RefreshCw, Send } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, errorStatus, isMethodUnavailableError } from "../../lib/errors.ts";
import { asRecord, firstArrayAtPath, firstString } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { readConfigKey } from "../providers/model-catalog.ts";
import { isSecretConfigKey, maskSecretValue } from "./config-redaction.ts";
import { notificationsApi } from "./notifications-api.ts";
import { settingsKeys, SETTINGS_POLL_MS } from "./settings-queries.ts";

interface TargetField {
  key: string;
  label: string;
  type: "boolean" | "string" | "number" | "secret";
}

const NTFY_FIELDS: readonly TargetField[] = [
  { key: "surfaces.ntfy.enabled", label: "Enabled", type: "boolean" },
  { key: "surfaces.ntfy.baseUrl", label: "Base URL", type: "string" },
  { key: "surfaces.ntfy.topic", label: "Default topic", type: "string" },
  { key: "surfaces.ntfy.chatTopic", label: "Chat topic", type: "string" },
  { key: "surfaces.ntfy.agentTopic", label: "Agent topic", type: "string" },
  { key: "surfaces.ntfy.remoteTopic", label: "Remote-chat topic", type: "string" },
  { key: "surfaces.ntfy.token", label: "Access token", type: "secret" },
  { key: "surfaces.ntfy.defaultPriority", label: "Default priority (1-5)", type: "number" },
];

const WEBHOOK_FIELDS: readonly TargetField[] = [
  { key: "surfaces.webhook.enabled", label: "Enabled", type: "boolean" },
  { key: "surfaces.webhook.defaultTarget", label: "Default target URL", type: "string" },
  { key: "surfaces.webhook.timeoutMs", label: "Timeout (ms)", type: "number" },
  { key: "surfaces.webhook.secret", label: "Signing secret", type: "secret" },
];

interface ChannelAction {
  id: string;
  surface: string;
  label: string;
}

function readChannelActions(data: unknown, surface: string): ChannelAction[] {
  return firstArrayAtPath(data, [["actions"]])
    .map((raw) => {
      const record = asRecord(raw);
      return {
        id: firstString(record, ["id"]),
        surface: firstString(record, ["surface"]),
        label: firstString(record, ["label"]) || firstString(record, ["id"]),
      };
    })
    .filter((a) => a.id && a.surface === surface);
}

/** Best-effort "this looks like a send-a-test-message action" match — no
 *  standardized action id exists on the wire, so this matches on substring. */
function findTestAction(actions: ChannelAction[]): ChannelAction | undefined {
  return actions.find((a) => /test|verify|ping|send/i.test(`${a.id} ${a.label}`));
}

export function NotificationTargetsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [localTestNote, setLocalTestNote] = useState<string | null>(null);

  const config = useQuery({
    queryKey: queryKeys.configAll,
    queryFn: () => gv.config.get(),
    retry: false,
    refetchInterval: SETTINGS_POLL_MS,
  });

  const channelActions = useQuery({
    queryKey: settingsKeys.channelActions,
    queryFn: () => gv.invoke("channels.actions.list"),
    retry: false,
  });

  const ntfyActions = useMemo(() => readChannelActions(channelActions.data, "ntfy"), [channelActions.data]);
  const webhookActions = useMemo(() => readChannelActions(channelActions.data, "webhook"), [channelActions.data]);
  const ntfyTestAction = findTestAction(ntfyActions);
  const webhookTestAction = findTestAction(webhookActions);

  const write = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => gv.config.set({ key, value }),
    onSuccess: async (_r, v) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.configAll });
      toast({ title: "Saved", description: v.key, tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Save failed", description: formatError(error), tone: "danger" }),
  });

  const invokeChannelTest = useMutation({
    mutationFn: (action: ChannelAction) =>
      gv.invoke("channels.actions.invoke", { params: { surface: action.surface, actionId: action.id }, body: {} }),
    onSuccess: (_r, action) =>
      toast({ title: "Test sent", description: `${action.surface} · ${action.label}`, tone: "success" }),
    onError: (error: unknown) =>
      toast({ title: "Test failed", description: formatError(error), tone: "danger" }),
  });

  const localTest = useMutation({
    mutationFn: (surface: "ntfy" | "webhook") =>
      notificationsApi.notify(`Test ${surface} target`, `Sent from Settings — this app has no registered ${surface} test action, so it fell back to a local desktop notification.`),
    onSuccess: (result, surface) => {
      setLocalTestNote(
        result.shown
          ? `Local test notification shown (not the real ${surface} target — no channels action registered).`
          : `Local test suppressed: ${result.reason ?? "blocked by current prefs or platform support."}`,
      );
    },
    onError: (error: unknown) => toast({ title: "Local test failed", description: formatError(error), tone: "danger" }),
  });

  const refused = config.isError && errorStatus(config.error) === 403;
  const unavailable = config.isError && !refused && isMethodUnavailableError(config.error);

  return (
    <section className="settings-notify-targets" aria-label="Notification targets">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <BellRing size={14} aria-hidden="true" /> Notification targets (ntfy / webhook)
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh notification target config"
          onClick={() => void config.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={config.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      <p className="settings-notify-targets__note">
        Curates <code>surfaces.ntfy.*</code> / <code>surfaces.webhook.*</code> — the same daemon config keys the
        full Config editor exposes. "Send test" tries a real registered channel action first; if this daemon
        registers none, it says so and falls back to this app's own local notification instead of pretending to
        reach the outbound target.
      </p>

      {config.isPending && <SkeletonBlock variant="text" lines={4} />}

      {refused && (
        <div className="settings-refused" role="status">
          <strong>Admin access required</strong>
          <span>Daemon config is admin-scoped — notification target keys can be neither read nor edited.</span>
        </div>
      )}

      {unavailable && (
        <UnavailableState capability="config.get" description="notification target configuration cannot be shown." />
      )}

      {config.isError && !refused && !unavailable && (
        <ErrorState error={config.error} onRetry={() => void config.refetch()} title="Failed to load config" />
      )}

      {config.isSuccess && (
        <div className="settings-notify-targets__grid">
          <TargetCard
            title="ntfy"
            fields={NTFY_FIELDS}
            config={config.data}
            saving={write.isPending}
            savingKey={write.variables?.key}
            onSave={(key, value) => write.mutate({ key, value })}
            testAction={ntfyTestAction}
            testActionsLoaded={channelActions.isSuccess}
            testing={invokeChannelTest.isPending || localTest.isPending}
            onTest={() =>
              ntfyTestAction ? invokeChannelTest.mutate(ntfyTestAction) : localTest.mutate("ntfy")
            }
          />
          <TargetCard
            title="webhook"
            fields={WEBHOOK_FIELDS}
            config={config.data}
            saving={write.isPending}
            savingKey={write.variables?.key}
            onSave={(key, value) => write.mutate({ key, value })}
            testAction={webhookTestAction}
            testActionsLoaded={channelActions.isSuccess}
            testing={invokeChannelTest.isPending || localTest.isPending}
            onTest={() =>
              webhookTestAction ? invokeChannelTest.mutate(webhookTestAction) : localTest.mutate("webhook")
            }
          />
        </div>
      )}

      {localTestNote && (
        <p className="settings-notify-targets__local-note" role="status">
          {localTestNote}
        </p>
      )}

      {config.isSuccess && NTFY_FIELDS.length === 0 && WEBHOOK_FIELDS.length === 0 && (
        <EmptyState title="No notification target keys" />
      )}
    </section>
  );
}

function TargetCard({
  title,
  fields,
  config,
  saving,
  savingKey,
  onSave,
  testAction,
  testActionsLoaded,
  testing,
  onTest,
}: {
  title: string;
  fields: readonly TargetField[];
  config: unknown;
  saving: boolean;
  savingKey: string | undefined;
  onSave: (key: string, value: unknown) => void;
  testAction: ChannelAction | undefined;
  testActionsLoaded: boolean;
  testing: boolean;
  onTest: () => void;
}) {
  return (
    <div className="settings-notify-targets__card">
      <h3 className="settings-notify-targets__card-title">{title}</h3>
      <ul className="settings-rows">
        {fields.map((field) => (
          <TargetFieldRow
            key={field.key}
            field={field}
            value={readConfigKey(config, field.key)}
            saving={saving && savingKey === field.key}
            onSave={(value) => onSave(field.key, value)}
          />
        ))}
      </ul>
      <button type="button" className="settings-secrets__add" onClick={onTest} disabled={testing}>
        <Send size={13} aria-hidden="true" /> {testing ? "Sending…" : "Send test"}
      </button>
      <p className="settings-notify-targets__test-hint">
        {!testActionsLoaded
          ? "Checking for a registered channel test action…"
          : testAction
            ? `Uses channels.actions.invoke → ${testAction.surface}/${testAction.id}.`
            : `No ${title} test action registered on this daemon — falls back to a local desktop notification.`}
      </p>
    </div>
  );
}

function TargetFieldRow({
  field,
  value,
  saving,
  onSave,
}: {
  field: TargetField;
  value: unknown;
  saving: boolean;
  onSave: (value: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const secret = field.type === "secret" || isSecretConfigKey(field.key);
  const [text, setText] = useState("");
  const [boolValue, setBoolValue] = useState(value === true);

  function startEdit(): void {
    setText(secret ? "" : value === undefined || value === null ? "" : String(value));
    setBoolValue(value === true);
    setEditing(true);
  }

  function commit(): void {
    if (field.type === "boolean") {
      onSave(boolValue);
    } else if (field.type === "number") {
      const parsed = Number(text);
      if (Number.isFinite(parsed)) onSave(parsed);
    } else {
      onSave(text);
    }
    setEditing(false);
  }

  const displayValue =
    value === undefined || value === null
      ? "(unset)"
      : secret && typeof value === "string"
        ? maskSecretValue(value)
        : String(value);

  return (
    <li className="settings-row">
      <div className="settings-row__main">
        <div className="settings-row__head">
          <code className="settings-row__key">{field.key}</code>
        </div>
        <p className="settings-row__description">{field.label}</p>
        {!editing ? (
          <span className={secret ? "settings-row__value settings-row__value--secret" : "settings-row__value"}>
            {displayValue}
          </span>
        ) : field.type === "boolean" ? (
          <label className="settings-editor__toggle">
            <input type="checkbox" role="switch" checked={boolValue} onChange={(e) => setBoolValue(e.target.checked)} />
            <span>{boolValue ? "true" : "false"}</span>
          </label>
        ) : (
          <input
            className="settings-editor__input"
            type={secret ? "password" : field.type === "number" ? "number" : "text"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={secret ? "Enter new value — current value stays masked" : undefined}
            aria-label={`${field.key} value`}
          />
        )}
      </div>
      <div className="settings-row__actions">
        {!editing ? (
          <button type="button" className="settings-row__edit" onClick={startEdit} disabled={saving}>
            {saving ? "Saving…" : "Edit"}
          </button>
        ) : (
          <>
            <button type="button" className="settings-editor__cancel" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="settings-editor__save" onClick={commit} disabled={saving}>
              Save
            </button>
          </>
        )}
      </div>
    </li>
  );
}
