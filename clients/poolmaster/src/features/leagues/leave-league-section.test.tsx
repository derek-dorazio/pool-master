import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import { LeaveLeagueSection } from './leave-league-section';
import { apiSuccess, buildLeague, listLeaguesData } from './test/fixtures';

const leaveLeagueMock = vi.fn();

bindApiMocks({
  leaveLeague: leaveLeagueMock,
});

function LeagueDestination() {
  const { leagueCode } = useParams();
  return <div data-testid="league-destination">{leagueCode}</div>;
}

function renderLeaveLeague({
  isActive = true,
  remainingLeagues = [] as ReturnType<typeof buildLeague>[],
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const league = buildLeague({ isActive });
  queryClient.setQueryData(QueryKeys.leagues.list, listLeaguesData([league, ...remainingLeagues]));

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/league/BIGDAWGS/team']}>
        <Routes>
          <Route element={<LeaveLeagueSection league={league} />} path="/league/:leagueCode/team" />
          <Route element={<LeagueDestination />} path="/league/:leagueCode" />
          <Route element={<div data-testid="welcome-page" />} path="/welcome" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient };
}

async function confirmLeave() {
  fireEvent.click(screen.getByRole('button', { name: 'Leave league' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Leave league' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Leave league' }));
  return dialog;
}

describe('Leave league', () => {
  afterEach(() => {
    leaveLeagueMock.mockReset();
  });

  it('asks the member to confirm before leaving', async () => {
    renderLeaveLeague();

    fireEvent.click(screen.getByRole('button', { name: 'Leave league' }));

    expect(await screen.findByRole('dialog', { name: 'Leave league' })).toBeInTheDocument();
    expect(leaveLeagueMock).not.toHaveBeenCalled();
  });

  it('after leaving, takes the member to their next active league rather than an inactive one', async () => {
    leaveLeagueMock.mockResolvedValue(apiSuccess({ success: true }));
    const { queryClient } = renderLeaveLeague({
      remainingLeagues: [
        buildLeague({ id: 'league-2', leagueCode: 'ASLEEP', isActive: false }),
        buildLeague({ id: 'league-3', leagueCode: 'AWAKE' }),
      ],
    });

    const dialog = await confirmLeave();
    expect(await dialog.findByText('You left Big Dawgs.')).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'OK' }));

    expect(await screen.findByTestId('league-destination')).toHaveTextContent('AWAKE');
    expect(queryClient.getQueryData(QueryKeys.leagues.list)).toMatchObject({
      leagues: [expect.objectContaining({ leagueCode: 'ASLEEP' }), expect.objectContaining({ leagueCode: 'AWAKE' })],
    });
  });

  it('after leaving their last active league, keeps the member signed in on the welcome page', async () => {
    leaveLeagueMock.mockResolvedValue(apiSuccess({ success: true }));
    renderLeaveLeague({
      remainingLeagues: [buildLeague({ id: 'league-2', leagueCode: 'ASLEEP', isActive: false })],
    });

    const dialog = await confirmLeave();
    fireEvent.click(await dialog.findByRole('button', { name: 'OK' }));

    expect(await screen.findByTestId('welcome-page')).toBeInTheDocument();
  });

  it('tells the last commissioner to appoint another before leaving', async () => {
    leaveLeagueMock.mockResolvedValue({
      error: {
        error: {
          code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED',
          message: 'Appoint another active commissioner before removing or demoting the last commissioner.',
        },
      },
    });
    renderLeaveLeague();

    const dialog = await confirmLeave();

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Appoint another commissioner before the last commissioner leaves or steps down.',
    );
  });

  it('cannot be used while the league is inactive, and says why', () => {
    renderLeaveLeague({ isActive: false });

    expect(screen.getByRole('button', { name: 'Leave league' })).toBeDisabled();
    expect(screen.getByText('You cannot leave while the league is inactive.')).toBeInTheDocument();
  });
});
