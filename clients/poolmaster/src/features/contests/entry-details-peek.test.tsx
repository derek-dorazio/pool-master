import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DETAILS_PEEK_HOVER_DELAY_MS } from '@/features/shared/ui';
import {
  buildCurrentUser,
  buildLeagueSquad,
  buildLeagueSquadMember,
  getLeagueSquadFrom,
} from '@/features/leagues/test/fixtures';
import { bindApiMocks } from '@/test/msw-api';
import { EntryDetailsPeek } from './entry-details-peek';

const getLeagueSquadMock = vi.fn();
bindApiMocks({ getLeagueSquad: getLeagueSquadMock });

const incubus = buildLeagueSquad({
  id: 'team-incubus',
  name: 'Incubus',
  members: [
    buildLeagueSquadMember({ id: 'm-1', user: buildCurrentUser({ id: 'u-1', firstName: 'Derek', lastName: 'Dorazio' }) }),
    buildLeagueSquadMember({ id: 'm-2', user: buildCurrentUser({ id: 'u-2', firstName: 'Sam', lastName: 'Lee' }) }),
    buildLeagueSquadMember({ id: 'm-3', status: 'INACTIVE', user: buildCurrentUser({ id: 'u-3', firstName: 'Former', lastName: 'Owner' }) }),
  ],
});

beforeEach(() => {
  getLeagueSquadMock.mockImplementation(getLeagueSquadFrom([incubus]));
});

afterEach(() => {
  vi.useRealTimers();
});

function drawEntries(entries: { entryId: string; entryName: string; squadId: string }[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {entries.map((entry) => (
          <EntryDetailsPeek
            entryName={entry.entryName}
            key={entry.entryId}
            leagueCode="BIGDAWGS"
            leagueId="league-1"
            squadId={entry.squadId}
            testId={`peek-${entry.entryId}`}
          />
        ))}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntryDetailsPeek', () => {
  it('reads no team until the peek is opened', () => {
    drawEntries([{ entryId: 'entry-1', entryName: 'Incubus 1', squadId: 'team-incubus' }]);

    expect(screen.getByRole('button', { name: 'About Incubus 1' })).toBeInTheDocument();
    expect(getLeagueSquadMock).not.toHaveBeenCalled();
  });

  it('opens on a tap with the team\'s name, its active owners and a link to the team page', async () => {
    drawEntries([{ entryId: 'entry-1', entryName: 'Incubus 1', squadId: 'team-incubus' }]);

    fireEvent.click(screen.getByRole('button', { name: 'About Incubus 1' }));

    const card = await screen.findByTestId('peek-entry-1-card');
    expect(card).toHaveTextContent('Incubus');
    expect(card).toHaveTextContent('Team · 2 owners');
    expect(card).toHaveTextContent('OwnersDerek Dorazio, Sam Lee');
    expect(card).not.toHaveTextContent('Former Owner');
    expect(screen.getByTestId('peek-entry-1-team-link')).toHaveAttribute('href', '/league/BIGDAWGS/teams/team-incubus');
  });

  it('starts reading the team as a mouse arrives and reads each team once, however many of its entries are hovered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    drawEntries([
      { entryId: 'entry-1', entryName: 'Incubus 1', squadId: 'team-incubus' },
      { entryId: 'entry-2', entryName: 'Incubus 2', squadId: 'team-incubus' },
    ]);

    const first = screen.getByRole('button', { name: 'About Incubus 1' });
    fireEvent.pointerEnter(first, { pointerType: 'mouse' });
    // The read starts before the card shows.
    await waitFor(() => expect(getLeagueSquadMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('peek-entry-1-card')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(DETAILS_PEEK_HOVER_DELAY_MS);
    });
    expect(await screen.findByTestId('peek-entry-1-card')).toHaveTextContent('Incubus');
    fireEvent.pointerLeave(first, { pointerType: 'mouse' });

    const second = screen.getByRole('button', { name: 'About Incubus 2' });
    fireEvent.pointerEnter(second, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(DETAILS_PEEK_HOVER_DELAY_MS);
    });
    expect(await screen.findByTestId('peek-entry-2-card')).toHaveTextContent('Incubus');

    expect(getLeagueSquadMock).toHaveBeenCalledTimes(1);
  });

  it('says so in the peek when the team cannot be read', async () => {
    drawEntries([{ entryId: 'entry-1', entryName: 'Ghost 1', squadId: 'team-gone' }]);

    fireEvent.click(screen.getByRole('button', { name: 'About Ghost 1' }));

    expect(await screen.findByTestId('peek-entry-1-error')).toHaveTextContent("We couldn't load this team.");
  });
});
