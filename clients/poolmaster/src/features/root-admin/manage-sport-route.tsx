import { Outlet } from 'react-router';
import { ErrorState } from '@/features/shared/ui';
import { useManagedSportParam } from './use-managed-sport';

/**
 * `/manage/sports/:sport`: the pages below it read the sport from the URL (`useManagedSport`),
 * so a segment that names no supported sport stops here with a plain message.
 */
export function ManageSportRoute() {
  const managed = useManagedSportParam();
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
