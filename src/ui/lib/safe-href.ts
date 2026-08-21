// One gate for every URL this app puts in an <a href> that it did not write
// itself. Daemon payloads, GitHub API bodies, CI reports, research findings and
// scraped page metadata all reach the renderer as plain strings, and a string
// that reaches href is not inert: `javascript:` runs, `data:` opens a document
// this app's origin owns, and a relative string silently resolves against the
// app's own page instead of going anywhere the operator expects.
//
// The rule is an allowlist, not a denylist: only an absolute http: or https:
// URL comes back. Everything else answers undefined, and the caller renders the
// text as a plain span, so the operator still SEES the value the daemon sent and
// simply cannot click it.
//
// Parsing is delegated to the platform's own URL parser rather than a regex,
// because that is the parser the browser will use again when it resolves the
// href. `new URL()` already strips the tab/newline characters that split
// `java\nscript:` across lines and lowercases the scheme, so a value that
// parses to an http/https protocol here parses to the same protocol there. That
// equivalence is why the string that was PARSED is returned rather than the
// normalized `href`: the link target then matches the text shown beside it
// character for character, with no re-parse gap in between.

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * The url, when it is an absolute http:/https: URL; undefined otherwise.
 * Undefined is the render-as-text signal, never an error.
 */
export function safeHref(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    // No base argument on purpose: a relative string must FAIL here rather than
    // resolve against this app's loopback origin and become a link into the UI.
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  // The TRIMMED string, never the padded original. String.prototype.trim strips
  // a wider set of code points than the URL parser and the HTML attribute
  // parser do (NBSP, BOM, U+2028 and the rest of White_Space), so a value
  // padded with one of those parses as absolute HERE and as a RELATIVE url when
  // the browser resolves the href: the padding survives into the attribute, the
  // scheme no longer starts the string, and the link silently points back at
  // this app's own origin. Returning what was actually parsed closes the gap.
  return ALLOWED_PROTOCOLS.has(parsed.protocol) ? trimmed : undefined;
}

/** True when safeHref would hand this value back. For chrome that only needs
 *  to decide whether to render a link at all. */
export function isSafeHref(url: unknown): boolean {
  return safeHref(url) !== undefined;
}
