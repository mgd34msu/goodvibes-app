// /app/git/* — workspace git operations for the Code views (docs/FEATURES.md
// §15, docs/ARCHITECTURE.md §5). Runs the system `git` binary via Bun.spawn
// (no native modules, no simple-git) against ONE workspace directory:
// GOODVIBES_WORKING_DIR when set, else the app's launch cwd — the same
// directory a co-located daemon treats as its workspace.
//
// Safety rails (desktop autopsy): NO force flags anywhere, no reset --hard,
// no clean, no push. Commit REFUSES an empty message and an empty index (no
// no-op commits). Every response that matters for guarding carries dirty-tree
// counts so the UI can explain before acting. All ref/path inputs are
// validated (no option injection via "-…", no traversal) and passed after a
// literal "--" separator.

import { homedir } from "node:os";
import { join } from "node:path";
import type { AppRouteHandler } from "./app-routes.ts";

const GIT_TIMEOUT_MS = 15_000;
const LOG_LIMIT_DEFAULT = 50;
const LOG_LIMIT_MAX = 200;
const DIFF_BYTE_CAP = 2_000_000; // ~2 MB of unified diff before truncation

const US = "\x1f";
const RS = "\x1e";

// ─── spawn plumbing ──────────────────────────────────────────────────────────

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

async function runGit(workspaceDir: string, args: string[]): Promise<GitResult> {
  const proc = Bun.spawn(["git", "--no-pager", ...args], {
    cwd: workspaceDir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0", // never hang on credential prompts
      GIT_OPTIONAL_LOCKS: "0", // status et al. must not take locks under a running agent
      LC_ALL: "C",
    },
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, GIT_TIMEOUT_MS);

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

// ─── validation ──────────────────────────────────────────────────────────────

/** Repo-relative path: non-empty, not an option, no traversal, not absolute. */
function isSafePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("-") &&
    !path.startsWith("/") &&
    !path.split("/").includes("..")
  );
}

/** Ref/revision names: branch, tag, sha, HEAD~2, stash@{0}, a/b range etc. */
const REF_PATTERN = /^[A-Za-z0-9._/@{}^~+-]+$/;

function isSafeRef(ref: unknown): ref is string {
  return typeof ref === "string" && ref.length > 0 && ref.length <= 256 && !ref.startsWith("-") && REF_PATTERN.test(ref);
}

const STASH_REF_PATTERN = /^stash@\{\d{1,4}\}$/;

// ─── responses ───────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function gitError(result: GitResult, fallbackCode: string, status = 500): Response {
  if (result.timedOut) {
    return json({ error: "git timed out", code: "GIT_TIMEOUT", detail: `exceeded ${GIT_TIMEOUT_MS}ms` }, 504);
  }
  return json(
    {
      error: result.stderr.trim() || result.stdout.trim() || "git failed",
      code: fallbackCode,
      exitCode: result.code,
    },
    status,
  );
}

