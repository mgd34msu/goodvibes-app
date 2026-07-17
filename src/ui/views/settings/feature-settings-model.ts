// feature-settings-model.ts — pure, deterministic model builder for the
// Feature settings surface. Takes the daemon's live config snapshot
// (config.get) plus the pinned FEATURE_SETTINGS_SNAPSHOT (feature-
// settings.generated.ts) and produces the domain-grouped feature-unit
// structure FeatureSettingsSection renders. No React, no I/O.
//
// Ported/adapted from goodvibes-webui src/lib/settings-model.ts's feature-unit
// half (buildFeatureUnit / isFeatureEnabled / grouping) — this app's Daemon
// config tab (ConfigSettingsSection.tsx) already renders every config key
// flattened from config.get with its own TUI-parity category grouping, so
// this module intentionally does NOT reproduce the plain-row / raw-row model:
// it renders ONLY feature units, grouped by feature.domain in
// FEATURE_SETTINGS_SNAPSHOT declaration order. A key a feature owns therefore
// still also appears as an ordinary editable row in the Daemon config tab —
// that overlap is deliberate (two different lenses on the same config tree),
// not a duplicate-listing bug; see the integration report.

import {
  FEATURE_SCHEMA_ENTRIES,
  FEATURE_SETTINGS_SNAPSHOT,
  type FeatureSettingMeta,
} from "./feature-settings.generated.ts";
import { categoryLabelForKey, isSecretConfigKey } from "./config-redaction.ts";
import type { ConfigSettingMeta } from "./config-schema.generated.ts";

/** Read a dotted key from the live config tree; distinguishes "absent" from
 *  "present but undefined/null" so the UI can show the schema default with an
 *  honest "(unset)" rather than pretending the daemon holds a null. */
function readConfigPath(config: unknown, key: string): { present: boolean; value: unknown } {
  const segments = key.split(".");
  let cursor: unknown = config;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
      return { present: false, value: undefined };
    }
    const record = cursor as Record<string, unknown>;
    if (!(segment in record)) return { present: false, value: undefined };
    cursor = record[segment];
  }
  return { present: true, value: cursor };
}

/** A single typed, editable settings field: schema metadata merged with its
 *  live value from config.get. */
export interface FeatureFieldModel {
  readonly key: string;
  readonly type: ConfigSettingMeta["type"];
  readonly enumValues?: readonly string[];
  readonly default: unknown;
  readonly description: string;
  readonly validationHint?: string;
  readonly liveValue: unknown;
  /** Whether the live config tree actually holds this key (vs. schema default only). */
  readonly present: boolean;
  readonly isSecret: boolean;
}

/**
 * One feature rendered as one unit: its enablement control in its real shape
 * plus the typed editors for the settings keys it owns.
 *
 *   - boolean/enum: `enablementField` is the settings key the feature-level
 *     control writes; excluded from `fields`.
 *   - constant: no separate off switch — `enablementField` is null and every
 *     owned settings key (which governs runtime activation directly) renders
 *     as an ordinary field, enablement key first.
 */
export interface FeatureUnitModel {
  readonly feature: FeatureSettingMeta;
  /** Whether the feature is active given the live config, per its enablement shape. */
  readonly enabled: boolean;
  /** True when the live config explicitly holds the enablement key (vs. schema default). */
  readonly explicit: boolean;
  readonly enablementField: FeatureFieldModel | null;
  readonly fields: readonly FeatureFieldModel[];
}

export interface FeatureGroupModel {
  readonly id: string;
  readonly label: string;
  readonly units: readonly FeatureUnitModel[];
}

const SCHEMA_BY_KEY = new Map<string, ConfigSettingMeta>(FEATURE_SCHEMA_ENTRIES.map((e) => [e.key, e]));

function buildField(entry: ConfigSettingMeta, liveConfig: unknown): FeatureFieldModel {
  const { present, value } = readConfigPath(liveConfig, entry.key);
  return {
    key: entry.key,
    type: entry.type,
    enumValues: entry.enumValues,
    default: entry.default,
    description: entry.description,
    validationHint: entry.validationHint,
    liveValue: value,
    present,
    isSecret: isSecretConfigKey(entry.key),
  };
}

