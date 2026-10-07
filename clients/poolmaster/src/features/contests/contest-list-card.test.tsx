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
    scoringEngine: 'STROKE_PLAY',
    leagueId: 'league-1',
    sport: 'GOLF',
    entryCount: 3,
    isExclusive: false,
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

  it('shows when the contest starts, from its sport event\'s schedule', async () => {
    getEventMock.mockResolvedValue({
      data: { event: { id: 'event-1', startDate: '2026-04-09T12:00:00.000Z', endDate: null } },
    });

    renderCard('OPEN', { sportEventId: 'event-1' });

    expect(await screen.findByTestId('contest-card-starts')).toHaveTextContent(
      `Starts ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-04-09T12:00:00.000Z'))}`,
    );
  });

  it('shows no start line for a contest without a sport event', () => {
    renderCard('OPEN');

    expect(screen.queryByTestId('contest-card-starts')).not.toBeInTheDocument();
    expect(getEventMock).not.toHaveBeenCalled();
  });
});
