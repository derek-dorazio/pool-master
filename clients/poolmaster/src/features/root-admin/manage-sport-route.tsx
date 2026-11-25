import { Outlet } from 'react-router';
import { ErrorState, LoadingState } from '@/features/shared/ui';
import { useManagedSportParam } from './use-managed-sport';

/**
 * `/manage/sports/:sport`: the pages below it read the sport from the URL (`useManagedSport`),
 * found by its stored URL segment, so a segment that names no sport stops here with a plain
 * message.
 */
export function ManageSportRoute() {
  const { managed, sportsQuery } = useManagedSportParam();
  if (sportsQuery.isLoading) {
    return <LoadingState body="Loading the sport..." />;
  }
  if (sportsQuery.isError) {
    return <ErrorState body="We couldn't load the sports." onRetry={() => void sportsQuery.refetch()} testId="root-admin-sport-error" />;
  }
  if (!managed) {
    return (
      <ErrorState
        body="Choose a sport from the menu."
        testId="root-admin-sport-not-found"
        title="We don't manage that sport."
      />
    );
  }
  return <Outlet />;
}
