import { Settings } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { LeagueMenu, LinkButton } from '@/features/shared/ui';
import { buildLeagueMenuItems } from './league-menu-items';
import { buildLeagueAdminPath } from './league-routing';
import { useLeagueContext } from './use-league-context';

/**
 * The league menu under the app bar. Commissioners, and root admins looking at the league,
 * also get the Commissioner tools button; members never see it.
 */
export function LeagueMenuBar({ leagueCode }: { leagueCode: string }) {
  const { pathname } = useLocation();
  // The league context every league page reads: one cache entry, so this adds no request.
  const { viewer } = useLeagueContext(leagueCode);
  const canOpenCommissionerTools = viewer.isCommissioner || viewer.isRootAdmin;

  return (
    <LeagueMenu
      action={canOpenCommissionerTools ? (
        <LinkButton
          data-testid="league-menu-commissioner-tools"
          size="sm"
          to={buildLeagueAdminPath(leagueCode)}
          variant="subtle"
        >
          <Settings aria-hidden size={16} />
          Commissioner tools
        </LinkButton>
      ) : null}
      aria-label="League"
      items={buildLeagueMenuItems(leagueCode, pathname)}
    />
  );
}
