import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import type { SquadDto } from '@/lib/api';
import { MyTeamLifecycleActions, MyTeamLifecycleDialogs, MyTeamLifecycleNotices } from './my-team-lifecycle';
import type { ActiveTeamDialog } from './my-team-shared';
import { useMyTeamLifecycle } from './use-my-team-lifecycle';

const inactivateLeagueSquadMock = vi.fn();
const deleteLeagueSquadMock = vi.fn();

bindApiMocks({
  inactivateLeagueSquad: inactivateLeagueSquadMock,
  deleteLeagueSquad: deleteLeagueSquadMock,
});

function buildTeam(overrides: Partial<SquadDto> = {}): SquadDto {
  return {
    id: 'team-1',
    leagueId: 'league-1',
    name: 'Birdie Hunters',
    iconKey: 'CAPTAIN_SMILE_FIELD',
    isActive: true,
    memberCount: 1,
    members: [],
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  } as SquadDto;
}

interface HarnessProps {
  team: SquadDto;
  isInactiveLeague?: boolean;
  canInactivate?: boolean;
  canDelete?: boolean;
}

/** The lifecycle tile, its notices and its dialogs, wired the way the My Team page wires them. */
function LifecycleHarness({ team, isInactiveLeague = false, canInactivate = true, canDelete = false }: HarnessProps) {
  const [activeDialog, setActiveDialog] = useState<ActiveTeamDialog>(null);
  const lifecycle = useMyTeamLifecycle({
    leagueId: 'league-1',
    leagueCode: 'BIGDAWGS',
    selectedTeam: team,
    setActiveDialog,
    resetOwnerForms: () => undefined,
  });

  return (
    <>
      <MyTeamLifecycleActions
        canDeleteSelectedTeam={canDelete}
        canInactivateSelectedTeam={canInactivate}
        isBusy={lifecycle.isPending}
        isInactiveLeague={isInactiveLeague}
        isInactiveTeam={!team.isActive}
        lifecycle={lifecycle}
        setActiveDialog={setActiveDialog}
      />
      <MyTeamLifecycleNotices lifecycle={lifecycle} />
      <MyTeamLifecycleDialogs
        activeDialog={activeDialog}
        lifecycle={lifecycle}
        selectedTeam={team}
        setActiveDialog={setActiveDialog}
      />
    </>
  );
}

