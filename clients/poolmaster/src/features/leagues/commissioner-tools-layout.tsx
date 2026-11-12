import { Outlet, useLocation, useParams } from 'react-router';
import { ToolsArea } from '@/features/shared/ui';
import {
  buildLeagueAdminChampionshipsEditPath,
  buildLeagueAdminEventEmailsEditPath,
  buildLeagueAdminPlanPath,
  buildLeagueAdminContestsPath,
  buildLeagueAdminInvitesPath,
  buildLeagueAdminPath,
  buildLeagueAdminTeamsPath,
  buildLeagueContestTypesPath,
  buildLeaguePath,
} from './league-routing';

import { useLeagueContext } from './use-league-context';

function isAtOrUnder(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The Commissioner tools area for one league: a slim band with the way back to the league, and
 * the four tools as tabs (#1562). `CommissionerRouteGuard` admits the viewer before this renders,
 * so the league context is already loaded.
 */
export function CommissionerToolsLayout() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { pathname } = useLocation();
  const { league } = useLeagueContext(leagueCode);
  const settingsPath = buildLeagueAdminPath(leagueCode);
  const teamsPath = buildLeagueAdminTeamsPath(leagueCode);
  const invitesPath = buildLeagueAdminInvitesPath(leagueCode);
  const contestsPath = buildLeagueAdminContestsPath(leagueCode);

  return (
    <ToolsArea
      back={{ label: 'Back to league', testId: 'commissioner-tools-back', to: buildLeaguePath(leagueCode) }}
      eyebrow="Commissioner tools"
      tabs={[
        {
          isActive: pathname === settingsPath
            || pathname === buildLeagueAdminChampionshipsEditPath(leagueCode)
            || pathname === buildLeagueAdminEventEmailsEditPath(leagueCode)
            || pathname === buildLeagueAdminPlanPath(leagueCode),
          label: 'Settings',
          testId: 'commissioner-tools-menu-settings',
          to: settingsPath,
        },
        {
          isActive: isAtOrUnder(pathname, teamsPath),
          label: 'Members',
          testId: 'commissioner-tools-menu-teams',
          to: teamsPath,
        },
        {
          isActive: isAtOrUnder(pathname, invitesPath),
          label: 'Invites',
          testId: 'commissioner-tools-menu-invites',
          to: invitesPath,
        },
        {
          // Contest types sits beside Create contest (#1392), so Contests stays lit on it.
          isActive: isAtOrUnder(pathname, contestsPath) || pathname === buildLeagueContestTypesPath(leagueCode),
          label: 'Contests',
          testId: 'commissioner-tools-menu-contests',
          to: contestsPath,
        },
      ]}
      tabsLabel="Commissioner tools"
      testId="commissioner-tools"
      title={league?.name ?? leagueCode}
    >
      <Outlet />
    </ToolsArea>
  );
}
