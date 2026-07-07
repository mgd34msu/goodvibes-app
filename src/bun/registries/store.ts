// File-backed JSON registry store: one <collection>.json per collection under
// <appHome>/registries/. Atomic writes (temp + rename), corrupt files renamed
// aside (never crash the app), per-collection mutation serialization so
// read-modify-write cycles never interleave. docs/ARCHITECTURE.md §5.

import { join, dirname } from "node:path";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import type { RegistryCollection, RegistryItem } from "../../shared/registries.ts";

interface StoreFile {
  version: 1;
  items: RegistryItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function newRegistryId(): string {
  return crypto.randomUUID();
}

/** Write content to `path` atomically: temp file in the same dir, then rename. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
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

export class RegistryStore {
  /** Directory holding <collection>.json files (e.g. ~/.goodvibes/app/registries). */
  readonly root: string;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(root: string) {
    this.root = root;
  }

  filePath(collection: RegistryCollection): string {
    return join(this.root, `${collection}.json`);
  }

  /** Serialize mutations per collection so concurrent writes never interleave. */
  private withLock<T>(collection: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(collection) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      collection,
      next.catch(() => undefined),
    );
    return next;
  }

  /**
   * Load a collection. Missing file → empty. Corrupt file → renamed to
   * <file>.corrupt-<ts> with a loud warning, then treated as empty; the app
   * never crashes on a bad store file.
   */
  private async load(collection: RegistryCollection): Promise<RegistryItem[]> {
    const path = this.filePath(collection);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return []; // ENOENT (or unreadable): start clean.
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
        throw new Error("store file is not {version, items[]}");
      }
      return parsed.items.filter(isRecord) as RegistryItem[];
    } catch (err) {
      const aside = `${path}.corrupt-${Date.now()}`;
      console.warn(
        `[registries] CORRUPT store file for "${collection}" at ${path}: ${
          err instanceof Error ? err.message : String(err)
        } — renaming to ${aside} and starting with an empty collection.`,
      );
      await rename(path, aside).catch((renameErr) => {
        console.warn(`[registries] could not rename corrupt file aside: ${String(renameErr)}`);
      });
      return [];
    }
  }

  private async save(collection: RegistryCollection, items: RegistryItem[]): Promise<void> {
    const file: StoreFile = { version: 1, items };
    await writeFileAtomic(this.filePath(collection), `${JSON.stringify(file, null, 2)}\n`);
  }

  async list(collection: RegistryCollection): Promise<RegistryItem[]> {
    return this.withLock(collection, () => this.load(collection));
  }

  async get(collection: RegistryCollection, id: string): Promise<RegistryItem | undefined> {
    const items = await this.list(collection);
    return items.find((item) => item.id === id);
  }

  /** Insert a new item; id/createdAt/updatedAt are always assigned server-side. */
  async create(collection: RegistryCollection, input: Record<string, unknown>): Promise<RegistryItem> {
    return this.withLock(collection, async () => {
      const items = await this.load(collection);
      const now = nowIso();
      const item: RegistryItem = { ...input, id: newRegistryId(), createdAt: now, updatedAt: now };
      items.push(item);
      await this.save(collection, items);
      return item;
    });
  }

  /** Replace an item's fields; id and createdAt are preserved, updatedAt bumped. */
  async put(
    collection: RegistryCollection,
    id: string,
    input: Record<string, unknown>,
  ): Promise<RegistryItem | undefined> {
    return this.withLock(collection, async () => {
      const items = await this.load(collection);
      const index = items.findIndex((item) => item.id === id);
      const existing = items[index];
      if (index < 0 || existing === undefined) return undefined;
      const item: RegistryItem = {
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      };
      items[index] = item;
      await this.save(collection, items);
      return item;
    });
  }

  async delete(collection: RegistryCollection, id: string): Promise<boolean> {
    return this.withLock(collection, async () => {
      const items = await this.load(collection);
      const next = items.filter((item) => item.id !== id);
      if (next.length === items.length) return false;
      await this.save(collection, next);
      return true;
    });
  }

  /** Arbitrary read-modify-write under the collection lock (documents versioning). */
  async mutate<T>(
    collection: RegistryCollection,
    fn: (items: RegistryItem[]) => Promise<{ items: RegistryItem[]; result: T }> | { items: RegistryItem[]; result: T },
  ): Promise<T> {
    return this.withLock(collection, async () => {
      const items = await this.load(collection);
      const { items: next, result } = await fn(items);
      await this.save(collection, next);
      return result;
    });
  }

  /**
   * Bulk insert for the import bridge: preserves incoming ids so re-imports are
   * idempotent, skips items whose id already exists. Returns how many were added.
   */
  async insertImported(collection: RegistryCollection, incoming: RegistryItem[]): Promise<number> {
    return this.withLock(collection, async () => {
      const items = await this.load(collection);
      const existingIds = new Set(items.map((item) => item.id));
      let added = 0;
      const now = nowIso();
      for (const candidate of incoming) {
        const id = typeof candidate.id === "string" && candidate.id !== "" ? candidate.id : newRegistryId();
        if (existingIds.has(id)) continue;
        existingIds.add(id);
        items.push({
          ...candidate,
          id,
          createdAt: typeof candidate.createdAt === "string" && candidate.createdAt !== "" ? candidate.createdAt : now,
          updatedAt: typeof candidate.updatedAt === "string" && candidate.updatedAt !== "" ? candidate.updatedAt : now,
        });
        added++;
      }
      if (added > 0) await this.save(collection, items);
      return added;
    });
  }
}
