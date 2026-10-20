import type { NavMenuItem } from '@/features/shared/ui';
import {
  buildLeagueContestTypesPath,
  buildLeagueContestsPath,
  buildLeagueHistoryPath,
  buildLeaguePath,
  buildLeagueTeamPath,
  buildLeagueTeamsPath,
} from './league-routing';

/**
 * The member pages' menu for one league: Home, Contests, Contest types, the viewer's own squad,
 * Members. Each item is active on its own page and on the pages under it, so a contest's
 * leaderboard keeps Contests lit. The viewer's squad is shown by its name; until that name is known, or when the
 * viewer has no squad in the league, the entry reads "Yours".
 */
export function buildLeagueMenuItems(
  leagueCode: string,
  pathname: string,
  mySquadName?: string | null,
): NavMenuItem[] {
  const homePath = buildLeaguePath(leagueCode);
  const contestsPath = buildLeagueContestsPath(leagueCode);
  const myTeamPath = buildLeagueTeamPath(leagueCode);
  const teamsPath = buildLeagueTeamsPath(leagueCode);
  const isUnder = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  return [
    { isActive: pathname === homePath, label: 'Home', testId: 'league-menu-home', to: homePath },
    { isActive: isUnder(contestsPath), label: 'Contests', testId: 'league-menu-contests', to: contestsPath },
    {
      isActive: isUnder(buildLeagueContestTypesPath(leagueCode)),
      label: 'Contest types',
      testId: 'league-menu-contest-types',
      to: buildLeagueContestTypesPath(leagueCode),
    },
    {
      isActive: isUnder(myTeamPath) || isUnder(buildLeagueHistoryPath(leagueCode)),
      label: mySquadName || 'Yours',
      testId: 'league-menu-my-team',
      to: myTeamPath,
    },
    { isActive: isUnder(teamsPath), label: 'Members', testId: 'league-menu-teams', to: teamsPath },
  ];
}
