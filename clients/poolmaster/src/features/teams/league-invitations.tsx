import { useQuery } from '@tanstack/react-query';
import { InviteType } from '@poolmaster/shared/domain';
import { useMemo } from 'react';
import { listLeagueInvitations, type LeagueInvitationDto, type LeagueMembershipDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { isExpiredInvitation } from './invites-page-helpers';
import { InvitesPageInvitePeopleSection } from './invites-page-invite-people-section';
import { InvitesPageWaitingInvitesSection } from './invites-page-waiting-invites-section';

/**
 * League invitations, on Commissioner tools › Invites: "Invite people" (by email, or the join link)
 * and the invites still waiting on an answer. Commissioner only, like the endpoints behind it.
 *
 * An invite is pending until it is accepted or cancelled. An email invite past its expiry is still
 * listed, under Expired, so the commissioner can resend it; a resend issues a new link and the old
 * one stops working. A join link can only be cancelled.
 *
 * Every row's "⋯" can copy its own link (#476). With the invite email switched off, a resend sends
 * nothing, so copying the new link is how the commissioner gets it to the invitee. Each email
 * invite says where its email stands (#844): it is sent a moment after the invite is made.
 */
type LeagueInvitationsProps = {
  isInactiveLeague: boolean;
  leagueId: string;
  membersByUserId: Map<string, LeagueMembershipDto>;
};

export function LeagueInvitations({ isInactiveLeague, leagueId, membersByUserId }: LeagueInvitationsProps) {
  const invitationsKey = QueryKeys.leagueInvitations.byLeague(leagueId);

  const invitationsQuery = useQuery({
    queryKey: invitationsKey,
    queryFn: async (): Promise<LeagueInvitationDto[]> => {
      const response = await listLeagueInvitations({ path: { id: leagueId } });
      if (!response.data?.invitations) {
        throwApiError(response.error, 'League invitation list response is missing data.');
      }
      return response.data.invitations;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const invitations = invitationsQuery.data;

  // The join link is the newest one still usable; older ones keep working until cancelled below.
  const joinLink = useMemo(
    () => (invitations ?? [])
      .filter((invitation) => invitation.inviteType === InviteType.LINK && !isExpiredInvitation(invitation))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .at(0),
    [invitations],
  );

  return (
    <div className="space-y-8" data-testid="league-invitations">
      <InvitesPageInvitePeopleSection
        invitationsKey={invitationsKey}
        isInactiveLeague={isInactiveLeague}
        joinLink={joinLink}
        leagueId={leagueId}
      />
      <InvitesPageWaitingInvitesSection
        invitations={invitations}
        invitationsKey={invitationsKey}
        isError={invitationsQuery.isError}
        isInactiveLeague={isInactiveLeague}
        isLoading={invitationsQuery.isLoading}
        leagueId={leagueId}
        membersByUserId={membersByUserId}
        onRetry={() => void invitationsQuery.refetch()}
      />
    </div>
  );
}
