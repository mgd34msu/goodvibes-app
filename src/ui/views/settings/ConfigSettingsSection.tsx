// Schema-driven config editor (docs/FEATURES.md §19): GET config.get for
// current values, the pinned CONFIG_SCHEMA snapshot for structure (types,
// defaults, enum values, descriptions), TUI-parity categories, one-key-at-a-
// time config.set. Type-aware editors, ◆ default-diff marker where the
// default is derivable, search across every key, secret-shaped values masked
// with explicit reveal on the editor only (never round-tripped for display).

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, errorStatus, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  categoryLabelForKey,
  differsFromDefault,
  displayConfigValue,
  flattenConfig,
  isDangerousConfigKey,
  isSecretConfigKey,
  requiresDaemonRestart,
  schemaFor,
  type ConfigEntry,
} from "./config-redaction.ts";
import { CONFIG_SCHEMA_SNAPSHOT } from "./config-schema.generated.ts";
import { settingsKeys, SETTINGS_POLL_MS } from "./settings-queries.ts";

/** The daemon's real 403 admin-scope refusal on config.get carries no machine
 *  code, status only (webui SettingsModal's isAdminRequiredError pattern). */
function isAdminRequiredError(error: unknown): boolean {
  return errorStatus(error) === 403;
}

interface PendingWrite {
  key: string;
  value: unknown;
}

