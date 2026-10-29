import type { AriaRole, ReactNode } from "react";
import { cn } from "./class-names";
import { LOADING_TEXT } from "./state-copy";
import { Tile } from "./tile";
import { Heading } from "./heading";

/**
 * `tile` is a page-level panel with a title. `inline` is one padded line inside a card, such as
 * a card's list that is still loading; it shows the body only.
 */
type StateSize = "tile" | "inline";

type StateProps = {
  action?: ReactNode;
  body?: ReactNode;
  size?: StateSize;
  testId?: string;
  title?: ReactNode;
};

type StateTileProps = StateProps & {
  ariaLive?: "polite" | "assertive";
  role?: AriaRole;
  tone?: "muted" | "error";
};

function StateTile({ action, ariaLive, body, role, size = "tile", testId, title, tone = "muted" }: StateTileProps) {
  if (size === "inline") {
    return (
      <p
        aria-live={ariaLive}
        className={cn("px-4 py-4 text-sm", tone === "error" ? "text-destructive" : "text-muted-foreground")}
        data-testid={testId}
        role={role}
      >
        {body ?? title}
      </p>
    );
  }
  return (
    <Tile aria-live={ariaLive} data-testid={testId} padding="lg" role={role}>
      {title ? (
        <Heading level={2} variant="page">{title}</Heading>
      ) : null}
      {body ? (
        <p
          className={
            title
              ? "mt-2 text-sm text-muted-foreground"
              : "text-sm text-muted-foreground"
          }
        >
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Tile>
  );
}

export function EmptyState(props: StateProps) {
  return <StateTile {...props} />;
}

export function LoadingState({ body = LOADING_TEXT, ...props }: StateProps) {
  return <StateTile ariaLive="polite" body={body} role="status" {...props} />;
}

export function ErrorState(props: StateProps) {
  return <StateTile ariaLive="assertive" role="alert" tone="error" {...props} />;
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
  size?: StateSize;
  testId?: string;
};

/**
 * One query's loading, error and empty states in place, and its data once it is there: the
 * in-card sibling of a page template's async state. Loading is "no data and no error", so a
 * disabled query (`enabled: false`) shows the loading line until it runs; render nothing in
 * its place when the query may never run.
 */
export function QueryState<T>({
  children,
  empty,
  error = "We couldn't load this right now.",
  isEmpty,
  loading,
  query,
  size = "inline",
  testId,
}: QueryStateProps<T>) {
  if (query.isError) {
    return <ErrorState body={error} size={size} testId={testId ? `${testId}-error` : undefined} />;
  }
  if (query.data === undefined) {
    return <LoadingState body={loading} size={size} testId={testId ? `${testId}-loading` : undefined} />;
  }
  if (isEmpty?.(query.data)) {
    return <EmptyState body={empty} size={size} testId={testId ? `${testId}-empty` : undefined} />;
  }
  return <>{children(query.data)}</>;
}
