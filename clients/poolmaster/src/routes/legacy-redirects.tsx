/**
 * Redirects kept for deep-links to routes that have since moved.
 *
 * Split out of `routes/index.tsx` for `react-refresh/only-export-components`
 * (#345 Phase 0, from #167): that module's only export is the `router` object, so
 * the two components defined in it could never be hot-updated -- an edit to either
 * reloaded the whole app. Here they are ordinary component modules.
 */
import { Sport } from '@poolmaster/shared/domain';
import { Navigate, useLocation, useParams } from 'react-router';
import {
  buildLeagueAdminContestCreatePath,
  buildLeagueAdminContestPath,
  buildLeagueAdminContestsPath,
} from '@/features/leagues/league-routing';
import { buildSportPath } from '@/features/root-admin/manage-navigation';

export function LegacyJoinInviteRedirect() {
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  return <Navigate replace to={`/invite/${inviteCode}`} />;
}

export function LegacyLeagueEntriesRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  return <Navigate replace to={`/league/${leagueCode}`} />;
}

// Contest setup moved into Commissioner tools (#557).
export function LegacyManageContestsRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  return <Navigate replace to={buildLeagueAdminContestsPath(leagueCode)} />;
}

export function LegacyContestCreateRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  return <Navigate replace to={buildLeagueAdminContestCreatePath(leagueCode)} />;
}

export function LegacyContestManageRedirect() {
  const { contestId = '', leagueCode = '' } = useParams<{ contestId: string; leagueCode: string }>();
  return <Navigate replace to={buildLeagueAdminContestPath(leagueCode, contestId)} />;
}

/**
 * Golf's Manage pages moved under `/manage/sports/golf` when horse racing joined them
 * (plans/racing-sports.md Q9.6): one copy of every event, field and tier page serves each sport.
 * An old golf link lands on the same page there. Its lists took the sport-neutral names
 * (tournaments are events, players are participants), and Scores became Results.
 */
const LEGACY_GOLF_LISTS: Readonly<Record<string, string>> = {
  tournaments: 'events',
  players: 'participants',
  leagues: 'leagues',
};

export function LegacyGolfManageRedirect() {
  const { pathname, search } = useLocation();
  const segments = pathname.replace(/^\/manage\/golf\/?/, '').split('/').filter(Boolean);
  const list = segments.at(0);
  const rest = segments.slice(1);
  const golfPath = buildSportPath(Sport.GOLF);
  const movedList = list === undefined ? undefined : LEGACY_GOLF_LISTS[list];
  if (!movedList) {
    return <Navigate replace to={`${golfPath}/events`} />;
  }
  const movedRest = rest.map((segment, index) => (index === rest.length - 1 && segment === 'scores' ? 'results' : segment));
  return <Navigate replace to={`${[golfPath, movedList, ...movedRest].join('/')}${search}`} />;
}
