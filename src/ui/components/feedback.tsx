// The four-state feedback kit (docs/UX.md §4 binding rule): every list view
// renders loading (SkeletonBlock) / error (ErrorState: cause + retry) /
// empty (EmptyState) / capability-unavailable (UnavailableState naming the
// missing daemon method) as VISUALLY DISTINCT states. Plus the top-level
// ErrorBoundary. Ported from goodvibes-webui src/components/feedback/*.

import { Component, type CSSProperties, type ErrorInfo, type FC, type ReactNode } from "react";
import { formatError, isMethodUnavailableError } from "../lib/errors.ts";

// ─── EmptyState ──────────────────────────────────────────────────────────────

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}

export const EmptyState: FC<EmptyStateProps> = ({ icon, title, description, action, className }) => (
  <div className={["feedback-empty-state", className].filter(Boolean).join(" ")} role="status" aria-label={title}>
    {icon && (
      <span className="feedback-empty-state__icon" aria-hidden="true">
        {icon}
      </span>
    )}
    <p className="feedback-empty-state__title">{title}</p>
    {description && <p className="feedback-empty-state__description">{description}</p>}
    {action && (
      <button type="button" className="feedback-empty-state__action" onClick={action.onClick}>
        {action.label}
      </button>
    )}
  </div>
);

// ─── ErrorState ──────────────────────────────────────────────────────────────

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}

export const ErrorState: FC<ErrorStateProps> = ({ error, onRetry, title = "Failed to load", className }) => {
  // Systemic capability honesty (docs/UX.md §4): a daemon 404 meaning "this
  // route/method does not exist on this daemon build" is not a failure to
  // retry — render the UnavailableState instead, wherever the view forgot to
  // triage it (verified live: memory search on daemon v1.0.0). Views that
  // classify refusals themselves branch before ever reaching ErrorState.
  if (isMethodUnavailableError(error)) {
    const route = formatError(error).match(/\/api\/[a-z0-9/._-]+/i)?.[0];
    return (
      <UnavailableState
        capability={route ?? "this capability"}
        description="The connected daemon build does not provide this route. Everything else keeps working."
        className={className}
      />
    );
  }
  const message = formatError(error);
  return (
    <div className={["feedback-error-state", className].filter(Boolean).join(" ")} role="alert" aria-live="polite">
      <span className="feedback-error-state__icon" aria-hidden="true">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </span>
      <div className="feedback-error-state__body">
        <span className="feedback-error-state__title">{title}</span>
        {message && <span className="feedback-error-state__message">{message}</span>}
      </div>
      {onRetry && (
        <button type="button" className="feedback-error-state__retry" onClick={onRetry} aria-label="Retry">
          Retry
        </button>
      )}
    </div>
  );
};

// ─── UnavailableState ────────────────────────────────────────────────────────

export interface UnavailableStateProps {
  /** The daemon capability that is missing, e.g. "fleet.snapshot". */
  capability: string;
  /** What the user loses, in plain words. */
  description?: string;
  /** Optional docs/next-step action. */
  action?: EmptyStateAction;
  className?: string;
}

/** Honest "not available on this daemon" state — distinct from error AND
 * empty (wire-or-delete rule: never a silent stub). */
export const UnavailableState: FC<UnavailableStateProps> = ({ capability, description, action, className }) => (
  <div
    className={["feedback-unavailable-state", className].filter(Boolean).join(" ")}
    role="status"
    aria-label={`${capability} unavailable`}
  >
    <span className="feedback-unavailable-state__icon" aria-hidden="true">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
      </svg>
    </span>
    <div className="feedback-unavailable-state__body">
      <span className="feedback-unavailable-state__title">Not available on this daemon</span>
      <span className="feedback-unavailable-state__message">
        The connected daemon does not serve <code>{capability}</code>
        {description ? ` — ${description}` : "."}
      </span>
    </div>
    {action && (
      <button type="button" className="feedback-unavailable-state__action" onClick={action.onClick}>
        {action.label}
      </button>
    )}
  </div>
);

// ─── SkeletonBlock ───────────────────────────────────────────────────────────

export type SkeletonVariant = "block" | "text" | "circle";

export interface SkeletonBlockProps {
  variant?: SkeletonVariant;
  width?: number | string;
  height?: number | string;
  size?: number | string;
  lines?: number;
  className?: string;
  style?: CSSProperties;
}

export const SkeletonBlock: FC<SkeletonBlockProps> = ({
  variant = "block",
  width,
  height,
  size,
  lines = 3,
  className,
  style,
}) => {
  const base = ["feedback-skeleton", `feedback-skeleton--${variant}`, className].filter(Boolean).join(" ");

  if (variant === "circle") {
    const dim = size ?? 40;
    const px = typeof dim === "number" ? `${dim}px` : dim;
    return <span className={base} aria-hidden="true" style={{ width: px, height: px, ...style }} />;
  }

  if (variant === "text") {
    return (
      <div className="feedback-skeleton-text" aria-hidden="true" style={style}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className="feedback-skeleton feedback-skeleton--text-line"
            style={i === lines - 1 ? { width: "70%" } : undefined}
          />
        ))}
      </div>
    );
  }

  const w = width != null ? (typeof width === "number" ? `${width}px` : width) : "100%";
  const h = height != null ? (typeof height === "number" ? `${height}px` : height) : "20px";
  return <span className={base} aria-hidden="true" style={{ width: w, height: h, ...style }} />;
};

// ─── ErrorBoundary ───────────────────────────────────────────────────────────

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: unknown, reset: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.handleReset);

    const message = formatError(this.state.error);
    return (
      <div className="feedback-error-boundary" role="alert" aria-live="assertive">
        <div className="feedback-error-boundary__icon" aria-hidden="true">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="feedback-error-boundary__title">Something went wrong</p>
        <p className="feedback-error-boundary__message">{message}</p>
        <button type="button" className="feedback-error-boundary__retry" onClick={this.handleReset}>
          Try again
        </button>
      </div>
    );
  }
}
