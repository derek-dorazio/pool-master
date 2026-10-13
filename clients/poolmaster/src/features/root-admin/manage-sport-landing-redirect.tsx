import { Navigate } from 'react-router-dom';
import { buildSportEventListPath } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';

/** A sport's own Manage entry opens its events, the list its work starts from. */
export function ManageSportLandingRedirect() {
  const { sport } = useManagedSport();
  return <Navigate replace to={buildSportEventListPath(sport)} />;
}