function notARepo(workspaceDir: string): Response {
  return json(
    {
      error: `Not a git repository: ${workspaceDir}`,
      code: "GIT_NOT_A_REPO",
      workspaceDir,
    },
    409,
  );
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ─── status (porcelain v2) ───────────────────────────────────────────────────

export interface GitFileEntry {
  path: string;
  /** Two-letter XY code from porcelain v2 (X=index, Y=worktree). */
  xy: string;
  /** Original path for renames/copies. */
  origPath?: string;
}

interface ParsedStatus {
  branch: { name: string; oid: string; upstream: string; ahead: number; behind: number };
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
  conflicted: GitFileEntry[];
}

function parseStatusV2(text: string): ParsedStatus {
  const out: ParsedStatus = {
    branch: { name: "", oid: "", upstream: "", ahead: 0, behind: 0 },
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };

  for (const line of text.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      out.branch.name = line.slice("# branch.head ".length);
    } else if (line.startsWith("# branch.oid ")) {
      out.branch.oid = line.slice("# branch.oid ".length);
    } else if (line.startsWith("# branch.upstream ")) {
      out.branch.upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      if (match) {
        out.branch.ahead = Number(match[1]);
        out.branch.behind = Number(match[2]);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const renamed = line.startsWith("2 ");
      // "1 XY sub mH mI mW hH hI path" / "2 XY sub mH mI mW hH hI Xscore path\torig"
      const fieldCount = renamed ? 9 : 8;
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const rest = parts.slice(fieldCount).join(" ");
      let path = rest;
      let origPath: string | undefined;
      if (renamed) {
        const tab = rest.indexOf("\t");
        if (tab >= 0) {
          path = rest.slice(0, tab);
          origPath = rest.slice(tab + 1);
        }
      }
      const entry: GitFileEntry = origPath ? { path, xy, origPath } : { path, xy };
      const x = xy[0] ?? ".";
      const y = xy[1] ?? ".";
      if (x !== ".") out.staged.push(entry);
      if (y !== ".") out.unstaged.push(entry);
    } else if (line.startsWith("u ")) {
      const parts = line.split(" ");
      const xy = parts[1] ?? "UU";
      const path = parts.slice(10).join(" ");
      if (path) out.conflicted.push({ path, xy });
    } else if (line.startsWith("? ")) {
      out.untracked.push(line.slice(2));
    }
  }
  return out;
}

/** Dirty-tree guard block included on status + mutation responses. */
function dirtyGuard(status: ParsedStatus) {
  return {
    dirty:
      status.staged.length > 0 ||
      status.unstaged.length > 0 ||
      status.untracked.length > 0 ||
      status.conflicted.length > 0,
    stagedCount: status.staged.length,
    unstagedCount: status.unstaged.length,
    untrackedCount: status.untracked.length,
    conflictedCount: status.conflicted.length,
  };
}

async function loadStatus(workspaceDir: string): Promise<ParsedStatus | Response> {
  const result = await runGit(workspaceDir, ["status", "--porcelain=v2", "--branch"]);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_STATUS_FAILED");
  }
  return parseStatusV2(result.stdout);
}

// ─── handlers ────────────────────────────────────────────────────────────────

async function handleWorkspace(workspaceDir: string): Promise<Response> {
  const [inside, version] = await Promise.all([
    runGit(workspaceDir, ["rev-parse", "--is-inside-work-tree"]),
    runGit(workspaceDir, ["--version"]),
  ]);
  return json({
    workspaceDir,
    isRepo: inside.code === 0 && inside.stdout.trim() === "true",
    gitVersion: version.code === 0 ? version.stdout.trim() : "",
    source: process.env["GOODVIBES_WORKING_DIR"]?.trim() ? "GOODVIBES_WORKING_DIR" : "home (default)",
  });
}

const FILES_CAP = 20_000; // entries; repos larger than this get a truncated flag
const FILE_READ_CAP = 512 * 1024; // bytes of file content served to the UI

/** Tracked-file listing for the repo browser (git ls-files, bounded). */
async function handleFiles(workspaceDir: string): Promise<Response> {
  const result = await runGit(workspaceDir, ["ls-files", "-z"]);
  if (result.code !== 0) {
    return json({ error: "not a git repository", code: "GIT_NOT_REPO", detail: result.stderr.trim() }, 409);
  }
  const all = result.stdout.split("\0").filter(Boolean);
  return json({ files: all.slice(0, FILES_CAP), total: all.length, truncated: all.length > FILES_CAP });
}

/** Bounded read of one TRACKED file inside the workspace (repo browser preview).
 * Tracked-only (git ls-files --error-unmatch) doubles as the traversal guard:
 * git resolves the pathspec relative to the repo and rejects anything outside
 * or untracked, so /etc/passwd and ../ escapes never reach the filesystem read. */
