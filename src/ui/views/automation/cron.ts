// App-local cron helper (docs/FEATURES.md §5 "Cron editor with human preview
// + next-run times"). Parses standard 5-field cron (minute hour day-of-month
// month day-of-week), renders a best-effort human description, and computes
// preview next-run times in an IANA timezone.
//
// HONESTY NOTE: this is a client-side PREVIEW helper only. The daemon's
// scheduler is authoritative — persisted jobs surface their real `nextRunAt`.
// Around DST transitions the preview's day-boundary skip may differ from the
// daemon by up to an hour; the preview is labeled as an estimate in the UI.

export interface CronField {
  /** Matching values (normalized: dow 7 → 0). */
  values: ReadonlySet<number>;
  /** True when the field was unrestricted: `*`, or a step of 1 over the full range. */
  wildcard: boolean;
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOW_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

interface FieldSpec {
  min: number;
  max: number;
  names?: readonly string[];
  /** Offset added when resolving a name (months are 1-based). */
  nameBase?: number;
}

const FIELD_SPECS: readonly [keyof ParsedCron, FieldSpec][] = [
  ["minute", { min: 0, max: 59 }],
  ["hour", { min: 0, max: 23 }],
  ["dayOfMonth", { min: 1, max: 31 }],
  ["month", { min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 }],
  ["dayOfWeek", { min: 0, max: 7, names: DOW_NAMES, nameBase: 0 }],
];

function resolveToken(token: string, spec: FieldSpec): number {
  const lower = token.toLowerCase();
  if (spec.names) {
    const index = spec.names.indexOf(lower.slice(0, 3));
    if (index >= 0) return index + (spec.nameBase ?? 0);
  }
  const value = Number.parseInt(token, 10);
  if (!Number.isFinite(value) || String(value) !== token.replace(/^0+(?=\d)/, "")) {
    throw new Error(`unrecognized value "${token}"`);
  }
  return value;
}

function parseField(text: string, spec: FieldSpec, label: string): CronField {
  const values = new Set<number>();
  let wildcard = false;
  for (const part of text.split(",")) {
    if (!part) throw new Error(`${label}: empty list item`);
    const [rangeText, stepText] = part.split("/") as [string, string | undefined];
    const step = stepText !== undefined ? Number.parseInt(stepText, 10) : 1;
    if (!Number.isFinite(step) || step < 1) throw new Error(`${label}: bad step "${stepText ?? ""}"`);
    let lo: number;
    let hi: number;
    if (rangeText === "*") {
      lo = spec.min;
      hi = spec.max;
      if (step === 1) wildcard = true;
    } else if (rangeText.includes("-")) {
      const [a, b] = rangeText.split("-") as [string, string];
      lo = resolveToken(a, spec);
      hi = resolveToken(b, spec);
    } else {
      lo = resolveToken(rangeText, spec);
      hi = stepText !== undefined ? spec.max : lo;
    }
    if (lo > hi || lo < spec.min || hi > spec.max) {
      throw new Error(`${label}: value out of range (${spec.min}–${spec.max})`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v > 6 && spec.max === 7 ? v % 7 : v);
  }
  return { values, wildcard };
}

/** Parse a 5-field cron expression; throws Error with a plain-words reason. */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`expected 5 fields (minute hour day month weekday), got ${fields.length}`);
  }
  const result: Partial<Record<keyof ParsedCron, CronField>> = {};
  FIELD_SPECS.forEach(([key, spec], index) => {
    result[key] = parseField(fields[index] ?? "", spec, key);
  });
  return result as ParsedCron;
}

