import { Settings } from 'lucide-react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { AdminAreaLayout } from '@/features/shared/ui';
import {
  buildLeagueAdminContestsPath,
  buildLeagueAdminEditPath,
  buildLeagueAdminPath,
  buildLeaguePath,
} from './league-routing';
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
          isActive: pathname === contestsPath || pathname.startsWith(`${contestsPath}/`),
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