async function handleFileRead(workspaceDir: string, url: URL): Promise<Response> {
  const rel = url.searchParams.get("path") ?? "";
  if (!rel || rel.startsWith("/") || rel.includes("..")) {
    return json({ error: "invalid path", code: "GIT_BAD_PATH" }, 400);
  }
  const tracked = await runGit(workspaceDir, ["ls-files", "--error-unmatch", "--", rel]);
  if (tracked.code !== 0) {
    return json({ error: "not a tracked file", code: "GIT_NOT_TRACKED", detail: rel }, 404);
  }
  const file = Bun.file(join(workspaceDir, rel));
  const size = file.size;
  const buf = new Uint8Array(await file.slice(0, Math.min(size, FILE_READ_CAP)).arrayBuffer());
  const binary = buf.subarray(0, 8000).includes(0);
  return json({
    path: rel,
    size,
    truncated: size > FILE_READ_CAP,
    binary,
    content: binary ? "" : new TextDecoder().decode(buf),
  });
}

async function handleStatus(workspaceDir: string): Promise<Response> {
  const status = await loadStatus(workspaceDir);
  if (status instanceof Response) return status;
  return json({ workspaceDir, ...status, guard: dirtyGuard(status) });
}

async function handleLog(workspaceDir: string, url: URL): Promise<Response> {
  const rawLimit = Number(url.searchParams.get("limit") ?? LOG_LIMIT_DEFAULT);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), LOG_LIMIT_MAX) : LOG_LIMIT_DEFAULT;
  const ref = url.searchParams.get("ref") ?? "";
  if (ref && !isSafeRef(ref)) return json({ error: `Invalid ref: ${ref}`, code: "GIT_BAD_REF" }, 400);

  const format = `%H${US}%h${US}%an${US}%ae${US}%aI${US}%P${US}%s${US}%b${RS}`;
  const args = ["log", `-n${limit}`, `--format=${format}`];
  if (ref) args.push(ref);
  args.push("--");

  const result = await runGit(workspaceDir, args);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    // Empty repository (no commits yet) is a normal state, not an error.
    if (/does not have any commits yet|bad default revision/i.test(result.stderr)) {
      return json({ commits: [], limit, note: "Repository has no commits yet." });
    }
    return gitError(result, "GIT_LOG_FAILED");
  }

  const commits = result.stdout
    .split(RS)
    .map((chunk) => chunk.replace(/^\n/, ""))
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const f = chunk.split(US);
      return {
        hash: f[0] ?? "",
        shortHash: f[1] ?? "",
        author: f[2] ?? "",
        email: f[3] ?? "",
        date: f[4] ?? "",
        parents: (f[5] ?? "").split(" ").filter(Boolean),
        subject: f[6] ?? "",
        body: (f[7] ?? "").trimEnd(),
      };
    });

  return json({ commits, limit });
}

async function handleBranches(workspaceDir: string): Promise<Response> {
  const format = "%(refname:short)\t%(objectname:short)\t%(HEAD)\t%(upstream:short)\t%(committerdate:iso8601-strict)";
  const [local, remote] = await Promise.all([
    runGit(workspaceDir, ["branch", "--list", `--format=${format}`]),
    runGit(workspaceDir, ["branch", "--remotes", "--list", `--format=${format}`]),
  ]);
  if (local.code !== 0) {
    if (/not a git repository/i.test(local.stderr)) return notARepo(workspaceDir);
    return gitError(local, "GIT_BRANCHES_FAILED");
  }

  const parse = (text: string) =>
    text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const f = line.split("\t");
        return {
          name: f[0] ?? "",
          sha: f[1] ?? "",
          current: (f[2] ?? "") === "*",
          upstream: f[3] ?? "",
          committedAt: f[4] ?? "",
        };
      })
      .filter((b) => b.name && !b.name.endsWith("/HEAD"));

  return json({
    local: parse(local.stdout),
    remote: remote.code === 0 ? parse(remote.stdout) : [],
  });
}

