// Diff view — pickers for working-tree vs staged vs arbitrary-ref
// comparisons over /app/git/diff, a per-file list with add/del counts, and
// unified-diff rendering with syntax highlight (lib/highlight.ts "diff"
// grammar) plus intra-view search: a query filters file sections to those
// containing it and renders matches with <mark> emphasis (plain-text lines
// while searching, so marks never fight the highlighter's HTML).
//
// Deep links: ?filter[mode]=working|staged|ref&filter[ref]=… — the Git view's
// commit peek jumps here via jumpToDiff (diff-model.ts module store).

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDiff, GitCompare, RefreshCw, Search } from "lucide-react";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { escapeHtml, highlightCode } from "../../lib/highlight.ts";
import { getCurrentUrlState } from "../../lib/router.ts";
import { codeKeys, gitApi, isGitMissingError, isNotARepoError, type DiffMode } from "./git-api.ts";
import {
  consumeDiffRequest,
  countMatches,
  diffTotals,
  parseUnifiedDiff,
  subscribeDiffRequest,
  type DiffFileSection,
} from "./diff-model.ts";

const MODES: Array<{ id: DiffMode; label: string; hint: string }> = [
  { id: "working", label: "Working tree", hint: "unstaged changes (working tree vs index)" },
  { id: "staged", label: "Staged", hint: "what the next commit contains (index vs HEAD)" },
  { id: "ref", label: "Ref…", hint: "working tree vs a ref, or a range like A..B / commit~1..commit" },
];

function initialMode(): DiffMode {
  const raw = getCurrentUrlState().filters["mode"];
  return raw === "staged" || raw === "ref" ? raw : "working";
}

