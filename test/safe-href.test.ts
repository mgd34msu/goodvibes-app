// Coverage for src/ui/lib/safe-href.ts, the one gate every daemon- or
// content-supplied URL passes before it reaches an <a href>.
//
// The cases that matter are the ones a caller would otherwise have rendered as
// a working link: a javascript: scheme (runs on click), a data: document (opens
// with this app's own origin), and a relative string (resolves against the
// app's page instead of going anywhere the operator expects).

import { describe, expect, test } from "bun:test";
import { isSafeHref, safeHref } from "../src/ui/lib/safe-href.ts";

describe("safeHref allows absolute http and https", () => {
  test("plain https", () => {
    expect(safeHref("https://github.com/mgd34msu/goodvibes-daemon/releases/latest")).toBe(
      "https://github.com/mgd34msu/goodvibes-daemon/releases/latest",
    );
  });

  test("plain http", () => {
    expect(safeHref("http://127.0.0.1:3421/status")).toBe("http://127.0.0.1:3421/status");
  });

  test("an uppercase scheme is still http", () => {
    expect(safeHref("HTTPS://example.com/x")).toBe("HTTPS://example.com/x");
  });

  test("the ORIGINAL string comes back, not a normalized one", () => {
    // The href must match the text rendered beside it character for character;
    // returning URL.href would silently append a path separator here.
    expect(safeHref("https://example.com")).toBe("https://example.com");
  });

  test("query strings and fragments survive", () => {
    expect(safeHref("https://example.com/a?b=c#d")).toBe("https://example.com/a?b=c#d");
  });

  test("the TRIMMED value comes back, never the padded original", () => {
    // The padded original in an href is a different url: the scheme no longer
    // starts the string, so the browser resolves it RELATIVE to this app's own
    // origin. Returning what was actually parsed is what closes that gap.
    expect(safeHref(" https://ok.com")).toBe("https://ok.com");
    expect(safeHref("https://ok.com\t")).toBe("https://ok.com");
    expect(safeHref("\n  https://ok.com/path  \n")).toBe("https://ok.com/path");
  });

  test("the platform behavior this fix turns on, pinned rather than asserted in prose", () => {
    // Measured: String.trim strips NBSP / BOM / U+2028, the URL parser does
    // not. So the padded original fails to parse as absolute AND resolves
    // against the app's own origin when a browser reads it out of an href,
    // which is precisely what returning the untrimmed value would have done.
    for (const padded of [" https://ok.com", "﻿https://ok.com", " https://ok.com"]) {
      expect(padded.trim()).toBe("https://ok.com");
      expect(() => new URL(padded)).toThrow();
      expect(new URL(padded, "http://127.0.0.1:5555/app/").origin).toBe("http://127.0.0.1:5555");
    }
    // A plain ASCII space was never the hole: the URL parser strips it too.
    expect(new URL(" https://ok.com", "http://127.0.0.1:5555/app/").origin).toBe("https://ok.com");
  });

  test("padding String.trim strips but the URL parser does not is removed too", () => {
    // These are the dangerous ones: trim() treats them as whitespace, the URL
    // parser and the HTML attribute parser do not, so a padded original would
    // have parsed as absolute here and resolved as relative in the document.
    const nbsp = " https://ok.com";
    const bom = "﻿https://ok.com";
    const lineSep = " https://ok.com";
    for (const padded of [nbsp, bom, lineSep]) {
      const result = safeHref(padded);
      expect(result).toBe("https://ok.com");
      expect(result?.startsWith("https:")).toBe(true);
    }
  });
});

describe("safeHref refuses everything else", () => {
  test("javascript:", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("JavaScript:alert(1)")).toBeUndefined();
    // URL parsing strips tabs and newlines inside the scheme, so this reads as
    // javascript: to the browser too; the allowlist catches it either way.
    expect(safeHref("java\nscript:alert(1)")).toBeUndefined();
    expect(safeHref("  javascript:alert(1)  ")).toBeUndefined();
  });

  test("data:", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHref("data:text/plain;base64,aGk=")).toBeUndefined();
  });

  test("relative inputs, which would resolve against this app's own page", () => {
    expect(safeHref("/api/profile")).toBeUndefined();
    expect(safeHref("./report.html")).toBeUndefined();
    expect(safeHref("../..")).toBeUndefined();
    expect(safeHref("example.com/no-scheme")).toBeUndefined();
    expect(safeHref("//example.com/protocol-relative")).toBeUndefined();
  });

  test("other schemes a daemon payload could carry", () => {
    expect(safeHref("file:///etc/passwd")).toBeUndefined();
    expect(safeHref("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeHref("blob:https://example.com/abc")).toBeUndefined();
    expect(safeHref("mailto:someone@example.com")).toBeUndefined();
  });

  test("absent, blank and non-string values", () => {
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
    expect(safeHref("   ")).toBeUndefined();
    expect(safeHref(42)).toBeUndefined();
    expect(safeHref({ url: "https://example.com" })).toBeUndefined();
  });
});

describe("isSafeHref mirrors safeHref", () => {
  test("true only where safeHref returns a string", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("/relative")).toBe(false);
    expect(isSafeHref(undefined)).toBe(false);
  });
});
