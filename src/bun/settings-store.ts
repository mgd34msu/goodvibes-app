// Single-writer for ~/.goodvibes/app/settings.json.
//
// Two modules own disjoint top-level keys in this one file: secrets.ts owns
// "app" (app-own settings) and notifications.ts owns "notifications". Before
// this store they each did an independent read-modify-write; the atomic rename
// prevented corruption but NOT lost updates — a concurrent write from the other
// module (each reading the pre-write object) could silently revert the other's
// key. Both now route their RMW through mutateAppSettings(), which serializes on
// a single process-wide chain so cross-module writes can never lose each other.
//
// Path resolution honors GOODVIBES_APP_HOME (matching the notifications module's
// prior behavior) so both owners always agree on the same file.

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";

const APP_HOME = process.env["GOODVIBES_APP_HOME"] ?? join(homedir(), ".goodvibes", "app");
export const APP_SETTINGS_PATH = join(APP_HOME, "settings.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** Read the whole settings.json object. Missing → {}. Corrupt → renamed aside, {}. */
export async function readAppSettings(): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(APP_SETTINGS_PATH, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("settings.json is not a JSON object");
    return parsed;
  } catch (err) {
    const aside = `${APP_SETTINGS_PATH}.corrupt-${Date.now()}`;
    console.warn(
      `[settings-store] CORRUPT settings.json at ${APP_SETTINGS_PATH}: ${
        err instanceof Error ? err.message : String(err)
      } — renaming to ${aside} and starting with defaults.`,
    );
    await rename(APP_SETTINGS_PATH, aside).catch(() => undefined);
    return {};
  }
}

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Serialized read-modify-write of settings.json. `mutate` receives the current
 * whole-file object and returns the next whole-file object; preserve every other
 * top-level key by spreading `current`. Runs under a process-wide chain so
 * concurrent writers (app-settings vs notifications) can't lose updates. The
 * chain survives a rejected write so later writes still run.
 */
export function mutateAppSettings(
  mutate: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const run = writeChain.then(async () => {
    const current = await readAppSettings();
    const next = mutate(current);
    await writeFileAtomic(APP_SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
  writeChain = run.catch(() => undefined);
  return run;
}
