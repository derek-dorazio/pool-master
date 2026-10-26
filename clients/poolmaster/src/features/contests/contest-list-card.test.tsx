import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import type { ContestDto } from '@/lib/api';
import { ContestListCard } from './contest-list-card';

const { getEventMock } = vi.hoisted(() => ({ getEventMock: vi.fn() }));

bindApiMocks({ getEvent: getEventMock });

function renderCard(status: ContestDto['status'], overrides: Partial<ContestDto> = {}) {
  const contest: ContestDto = {
    id: 'contest-1',
    name: 'Masters Pick 6',
    status,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    leagueId: 'league-1',
    entriesPerContest: null,
    sportEvents: [],
    sport: 'GOLF',
    entryCount: 3,
    ...overrides,
  };

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ContestListCard contest={contest} leagueCode="BIGDAWGS" testId="contest-card" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContestListCard', () => {
  it('shows an open contest as "Open for entries" in the open colour, not the raw enum', () => {
    renderCard('OPEN');

    const card = screen.getByRole('link', { name: /Masters Pick 6/ });
    expect(card).toHaveTextContent('Open for entries');
    expect(card).not.toHaveTextContent('OPEN');
    expect(screen.getByText('Open for entries')).toHaveClass('[color:var(--status-active-text)]');
  });

  it('shows when the contest starts, from the event start the contest list carries, without reading the event', () => {
    renderCard('OPEN', {
      sportEvents: [{ sportEventId: 'event-1', sequence: 1, name: 'The Masters', startDate: '2026-04-09T12:00:00.000Z', status: 'SCHEDULED', participantType: null, scoringFamily: null }],
    });

    expect(screen.getByTestId('contest-card-starts')).toHaveTextContent(
      'Starts Apr 9, 2026, 8:00 AM EDT',
    );
    expect(getEventMock).not.toHaveBeenCalled();
  });

  it('shows the contest\'s own start once it is set, ahead of its event\'s scheduled start', () => {
    renderCard('ACTIVE', {
      startsAt: '2026-04-10T08:00:00.000Z',
      sportEvents: [{ sportEventId: 'event-1', sequence: 1, name: 'The Masters', startDate: '2026-04-09T12:00:00.000Z', status: 'SCHEDULED', participantType: null, scoringFamily: null }],
    });

    expect(screen.getByTestId('contest-card-starts')).toHaveTextContent(
      'Starts Apr 10, 2026, 4:00 AM EDT',
    );
  });

  it('shows no start line for a contest without a sport event', () => {
    renderCard('OPEN');

    expect(screen.queryByTestId('contest-card-starts')).not.toBeInTheDocument();
    expect(getEventMock).not.toHaveBeenCalled();
  });
});