export function ConfigSettingsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingWrite | null>(null);

  const config = useQuery({
    queryKey: settingsKeys.config,
    queryFn: () => gv.config.get(),
    retry: false,
    // No wire event exists for config changes — targeted poll so edits made
    // from the TUI/webui show up here within one cadence.
    refetchInterval: SETTINGS_POLL_MS,
  });

  // Rows: everything config.get returned, plus schema keys the live config
  // object doesn't materialize yet (value shows "(unset)", default beside it).
  const entries = useMemo<ConfigEntry[]>(() => {
    const flattened = flattenConfig(config.data);
    const seen = new Set(flattened.map((e) => e.key));
    const extras: ConfigEntry[] = [];
    for (const meta of CONFIG_SCHEMA_SNAPSHOT) {
      if (!seen.has(meta.key)) {
        extras.push({ key: meta.key, value: undefined, category: categoryLabelForKey(meta.key) });
      }
    }
    return [...flattened, ...extras];
  }, [config.data]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const entry of entries) {
      if (!seen.has(entry.category)) {
        seen.add(entry.category);
        ordered.push(entry.category);
      }
    }
    return ordered;
  }, [entries]);

  const searching = search.trim().length > 0;
  const currentCategory =
    activeCategory && categories.includes(activeCategory) ? activeCategory : (categories[0] ?? "");

  const visibleEntries = useMemo(() => {
    if (searching) {
      const q = search.trim().toLowerCase();
      return entries.filter((entry) => {
        if (entry.key.toLowerCase().includes(q)) return true;
        const description = schemaFor(entry.key)?.description ?? "";
        return description.toLowerCase().includes(q);
      });
    }
    return entries.filter((entry) => entry.category === currentCategory);
  }, [entries, searching, search, currentCategory]);

  const save = useMutation({
    mutationFn: ({ key, value, meta }: PendingWrite & { meta?: ConfirmMetadata }) =>
      gv.config.set({ key, value, ...(meta ?? {}) }),
    onSuccess: async (_result, variables) => {
      setEditingKey(null);
      setPendingConfirm(null);
      await queryClient.invalidateQueries({ queryKey: settingsKeys.config });
      if (requiresDaemonRestart(variables.key)) {
        toast({
          title: "Saved — restart required",
          description: `"${variables.key}" takes effect after the daemon restarts.`,
          tone: "warning",
        });
      } else {
        toast({ title: "Config saved", description: `"${variables.key}" updated.`, tone: "success" });
      }
    },
    onError: (error: unknown) => {
      toast({ title: "Failed to save config", description: formatError(error), tone: "danger" });
    },
  });

  function requestWrite(key: string, value: unknown): void {
    if (isDangerousConfigKey(key)) {
      setPendingConfirm({ key, value });
      return;
    }
    save.mutate({ key, value });
  }

  const refused = config.isError && isAdminRequiredError(config.error);
  const unavailable = config.isError && !refused && isMethodUnavailableError(config.error);

  return (
    <section className="settings-config" aria-label="Daemon configuration">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <SlidersHorizontal size={14} aria-hidden="true" /> Daemon config
          {config.isSuccess ? ` · ${entries.length} keys` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh config"
          onClick={() => void config.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={config.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      <label className="settings-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all keys and descriptions…"
          aria-label="Search config keys"
        />
      </label>

      {config.isPending && <SkeletonBlock variant="text" lines={6} />}

      {refused && (
        <div className="settings-refused" role="status">
          <strong>Admin access required</strong>
          <span>The connected principal is not admin-scoped — config can be neither read nor edited.</span>
        </div>
      )}

      {unavailable && (
        <UnavailableState capability="config.get" description="daemon configuration cannot be read or edited." />
      )}

      {config.isError && !refused && !unavailable && (
        <ErrorState error={config.error} onRetry={() => void config.refetch()} title="Failed to load config" />
      )}

      {config.isSuccess && (
        <div className="settings-config__layout">
          {!searching && (
            <nav className="settings-config__categories" aria-label="Config categories">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={
                    category === currentCategory
                      ? "settings-category settings-category--active"
                      : "settings-category"
                  }
                  onClick={() => setActiveCategory(category)}
                >
                  {category}
                </button>
              ))}
            </nav>
          )}

          <div className="settings-config__entries">
            {visibleEntries.length === 0 ? (
              <EmptyState
                title={searching ? "No keys match" : "No settings in this category"}
                description={searching ? `Nothing matches "${search.trim()}" across any category.` : undefined}
              />
            ) : (
              <ul className="settings-rows">
                {visibleEntries.map((entry) => (
                  <ConfigRow
                    key={entry.key}
                    entry={entry}
                    showCategory={searching}
                    editing={editingKey === entry.key}
                    saving={save.isPending && save.variables?.key === entry.key}
                    onEdit={() => setEditingKey(entry.key)}
                    onCancel={() => setEditingKey(null)}
                    onSave={(value) => requestWrite(entry.key, value)}
                    onResetToDefault={() => {
                      const meta = schemaFor(entry.key);
                      if (meta) requestWrite(entry.key, meta.default);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <ConfirmSurface
        open={pendingConfirm !== null}
        action="Write dangerous config key"
        target={pendingConfirm?.key ?? ""}
        blastRadius={
          pendingConfirm?.key.startsWith("danger.")
            ? "This key sits in the daemon's danger namespace — it can disable safety rails for every surface and agent using this daemon."
            : "This key changes the approval posture for every surface and agent using this daemon."
        }
        danger
        confirmLabel="Write key"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={(meta) => {
          if (pendingConfirm) save.mutate({ ...pendingConfirm, meta });
        }}
      >
        {pendingConfirm && (
          <p className="settings-confirm-value">
            New value:{" "}
            <code>
              {isSecretConfigKey(pendingConfirm.key)
                ? "(hidden — secret-shaped key)"
                : JSON.stringify(pendingConfirm.value)}
            </code>
          </p>
        )}
      </ConfirmSurface>
    </section>
  );
}

// ─── Row + type-aware editor ─────────────────────────────────────────────────

interface ConfigRowProps {
  entry: ConfigEntry;
  showCategory: boolean;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (value: unknown) => void;
  onResetToDefault: () => void;
}

function ConfigRow({
  entry,
  showCategory,
  editing,
  saving,
  onEdit,
  onCancel,
  onSave,
  onResetToDefault,
}: ConfigRowProps) {
  const meta = schemaFor(entry.key);
  const secret = isSecretConfigKey(entry.key);
  const modified = differsFromDefault(entry.key, entry.value);
  const displayValue = entry.value === undefined ? "(unset)" : displayConfigValue(entry.key, entry.value);

  return (
    <li className={editing ? "settings-row settings-row--editing" : "settings-row"}>
      <div className="settings-row__main">
        <div className="settings-row__head">
          <code className="settings-row__key">
            {modified && (
              <span
                className="settings-row__diamond"
                title={`Differs from default (${JSON.stringify(meta?.default)})`}
                aria-label="Differs from default"
              >
                ◆
              </span>
            )}
            {entry.key}
          </code>
          {secret && <span className="settings-row__secret-flag">secret</span>}
          {showCategory && <span className="settings-row__category">{entry.category}</span>}
        </div>
        {meta?.description && <p className="settings-row__description">{meta.description}</p>}
        {!editing && (
          <span className={secret ? "settings-row__value settings-row__value--secret" : "settings-row__value"}>
            {displayValue}
          </span>
        )}
        {editing && (
          <ValueEditor
            entryKey={entry.key}
            value={entry.value}
            saving={saving}
            onCancel={onCancel}
            onSave={onSave}
          />
        )}
      </div>
      {!editing && (
        <div className="settings-row__actions">
          {modified && meta && (
            <button
              type="button"
              className="settings-row__reset"
              onClick={onResetToDefault}
              disabled={saving}
              title={`Reset to default: ${JSON.stringify(meta.default)}`}
            >
              <RotateCcw size={13} aria-hidden="true" /> Default
            </button>
          )}
          <button type="button" className="settings-row__edit" onClick={onEdit} disabled={saving}>
            {saving ? "Saving…" : "Edit"}
          </button>
        </div>
      )}
    </li>
  );
}

type EditorKind = "boolean" | "number" | "enum" | "secret" | "string" | "json";

function editorKindFor(key: string, value: unknown): EditorKind {
  const meta = schemaFor(key);
  if (isSecretConfigKey(key)) return "secret";
  if (meta?.type === "boolean") return "boolean";
  if (meta?.type === "number") return "number";
  if (meta?.type === "enum") return "enum";
  if (meta?.type === "string") return "string";
  // No schema row: infer from the live value.
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "json";
}

function ValueEditor({
  entryKey,
  value,
  saving,
  onCancel,
  onSave,
}: {
  entryKey: string;
  value: unknown;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: unknown) => void;
}) {
  const meta = schemaFor(entryKey);
  const kind = editorKindFor(entryKey, value);
  // Secrets never prefill the editor with the live value.
  const [text, setText] = useState<string>(() => {
    if (kind === "secret") return "";
    if (kind === "json") {
      try {
        return JSON.stringify(value ?? null, null, 2);
      } catch {
        return "";
      }
    }
    if (value === undefined || value === null) {
      // Enum selects need a concrete initial option — the schema default.
      if (kind === "enum" && meta && typeof meta.default === "string") return meta.default;
      return "";
    }
    return typeof value === "string" ? value : String(value);
  });
  const [boolValue, setBoolValue] = useState<boolean>(value === true);
  const [reveal, setReveal] = useState(false);
  const [parseError, setParseError] = useState("");

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (saving) return;
    setParseError("");
    if (kind === "boolean") {
      onSave(boolValue);
      return;
    }
    if (kind === "number") {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        setParseError(meta?.validationHint ? `Expected: ${meta.validationHint}` : "Not a finite number.");
        return;
      }
      onSave(parsed);
      return;
    }
    if (kind === "json") {
      try {
        onSave(text.trim() === "" ? null : JSON.parse(text));
      } catch {
        setParseError("Not valid JSON.");
      }
      return;
    }
    // enum / string / secret all submit the raw string.
    onSave(text);
  }

  return (
    <form className="settings-editor" onSubmit={handleSubmit}>
      {kind === "boolean" && (
        <label className="settings-editor__toggle">
          <input
            type="checkbox"
            role="switch"
            checked={boolValue}
            onChange={(e) => setBoolValue(e.target.checked)}
            aria-label={`${entryKey} value`}
          />
          <span>{boolValue ? "true" : "false"}</span>
        </label>
      )}

      {kind === "number" && (
        <input
          className="settings-editor__input"
          type="number"
          step="any"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`${entryKey} value`}
          placeholder={meta ? `default: ${String(meta.default)}` : undefined}
        />
      )}

      {kind === "enum" && (
        <select
          className="settings-editor__select"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`${entryKey} value`}
        >
          {(meta?.enumValues ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
              {meta && option === meta.default ? " (default)" : ""}
            </option>
          ))}
          {/* The live value may predate the pinned enum list — keep it selectable. */}
          {typeof value === "string" && value !== "" && !(meta?.enumValues ?? []).includes(value) && (
            <option value={value}>{value} (current)</option>
          )}
        </select>
      )}

      {kind === "string" && (
        <input
          className="settings-editor__input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`${entryKey} value`}
          placeholder={meta && typeof meta.default === "string" && meta.default ? `default: ${meta.default}` : undefined}
        />
      )}

      {kind === "secret" && (
        <div className="settings-editor__secret">
          <input
            className="settings-editor__input"
            type={reveal ? "text" : "password"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`${entryKey} new secret value`}
            placeholder="Enter new value — current value stays masked"
          />
          <button
            type="button"
            className="settings-editor__reveal"
            onClick={() => setReveal((r) => !r)}
            aria-pressed={reveal}
          >
            {reveal ? "Hide" : "Reveal"}
          </button>
        </div>
      )}

      {kind === "json" && (
        <textarea
          className="settings-editor__json"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label={`${entryKey} JSON value`}
        />
      )}

      {meta?.validationHint && <span className="settings-editor__hint">Expected: {meta.validationHint}</span>}
      {parseError && (
        <span className="settings-editor__error" role="alert">
          {parseError}
        </span>
      )}

      <div className="settings-editor__actions">
        <button type="button" className="settings-editor__cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="settings-editor__save" disabled={saving || (kind === "secret" && !text)}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
