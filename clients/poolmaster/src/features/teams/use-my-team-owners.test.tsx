import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import type { SquadDto } from '@/lib/api';
import { useMyTeamOwners } from './use-my-team-owners';

const createSquadOwnerInvitationMock = vi.fn();
const replaceSquadOwnerMock = vi.fn();
const revokeSquadOwnerInvitationMock = vi.fn();

bindApiMocks({
  createSquadOwnerInvitation: createSquadOwnerInvitationMock,
  replaceSquadOwner: replaceSquadOwnerMock,
  revokeSquadOwnerInvitation: revokeSquadOwnerInvitationMock,
});

const team = { id: 'team-1', leagueId: 'league-1', name: 'Birdie Hunters' } as SquadDto;

const invitation = {
  data: {
    invitation: {
      id: 'invite-1',
      leagueId: 'league-1',
      squadId: 'team-1',
      email: 'friend@example.com',
      inviteCode: 'owner-1',
      status: 'ACCEPTED',
      invitedBy: 'user-1',
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    },
  },
};

function renderOwners(selectedTeam: SquadDto | null = team) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => useMyTeamOwners({ leagueCode: 'BIGDAWGS', leagueId: 'league-1', selectedTeam }),
    { wrapper },
  );
  const invalidatedKeys = () =>
    invalidateSpy.mock.calls.map(([filters]) => (filters as { queryKey?: unknown } | undefined)?.queryKey);
  return { ...view, invalidatedKeys };
}

describe('useMyTeamOwners', () => {
  beforeEach(() => {
    createSquadOwnerInvitationMock.mockReset();
    replaceSquadOwnerMock.mockReset();
    revokeSquadOwnerInvitationMock.mockReset();
  });

  it('refuses to invite a co-owner before a team exists, without calling the server', async () => {
    const { result } = renderOwners(null);

    await act(async () => {
      await expect(result.current.createOwnerInvitationMutation.mutateAsync('friend@example.com')).rejects.toThrow(
        'A team must exist before inviting a co-owner.',
      );
    });
    expect(createSquadOwnerInvitationMock).not.toHaveBeenCalled();
  });

  it('refuses to replace an owner before a team exists, without calling the server', async () => {
    const { result } = renderOwners(null);

    await act(async () => {
      await expect(
        result.current.replaceOwnerMutation.mutateAsync({ userId: 'user-2', email: 'new@example.com' }),
      ).rejects.toThrow('A team must exist before replacing an owner.');
    });
    expect(replaceSquadOwnerMock).not.toHaveBeenCalled();
  });

  it('clears the invite email after a co-owner invite and refreshes the league\'s members and context, since an existing user joins at once', async () => {
    createSquadOwnerInvitationMock.mockResolvedValue(invitation);
    const { result, invalidatedKeys } = renderOwners();

    act(() => result.current.setCoOwnerEmail('friend@example.com'));
    await act(async () => {
      await result.current.createOwnerInvitationMutation.mutateAsync('friend@example.com');
    });

    expect(result.current.coOwnerEmail).toBe('');
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        QueryKeys.leagues.detail('BIGDAWGS'),
        QueryKeys.leagues.members('league-1'),
        QueryKeys.leagueTeams.byLeague('league-1'),
        QueryKeys.leagueTeamOwnerInvitations.byLeague('league-1'),
      ]),
    );
  });

  it('closes the replace form after replacing an owner and refreshes the league\'s members and context, since the replaced owner leaves the league', async () => {
    replaceSquadOwnerMock.mockResolvedValue(invitation);
    const { result, invalidatedKeys } = renderOwners();

    act(() => {
      result.current.setReplaceTargetUserId('user-2');
      result.current.setReplaceEmail('new@example.com');
    });
    await act(async () => {
      await result.current.replaceOwnerMutation.mutateAsync({ userId: 'user-2', email: 'new@example.com' });
    });

    expect(replaceSquadOwnerMock).toHaveBeenCalledWith({
      path: { id: 'league-1', squadId: 'team-1', userId: 'user-2' },
      body: { email: 'new@example.com' },
    });
    expect(result.current.replaceTargetUserId).toBeNull();
    expect(result.current.replaceEmail).toBe('');
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        QueryKeys.leagues.detail('BIGDAWGS'),
        QueryKeys.leagues.members('league-1'),
        QueryKeys.leagueTeams.byLeague('league-1'),
      ]),
    );
  });

  it('reports a refused revoke through the mutation\'s error, leaving the forms untouched', async () => {
    revokeSquadOwnerInvitationMock.mockResolvedValue({
      error: { code: 'SQUAD_OWNER_INVITATION_ACCEPTED', message: 'Invitation is accepted' },
    });
    const { result } = renderOwners();

    act(() => result.current.setCoOwnerEmail('draft@example.com'));
    await act(async () => {
      await result.current.revokeOwnerInvitationMutation.mutateAsync('invite-1').catch(() => undefined);
    });

    await waitFor(() => expect(result.current.revokeOwnerInvitationMutation.isError).toBe(true));
    expect(result.current.coOwnerEmail).toBe('draft@example.com');
  });

  it('resets every owner form at once', () => {
    const { result } = renderOwners();

    act(() => {
      result.current.setCoOwnerEmail('a@example.com');
      result.current.setReplaceTargetUserId('user-2');
      result.current.setReplaceEmail('b@example.com');
    });
    act(() => result.current.resetOwnerForms());

    expect(result.current.coOwnerEmail).toBe('');
    expect(result.current.replaceTargetUserId).toBeNull();
    expect(result.current.replaceEmail).toBe('');
  });
});
