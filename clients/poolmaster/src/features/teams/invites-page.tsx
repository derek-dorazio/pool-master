import { useParams } from 'react-router-dom';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useLeagueMembersQuery } from '@/features/leagues/use-league-members-query';
import { PageHeader } from '@/features/shared/ui';
import { LeagueInvitations } from './league-invitations';

/** Commissioner tools › Invites: invite people to the league and follow the invites still out. */
export function InvitesPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);
  const { membersByUserId } = useLeagueMembersQuery(league?.id ?? '');

  if (!league) {
    return null;
  }

  return (
    <section className="space-y-6" data-testid="admin-invites-page">
      <PageHeader
        description="Each person you invite joins with a team of their own."
        title="Invites"
      />
      <LeagueInvitations
        isInactiveLeague={!league.isActive}
        leagueId={league.id}
        leagueName={league.name}
        membersByUserId={membersByUserId}
      />
    </section>
  );
}
