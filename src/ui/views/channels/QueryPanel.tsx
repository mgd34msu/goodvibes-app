// Shared four-state gate for the Channels panels (docs/UX.md §4 binding rule):
// loading (SkeletonBlock) / error-with-retry / capability-unavailable (naming
// the missing daemon method — the 1.0.0 daemon may 404 any channels.* method)
// / empty, all visually distinct. Success content renders through the child
// function so every panel keeps its own markup.

import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { isMethodUnavailableError, isMethodNotInvokableError } from "../../lib/errors.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";

export interface QueryPanelProps<T> {
  query: UseQueryResult<T>;
  /** The daemon method id this panel depends on, e.g. "channels.inbox.list". */
  capability: string;
  /** What the user loses when the capability is missing, plain words. */
  unavailableDescription: string;
  errorTitle: string;
  isEmpty?: (data: T) => boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  skeletonLines?: number;
  children: (data: T) => ReactNode;
}

export function QueryPanel<T>({
  query,
  capability,
  unavailableDescription,
  errorTitle,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  skeletonLines = 4,
  children,
}: QueryPanelProps<T>) {
  if (query.isPending) return <SkeletonBlock variant="text" lines={skeletonLines} />;

  if (query.isError) {
    if (isMethodUnavailableError(query.error) || isMethodNotInvokableError(query.error)) {
      return <UnavailableState capability={capability} description={unavailableDescription} />;
    }
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} title={errorTitle} />;
  }

  const data = query.data as T;
  if (isEmpty?.(data)) {
    return <EmptyState icon={emptyIcon} title={emptyTitle ?? "Nothing here yet"} description={emptyDescription} />;
  }
  return <>{children(data)}</>;
}
