import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./class-names";
import { Heading } from "./heading";
import { LOADING_TEXT, QUERY_ERROR_TEXT, RETRY_LABEL } from "./state-copy";

/**
 * `inline` is one line inside a card that already has its title, such as a section whose list is
 * still loading. `tile` is the same line in a card of its own, for a page body below a header
 * that stays put. `plain` is the line with no padding of its own, for a body that is already
 * padded (a `padded` section card, a form).
 */
type StateSize = "tile" | "inline" | "plain";

/** The padding a state line takes: none when its host already pads it. */
function linePadding(size: StateSize) {
  return size === "plain" ? undefined : "px-4 py-3";
}

/** A `tile` state is its own card: the same 8px-cornered card as a section. */
function frame(size: StateSize) {
  return size === "tile" ? "overflow-hidden rounded-lg border border-border bg-card" : undefined;
}

// Placeholder bars stagger their widths so they read as rows, not as one block.
const PLACEHOLDER_WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-3/5"];

type LoadingStateProps = {
  /** What is loading, as "Loading members...". Defaults to `LOADING_TEXT`. */
  body?: ReactNode;
  /** For a list: this many faint placeholder rows under the spinner line. */
  rows?: number;
  size?: StateSize;
  testId?: string;
};

/** Something is still loading: a spinner and what it is, plus faint placeholder rows for a list. */
export function LoadingState({ body = LOADING_TEXT, rows = 0, size = "tile", testId }: LoadingStateProps) {
  return (
    <div aria-live="polite" className={frame(size)} data-testid={testId} role="status">
      <p className={cn("flex items-center gap-2.5 text-sm text-muted-foreground", linePadding(size))}>
        <span
          aria-hidden="true"
          className="size-3.5 flex-none rounded-full border-2 border-border border-t-primary motion-safe:animate-spin"
          data-testid="loading-spinner"
        />
        {body}
      </p>
      {rows > 0 ? (
        <div aria-hidden="true" className={cn("grid gap-2", size === "plain" ? "pt-3" : "px-4 pb-3.5")} data-testid="loading-placeholder-rows">
          {Array.from({ length: rows }, (_, index) => (
            <div
              className={cn("h-3 rounded border border-border bg-row-alt", PLACEHOLDER_WIDTHS[index % PLACEHOLDER_WIDTHS.length])}
              data-testid="loading-placeholder-row"
              key={index}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

type ErrorStateProps = {
  /** Another way out besides Retry, such as a link back to the welcome page. */
  action?: ReactNode;
  body?: ReactNode;
  /**
   * Runs the failed read again. Every failed read offers it; `null` says the failure is permanent
   * (not found, no access), where reading again cannot help, and draws no Retry.
   */
  onRetry?: (() => void) | null;
  retryLabel?: string;
  size?: StateSize;
  testId?: string;
  /** A lead-in drawn in bold before the body, such as "League not found." */
  title?: ReactNode;
};

/** Something failed to load: one red line saying what, with Retry at its right. */
export function ErrorState({ action, body, onRetry, retryLabel = RETRY_LABEL, size = "tile", testId, title }: ErrorStateProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-destructive", linePadding(size), frame(size))}
      data-testid={testId}
      role="alert"
    >
      <p className="min-w-0 flex-1">
        {title ? <strong className="font-semibold">{title}</strong> : null}
        {title && body ? " " : null}
        {body ?? (title ? null : QUERY_ERROR_TEXT)}
      </p>
      {onRetry || action ? (
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {onRetry ? (
            <Button onClick={onRetry} size="xs" variant="link">
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </span>
      ) : null}
    </div>
  );
}

type EmptyStateProps = {
  action?: ReactNode;
  body?: ReactNode;
  size?: StateSize;
  testId?: string;
  /** A tile only: a heading over the body, for a page with nothing in it yet. */
  title?: ReactNode;
};

/** There is nothing to show: one quiet italic line, so it never reads as data. */
export function EmptyState({ action, body, size = "tile", testId, title }: EmptyStateProps) {
  if (size !== "tile") {
    return <p className={cn("text-sm italic text-muted-foreground", linePadding(size))} data-testid={testId}>{body ?? title}</p>;
  }
  return (
    <div className={cn("px-4 py-3.5", frame(size))} data-testid={testId}>
      {title ? <Heading level={2} variant="section">{title}</Heading> : null}
      {body ? <p className={cn("text-sm italic text-muted-foreground", title ? "mt-1" : undefined)}>{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

type InlineErrorProps = {
  children: ReactNode;
  className?: string;
  id?: string;
  testId?: string;
};

/** A one-line failure next to what failed, such as a save that was refused. Screen readers announce it. */
export function InlineError({ children, className, id, testId }: InlineErrorProps) {
  return (
    <p className={cn("text-sm text-destructive", className)} data-testid={testId} id={id} role="alert">
      {children}
    </p>
  );
}

/** The parts of a TanStack query result that `QueryState` reads. */
type QueryLike<T> = {
  data: T | undefined;
  isError: boolean;
  /** The query's own `refetch`; its error offers Retry, which calls it. */
  refetch: () => unknown;
};

/** An empty state needs both its words and its test; without them, data is never empty. */
type QueryStateEmpty<T> =
  | {
      /** What to say when the data is there but holds nothing to show. */
      empty: ReactNode;
      /** Whether the data counts as empty. */
      isEmpty: (data: T) => boolean;
    }
  | { empty?: never; isEmpty?: never };

type QueryStateProps<T> = QueryStateEmpty<T> & {
  children: (data: T) => ReactNode;
  error?: ReactNode;
  loading?: ReactNode;
  query: QueryLike<T>;
  /** For a list: placeholder rows under the loading line. */
  rows?: number;
  size?: StateSize;
  testId?: string;
};

/**
 * One query's loading, error and empty states in place, and its data once it is there. Its error
 * offers Retry, which refetches the query. Loading is "no data and no error", so a disabled query
 * (`enabled: false`) shows the loading line until it runs; render nothing in its place when the
 * query may never run.
 */
export function QueryState<T>({
  children,
  empty,
  error = QUERY_ERROR_TEXT,
  isEmpty,
  loading,
  query,
  rows,
  size = "inline",
  testId,
}: QueryStateProps<T>) {
  if (query.isError) {
    return (
      <ErrorState
        body={error}
        onRetry={() => void query.refetch()}
        size={size}
        testId={testId ? `${testId}-error` : undefined}
      />
    );
  }
  if (query.data === undefined) {
    return <LoadingState body={loading} rows={rows} size={size} testId={testId ? `${testId}-loading` : undefined} />;
  }
  if (isEmpty?.(query.data)) {
    return <EmptyState body={empty} size={size} testId={testId ? `${testId}-empty` : undefined} />;
  }
  return <>{children(query.data)}</>;
}
