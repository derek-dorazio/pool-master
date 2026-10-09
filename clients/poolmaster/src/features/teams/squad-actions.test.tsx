import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import type { TeamOwnerInvitationDto } from '@/lib/api';
import { SquadActions } from './squad-actions';

const createSquadOwnerInvitationMock = vi.fn();
const inactivateLeagueSquadMock = vi.fn();
const revokeSquadOwnerInvitationMock = vi.fn();

bindApiMocks({
  createSquadOwnerInvitation: createSquadOwnerInvitationMock,
  inactivateLeagueSquad: inactivateLeagueSquadMock,
  revokeSquadOwnerInvitation: revokeSquadOwnerInvitationMock,
});

type Props = Parameters<typeof SquadActions>[0];

function pendingInvitation(overrides: Partial<TeamOwnerInvitationDto> = {}): TeamOwnerInvitationDto {
  return {
    id: 'invite-1',
    leagueId: 'league-1',
    squadId: 'team-1',
    email: 'friend@example.com',
    inviteCode: 'owner-1',
    status: 'PENDING',
    invitedBy: 'user-1',
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  } as TeamOwnerInvitationDto;
}

function renderActions(overrides: Partial<Props> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SquadActions
        canInactivate
        canManageOwners
        leagueCode="BIGDAWGS"
        leagueId="league-1"
        pendingInvitations={[]}
        squadId="team-1"
        squadIsActive
        squadName="Birdie Hunters"
        {...overrides}
      />
    </QueryClientProvider>,
  );
  const invalidatedKeys = () =>
    invalidateSpy.mock.calls.map(([filters]) => (filters as { queryKey?: unknown } | undefined)?.queryKey);
  return { ...view, invalidatedKeys };
}

describe('SquadActions', () => {
  beforeEach(() => {
    createSquadOwnerInvitationMock.mockReset();
    inactivateLeagueSquadMock.mockReset();
    revokeSquadOwnerInvitationMock.mockReset();
  });

  it('renders nothing for a viewer with no squad actions and no pending invitations to show', () => {
    const { container } = renderActions({ canInactivate: false, canManageOwners: false });

    expect(container).toBeEmptyDOMElement();
  });

  it('offers no invite or inactivate action on an inactive team', () => {
    renderActions({ squadIsActive: false, pendingInvitations: [pendingInvitation()] });

    expect(screen.queryByTestId('squad-actions-open-invite-team-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('squad-actions-open-inactivate-team-1')).not.toBeInTheDocument();
  });

  it('shows pending invitations to an ordinary member without letting them revoke', () => {
    renderActions({ canInactivate: false, canManageOwners: false, pendingInvitations: [pendingInvitation()] });

    expect(screen.getByTestId('squad-actions-pending-team-1-invite-1')).toHaveTextContent('friend@example.com');
    expect(screen.queryByTestId('squad-actions-revoke-team-1-invite-1')).not.toBeInTheDocument();
  });

  it('keeps Send invite disabled until an email is typed', () => {
    renderActions();

    fireEvent.click(screen.getByTestId('squad-actions-open-invite-team-1'));

    expect(screen.getByTestId('squad-actions-send-invite-team-1')).toBeDisabled();
  });

  it('explains in plain words why a current league member cannot be invited as a co-owner', async () => {
    createSquadOwnerInvitationMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_INVITATION_LEAGUE_MEMBER_CONFLICT', message: 'That user already belongs to this league' } },
    });
    renderActions();

    fireEvent.click(screen.getByTestId('squad-actions-open-invite-team-1'));
    fireEvent.change(screen.getByTestId('squad-actions-invite-email-team-1'), { target: { value: ' member@example.com ' } });
    fireEvent.click(screen.getByTestId('squad-actions-send-invite-team-1'));

    expect(await screen.findByTestId('squad-actions-invite-error-team-1')).toHaveTextContent(
      /already in this league, and every member has their own team/,
    );
    expect(createSquadOwnerInvitationMock).toHaveBeenCalledWith({
      path: { id: 'league-1', squadId: 'team-1' },
      body: { email: 'member@example.com' },
    });
  });

  it('shows the server\'s refusal to revoke an invitation', async () => {
    revokeSquadOwnerInvitationMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_INVITATION_ACCEPTED', message: 'Invitation is accepted' } },
    });
    renderActions({ pendingInvitations: [pendingInvitation()] });

    fireEvent.click(screen.getByTestId('squad-actions-revoke-team-1-invite-1'));

    expect(await screen.findByTestId('squad-actions-revoke-error-team-1')).toHaveTextContent('Invitation is accepted');
  });

  it('shows the server\'s refusal to inactivate and keeps the confirm panel open', async () => {
    inactivateLeagueSquadMock.mockResolvedValue({
      error: {
        error: {
          code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED',
          message: 'Appoint another active commissioner before removing or demoting the last commissioner.',
        },
      },
    });
    renderActions();

    fireEvent.click(screen.getByTestId('squad-actions-open-inactivate-team-1'));
    fireEvent.click(screen.getByTestId('squad-actions-confirm-inactivate-team-1'));

    expect(await screen.findByTestId('squad-actions-inactivate-error-team-1')).toHaveTextContent(
      /Appoint another active commissioner/,
    );
    expect(screen.getByTestId('squad-actions-inactivate-panel-team-1')).toBeInTheDocument();
  });

  it('refreshes the team\'s owner invitations and the league context after inactivating, since the server revokes the pending invites and ends the owners\' memberships', async () => {
    inactivateLeagueSquadMock.mockResolvedValue({
      data: {
        squad: {
          id: 'team-1',
          leagueId: 'league-1',
          name: 'Birdie Hunters',
          iconKey: 'CAPTAIN_SMILE_FIELD',
          isActive: false,
          memberCount: 0,
          members: [],
          createdAt: '2026-04-16T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });
    const { invalidatedKeys } = renderActions({ pendingInvitations: [pendingInvitation()] });

    fireEvent.click(screen.getByTestId('squad-actions-open-inactivate-team-1'));
    fireEvent.click(screen.getByTestId('squad-actions-confirm-inactivate-team-1'));

    await waitFor(() =>
      expect(screen.queryByTestId('squad-actions-inactivate-panel-team-1')).not.toBeInTheDocument(),
    );
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        QueryKeys.leagueTeamOwnerInvitations.byLeague('league-1'),
        QueryKeys.leagues.detail('BIGDAWGS'),
        QueryKeys.leagues.members('league-1'),
        QueryKeys.leagueTeams.byLeague('league-1'),
      ]),
    );
  });
});
