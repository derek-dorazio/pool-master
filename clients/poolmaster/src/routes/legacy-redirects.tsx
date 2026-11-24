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
import { HOW_TO_PLAY_PATH } from '@/features/event-pages/event-page-paths';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import {
  buildLeagueAdminContestCreatePath,
  buildLeagueAdminContestPath,
  buildLeagueAdminContestsPath,
  buildLeagueAdminEditPath,
  buildLeagueContestTypesPath,
  buildLeaguePath,
  buildLeagueTeamPastContestsPath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { ACTIVITY_PATH, buildManageUserPath, buildSportPath, LEGACY_SYNC_PATH, PROVIDERS_PATH } from '@/features/root-admin/manage-navigation';

export function LegacyJoinInviteRedirect() {
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  return <Navigate replace to={`/invite/${inviteCode}`} />;
}

/**
 * The Contests tab folded into League Home (#1763): an old link to its list opens Home, keeping
 * `?focus` so the contest it named is still tinted there.
 */
export function LegacyLeagueContestsRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { search } = useLocation();
  const focus = new URLSearchParams(search).get('focus');
  const query = focus ? `?${new URLSearchParams({ focus }).toString()}` : '';
  return <Navigate replace to={`${buildLeaguePath(leagueCode)}${query}`} />;
}

/**
 * Contests › Past moved to My team's Past contests (#1763): an old link opens its full list at
 * the year and contest it named.
 */
export function LegacyContestHistoryRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const year = Number(params.get('year'));
  return (
    <Navigate
      replace
      to={buildLeagueTeamPastContestsPath(leagueCode, {
        focusContestId: params.get('focus'),
        year: Number.isInteger(year) && year > 0 ? year : null,
      })}
    />
  );
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
 * Contest types left the member menu for Commissioner tools (#1392): a commissioner's old link
 * opens it there, and a member's opens How to Play, which explains every contest type.
 */
export function LegacyContestTypesRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { query, viewer } = useLeagueContext(leagueCode);
  const leagueContext = useLeagueContextGuard(query, { loadingBody: 'Loading contest types...' });
  if (leagueContext.state === 'blocked') {
    return leagueContext.element;
  }
  const canManage = viewer.isCommissioner || viewer.isRootAdmin;
  return <Navigate replace to={canManage ? buildLeagueContestTypesPath(leagueCode) : HOW_TO_PLAY_PATH} />;
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

/** The old Edit league page: General's Edit is now a dialog on League settings. */
export function LegacyEditLeagueRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  return <Navigate replace to={buildLeagueAdminEditPath(leagueCode)} />;
}

/**
 * The sync run history page at /manage/sync became Activity, and its Run event sync and Unmapped
 * participants pages moved under Providers (#1887): an old link opens where its page went,
 * keeping its query. Unmapped participants then became Findings (#1999), which its old path opens.
 */
export function LegacyManageSyncRedirect() {
  const { pathname, search } = useLocation();
  const rest = pathname.slice(LEGACY_SYNC_PATH.length).replace(/\/$/, '');
  return <Navigate replace to={rest === '' ? ACTIVITY_PATH : `${PROVIDERS_PATH}${rest}${search}`} />;
}

/** A user's old Manage page now opens their dialog on Customers › Users (#1883). */
export function LegacyManageUserRedirect() {
  const { userId = '' } = useParams<{ userId: string }>();
  return <Navigate replace to={buildManageUserPath(userId)} />;
}