/** Whether a feature is active for a given enablement-key value, per its
 *  enablement shape. Mirrors the SDK's own state derivation (feature-
 *  settings.ts deriveFeatureState): boolean keys active when true; enum keys
 *  while the value is in enabledValues; constant capabilities have no
 *  separate off switch, so they always report active. */
export function isFeatureEnabled(feature: FeatureSettingMeta, value: unknown): boolean {
  switch (feature.enablement.kind) {
    case "constant":
      return true;
    case "boolean":
      return value === true;
    case "enum":
      return typeof value === "string" && (feature.enablement.enabledValues ?? []).includes(value);
  }
}

function buildFeatureUnit(feature: FeatureSettingMeta, liveConfig: unknown): FeatureUnitModel {
  const enablementEntry = SCHEMA_BY_KEY.get(feature.enablement.key);
  const enablementField =
    feature.enablement.kind !== "constant" && enablementEntry ? buildField(enablementEntry, liveConfig) : null;

  const fieldKeys =
    feature.enablement.kind === "constant"
      ? feature.settings
      : feature.settings.filter((k) => k !== feature.enablement.key);
  const fields = fieldKeys
    .map((k) => SCHEMA_BY_KEY.get(k))
    .filter((e): e is ConfigSettingMeta => Boolean(e))
    .map((e) => buildField(e, liveConfig));

  const { present, value } = readConfigPath(liveConfig, feature.enablement.key);
  const effective = present ? value : enablementEntry?.default;
  return {
    feature,
    enabled: isFeatureEnabled(feature, effective),
    explicit: present,
    enablementField,
    fields,
  };
}

/** Build the ordered, domain-grouped feature-unit model from the live config
 *  snapshot. Group order: domains in FEATURE_SETTINGS_SNAPSHOT declaration
 *  order (first appearance wins) — structural parity with the SDK registry,
 *  never a hand-copied category list. */
export function buildFeatureGroups(liveConfig: unknown): FeatureGroupModel[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const unitsByDomain = new Map<string, FeatureUnitModel[]>();

  for (const feature of FEATURE_SETTINGS_SNAPSHOT) {
    const domain = feature.domain;
    if (!seen.has(domain)) {
      seen.add(domain);
      order.push(domain);
    }
    const unit = buildFeatureUnit(feature, liveConfig);
    const list = unitsByDomain.get(domain) ?? [];
    list.push(unit);
    unitsByDomain.set(domain, list);
  }

  return order.map((domain) => ({
    id: domain,
    // Feature domains ARE config namespaces (schema-grounded), so the same
    // CATEGORY_LABELS/titleCase fallback the Daemon config tab uses applies
    // verbatim — cross-tab label parity, never a hand-copied list.
    label: categoryLabelForKey(`${domain}.x`),
    units: unitsByDomain.get(domain) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

function fieldMatches(field: FeatureFieldModel, q: string): boolean {
  return field.key.toLowerCase().includes(q) || field.description.toLowerCase().includes(q);
}

function unitMatches(unit: FeatureUnitModel, q: string): boolean {
  return (
    unit.feature.id.toLowerCase().includes(q) ||
    unit.feature.name.toLowerCase().includes(q) ||
    unit.feature.description.toLowerCase().includes(q) ||
    (unit.enablementField !== null && fieldMatches(unit.enablementField, q)) ||
    unit.fields.some((f) => fieldMatches(f, q))
  );
}

/** Filter the model by a free-text query across group labels, feature id/
 *  name/description, and owned key/description. A group matches wholly when
 *  its label matches; otherwise narrowed to matching units. Empty groups drop. */
export function filterFeatureGroups(groups: readonly FeatureGroupModel[], query: string): FeatureGroupModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups];
  const out: FeatureGroupModel[] = [];
  for (const group of groups) {
    if (group.label.toLowerCase().includes(q)) {
      out.push(group);
      continue;
    }
    const units = group.units.filter((u) => unitMatches(u, q));
    if (units.length === 0) continue;
    out.push({ ...group, units });
  }
  return out;
}