async function handleDiff(workspaceDir: string, url: URL): Promise<Response> {
  const mode = url.searchParams.get("mode") ?? "working";
  const ref = url.searchParams.get("ref") ?? "";
  const path = url.searchParams.get("path") ?? "";

  if (mode !== "working" && mode !== "staged" && mode !== "ref") {
    return json({ error: `Unknown diff mode: ${mode}`, code: "GIT_BAD_DIFF_MODE" }, 400);
  }
  if (mode === "ref" && !isSafeRef(ref)) {
    return json({ error: ref ? `Invalid ref: ${ref}` : "mode=ref requires ?ref=", code: "GIT_BAD_REF" }, 400);
  }
  if (path && !isSafePath(path)) return json({ error: `Invalid path: ${path}`, code: "GIT_BAD_PATH" }, 400);

  const args = ["diff", "--no-color", "--no-ext-diff"];
  if (mode === "staged") args.push("--cached");
  if (mode === "ref") args.push(ref);
  args.push("--");
  if (path) args.push(path);

  const result = await runGit(workspaceDir, args);
  if (result.code !== 0 && result.code !== 1) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_DIFF_FAILED");
  }

  let diff = result.stdout;
  let truncated = false;
  if (diff.length > DIFF_BYTE_CAP) {
    diff = diff.slice(0, DIFF_BYTE_CAP);
    truncated = true;
  }
  return json({ mode, ref: mode === "ref" ? ref : "", path, diff, truncated });
}

function readPaths(body: Record<string, unknown>): string[] | Response {
  const raw = body["paths"];
  if (!Array.isArray(raw) || raw.length === 0) {
    return json({ error: "Body requires non-empty paths: string[]", code: "GIT_PATHS_REQUIRED" }, 400);
  }
  const paths: string[] = [];
  for (const item of raw) {
    if (!isSafePath(item)) return json({ error: `Invalid path: ${String(item)}`, code: "GIT_BAD_PATH" }, 400);
    paths.push(item);
  }
  return paths;
}

async function handleStage(workspaceDir: string, req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const paths = readPaths(body);
  if (paths instanceof Response) return paths;

  const result = await runGit(workspaceDir, ["add", "--", ...paths]);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_STAGE_FAILED", 409);
  }
  const status = await loadStatus(workspaceDir);
  return json({ ok: true, staged: paths, guard: status instanceof Response ? undefined : dirtyGuard(status) });
}

async function handleUnstage(workspaceDir: string, req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const paths = readPaths(body);
  if (paths instanceof Response) return paths;

  // restore --staged only moves index → it never touches the working tree.
  let result = await runGit(workspaceDir, ["restore", "--staged", "--", ...paths]);
  if (result.code !== 0 && /bad revision|unknown revision|HEAD/i.test(result.stderr)) {
    // Repo with no commits yet: unstage means dropping the path from the index.
    result = await runGit(workspaceDir, ["rm", "--cached", "-r", "--quiet", "--", ...paths]);
  }
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_UNSTAGE_FAILED", 409);
  }
  const status = await loadStatus(workspaceDir);
  return json({ ok: true, unstaged: paths, guard: status instanceof Response ? undefined : dirtyGuard(status) });
}

async function handleCommit(workspaceDir: string, req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const message = typeof body["message"] === "string" ? body["message"].trim() : "";
  if (!message) {
    return json({ error: "Commit message is required.", code: "GIT_COMMIT_MESSAGE_REQUIRED" }, 400);
  }

  // Refuse no-op commits: the index must contain something. Grounded in the
  // same porcelain-v2 parse the status endpoint uses (works in empty repos
  // where `git diff --cached HEAD` cannot).
  const status = await loadStatus(workspaceDir);
  if (status instanceof Response) return status;
  if (status.conflicted.length > 0) {
    return json(
      {
        error: `Refusing to commit with ${status.conflicted.length} unresolved conflict(s).`,
        code: "GIT_COMMIT_CONFLICTS",
        guard: dirtyGuard(status),
      },
      409,
    );
  }
  if (status.staged.length === 0) {
    return json(
      {
        error: "Nothing is staged — stage changes first (no-op commits are refused).",
        code: "GIT_COMMIT_NOTHING_STAGED",
        guard: dirtyGuard(status),
      },
      409,
    );
  }

  const result = await runGit(workspaceDir, ["commit", "-m", message]);
  if (result.code !== 0) {
    return gitError(result, "GIT_COMMIT_FAILED", 409);
  }
  const head = await runGit(workspaceDir, ["rev-parse", "HEAD"]);
  return json({
    ok: true,
    hash: head.code === 0 ? head.stdout.trim() : "",
    summary: result.stdout.trim(),
  });
}

