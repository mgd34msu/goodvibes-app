// VIBE.md handling: reads and writes the REAL file <appHome>/VIBE.md
// (default ~/.goodvibes/app/VIBE.md). Never a database row — the desktop
// autopsy's Memory-view deception (a "file" editor that silently wrote to a
// DB) is the named failure this module exists to avoid.

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { VibeResponse } from "../../shared/registries.ts";
import { writeFileAtomic } from "./store.ts";

export function vibePath(appHome: string): string {
  return join(appHome, "VIBE.md");
}

export async function readVibe(appHome: string): Promise<VibeResponse> {
  const path = vibePath(appHome);
  try {
    const content = await readFile(path, "utf8");
    return { content, path, exists: true };
  } catch {
    return { content: "", path, exists: false };
  }
}

export async function writeVibe(appHome: string, content: string): Promise<VibeResponse> {
  const path = vibePath(appHome);
  await writeFileAtomic(path, content);
  return { content, path, exists: true };
}
