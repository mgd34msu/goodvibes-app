// Dependency-free URL state encoder/decoder, ported from goodvibes-webui
// src/lib/router.ts. Every view is URL-addressable (?view=…&session=…&
// filter[k]=v) so palette jumps, notifications, and deep links compose
// (docs/UX.md §2).

import { useCallback, useEffect, useState } from "react";

/** The 26 sidebar views (docs/UX.md §2 information architecture). */
export type ViewId =
  // Work
  | "chat"
  | "sessions"
  | "fleet"
  | "approvals"
  // Automate
  | "automation"
  | "watchers"
  | "channels"
  // Know
  | "knowledge"
  | "memory"
  | "artifacts"
  | "research"
  | "documents"
  // Assistant
  | "home"
  | "routines"
  | "personas"
  | "skills"
  | "personal-ops"
  // Code
  | "git"
  | "diff"
  | "worktrees"
  | "checkpoints"
  | "terminal"
  // System
  | "observability"
  | "providers"
  | "mcp"
  | "peers"
  | "settings";

export const ALL_VIEW_IDS: readonly ViewId[] = [
  "chat",
  "sessions",
  "fleet",
  "approvals",
  "automation",
  "watchers",
  "channels",
  "knowledge",
  "memory",
  "artifacts",
  "research",
  "documents",
  "home",
  "routines",
  "personas",
  "skills",
  "personal-ops",
  "git",
  "diff",
  "worktrees",
  "checkpoints",
  "terminal",
  "observability",
  "providers",
  "mcp",
  "peers",
  "settings",
];

export interface AppUrlState {
  view: ViewId;
  session: string;
  filters: Record<string, string>;
}

const VALID_VIEWS: ReadonlySet<string> = new Set(ALL_VIEW_IDS);

const DEFAULT_STATE: AppUrlState = { view: "chat", session: "", filters: {} };

const FILTER_PREFIX = "filter[";

export function decodeUrlState(search: string = window.location.search): AppUrlState {
  const params = new URLSearchParams(search);

  const rawView = params.get("view") ?? "";
  const view: ViewId = VALID_VIEWS.has(rawView) ? (rawView as ViewId) : DEFAULT_STATE.view;
  const session = params.get("session") ?? "";

  const filters: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key.startsWith(FILTER_PREFIX) && key.endsWith("]")) {
      const filterKey = key.slice(FILTER_PREFIX.length, -1);
      if (filterKey.length > 0) filters[filterKey] = value;
    }
  });

  return { view, session, filters };
}

export function encodeUrlState(state: AppUrlState): string {
  const params = new URLSearchParams();
  params.set("view", state.view);
  if (state.session) params.set("session", state.session);
  for (const key of Object.keys(state.filters).sort()) {
    const value = state.filters[key];
    if (value !== undefined && value !== "") params.set(`${FILTER_PREFIX}${key}]`, value);
  }
  return params.toString();
}

export function pushState(state: AppUrlState): void {
  window.history.pushState(state, "", `${window.location.pathname}?${encodeUrlState(state)}`);
}

export function replaceState(state: AppUrlState): void {
  window.history.replaceState(state, "", `${window.location.pathname}?${encodeUrlState(state)}`);
}

export function getCurrentUrlState(): AppUrlState {
  return decodeUrlState(window.location.search);
}

// ---------------------------------------------------------------------------
// Hook (webui useUrlState port)
// ---------------------------------------------------------------------------

export interface UrlStateSetters {
  setView: (view: ViewId, options?: { replace?: boolean }) => void;
  setSession: (session: string, options?: { replace?: boolean }) => void;
  setFilters: (updates: Record<string, string | undefined>, options?: { replace?: boolean }) => void;
  setUrlState: (partial: Partial<AppUrlState>, options?: { replace?: boolean }) => void;
}

export interface UseUrlStateReturn extends AppUrlState, UrlStateSetters {}

export function useUrlState(): UseUrlStateReturn {
  const [urlState, setLocalState] = useState<AppUrlState>(() => decodeUrlState());

  // Normalize a bare "/" to "?view=chat" without a history entry, in an
  // effect so StrictMode's double-invoked initializers stay side-effect-free.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("view")) replaceState(urlState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handlePopState = () => setLocalState(decodeUrlState());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const apply = useCallback(
    (nextState: AppUrlState, options?: { replace?: boolean }) => {
      if (options?.replace) replaceState(nextState);
      else pushState(nextState);
      setLocalState(nextState);
    },
    [],
  );

  const setView = useCallback(
    (view: ViewId, options?: { replace?: boolean }) => apply({ ...urlState, view }, options),
    [urlState, apply],
  );

  const setSession = useCallback(
    (session: string, options?: { replace?: boolean }) => apply({ ...urlState, session }, options),
    [urlState, apply],
  );

  const setFilters = useCallback(
    (updates: Record<string, string | undefined>, options?: { replace?: boolean }) => {
      const next: Record<string, string> = { ...urlState.filters };
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      apply({ ...urlState, filters: next }, options);
    },
    [urlState, apply],
  );

  const setUrlState = useCallback(
    (partial: Partial<AppUrlState>, options?: { replace?: boolean }) =>
      apply({ ...urlState, ...partial }, options),
    [urlState, apply],
  );

  return { ...urlState, setView, setSession, setFilters, setUrlState };
}