function renderLifecycle(props: HarnessProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/league/BIGDAWGS/team']}>
        <Routes>
          <Route element={<LifecycleHarness {...props} />} path="/league/:leagueCode/team" />
          <Route element={<div data-testid="league-route-destination" />} path="/league/:leagueCode" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

function invalidatedKeys(spy: ReturnType<typeof renderLifecycle>['invalidateSpy']) {
  return spy.mock.calls.map(([filters]) => (filters as { queryKey?: unknown } | undefined)?.queryKey);
}

describe('My Team lifecycle', () => {
  beforeEach(() => {
    inactivateLeagueSquadMock.mockReset();
    deleteLeagueSquadMock.mockReset();
  });

  it('offers inactivation for an active team and hides deletion until the team is inactive', () => {
    renderLifecycle({ team: buildTeam(), canDelete: true });

    expect(screen.getByTestId('my-team-inactivate')).toBeEnabled();
    expect(screen.queryByTestId('my-team-delete')).not.toBeInTheDocument();
  });

  it('disables inactivation in an inactive league', () => {
    renderLifecycle({ team: buildTeam(), isInactiveLeague: true });
    expect(screen.getByTestId('my-team-inactivate')).toBeDisabled();
  });

  it('disables inactivation for a viewer who may not end the team', () => {
    renderLifecycle({ team: buildTeam(), canInactivate: false });
    expect(screen.getByTestId('my-team-inactivate')).toBeDisabled();
  });

  it('inactivates the team, closes the dialog, says what happened and refreshes the league\'s roster and context', async () => {
    inactivateLeagueSquadMock.mockResolvedValue({ data: { squad: buildTeam({ isActive: false }) } });
    const { invalidateSpy } = renderLifecycle({ team: buildTeam() });

    fireEvent.click(screen.getByTestId('my-team-inactivate'));
    fireEvent.click(await screen.findByTestId('my-team-confirm-inactivate'));

    expect(await screen.findByText(/Birdie Hunters is now inactive/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('my-team-inactivate-dialog')).not.toBeInTheDocument());
    expect(inactivateLeagueSquadMock).toHaveBeenCalledWith({ path: { id: 'league-1', squadId: 'team-1' } });
    expect(invalidatedKeys(invalidateSpy)).toEqual(
      expect.arrayContaining([
        QueryKeys.leagues.detail('BIGDAWGS'),
        QueryKeys.leagues.list,
        QueryKeys.leagues.members('league-1'),
        QueryKeys.leagueTeams.byLeague('league-1'),
        QueryKeys.leagueTeamOwnerInvitations.byLeague('league-1'),
      ]),
    );
  });

  it('shows the server\'s refusal to inactivate, keeps the dialog open, and clears the refusal on cancel', async () => {
    inactivateLeagueSquadMock.mockResolvedValue({
      error: {
        error: {
          code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED',
          message: 'Appoint another active commissioner before removing or demoting the last commissioner.',
        },
      },
    });
    renderLifecycle({ team: buildTeam() });

    fireEvent.click(screen.getByTestId('my-team-inactivate'));
    fireEvent.click(await screen.findByTestId('my-team-confirm-inactivate'));

    expect(await screen.findByText(/Appoint another active commissioner/)).toBeInTheDocument();
    expect(screen.getByTestId('my-team-inactivate-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByTestId('my-team-inactivate-dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(/Appoint another active commissioner/)).not.toBeInTheDocument();
  });

  it('deletes an inactive team and returns to the league page', async () => {
    deleteLeagueSquadMock.mockResolvedValue({ data: { success: true } });
    renderLifecycle({ team: buildTeam({ isActive: false }), canDelete: true });

    expect(screen.queryByTestId('my-team-inactivate')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('my-team-delete'));
    fireEvent.click(await screen.findByTestId('my-team-confirm-delete'));

    expect(await screen.findByTestId('league-route-destination')).toBeInTheDocument();
    expect(deleteLeagueSquadMock).toHaveBeenCalledWith({ path: { id: 'league-1', squadId: 'team-1' } });
  });

  it('shows the server\'s refusal to delete and stays on the team page', async () => {
    deleteLeagueSquadMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_DELETE_REQUIRES_INACTIVE', message: 'Team must already be inactive before it can be permanently deleted.' } },
    });
    renderLifecycle({ team: buildTeam({ isActive: false }), canDelete: true });

    fireEvent.click(screen.getByTestId('my-team-delete'));
    fireEvent.click(await screen.findByTestId('my-team-confirm-delete'));

    expect(await screen.findByText('Team must already be inactive before it can be permanently deleted.')).toBeInTheDocument();
    expect(screen.queryByTestId('league-route-destination')).not.toBeInTheDocument();
  });

  it('closes the delete dialog on Escape and forgets an earlier refusal', async () => {
    deleteLeagueSquadMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_DELETE_REQUIRES_INACTIVE', message: 'Team must already be inactive before it can be permanently deleted.' } },
    });
    renderLifecycle({ team: buildTeam({ isActive: false }), canDelete: true });

    fireEvent.click(screen.getByTestId('my-team-delete'));
    fireEvent.click(await screen.findByTestId('my-team-confirm-delete'));
    await screen.findByText('Team must already be inactive before it can be permanently deleted.');

    fireEvent.keyDown(screen.getByTestId('my-team-delete-dialog'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('my-team-delete-dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Team must already be inactive before it can be permanently deleted.')).not.toBeInTheDocument();
  });

  it('closes the inactivate dialog on Escape without inactivating', async () => {
    renderLifecycle({ team: buildTeam() });

    fireEvent.click(screen.getByTestId('my-team-inactivate'));
    fireEvent.keyDown(await screen.findByTestId('my-team-inactivate-dialog'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('my-team-inactivate-dialog')).not.toBeInTheDocument());
    expect(inactivateLeagueSquadMock).not.toHaveBeenCalled();
  });
});