async function handleStashList(workspaceDir: string): Promise<Response> {
  const format = `%gd${US}%H${US}%cI${US}%gs${RS}`;
  const result = await runGit(workspaceDir, ["stash", "list", `--format=${format}`]);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_STASH_LIST_FAILED");
  }
  const stashes = result.stdout
    .split(RS)
    .map((chunk) => chunk.replace(/^\n/, ""))
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const f = chunk.split(US);
      return { ref: f[0] ?? "", sha: f[1] ?? "", date: f[2] ?? "", message: f[3] ?? "" };
    });
  return json({ stashes });
}

async function handleStashPush(workspaceDir: string, req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const message = typeof body["message"] === "string" ? body["message"].trim() : "";
  const includeUntracked = body["includeUntracked"] === true;

  const args = ["stash", "push"];
  if (includeUntracked) args.push("--include-untracked");
  if (message) args.push("-m", message);

  const result = await runGit(workspaceDir, args);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_STASH_PUSH_FAILED", 409);
  }
  if (/no local changes to save/i.test(result.stdout + result.stderr)) {
    return json({ ok: true, noop: true, note: "No local changes to save — nothing was stashed." });
  }
  return json({ ok: true, noop: false, summary: result.stdout.trim() });
}

async function handleStashPop(workspaceDir: string, req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const ref = typeof body["ref"] === "string" ? body["ref"] : "";
  if (ref && !STASH_REF_PATTERN.test(ref)) {
    return json({ error: `Invalid stash ref: ${ref} (expected stash@{n})`, code: "GIT_BAD_STASH_REF" }, 400);
  }

  const args = ["stash", "pop"];
  if (ref) args.push(ref);
  const result = await runGit(workspaceDir, args);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    const conflicted = /conflict/i.test(result.stdout + result.stderr);
    return json(
      {
        error: result.stderr.trim() || result.stdout.trim() || "stash pop failed",
        code: conflicted ? "GIT_STASH_POP_CONFLICT" : "GIT_STASH_POP_FAILED",
        note: conflicted
          ? "The stash was NOT dropped — resolve the conflicts in the working tree, then drop it manually."
          : undefined,
      },
      409,
    );
  }
  return json({ ok: true, summary: result.stdout.trim() });
}

async function handleWorktrees(workspaceDir: string): Promise<Response> {
  const result = await runGit(workspaceDir, ["worktree", "list", "--porcelain"]);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_WORKTREES_FAILED");
  }

  interface Worktree {
    path: string;
    head: string;
    branch: string;
    detached: boolean;
    bare: boolean;
    locked: boolean;
    lockReason: string;
    prunable: boolean;
  }
  const worktrees: Worktree[] = [];
  let current: Worktree | null = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = {
        path: line.slice("worktree ".length),
        head: "",
        branch: "",
        detached: false,
        bare: false,
        locked: false,
        lockReason: "",
        prunable: false,
      };
      worktrees.push(current);
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    } else if (line.startsWith("locked")) {
      current.locked = true;
      current.lockReason = line.slice(6).trim();
    } else if (line.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  return json({ worktrees });
}

// ─── checkout / branch-create (§15 row 2 — dirty-guarded, no force) ─────────

/** Switch branches. REFUSES when the working tree is dirty (reuses the same
 * porcelain-v2 guard as commit/stage) so the UI can explain before acting —
 * no `git checkout -f` path exists anywhere in this module. */
