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
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";

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

// ─── Single shared pending-confirm surface ──────────────────────────────────
//
// The Home-graph and Project-planning panels each wire a dozen+ admin-access
// methods (docs/FEATURES.md §6 rows 21-24). Rather than one ConfirmSurface
// instance per action, callers hold ONE `PendingAction | null` and render one
// <PendingConfirmSurface>; this still emits confirm:true + explicitUserRequest
// per docs/UX.md §4 — it just shares the modal shell.

export interface PendingAction {
  action: string;
  target: string;
  blastRadius: string;
  danger?: boolean;
  confirmLabel?: string;
  requireTypedText?: string;
  run: (meta: ConfirmMetadata) => void;
}

export function PendingConfirmSurface({
  pending,
  onCancel,
}: {
  pending: PendingAction | null;
  onCancel: () => void;
}) {
  return (
    <ConfirmSurface
      open={pending !== null}
      action={pending?.action ?? ""}
      target={pending?.target ?? ""}
      blastRadius={pending?.blastRadius ?? ""}
      danger={pending?.danger}
      confirmLabel={pending?.confirmLabel}
      requireTypedText={pending?.requireTypedText}
      onConfirm={(meta) => pending?.run(meta)}
      onCancel={onCancel}
    />
  );
}

// ─── Raw JSON extra-params field ────────────────────────────────────────────
//
// A few admin methods here (home-graph device-passport/room-page/packet
// generation) accept daemon-side object shapes richer than this view can
// enumerate as named fields. Rather than hardcode a guessed field name and
// silently drop what the user actually wanted, this exposes exactly what the
// route accepts — a JSON object merged into the request body — wired to the
// real method, capability-honest about what it does.

export function parseJsonParams(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function JsonParamsField({
  value,
  onChange,
  label = "Extra parameters (JSON, optional)",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  let parseError: string | null = null;
  if (value.trim()) {
    try {
      JSON.parse(value);
    } catch (error) {
      parseError = error instanceof Error ? error.message : "Invalid JSON";
    }
  }
  return (
    <label className="knowledge-form__json">
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="{}"
        rows={3}
        spellCheck={false}
        aria-invalid={parseError !== null}
      />
      {parseError && <span className="knowledge-form__error">{parseError}</span>}
    </label>
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
