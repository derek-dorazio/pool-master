import { Settings } from 'lucide-react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { AdminAreaLayout } from '@/features/shared/ui';
import {
  buildLeagueAdminContestsPath,
  buildLeagueAdminEditPath,
  buildLeagueAdminInvitesPath,
  buildLeagueAdminPath,
  buildLeagueAdminTeamsPath,
  buildLeaguePath,
} from './league-routing';

function isAtOrUnder(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}
import { useLeagueContext } from './use-league-context';

/**
 * The Commissioner tools area for one league: its own header with the way back to the league,
 * and a side menu of the tools. `CommissionerRouteGuard` admits the viewer before this renders,
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
    <AdminAreaLayout
      back={{ label: 'Back to league', testId: 'commissioner-tools-back', to: buildLeaguePath(leagueCode) }}
      eyebrow="Commissioner tools"
      icon={<Settings aria-hidden size={18} />}
      menuItems={[
        {
          isActive: pathname === settingsPath || pathname === buildLeagueAdminEditPath(leagueCode),
          label: 'League settings',
          testId: 'commissioner-tools-menu-settings',
          to: settingsPath,
        },
        {
          isActive: isAtOrUnder(pathname, teamsPath),
          label: 'Teams',
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
          isActive: isAtOrUnder(pathname, contestsPath),
          label: 'Contests',
          testId: 'commissioner-tools-menu-contests',
          to: contestsPath,
        },
      ]}
      menuLabel="Commissioner tools"
      testId="commissioner-tools"
      title={league?.name ?? leagueCode}
    >
      <Outlet />
    </AdminAreaLayout>
  );
}