async function handleCheckout(workspaceDir: string, req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const branch = typeof body["branch"] === "string" ? body["branch"] : "";
  if (!isSafeRef(branch)) return json({ error: `Invalid branch: ${branch}`, code: "GIT_BAD_REF" }, 400);

  const status = await loadStatus(workspaceDir);
  if (status instanceof Response) return status;
  const guard = dirtyGuard(status);
  if (guard.dirty) {
    const dirtyCount = guard.stagedCount + guard.unstagedCount + guard.untrackedCount + guard.conflictedCount;
    return json(
      {
        error: `Refusing to checkout '${branch}' — working tree has ${dirtyCount} dirty file(s). Commit or stash first.`,
        code: "GIT_CHECKOUT_DIRTY",
        guard,
      },
      409,
    );
  }

  const result = await runGit(workspaceDir, ["checkout", branch]);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_CHECKOUT_FAILED", 409);
  }
  return json({ ok: true, branch, summary: (result.stderr.trim() || result.stdout.trim()) });
}

/** Create a new local branch, optionally from a start point. Never switches
 * to it — checkout is a separate, explicitly confirmed call from the UI. */
async function handleBranchCreate(workspaceDir: string, req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const name = typeof body["name"] === "string" ? body["name"] : "";
  const from = typeof body["from"] === "string" ? body["from"] : "";
  if (!isSafeRef(name)) return json({ error: `Invalid branch name: ${name}`, code: "GIT_BAD_REF" }, 400);
  if (from && !isSafeRef(from)) return json({ error: `Invalid start point: ${from}`, code: "GIT_BAD_REF" }, 400);

  const args = ["branch", name];
  if (from) args.push(from);
  const result = await runGit(workspaceDir, args);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_BRANCH_CREATE_FAILED", 409);
  }
  return json({ ok: true, name, from: from || undefined });
}

// ─── tags / remotes / reflog (§15 row 3 — read-only) ────────────────────────

async function handleTags(workspaceDir: string): Promise<Response> {
  const format = [
    "%(refname:short)",
    "%(objecttype)",
    "%(objectname:short)",
    "%(*objectname:short)",
    "%(contents:subject)",
    "%(creatordate:iso8601-strict)",
  ].join(US) + RS;
  const result = await runGit(workspaceDir, ["for-each-ref", `--format=${format}`, "refs/tags"]);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_TAGS_FAILED");
  }
  const tags = result.stdout
    .split(RS)
    .map((chunk) => chunk.replace(/^\n/, ""))
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const f = chunk.split(US);
      const annotated = (f[1] ?? "") === "tag";
      const objectSha = f[2] ?? "";
      const dereferencedSha = f[3] ?? "";
      return {
        name: f[0] ?? "",
        annotated,
        sha: objectSha,
        target: annotated && dereferencedSha ? dereferencedSha : objectSha,
        message: annotated ? (f[4] ?? "").trim() : "",
        date: f[5] ?? "",
      };
    });
  return json({ tags });
}

async function handleRemotes(workspaceDir: string): Promise<Response> {
  const result = await runGit(workspaceDir, ["remote", "-v"]);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    return gitError(result, "GIT_REMOTES_FAILED");
  }
  const byName = new Map<string, { name: string; fetchUrl: string; pushUrl: string }>();
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
    if (!match) continue;
    const name = match[1] ?? "";
    const url = match[2] ?? "";
    const kind = match[3] ?? "";
    const entry = byName.get(name) ?? { name, fetchUrl: "", pushUrl: "" };
    if (kind === "fetch") entry.fetchUrl = url;
    else if (kind === "push") entry.pushUrl = url;
    byName.set(name, entry);
  }
  return json({ remotes: [...byName.values()] });
}

const REFLOG_LIMIT = 50;

/** Bounded, read-only reflog for rescue browsing. No restore endpoint exists
 * yet — the UI labels that honestly rather than wiring a destructive reset. */
