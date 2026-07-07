// Per-repo session table (docs/FEATURES.md §15 row 10, docs/GAPS.md §15 row
// 10): sessions whose `project` field matches this git workspace, with
// jump-to-session links into the Sessions view.
//
// Backed by gv.sessions.list() (GET /api/sessions — the same cross-surface
// union SessionsView reads). That route ignores ?limit/?cursor and the
// daemon caps the union at 50 (verified live, see SessionsView.tsx) — this
// panel filters that same capped set client-side by `project`, so it is
// honestly "sessions in the 50 most recent whose project matches", never a
// claim of full history. `project` may be a workspace path, a repo name, or
// 'unknown' depending on how the session was registered, so the match is
// exact-or-contains-basename rather than a strict path equality — the raw
// value is always shown alongside the match so a user can judge it.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListTodo } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { asArray, asRecord, firstNumber, firstString, readPath } from "../../lib/wire.ts";
import { useUrlState } from "../../lib/router.ts";
import { EmptyState, ErrorState, SkeletonBlock } from "../../components/feedback.tsx";

const codeSessionsKey = ["code", "sessions", "repo"] as const;
const SESSIONS_CAP_NOTE = "up to the 50 most recent sessions across all projects — the daemon caps the session union.";

interface RepoSessionRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  project: string;
  updatedAt: number;
}

function rowFromRecord(value: unknown): RepoSessionRow {
  const record = asRecord(value);
  return {
    id: firstString(record, ["id", "sessionId"]),
    title: firstString(record, ["title", "name", "label"]) || firstString(record, ["id"]) || "Untitled session",
    kind: firstString(record, ["kind"]) || "unknown",
    status: firstString(record, ["status", "state"]) || "active",
    project: firstString(record, ["project"]) || "unknown",
    updatedAt: firstNumber(record, ["updatedAt", "lastActivityAt", "createdAt"]) ?? 0,
  };
}

function rowsFromListResponse(value: unknown): RepoSessionRow[] {
  const candidates: unknown[] = [value, readPath(value, ["sessions"]), readPath(value, ["items"]), readPath(value, ["data"])];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(rowFromRecord);
  }
  return asArray(value).map(rowFromRecord);
}

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? trimmed;
}

/** Loose match: project field is a path, a repo name, or 'unknown' depending
 * on how the session registered — never a strict path-equality assumption. */
function matchesWorkspace(project: string, workspaceDir: string): boolean {
  if (!project || project === "unknown") return false;
  const p = project.trim().toLowerCase();
  const dir = workspaceDir.trim().toLowerCase();
  const base = basename(workspaceDir).toLowerCase();
  return p === dir || p === base || p.endsWith(`/${base}`) || dir.endsWith(`/${p}`) || p.includes(base);
}

export function RepoSessionsPanel({ workspaceDir }: { workspaceDir: string }) {
  const { setUrlState } = useUrlState();
  const sessions = useQuery({
    queryKey: codeSessionsKey,
    queryFn: () => gv.sessions.list(),
    select: rowsFromListResponse,
    staleTime: 15_000,
    retry: false,
  });

  const matched = useMemo(() => {
    if (!sessions.data) return [];
    return sessions.data
      .filter((row) => matchesWorkspace(row.project, workspaceDir))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [sessions.data, workspaceDir]);

  return (
    <section className="repo-sessions" aria-label="Sessions in this repo">
      <h3 className="git-section-title">
        <ListTodo size={14} aria-hidden="true" /> Sessions here
        {sessions.isSuccess ? ` · ${matched.length}` : ""}
      </h3>
      <p className="git-honest-note" role="note">
        Filtered by session <code>project</code> matching this workspace, within {SESSIONS_CAP_NOTE}
      </p>
      {sessions.isPending && <SkeletonBlock variant="text" lines={3} />}
      {sessions.isError && (
        <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} title="Failed to load sessions" />
      )}
      {sessions.isSuccess && matched.length === 0 && (
        <EmptyState
          title="No sessions matched to this repo"
          description="Either no session was created from this workspace yet, or its project field does not match this directory."
        />
      )}
      {sessions.isSuccess && matched.length > 0 && (
        <ul className="repo-sessions__rows">
          {matched.map((row) => (
            <li key={row.id} className="repo-sessions__row">
              <button
                type="button"
                className="repo-sessions__jump"
                onClick={() => setUrlState({ view: "sessions", session: row.id })}
                title={`project: ${row.project}`}
              >
                <span className="repo-sessions__title">{row.title}</span>
                <span className="repo-sessions__meta">
                  <span className="badge neutral">{row.kind}</span>
                  <span className={`badge ${row.status === "closed" ? "neutral" : "ok"}`}>{row.status}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
