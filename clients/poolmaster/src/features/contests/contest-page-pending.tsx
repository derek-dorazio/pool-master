import { ErrorState, LoadingState, PendingPage } from '@/features/shared/ui';

/**
 * A contest page's frame while its contest loads, or when the read fails, with Retry (#1739):
 * one copy for the page and the entry list it shows, so a slow load reads the same in both.
 */
export function ContestPagePending({ isError, onRetry }: { isError: boolean; onRetry: () => void }) {
  return (
    <PendingPage testId="contest-page-pending">
      {isError
        ? <ErrorState body="We couldn't load this contest." onRetry={onRetry} />
        : <LoadingState body="Loading contest..." />}
    </PendingPage>
  );
}