export function DiffView() {
  const [mode, setMode] = useState<DiffMode>(initialMode);
  const [refDraft, setRefDraft] = useState(() => getCurrentUrlState().filters["ref"] ?? "");
  const [ref, setRef] = useState(refDraft);
  const [query, setQuery] = useState("");
  const fileAnchors = useRef(new Map<string, HTMLElement>());

  // Jump requests arriving while mounted (Git log peek → Diff), plus one that
  // may have been queued just before mount.
  useEffect(() => {
    const applyRequest = () => {
      const request = consumeDiffRequest();
      if (!request) return;
      setMode(request.mode);
      setRefDraft(request.ref ?? "");
      setRef(request.ref ?? "");
    };
    applyRequest();
    return subscribeDiffRequest(applyRequest);
  }, []);

  const refReady = mode !== "ref" || ref.trim() !== "";
  const diff = useQuery({
    queryKey: codeKeys.diff(mode, mode === "ref" ? ref : ""),
    queryFn: () => gitApi.diff(mode, mode === "ref" ? ref : undefined),
    enabled: refReady,
    retry: false,
    // App-local git — no wire events; diffs can be large, so refresh is manual
    // (button / mode switch) rather than an interval poll.
  });

  const sections = useMemo(() => parseUnifiedDiff(diff.data?.diff ?? ""), [diff.data]);
  const totals = useMemo(() => diffTotals(sections), [sections]);

  const trimmedQuery = query.trim();
  const visibleSections = useMemo(
    () =>
      trimmedQuery
        ? sections.filter(
            (s) =>
              countMatches(s.text, trimmedQuery) > 0 || s.path.toLowerCase().includes(trimmedQuery.toLowerCase()),
          )
        : sections,
    [sections, trimmedQuery],
  );

  const scrollToFile = (path: string) => {
    fileAnchors.current.get(path)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <div className="diff-modes" role="tablist" aria-label="Diff source">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? "diff-mode diff-mode--active" : "diff-mode"}
              title={m.hint}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "ref" && (
          <form
            className="diff-ref-form"
            onSubmit={(e) => {
              e.preventDefault();
              setRef(refDraft.trim());
            }}
          >
            <input
              type="text"
              className="diff-ref-input"
              placeholder="ref, e.g. HEAD~3, main, abc123~1..abc123"
              value={refDraft}
              onChange={(e) => setRefDraft(e.target.value)}
              spellCheck={false}
              aria-label="Diff ref"
            />
            <button type="submit" className="git-mini-button" disabled={refDraft.trim() === ""}>
              Compare
            </button>
          </form>
        )}

        <label className="diff-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="text"
            placeholder="Search in diff"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search within the diff"
          />
        </label>

        <button
          type="button"
          className="section-toolbar__refresh"
          aria-label="Refresh diff"
          onClick={() => void diff.refetch()}
        >
          <RefreshCw size={15} aria-hidden="true" className={diff.isFetching ? "spinning" : undefined} />
        </button>
      </div>

      {!refReady && (
        <EmptyState
          icon={<GitCompare size={28} aria-hidden="true" />}
          title="Enter a ref to compare"
          description="The working tree will be diffed against the ref you enter; ranges like A..B compare two commits."
        />
      )}

      {refReady && diff.isPending && <SkeletonBlock variant="text" lines={8} />}

      {refReady && diff.isError && (
        <>
          {isGitMissingError(diff.error) ? (
            <UnavailableState
              capability="git (system binary)"
              description="the git executable was not found on PATH."
            />
          ) : isNotARepoError(diff.error) ? (
            <EmptyState
              icon={<GitCompare size={28} aria-hidden="true" />}
              title="Not a git repository"
              description="The workspace directory is not inside a git repository — see the Git view for details."
            />
          ) : (
            <ErrorState error={diff.error} onRetry={() => void diff.refetch()} title="Failed to load diff" />
          )}
        </>
      )}

      {refReady && diff.isSuccess && sections.length === 0 && (
        <EmptyState
          icon={<FileDiff size={28} aria-hidden="true" />}
          title="No differences"
          description={
            mode === "working"
              ? "The working tree matches the index — nothing unstaged."
              : mode === "staged"
                ? "The index matches HEAD — nothing staged."
                : `No differences for ${ref}.`
          }
        />
      )}

      {refReady && diff.isSuccess && sections.length > 0 && (
        <div className="diff-body">
          <aside className="diff-files" aria-label="Changed files">
            <p className="diff-files__totals">
              {totals.files} file{totals.files === 1 ? "" : "s"} ·{" "}
              <span className="diff-add">+{totals.additions}</span> <span className="diff-del">−{totals.deletions}</span>
              {diff.data.truncated && <span className="badge warning">truncated</span>}
            </p>
            <ul>
              {sections.map((section) => {
                const matches = trimmedQuery ? countMatches(section.text, trimmedQuery) : 0;
                const hidden = trimmedQuery !== "" && !visibleSections.includes(section);
                return (
                  <li key={section.path}>
                    <button
                      type="button"
                      className={hidden ? "diff-file-row diff-file-row--filtered" : "diff-file-row"}
                      onClick={() => scrollToFile(section.path)}
                      disabled={hidden}
                      title={hidden ? "No matches for the current search" : section.path}
                    >
                      <code className="diff-file-row__path">{section.path}</code>
                      <span className="diff-file-row__counts">
                        <span className="diff-add">+{section.additions}</span>
                        <span className="diff-del">−{section.deletions}</span>
                        {trimmedQuery && matches > 0 && <span className="badge info">{matches}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <div className="diff-sections">
            {trimmedQuery && visibleSections.length === 0 && (
              <EmptyState title="No matches" description={`Nothing in this diff contains “${trimmedQuery}”.`} />
            )}
            {visibleSections.map((section) => (
              <FileSection
                key={section.path}
                section={section}
                query={trimmedQuery}
                anchorRef={(el) => {
                  if (el) fileAnchors.current.set(section.path, el);
                  else fileAnchors.current.delete(section.path);
                }}
              />
            ))}
            {diff.data.truncated && (
              <p className="git-honest-note" role="note">
                This diff exceeded the 2&nbsp;MB transfer cap and was truncated — narrow it with a path or ref range.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── one file section ────────────────────────────────────────────────────────

function FileSection({
  section,
  query,
  anchorRef,
}: {
  section: DiffFileSection;
  query: string;
  anchorRef: (el: HTMLElement | null) => void;
}) {
  const html = useMemo(() => {
    if (section.isBinary) return "";
    if (query) return markLines(section.text, query);
    return highlightCode(section.text, "diff").html;
  }, [section, query]);

  return (
    <section className="diff-file-section" ref={anchorRef} aria-label={`Diff for ${section.path}`}>
      <header className="diff-file-section__head">
        <code>{section.isRename ? `${section.oldPath} → ${section.path}` : section.path}</code>
        <span className="diff-file-section__flags">
          {section.isNew && <span className="badge ok">new</span>}
          {section.isDeleted && <span className="badge bad">deleted</span>}
          {section.isRename && <span className="badge info">renamed</span>}
          {section.isBinary && <span className="badge neutral">binary</span>}
          <span className="diff-add">+{section.additions}</span>
          <span className="diff-del">−{section.deletions}</span>
        </span>
      </header>
      {section.isBinary ? (
        <p className="git-honest-note" role="note">
          Binary file — no text diff to render.
        </p>
      ) : (
        // Highlight source: hljs over local git output, or our own
        // escapeHtml+<mark> when searching. Both escape all file content.
        <pre className="diff-pre hljs" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </section>
  );
}

/** Escape every line, wrapping case-insensitive query matches in <mark>. */
function markLines(text: string, query: string): string {
  const lower = query.toLowerCase();
  return text
    .split("\n")
    .map((line) => {
      const lineLower = line.toLowerCase();
      let out = "";
      let cursor = 0;
      let hit = lineLower.indexOf(lower);
      while (hit !== -1) {
        out += escapeHtml(line.slice(cursor, hit));
        out += `<mark>${escapeHtml(line.slice(hit, hit + query.length))}</mark>`;
        cursor = hit + query.length;
        hit = lineLower.indexOf(lower, cursor);
      }
      out += escapeHtml(line.slice(cursor));
      const cls = line.startsWith("+") ? "diff-line-add" : line.startsWith("-") ? "diff-line-del" : "";
      return cls ? `<span class="${cls}">${out}</span>` : out;
    })
    .join("\n");
}
