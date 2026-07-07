// App-local pinned/favorite models (docs/FEATURES.md §14 "Pin/unpin favorite
// models" — backing: app-local favorites). Persisted per the app's shared-store
// conventions in localStorage; a tiny external store so every mounted pin
// button re-renders on toggle without prop drilling.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "goodvibes.app.providers.favorite-models";

let favorites: readonly string[] = readStored();
const listeners = new Set<() => void>();

function readStored(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function persist(next: readonly string[]): void {
  favorites = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota/privacy failures degrade to session-only pins — never a crash.
  }
  listeners.forEach((fn) => fn());
}

export function isFavoriteModel(registryKey: string): boolean {
  return favorites.includes(registryKey);
}

export function toggleFavoriteModel(registryKey: string): void {
  persist(
    favorites.includes(registryKey)
      ? favorites.filter((key) => key !== registryKey)
      : [...favorites, registryKey],
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive snapshot of pinned registry keys, insertion order. */
export function useFavoriteModels(): readonly string[] {
  return useSyncExternalStore(subscribe, () => favorites, () => favorites);
}
