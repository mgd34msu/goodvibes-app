// Small shared pieces for the Knowledge view: the four-state list wrapper
// (loading / error-with-retry / unavailable-naming-the-capability / empty —
// docs/UX.md §4 binding), a raw-JSON disclosure block, a pager, and a
// copyable monospace value (URIs never navigate the app webview).

import { useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { compactJson } from "../../lib/wire.ts";
import { isMethodUnavailableError } from "../../lib/errors.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";

// ─── Four-state wrapper ──────────────────────────────────────────────────────

export interface QueryStatesProps {
  query: UseQueryResult<unknown, unknown>;
  /** The daemon method behind this list — named in the unavailable state. */
  capability: string;
  /** What the user loses when the capability is missing. */
  unavailableDescription: string;
  /** True when the loaded data has zero rows. */
  isEmpty: boolean;
  empty: ReactNode;
  skeletonLines?: number;
  children: ReactNode;
}

/** Renders exactly one of: skeleton, unavailable, error, empty, children. */
export function QueryStates({
  query,
  capability,
  unavailableDescription,
  isEmpty,
  empty,
  skeletonLines = 4,
  children,
}: QueryStatesProps) {
  if (query.isPending) return <SkeletonBlock variant="text" lines={skeletonLines} />;
  if (query.isError) {
    if (isMethodUnavailableError(query.error)) {
      return <UnavailableState capability={capability} description={unavailableDescription} />;
    }
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
}

// ─── Raw JSON disclosure ─────────────────────────────────────────────────────

export function DataBlock({ title, value, open = false }: { title: string; value: unknown; open?: boolean }) {
  if (value === undefined || value === null) return null;
  return (
    <details className="knowledge-datablock" open={open}>
      <summary>{title}</summary>
      <pre className="knowledge-datablock__pre">{compactJson(value)}</pre>
    </details>
  );
}

// ─── Pager ───────────────────────────────────────────────────────────────────

export interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  label: string;
}

export function Pager({ page, pageSize, total, onPage, label }: PagerProps) {
  if (total <= pageSize) return null;
  const first = page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="knowledge-pager">
      <span>
        {first}–{last} of {total}
      </span>
      <div className="knowledge-pager__buttons">
        <button
          type="button"
          disabled={page === 0}
          aria-label={`Previous page of ${label}`}
          onClick={() => onPage(Math.max(0, page - 1))}
        >
          Prev
        </button>
        <button
          type="button"
          disabled={(page + 1) * pageSize >= total}
          aria-label={`Next page of ${label}`}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Copyable value (URIs render as text + copy, never navigation) ──────────

export function CopyValue({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="knowledge-copy">
      <code className="knowledge-copy__value" title={value}>
        {value}
      </code>
      <button
        type="button"
        className="knowledge-copy__button"
        aria-label={`Copy ${label ?? "value"}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      </button>
    </span>
  );
}

// ─── Key/value fact grid ─────────────────────────────────────────────────────

export function FactGrid({ facts }: { facts: ReadonlyArray<readonly [string, string]> }) {
  if (facts.length === 0) return null;
  return (
    <dl className="knowledge-facts">
      {facts.map(([key, value]) => (
        <div key={key} className="knowledge-facts__row">
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
