// Project-context viewer — docs/FEATURES.md §8 row 9. Directory input
// (defaults to GOODVIBES_WORKING_DIR, read off /app/git/workspace) → GET
// /app/local/context for the well-known-filename list → bounded read +
// markdown render via /app/local/context/file. Read-only; the allowlist of
// well-known basenames (CLAUDE.md, AGENTS.md, .cursorrules,
// .goodvibes/GOODVIBES.md, .github/copilot-instructions.md) IS the traversal
// guard on the Bun side (src/bun/local-tools.ts) — this panel never lets the
// user type an arbitrary file path, only pick from that fixed list.

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FolderOpen, RefreshCw } from "lucide-react";
import { appJson } from "../../lib/http.ts";
import { errorStatus } from "../../lib/errors.ts";
import { asRecord, firstArray, firstString } from "../../lib/wire.ts";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";

const poContextKeys = {
  workspace: ["personal-ops", "context", "workspace"] as const,
  files: (dir: string) => ["personal-ops", "context", "files", dir] as const,
  file: (path: string) => ["personal-ops", "context", "file", path] as const,
};

interface ContextFile {
  name: string;
  path: string;
  size: number;
  exists: boolean;
}

function parseContextFiles(value: unknown): ContextFile[] {
  return firstArray(asRecord(value), ["files"]).map((raw) => {
    const record = asRecord(raw);
    return {
      name: firstString(record, ["name"]),
      path: firstString(record, ["path"]),
      size: typeof record["size"] === "number" ? record["size"] : 0,
      exists: record["exists"] === true,
    };
  });
}

function isLocalUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 501;
}

export function ProjectContextPanel() {
  const queryClient = useQueryClient();
  const [dirInput, setDirInput] = useState("");
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);

  const workspace = useQuery({
    queryKey: poContextKeys.workspace,
    queryFn: () => appJson<{ workspaceDir?: string }>("/app/git/workspace"),
    retry: false,
  });

  const effectiveDir = activeDir ?? workspace.data?.workspaceDir ?? "";

  const files = useQuery({
    queryKey: poContextKeys.files(effectiveDir),
    queryFn: () => appJson<unknown>(`/app/local/context?dir=${encodeURIComponent(effectiveDir)}`),
    enabled: Boolean(effectiveDir),
    retry: false,
  });

  const fileDetail = useQuery({
    queryKey: poContextKeys.file(openFile ?? ""),
    queryFn: () => appJson<{ path: string; content: string; truncated: boolean }>(`/app/local/context/file?path=${encodeURIComponent(openFile ?? "")}`),
    enabled: Boolean(openFile),
    retry: false,
  });

  const entries = files.isSuccess ? parseContextFiles(files.data) : [];
  // Only a failed /app/local/context call means "local tools unavailable" —
  // a failed /app/git/workspace default just falls back to an empty
  // placeholder; the user can still type a directory in by hand.
  const unavailable = files.isError && isLocalUnavailable(files.error);

  function browse(event: FormEvent): void {
    event.preventDefault();
    const dir = dirInput.trim();
    if (!dir) return;
    setActiveDir(dir);
    setOpenFile(null);
  }

  return (
    <div className="po-context">
      <p className="po-context__note">
        Read-only. Only the well-known project-context files below are ever read — the allowlist of basenames is the
        traversal guard, so this cannot browse arbitrary paths.
      </p>

      <form className="po-context__dirform" onSubmit={browse}>
        <FolderOpen size={14} aria-hidden="true" />
        <input
          value={dirInput}
          onChange={(e) => setDirInput(e.target.value)}
          placeholder={workspace.data?.workspaceDir || "/absolute/path/to/project"}
          aria-label="Project directory"
        />
        <button type="submit" className="reg-button">
          Browse
        </button>
        {effectiveDir && (
          <button
            type="button"
            className="reg-icon-button"
            aria-label="Refresh context files"
            onClick={() => void files.refetch()}
          >
            <RefreshCw size={14} aria-hidden="true" className={files.isFetching ? "spinning" : undefined} />
          </button>
        )}
      </form>

      {effectiveDir && <p className="po-context__dir">{effectiveDir}</p>}

      {!effectiveDir && workspace.isPending && <SkeletonBlock variant="text" lines={2} />}

      {unavailable && (
        <UnavailableState
          capability="/app/local/context"
          description="the local-machine tools route is not part of this build, so project-context files cannot be inspected."
        />
      )}

      {effectiveDir && files.isPending && <SkeletonBlock variant="text" lines={4} />}

      {effectiveDir && files.isError && !unavailable && (
        <ErrorState error={files.error} onRetry={() => void files.refetch()} title="Failed to list context files" />
      )}

      {effectiveDir && files.isSuccess && (
        <ul className="po-context__files">
          {entries.map((file) => (
            <li key={file.path} className={file.exists ? "po-context__file" : "po-context__file po-context__file--missing"}>
              <button
                type="button"
                className="po-context__file-button"
                disabled={!file.exists}
                onClick={() => setOpenFile(file.path)}
              >
                <FileText size={14} aria-hidden="true" />
                <span className="po-context__file-name">{file.name}</span>
                <span className="po-context__file-meta">{file.exists ? `${file.size} bytes` : "not found"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {effectiveDir && files.isSuccess && entries.every((f) => !f.exists) && (
        <EmptyState
          icon={<FileText size={24} aria-hidden="true" />}
          title="No context files found"
          description="None of CLAUDE.md, AGENTS.md, .cursorrules, .goodvibes/GOODVIBES.md, or .github/copilot-instructions.md exist in this directory."
        />
      )}

      {openFile && (
        <section className="po-context__viewer" aria-label={`Contents of ${openFile}`}>
          <div className="po-context__viewer-head">
            <code>{openFile}</code>
            <button type="button" className="reg-icon-button" aria-label="Close file" onClick={() => setOpenFile(null)}>
              ×
            </button>
          </div>
          {fileDetail.isPending && <SkeletonBlock variant="text" lines={6} />}
          {fileDetail.isError && (
            <ErrorState
              error={fileDetail.error}
              onRetry={() => void queryClient.invalidateQueries({ queryKey: poContextKeys.file(openFile) })}
              title="Failed to read file"
            />
          )}
          {fileDetail.isSuccess && (
            <>
              {fileDetail.data.truncated && (
                <p className="po-context__truncated" role="status">
                  Truncated at 256 KB — showing the first portion of the file.
                </p>
              )}
              <div className="po-context__markdown">
                <MarkdownMessage content={fileDetail.data.content} />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
