import { LeagueRole, SquadOwnerInvitationStatus } from '@poolmaster/shared/domain';
import type { SquadDto, TeamOwnerInvitationDto } from '@/lib/api';
import { Notice, Button, Heading, Input, StatusBadge, Text, Tile } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { formatUserName } from '@/features/account/user-name';
import { TeamOwnerActionMenu } from './team-owner-action-menu';
import { type TeamMember, TEAM_PAGE_FALLBACK_ERROR } from './my-team-shared';
import type { MyTeamOwners } from './use-my-team-owners';

const OWNER_INVITATION_STATUS_LABELS: Record<SquadOwnerInvitationStatus, string> = {
  [SquadOwnerInvitationStatus.PENDING]: 'Pending',
  [SquadOwnerInvitationStatus.ACCEPTED]: 'Accepted',
  [SquadOwnerInvitationStatus.EXPIRED]: 'Expired',
  [SquadOwnerInvitationStatus.REVOKED]: 'Revoked',
};

/** Co-owner invites, the active owner list, pending invites, and replace owner. */
export function MyTeamOwnersPanel({
  owners,
  selectedTeam,
  activeMembers,
  teamOwnerInvitations,
  leagueCode,
  leagueId,
  viewerUserId,
  isInactiveLeague,
  isInactiveTeam,
  isBusy,
  canManageAnyTeam,
}: {
  owners: MyTeamOwners;
  selectedTeam: SquadDto;
  activeMembers: TeamMember[];
  teamOwnerInvitations: TeamOwnerInvitationDto[];
  leagueCode: string;
  leagueId: string;
  viewerUserId: string | undefined;
  isInactiveLeague: boolean;
  isInactiveTeam: boolean;
  isBusy: boolean;
  canManageAnyTeam: boolean;
}) {
  const {
    coOwnerEmail,
    setCoOwnerEmail,
    replaceTargetUserId,
    setReplaceTargetUserId,
    replaceEmail,
    setReplaceEmail,
    createOwnerInvitationMutation,
    replaceOwnerMutation,
    revokeOwnerInvitationMutation,
  } = owners;

  return (
    <div className="space-y-5" data-testid="my-team-owners-panel">
      <Tile>
        <Heading level={4} variant="label">Add co-owner</Heading>
        <Text as="p" className="mt-2" variant="meta">
          Invite another person to co-own {selectedTeam.name}. People already in this league can&apos;t be invited.
        </Text>
        <div className="mt-4 flex gap-3">
          <Input
            aria-label="Co-owner email"
            data-testid="my-team-owner-email"
            disabled={isInactiveLeague || isInactiveTeam || isBusy}
            onChange={(event) => setCoOwnerEmail(event.target.value)}
            placeholder="owner@example.com"
            type="email"
            value={coOwnerEmail}
          />
          <Button
            data-testid="my-team-owner-invite"
            disabled={isInactiveLeague || isInactiveTeam || isBusy || !coOwnerEmail.trim()}
            onClick={() =>
              void createOwnerInvitationMutation.mutateAsync(coOwnerEmail.trim()).catch(() => undefined)}
          >
            Invite
          </Button>
        </div>
        {createOwnerInvitationMutation.isError ? (
          <Notice className="mt-3" tone="danger">{extractErrorMessage(createOwnerInvitationMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Notice>
        ) : null}
      </Tile>

      <div className="space-y-3">
        {activeMembers.length === 0 ? (
          <Text as="p" variant="meta">
            {selectedTeam.name} does not have any active owners yet.
          </Text>
        ) : (
          activeMembers.map((member: TeamMember) => (
            <Tile
              className="flex items-center justify-between gap-4"
              data-testid={`my-team-member-${member.userId}`}
              key={member.id}
            >
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <Text data-testid={`my-team-member-name-${member.userId}`} size="inherit" variant="strong">
                    {formatUserName(member.user.firstName, member.user.lastName)}
                  </Text>
                  <StatusBadge>Active owner</StatusBadge>
                  {member.leagueRole ? (
                    <StatusBadge>
                      {member.leagueRole === LeagueRole.COMMISSIONER ? 'Commissioner' : 'Member'}
                    </StatusBadge>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <TeamOwnerActionMenu
                  activeOwnerCount={activeMembers.length}
                  canManageLeagueRole={canManageAnyTeam}
                  leagueCode={leagueCode}
                  leagueId={leagueId}
                  ownerName={formatUserName(member.user.firstName, member.user.lastName)}
                  ownerRole={member.leagueRole}
                  ownerUserId={member.userId}
                  teamId={selectedTeam.id}
                />
                {member.userId !== viewerUserId ? (
                  <Button
                    data-testid={`my-team-open-replace-${member.userId}`}
                    disabled={isInactiveLeague || isInactiveTeam || isBusy}
                    onClick={() => {
                      setReplaceTargetUserId((current) => current === member.userId ? null : member.userId);
                      setReplaceEmail('');
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    Replace owner
                  </Button>
                ) : null}
              </div>
            </Tile>
          ))
        )}
      </div>

      {teamOwnerInvitations.length ? (
        <Tile>
          <Heading level={4} variant="label">Pending owner invites</Heading>
          <div className="mt-4 space-y-3">
            {teamOwnerInvitations.map((invitation) => (
              <Tile
                className="flex flex-wrap items-center justify-between gap-3"
                data-testid={`my-team-owner-invitation-${invitation.id}`}
                key={invitation.id}
              >
                <div>
                  <Text as="div" size="inherit" variant="strong">{invitation.email}</Text>
                  <Text as="div" variant="meta">
                    {OWNER_INVITATION_STATUS_LABELS[invitation.status]}
                    {invitation.replacementForUserId ? ' · Replacement invite' : ''}
                  </Text>
                </div>
                {invitation.status === SquadOwnerInvitationStatus.PENDING ? (
                  <Button
                    data-testid={`my-team-revoke-owner-invitation-${invitation.id}`}
                    disabled={isInactiveLeague || isInactiveTeam || isBusy}
                    onClick={() =>
                      void revokeOwnerInvitationMutation.mutateAsync(invitation.id).catch(() => undefined)}
                    size="sm"
                    variant="secondary"
                  >
                    Revoke
                  </Button>
                ) : null}
              </Tile>
            ))}
          </div>
        </Tile>
      ) : null}

      {replaceTargetUserId ? (
        <Tile>
          <Heading level={4} variant="label">Replace owner</Heading>
          <Text as="p" className="mt-2" variant="meta">
            Replacing an owner removes them from {selectedTeam.name} and the league, and invites the replacement email to take their place.
          </Text>
          <div className="mt-4 flex gap-3">
            <Input
              aria-label="Replacement owner email"
              data-testid="my-team-replace-email"
              disabled={isInactiveLeague || isInactiveTeam || isBusy}
              onChange={(event) => setReplaceEmail(event.target.value)}
              placeholder="replacement@example.com"
              type="email"
              value={replaceEmail}
            />
            <Button
              data-testid="my-team-replace-submit"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !replaceEmail.trim()}
              onClick={() =>
                void replaceOwnerMutation.mutateAsync({
                  userId: replaceTargetUserId,
                  email: replaceEmail.trim(),
                }).catch(() => undefined)}
            >
              Replace
            </Button>
            <Button
              data-testid="my-team-replace-cancel"
              onClick={() => {
                setReplaceTargetUserId(null);
                setReplaceEmail('');
              }}
              variant="secondary"
            >
              Cancel
            </Button>
          </div>
          {replaceOwnerMutation.isError ? (
            <Notice className="mt-3" tone="danger">{extractErrorMessage(replaceOwnerMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Notice>
          ) : null}
        </Tile>
      ) : null}

      {revokeOwnerInvitationMutation.isError ? (
        <Notice tone="danger">{extractErrorMessage(revokeOwnerInvitationMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Notice>
      ) : null}
    </div>
  );
}
