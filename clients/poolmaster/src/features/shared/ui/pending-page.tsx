import type { ReactNode } from "react";

type PendingPageProps = {
  /** The shared `LoadingState` or `ErrorState` for the read the header waits on. */
  children: ReactNode;
  /** Draw a placeholder tab row too, for a page whose header has tabs. */
  hasTabs?: boolean;
  testId?: string;
};

/**
 * The frame of a page whose header names the thing being read (a team, a contest): while that
 * read loads or fails, a faint placeholder stands in for the `PageHeader`, at its height and
 * with its rule, so the frame stays put and only the body below swaps from the shared loading
 * or error state to the page. A page whose header is fixed draws its real header instead.
 */
export function PendingPage({ children, hasTabs = false, testId }: PendingPageProps) {
  return (
    <section className="space-y-6" data-testid={testId}>
      <PageHeaderPlaceholder hasTabs={hasTabs} testId={testId ? `${testId}-header` : undefined} />
      {children}
    </section>
  );
}

function PageHeaderPlaceholder({ hasTabs, testId }: { hasTabs: boolean; testId?: string }) {
  return (
    <div aria-hidden="true" data-testid={testId}>
      <div className={hasTabs ? "pb-2" : "border-b border-border pb-3.5"}>
        <div className="h-8 w-64 max-w-full animate-pulse rounded-md bg-muted" />
        <div className="mt-2 h-4 w-40 max-w-full animate-pulse rounded bg-muted" />
      </div>
      {hasTabs ? (
        <div className="flex gap-6 border-b border-border pt-2 pb-3" data-testid={testId ? `${testId}-tabs` : undefined}>
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        </div>
      ) : null}
    </div>
  );
}
