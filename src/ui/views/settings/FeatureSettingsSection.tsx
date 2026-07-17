// Feature settings surface (owner-flagged Tier-2 debt: the app previously had
// ZERO feature-flag settings surface — the Automate sidebar sat over dark
// flags with no way to see or flip them here).
//
// Renders the SDK's dissolved-feature model (feature-settings.generated.ts,
// pinned from @pellux/goodvibes-sdk@1.11.2's platform/runtime/feature-flags):
// every platform capability is a first-class domain settings key, grouped by
// domain, one card per feature unit. Enablement renders in its real shape
// (feature.enablement.kind):
//   - boolean : a toggle writing true/false to the domain key.
//   - enum    : a mode select over enablement.enabledValues (inactive modes
//               like "off" are real, selectable choices).
//   - constant: no separate off switch — "Governed by its settings below",
//               and every owned key renders as an ordinary field.
// Every write goes through the same per-key config.set path
// (ConfigSettingsSection.tsx's gv.config.set({ key, value })) — features live
// on first-class domain settings keys, there is no separate enablement
// namespace, and no page-level "save all" exists: each control saves on
// change with its own toast.
//
// Restart honesty: a restart-gated feature (feature.restartRequired) states
// that up front as static text, and after a successful ENABLEMENT write shows
// a pending-restart marker for the rest of this session — tracked purely from
// this session's confirmed config.set resolutions, never a fabricated wire
// signal (the daemon exposes no per-process pending-restart state).
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, RefreshCw, RotateCcw, Search } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, errorStatus, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { isDangerousConfigKey, isSecretConfigKey, displayConfigValue } from "./config-redaction.ts";
import {
  buildFeatureGroups,
  filterFeatureGroups,
  type FeatureFieldModel,
  type FeatureGroupModel,
  type FeatureUnitModel,
} from "./feature-settings-model.ts";
import { settingsKeys, SETTINGS_POLL_MS } from "./settings-queries.ts";

/** Mirrors ConfigSettingsSection's isAdminRequiredError: the daemon's real
 *  403 admin-scope refusal on config.get carries no machine code, status only. */
function isAdminRequiredError(error: unknown): boolean {
  return errorStatus(error) === 403;
}

interface PendingWrite {
  key: string;
  value: unknown;
  /** Set only for an enablement write — drives the pending-restart marker. */
  featureId?: string;
  restartRequired?: boolean;
}

