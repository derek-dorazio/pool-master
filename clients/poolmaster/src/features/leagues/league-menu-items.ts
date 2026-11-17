import type { NavMenuItem } from '@/features/shared/ui';
import {
  buildLeagueChampionshipsPath,
  buildLeagueHistoryPath,
  buildLeaguePath,
  buildLeagueTeamPath,
  buildLeagueTeamsPath,
} from './league-routing';

/**
 * The member pages' menu for one league: Home, Championships, My team, Members. Home is the
 * league's one list of current contests and My team holds Past contests (#1763), so there is no
 * Contests item. Contest types lives in Commissioner tools (#1392). Each item is active on its own
 * page and on the pages under it. The viewer's own squad is
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
  const myTeamPath = buildLeagueTeamPath(leagueCode);
  const teamsPath = buildLeagueTeamsPath(leagueCode);
  const isUnder = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  return [
    // A contest's pages sit under Home, the one list of contests, so they keep Home lit.
    { isActive: pathname === homePath || isUnder(`${homePath}/contests`), label: 'Home', testId: 'league-menu-home', to: homePath },
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