/** null when valid; a plain-words problem statement otherwise. */
export function validateCron(expression: string): string | null {
  try {
    parseCron(expression);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ─── Human description (best-effort) ─────────────────────────────────────────

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function listValues(field: CronField, labels?: readonly string[], offset = 0): string {
  return [...field.values]
    .sort((a, b) => a - b)
    .map((v) => (labels ? (labels[v - offset] ?? String(v)) : String(v)))
    .join(", ");
}

export function describeCron(expression: string): string {
  let cron: ParsedCron;
  try {
    cron = parseCron(expression);
  } catch {
    return "";
  }
  const { minute, hour, dayOfMonth, month, dayOfWeek } = cron;

  let timePart: string;
  if (minute.wildcard && hour.wildcard) {
    timePart = "Every minute";
  } else if (!minute.wildcard && hour.wildcard && minute.values.size === 1) {
    const m = [...minute.values][0] ?? 0;
    timePart = m === 0 ? "Every hour, on the hour" : `Every hour at minute ${m}`;
  } else if (minute.values.size <= 4 && hour.values.size <= 4 && !minute.wildcard && !hour.wildcard) {
    const times: string[] = [];
    for (const h of [...hour.values].sort((a, b) => a - b)) {
      for (const m of [...minute.values].sort((a, b) => a - b)) {
        times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    timePart = `At ${times.join(", ")}`;
  } else {
    timePart = `At minute ${minute.wildcard ? "*" : listValues(minute)} past hour ${
      hour.wildcard ? "*" : listValues(hour)
    }`;
  }

  const dayParts: string[] = [];
  if (!dayOfWeek.wildcard) dayParts.push(`on ${listValues(dayOfWeek, DOW_LABELS)}`);
  if (!dayOfMonth.wildcard) dayParts.push(`on day ${listValues(dayOfMonth)} of the month`);
  if (!month.wildcard) dayParts.push(`in ${listValues(month, MONTH_LABELS, 1)}`);
  if (!dayOfWeek.wildcard && !dayOfMonth.wildcard) {
    // Standard cron: when BOTH day fields are restricted, a date matching EITHER runs.
    dayParts[0] = `on ${listValues(dayOfWeek, DOW_LABELS)} OR day ${listValues(dayOfMonth)} of the month`;
    dayParts.splice(1, 1);
  }
  return [timePart, ...dayParts].join(" ");
}

// ─── Next-run preview (timezone-aware) ───────────────────────────────────────

interface ZonedParts {
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  dow: number; // 0-6, Sunday=0
}

const DOW_FROM_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  const parts = zonedFormatter(timeZone).formatToParts(epochMs);
  const out: ZonedParts = { month: 1, day: 1, hour: 0, minute: 0, dow: 0 };
  for (const part of parts) {
    if (part.type === "month") out.month = Number.parseInt(part.value, 10);
    else if (part.type === "day") out.day = Number.parseInt(part.value, 10);
    else if (part.type === "hour") out.hour = Number.parseInt(part.value, 10) % 24;
    else if (part.type === "minute") out.minute = Number.parseInt(part.value, 10);
    else if (part.type === "weekday") out.dow = DOW_FROM_SHORT[part.value] ?? 0;
  }
  return out;
}

function dayMatches(cron: ParsedCron, parts: ZonedParts): boolean {
  const domRestricted = !cron.dayOfMonth.wildcard;
  const dowRestricted = !cron.dayOfWeek.wildcard;
  const domOk = cron.dayOfMonth.values.has(parts.day);
  const dowOk = cron.dayOfWeek.values.has(parts.dow);
  if (domRestricted && dowRestricted) return domOk || dowOk; // standard cron either-rule
  if (domRestricted) return domOk;
  if (dowRestricted) return dowOk;
  return true;
}

const MINUTE_MS = 60_000;
const HORIZON_MS = 400 * 86_400_000;
const MAX_STEPS = 20_000;

/**
 * Next `count` run times (epoch ms) for a cron expression in a timezone,
 * starting strictly after `from`. Returns [] when nothing matches within
 * ~400 days or the expression/timezone is invalid.
 */
export function nextCronRuns(
  expression: string,
  timeZone: string | undefined,
  count = 3,
  from: number = Date.now(),
): number[] {
  let cron: ParsedCron;
  try {
    cron = parseCron(expression);
  } catch {
    return [];
  }
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    zonedParts(from, tz); // throws on bad timezone
  } catch {
    return [];
  }

  const results: number[] = [];
  let t = Math.floor(from / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let steps = 0; steps < MAX_STEPS && results.length < count && t - from < HORIZON_MS; steps++) {
    const parts = zonedParts(t, tz);
    if (!cron.month.values.has(parts.month) || !dayMatches(cron, parts)) {
      // Jump to (approximately) the next local day boundary; parts are always
      // re-derived, so a DST offset only costs extra iterations, never a match
      // inside the already-checked minute.
      t += ((23 - parts.hour) * 60 + (60 - parts.minute)) * MINUTE_MS;
      continue;
    }
    if (!cron.hour.values.has(parts.hour)) {
      t += (60 - parts.minute) * MINUTE_MS;
      continue;
    }
    if (!cron.minute.values.has(parts.minute)) {
      t += MINUTE_MS;
      continue;
    }
    results.push(t);
    t += MINUTE_MS;
  }
  return results;
}

// ─── Every-interval helper (mirrors the daemon's parser) ────────────────────

const EVERY_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;

/** Parse "30s" / "5m" / "1h" / "1d" to ms; throws with a plain-words reason. */
export function parseEveryInterval(input: string): number {
  const match = input.trim().match(EVERY_PATTERN);
  if (!match) throw new Error(`Invalid interval "${input}" — use values like 30s, 5m, 1h, or 1d.`);
  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid interval amount "${input}"`);
  switch (match[2]) {
    case "ms":
      return amount;
    case "s":
      return amount * 1_000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 3_600_000;
    default:
      return amount * 86_400_000;
  }
}

/** IANA timezone list for the picker; [] when the runtime can't enumerate. */
export function timezoneOptions(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
}

export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
