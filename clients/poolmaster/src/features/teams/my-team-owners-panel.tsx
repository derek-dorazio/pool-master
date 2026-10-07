import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LeagueRole } from '@poolmaster/shared/domain';
import type { SquadDto, TeamOwnerInvitationDto } from '@/lib/api';
import { Alert, Button, Input, Tile } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { buildUserPath } from '@/features/account/user-routing';
import { formatUserName } from '@/features/account/user-name';
import type { useLeagueMembersQuery } from '@/features/leagues/use-league-members-query';
import { TeamOwnerActionMenu } from './team-owner-action-menu';
import { type TeamMember, TEAM_PAGE_FALLBACK_ERROR } from './my-team-shared';
import type { MyTeamOwners } from './use-my-team-owners';

type LeagueMembersByUserId = ReturnType<typeof useLeagueMembersQuery>['membersByUserId'];

/** Co-owner invites, the active owner list, pending invites, and replace owner. */
export function MyTeamOwnersPanel({
  owners,
  notices,
  selectedTeam,
  activeMembers,
  teamOwnerInvitations,
  leagueMembersByUserId,
  leagueCode,
  leagueId,
  viewerUserId,
  isInactiveLeague,
  isInactiveTeam,
  isBusy,
  canManageAnyTeam,
  canManageSelectedTeam,
}: {
  owners: MyTeamOwners;
  /** The lifecycle outcomes, shown under the owner controls. */
  notices: ReactNode;
  selectedTeam: SquadDto | null;
  activeMembers: TeamMember[];
  teamOwnerInvitations: TeamOwnerInvitationDto[];
  leagueMembersByUserId: LeagueMembersByUserId;
  leagueCode: string;
  leagueId: string;
  viewerUserId: string | undefined;
  isInactiveLeague: boolean;
  isInactiveTeam: boolean;
  isBusy: boolean;
  canManageAnyTeam: boolean;
  canManageSelectedTeam: boolean;
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
      {selectedTeam ? (
        <Tile radius="lg">
          <h4 className="text-sm font-semibold text-foreground">Add co-owner</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            Invite another person to co-manage this team. Existing league members are rejected automatically.
          </p>
          <div className="mt-4 flex gap-3">
            <Input
              aria-label="Co-owner email"
              data-testid="my-team-owner-email"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
              onChange={(event) => setCoOwnerEmail(event.target.value)}
              placeholder="owner@example.com"
              type="email"
              value={coOwnerEmail}
            />
            <Button
              data-testid="my-team-owner-invite"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam || !coOwnerEmail.trim()}
              onClick={() =>
                void createOwnerInvitationMutation.mutateAsync(coOwnerEmail.trim()).catch(() => undefined)}
            >
              Invite
            </Button>
          </div>
          {createOwnerInvitationMutation.isSuccess ? (
            <Alert className="mt-3" tone="success">Co-owner invite created.</Alert>
          ) : null}
          {createOwnerInvitationMutation.isError ? (
            <Alert className="mt-3" tone="danger">{extractErrorMessage(createOwnerInvitationMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
          ) : null}
        </Tile>
      ) : null}

      <div className="space-y-3">
        {!selectedTeam ? (
          <p className="text-sm text-muted-foreground">
            Create your team first and the active member list will appear here.
          </p>
        ) : activeMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This team does not have any active members yet.
          </p>
        ) : (
          activeMembers.map((member: TeamMember) => (
            <Tile
              className="flex items-center justify-between gap-4"
              data-testid={`my-team-member-${member.userId}`}
              key={member.id}
              radius="lg"
            >
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    className="font-medium text-foreground hover:underline"
                    data-testid={`my-team-member-link-${member.userId}`}
                    to={buildUserPath(member.userId)}
                  >
                    {formatUserName(member.user.firstName, member.user.lastName)}
                  </Link>
                  <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    Active owner
                  </span>
                  {leagueMembersByUserId.get(member.userId) ? (
                    <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                      {leagueMembersByUserId.get(member.userId)?.role === LeagueRole.COMMISSIONER ? 'Commissioner' : 'Member'}
                    </span>
                  ) : null}
                </div>
                <div className="text-sm text-muted-foreground">{member.userId}</div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <TeamOwnerActionMenu
                  activeOwnerCount={activeMembers.length}
                  canManageLeagueRole={canManageAnyTeam}
                  canRemoveOwner={canManageSelectedTeam}
                  leagueCode={leagueCode}
                  leagueId={leagueId}
                  ownerName={formatUserName(member.user.firstName, member.user.lastName)}
                  ownerRole={leagueMembersByUserId.get(member.userId)?.role}
                  ownerUserId={member.userId}
                  surface="team-home"
                  teamId={selectedTeam.id}
                />
                {member.userId !== viewerUserId ? (
                  <Button
                    data-testid={`my-team-open-replace-${member.userId}`}
                    disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
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

      {selectedTeam && teamOwnerInvitations.length ? (
        <Tile radius="lg">
          <h4 className="text-sm font-semibold text-foreground">Pending owner invites</h4>
          <div className="mt-4 space-y-3">
            {teamOwnerInvitations.map((invitation) => (
              <Tile
                className="flex flex-wrap items-center justify-between gap-3"
                data-testid={`my-team-owner-invitation-${invitation.id}`}
                key={invitation.id}
                radius="lg"
              >
                <div>
                  <div className="font-medium text-foreground">{invitation.email}</div>
                  <div className="text-sm text-muted-foreground">
                    {invitation.status} {invitation.replacementForUserId ? '· Replacement invite' : ''}
                  </div>
                </div>
                {invitation.status === 'PENDING' ? (
                  <Button
                    data-testid={`my-team-revoke-owner-invitation-${invitation.id}`}
                    disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
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
        <Tile radius="lg">
          <h4 className="text-sm font-semibold text-foreground">Replace owner</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            Replacing an owner removes them from this team and the league, and invites the replacement email to take their place.
          </p>
          <div className="mt-4 flex gap-3">
            <Input
              aria-label="Replacement owner email"
              data-testid="my-team-replace-email"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
              onChange={(event) => setReplaceEmail(event.target.value)}
              placeholder="replacement@example.com"
              type="email"
              value={replaceEmail}
            />
            <Button
              data-testid="my-team-replace-submit"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam || !replaceEmail.trim()}
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
            <Alert className="mt-3" tone="danger">{extractErrorMessage(replaceOwnerMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
          ) : null}
        </Tile>
      ) : null}

      {revokeOwnerInvitationMutation.isError ? (
        <Alert tone="danger">{extractErrorMessage(revokeOwnerInvitationMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
      ) : null}
      {notices}
    </div>
  );
}