export function FeatureSettingsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeDomain, setActiveDomain] = useState<string>("");
  const [search, setSearch] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingWrite | null>(null);
  // Feature ids whose enablement changed THIS session and await a daemon
  // restart — never fabricated from a wire signal, held only in memory.
  const [pendingRestartIds, setPendingRestartIds] = useState<ReadonlySet<string>>(new Set());

  // Same query key as ConfigSettingsSection — the two tabs share one cache
  // entry, so switching tabs never double-fetches config.get.
  const config = useQuery({
    queryKey: settingsKeys.config,
    queryFn: () => gv.config.get(),
    retry: false,
    refetchInterval: SETTINGS_POLL_MS,
  });

  const allGroups = useMemo<FeatureGroupModel[]>(() => buildFeatureGroups(config.data), [config.data]);
  const groups = useMemo(() => filterFeatureGroups(allGroups, search), [allGroups, search]);
  const searching = search.trim().length > 0;
  const currentDomain =
    activeDomain && groups.some((g) => g.id === activeDomain) ? activeDomain : (groups[0]?.id ?? "");
  const currentGroup = groups.find((g) => g.id === currentDomain) ?? null;
  const totalUnits = allGroups.reduce((n, g) => n + g.units.length, 0);

  const save = useMutation({
    mutationFn: ({ key, value, meta }: PendingWrite & { meta?: ConfirmMetadata }) =>
      gv.config.set({ key, value, ...(meta ?? {}) }),
    onSuccess: async (_result, variables) => {
      setEditingKey(null);
      setPendingConfirm(null);
      await queryClient.invalidateQueries({ queryKey: settingsKeys.config });
      if (variables.featureId && variables.restartRequired) {
        setPendingRestartIds((prev) => new Set(prev).add(variables.featureId!));
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

  function requestWrite(write: PendingWrite): void {
    if (isDangerousConfigKey(write.key)) {
      setPendingConfirm(write);
      return;
    }
    save.mutate(write);
  }

  const refused = config.isError && isAdminRequiredError(config.error);
  const unavailable = config.isError && !refused && isMethodUnavailableError(config.error);

  return (
    <section className="settings-features" aria-label="Feature settings">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Flag size={14} aria-hidden="true" /> Feature settings
          {config.isSuccess ? ` · ${totalUnits} capabilities` : ""}
        </span>
        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh feature settings"
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
          placeholder="Search feature names, descriptions, keys…"
          aria-label="Search feature settings"
        />
      </label>

      {config.isPending && <SkeletonBlock variant="text" lines={6} />}

      {refused && (
        <div className="settings-refused" role="status">
          <strong>Admin access required</strong>
          <span>The connected principal is not admin-scoped — feature settings can be neither read nor edited.</span>
        </div>
      )}

      {unavailable && (
        <UnavailableState capability="config.get" description="feature settings cannot be read or edited." />
      )}

      {config.isError && !refused && !unavailable && (
        <ErrorState error={config.error} onRetry={() => void config.refetch()} title="Failed to load feature settings" />
      )}

      {config.isSuccess && (
        <div className="settings-config__layout">
          {!searching && (
            <nav className="settings-config__categories" aria-label="Feature domains">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={
                    group.id === currentDomain ? "settings-category settings-category--active" : "settings-category"
                  }
                  onClick={() => setActiveDomain(group.id)}
                >
                  {group.label}
                </button>
              ))}
            </nav>
          )}

          <div className="settings-config__entries">
            {allGroups.length === 0 ? (
              <EmptyState
                title="No feature settings on this daemon"
                description="config.get returned no data to derive feature state from."
              />
            ) : groups.length === 0 ? (
              <EmptyState
                title="No features match"
                description={searching ? `Nothing matches "${search.trim()}" across any domain.` : undefined}
              />
            ) : (
              (searching ? groups : currentGroup ? [currentGroup] : []).map((group) => (
                <div key={group.id} className="settings-feature-group">
                  {searching && <h3 className="settings-feature-group__label">{group.label}</h3>}
                  {group.units.map((unit) => (
                    <FeatureCard
                      key={unit.feature.id}
                      unit={unit}
                      editingKey={editingKey}
                      saving={save.isPending}
                      savingKey={save.variables?.key}
                      pendingRestart={pendingRestartIds.has(unit.feature.id)}
                      onEditField={setEditingKey}
                      onCancelField={() => setEditingKey(null)}
                      onCommitEnablement={(value) =>
                        requestWrite({
                          key: unit.feature.enablement.key,
                          value,
                          featureId: unit.feature.id,
                          restartRequired: unit.feature.restartRequired,
                        })
                      }
                      onCommitField={(key, value) => requestWrite({ key, value })}
                    />
                  ))}
                </div>
              ))
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
              {isSecretConfigKey(pendingConfirm.key) ? "(hidden — secret-shaped key)" : JSON.stringify(pendingConfirm.value)}
            </code>
          </p>
        )}
      </ConfirmSurface>
    </section>
  );
}

// ─── Feature card ────────────────────────────────────────────────────────────

interface FeatureCardProps {
  unit: FeatureUnitModel;
  editingKey: string | null;
  saving: boolean;
  savingKey: string | undefined;
  pendingRestart: boolean;
  onEditField: (key: string) => void;
  onCancelField: () => void;
  onCommitEnablement: (value: unknown) => void;
  onCommitField: (key: string, value: unknown) => void;
}

function FeatureCard({
  unit,
  editingKey,
  saving,
  savingKey,
  pendingRestart,
  onEditField,
  onCancelField,
  onCommitEnablement,
  onCommitField,
}: FeatureCardProps) {
  const { feature, enabled, explicit, enablementField, fields } = unit;
  const kind = feature.enablement.kind;
  const enablementSaving = saving && savingKey === feature.enablement.key;

  return (
    <section className="settings-feature-unit" data-feature-id={feature.id} data-feature-enabled={enabled}>
      <header className="settings-feature-unit__head">
        <div className="settings-feature-unit__title">
          <h3 className="settings-feature-unit__name">{feature.name}</h3>
          {kind === "constant" ? (
            <span className="settings-feature-unit__state">Governed by its settings below</span>
          ) : (
            <span
              className={
                enabled
                  ? "settings-feature-unit__state settings-feature-unit__state--enabled"
                  : "settings-feature-unit__state"
              }
            >
              {enabled ? "Enabled" : "Disabled"}
              {explicit ? "" : " (default)"}
            </span>
          )}
        </div>

        {kind === "boolean" && (
          <label className="settings-editor__toggle settings-feature-unit__control">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              disabled={enablementSaving}
              aria-label={`Enable ${feature.name}`}
              onChange={(e) => onCommitEnablement(e.target.checked)}
            />
            <span>{enablementSaving ? "Saving…" : enabled ? "On" : "Off"}</span>
          </label>
        )}

        {kind === "enum" && enablementField && (
          <label className="settings-feature-unit__control settings-feature-unit__mode">
            <span className="settings-feature-unit__mode-label">Mode</span>
            <select
              className="settings-editor__select"
              aria-label={`${feature.name} mode`}
              value={enablementField.present ? String(enablementField.liveValue ?? "") : String(enablementField.default ?? "")}
              disabled={enablementSaving}
              onChange={(e) => onCommitEnablement(e.target.value)}
            >
              {(enablementField.enumValues ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                  {option === enablementField.default ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <p className="settings-feature-unit__desc">{feature.description}</p>

      {kind !== "constant" &&
        (feature.restartRequired ? (
          <p className="settings-feature-unit__note">Enablement changes take effect after a daemon restart.</p>
        ) : (
          <p className="settings-feature-unit__note">Changes to this feature apply immediately.</p>
        ))}

      {pendingRestart && (
        <p className="settings-feature-unit__pending" role="status" data-pending-restart={feature.id}>
          Saved — takes effect when the daemon restarts.
        </p>
      )}

      {kind === "enum" && enablementField?.description && (
        <p className="settings-feature-unit__mode-desc">{enablementField.description}</p>
      )}

      {fields.length > 0 && (
        <ul className="settings-rows settings-feature-unit__fields">
          {fields.map((field) => (
            <FeatureFieldRow
              key={field.key}
              field={field}
              editing={editingKey === field.key}
              saving={saving && savingKey === field.key}
              onEdit={() => onEditField(field.key)}
              onCancel={onCancelField}
              onSave={(value) => onCommitField(field.key, value)}
              onResetToDefault={() => onCommitField(field.key, field.default)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Field row + type-aware editor (parity with ConfigSettingsSection's
// ConfigRow/ValueEditor — same CSS classes, independent implementation
// because it reads a FeatureFieldModel, not a flattened ConfigEntry) ────────

interface FeatureFieldRowProps {
  field: FeatureFieldModel;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (value: unknown) => void;
  onResetToDefault: () => void;
}

function FeatureFieldRow({ field, editing, saving, onEdit, onCancel, onSave, onResetToDefault }: FeatureFieldRowProps) {
  const modified = field.present && !valueEquals(field.liveValue, field.default);
  const displayValue = field.present ? displayConfigValue(field.key, field.liveValue) : "(unset)";

  return (
    <li className={editing ? "settings-row settings-row--editing" : "settings-row"}>
      <div className="settings-row__main">
        <div className="settings-row__head">
          <code className="settings-row__key">
            {modified && (
              <span
                className="settings-row__diamond"
                title={`Differs from default (${JSON.stringify(field.default)})`}
                aria-label="Differs from default"
              >
                ◆
              </span>
            )}
            {field.key}
          </code>
          {field.isSecret && <span className="settings-row__secret-flag">secret</span>}
        </div>
        {field.description && <p className="settings-row__description">{field.description}</p>}
        {!editing && (
          <span className={field.isSecret ? "settings-row__value settings-row__value--secret" : "settings-row__value"}>
            {displayValue}
          </span>
        )}
        {editing && <FeatureFieldEditor field={field} saving={saving} onCancel={onCancel} onSave={onSave} />}
      </div>
      {!editing && (
        <div className="settings-row__actions">
          {modified && (
            <button
              type="button"
              className="settings-row__reset"
              onClick={onResetToDefault}
              disabled={saving}
              title={`Reset to default: ${JSON.stringify(field.default)}`}
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

function valueEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

type FieldEditorKind = "boolean" | "number" | "enum" | "secret" | "string" | "json";

function editorKindFor(field: FeatureFieldModel): FieldEditorKind {
  if (field.isSecret) return "secret";
  if (field.type === "boolean") return "boolean";
  if (field.type === "number") return "number";
  if (field.type === "enum") return "enum";
  if (field.type === "string") return "string";
  return "json";
}

function FeatureFieldEditor({
  field,
  saving,
  onCancel,
  onSave,
}: {
  field: FeatureFieldModel;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: unknown) => void;
}) {
  const kind = editorKindFor(field);
  const liveOrDefault = field.present ? field.liveValue : field.default;
  const [text, setText] = useState<string>(() => {
    if (kind === "secret") return "";
    if (kind === "json") {
      try {
        return JSON.stringify(liveOrDefault ?? null, null, 2);
      } catch {
        return "";
      }
    }
    if (liveOrDefault === undefined || liveOrDefault === null) {
      if (kind === "enum" && typeof field.default === "string") return field.default;
      return "";
    }
    return typeof liveOrDefault === "string" ? liveOrDefault : String(liveOrDefault);
  });
  const [boolValue, setBoolValue] = useState<boolean>(liveOrDefault === true);
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
        setParseError(field.validationHint ? `Expected: ${field.validationHint}` : "Not a finite number.");
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
            aria-label={`${field.key} value`}
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
          aria-label={`${field.key} value`}
          placeholder={`default: ${String(field.default)}`}
        />
      )}

      {kind === "enum" && (
        <select
          className="settings-editor__select"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`${field.key} value`}
        >
          {(field.enumValues ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
              {option === field.default ? " (default)" : ""}
            </option>
          ))}
          {typeof liveOrDefault === "string" &&
            liveOrDefault !== "" &&
            !(field.enumValues ?? []).includes(liveOrDefault) && (
              <option value={liveOrDefault}>{liveOrDefault} (current)</option>
            )}
        </select>
      )}

      {kind === "string" && (
        <input
          className="settings-editor__input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`${field.key} value`}
          placeholder={typeof field.default === "string" && field.default ? `default: ${field.default}` : undefined}
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
            aria-label={`${field.key} new secret value`}
            placeholder="Enter new value — current value stays masked"
          />
          <button type="button" className="settings-editor__reveal" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
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
          aria-label={`${field.key} JSON value`}
        />
      )}

      {field.validationHint && <span className="settings-editor__hint">Expected: {field.validationHint}</span>}
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
