import type { NavMenuItem } from '@/features/shared/ui';
import {
  buildLeagueContestsPath,
  buildLeagueHistoryPath,
  buildLeaguePath,
  buildLeagueTeamPath,
  buildLeagueTeamsPath,
} from './league-routing';

/**
 * The member pages' menu for one league: Home, Contests, My team, Teams. Each item is active
 * on its own page and on the pages under it, so a contest's leaderboard keeps Contests lit.
 */
export function buildLeagueMenuItems(leagueCode: string, pathname: string): NavMenuItem[] {
  const homePath = buildLeaguePath(leagueCode);
  const contestsPath = buildLeagueContestsPath(leagueCode);
  const myTeamPath = buildLeagueTeamPath(leagueCode);
  const teamsPath = buildLeagueTeamsPath(leagueCode);
  const isUnder = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  return [
    { isActive: pathname === homePath, label: 'Home', testId: 'league-menu-home', to: homePath },
    { isActive: isUnder(contestsPath), label: 'Contests', testId: 'league-menu-contests', to: contestsPath },
    {
      isActive: isUnder(myTeamPath) || isUnder(buildLeagueHistoryPath(leagueCode)),
      label: 'My team',
      testId: 'league-menu-my-team',
      to: myTeamPath,
    },
    { isActive: isUnder(teamsPath), label: 'Teams', testId: 'league-menu-teams', to: teamsPath },
  ];
}