async function handleReflog(workspaceDir: string): Promise<Response> {
  const format = `%H${US}%h${US}%gd${US}%gs${US}%cI${RS}`;
  const result = await runGit(workspaceDir, ["reflog", "show", `-n${REFLOG_LIMIT}`, `--format=${format}`, "HEAD"]);
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return notARepo(workspaceDir);
    if (/does not have any commits yet|bad default revision|unknown revision/i.test(result.stderr)) {
      return json({ entries: [], limit: REFLOG_LIMIT, note: "No reflog entries yet." });
    }
    return gitError(result, "GIT_REFLOG_FAILED");
  }
  const entries = result.stdout
    .split(RS)
    .map((chunk) => chunk.replace(/^\n/, ""))
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const f = chunk.split(US);
      return { hash: f[0] ?? "", shortHash: f[1] ?? "", selector: f[2] ?? "", subject: f[3] ?? "", date: f[4] ?? "" };
    });
  return json({ entries, limit: REFLOG_LIMIT });
}

// ─── router ──────────────────────────────────────────────────────────────────

export function createGitRoutes(): AppRouteHandler {
  // NEVER default to process.cwd(): in the bundled app that is the launcher's
  // bin directory, so the Git view silently showed the app's own install repo
  // (verified live). Home is the honest fallback — the view then reports
  // "not a git repository" instead of lying about which repo it's showing.
  const workspaceDir = process.env["GOODVIBES_WORKING_DIR"]?.trim() || homedir();

  return async (req: Request, url: URL): Promise<Response> => {
    const sub = url.pathname.slice("/app/git".length) || "/";
    const method = req.method;

    try {
      if (method === "GET") {
        switch (sub) {
          case "/":
          case "/workspace":
            return await handleWorkspace(workspaceDir);
          case "/status":
            return await handleStatus(workspaceDir);
          case "/files":
            return await handleFiles(workspaceDir);
          case "/file":
            return await handleFileRead(workspaceDir, url);
          case "/log":
            return await handleLog(workspaceDir, url);
          case "/branches":
            return await handleBranches(workspaceDir);
          case "/diff":
            return await handleDiff(workspaceDir, url);
          case "/stash":
            return await handleStashList(workspaceDir);
          case "/worktrees":
            return await handleWorktrees(workspaceDir);
          case "/tags":
            return await handleTags(workspaceDir);
          case "/remotes":
            return await handleRemotes(workspaceDir);
          case "/reflog":
            return await handleReflog(workspaceDir);
          default:
            return json({ error: `Unknown git route: ${sub}`, code: "GIT_ROUTE_NOT_FOUND" }, 404);
        }
      }

      if (method === "POST") {
        switch (sub) {
          case "/stage":
            return await handleStage(workspaceDir, req);
          case "/unstage":
            return await handleUnstage(workspaceDir, req);
          case "/commit":
            return await handleCommit(workspaceDir, req);
          case "/stash/push":
            return await handleStashPush(workspaceDir, req);
          case "/stash/pop":
            return await handleStashPop(workspaceDir, req);
          case "/checkout":
            return await handleCheckout(workspaceDir, req);
          case "/branch-create":
            return await handleBranchCreate(workspaceDir, req);
          default:
            return json({ error: `Unknown git route: ${sub}`, code: "GIT_ROUTE_NOT_FOUND" }, 404);
        }
      }

      return json({ error: `Method ${method} not allowed`, code: "GIT_METHOD_NOT_ALLOWED" }, 405);
    } catch (err) {
      // ENOENT here means the git binary itself is missing — name it honestly.
      const detail = err instanceof Error ? err.message : String(err);
      const missingGit = /ENOENT|executable/i.test(detail);
      return json(
        {
          error: missingGit ? "The git executable was not found on PATH." : "git route failed",
          code: missingGit ? "GIT_BINARY_MISSING" : "GIT_INTERNAL",
          detail,
        },
        missingGit ? 501 : 500,
      );
    }
  };
}
