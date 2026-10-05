/**
 * Redirects kept for deep-links to routes that have since moved.
 *
 * Split out of `routes/index.tsx` for `react-refresh/only-export-components`
 * (#345 Phase 0, from #167): that module's only export is the `router` object, so
 * the two components defined in it could never be hot-updated -- an edit to either
 * reloaded the whole app. Here they are ordinary component modules.
 */
import { Navigate, useParams } from 'react-router-dom';

export function LegacyJoinInviteRedirect() {
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  return <Navigate replace to={`/invite/${inviteCode}`} />;
}

export function LegacyLeagueEntriesRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  return <Navigate replace to={`/league/${leagueCode}`} />;
}
