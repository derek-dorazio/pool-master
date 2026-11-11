import type { NavMenuItem } from '@/features/shared/ui';
import {
  buildLeagueChampionshipsPath,
  buildLeagueContestsPath,
  buildLeagueHistoryPath,
  buildLeaguePath,
  buildLeagueTeamPath,
  buildLeagueTeamsPath,
} from './league-routing';

/**
 * The member pages' menu for one league: Home, Contests, Championships, My team, Members.
 * Contest types lives in Commissioner tools (#1392). Each item is active on its own page and on
 * the pages under it, so a contest's leaderboard keeps Contests lit. The viewer's own squad is
 * "My team" (rules/poolmaster-webapp-rules.md §1 *A Squad Is a Team On Screen*), a fixed label
 * whatever the team is called; while the league is loading, or when the viewer has no squad in
 * the league, the entry reads "Yours".
 */
export function buildLeagueMenuItems(
  leagueCode: string,
  pathname: string,
  hasSquad = false,
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
      isActive: isUnder(buildLeagueChampionshipsPath(leagueCode)) || isUnder(buildLeagueHistoryPath(leagueCode)),
      label: 'Championships',
      testId: 'league-menu-championships',
      to: buildLeagueChampionshipsPath(leagueCode),
    },
    {
      isActive: isUnder(myTeamPath),
      label: hasSquad ? 'My team' : 'Yours',
      testId: 'league-menu-my-team',
      to: myTeamPath,
    },
    { isActive: isUnder(teamsPath), label: 'Members', testId: 'league-menu-teams', to: teamsPath },
  ];
}
