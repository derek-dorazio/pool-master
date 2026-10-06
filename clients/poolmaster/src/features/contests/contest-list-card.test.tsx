import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ContestDto } from '@/lib/api';
import { ContestListCard } from './contest-list-card';

function renderCard(status: ContestDto['status']) {
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
  };

  render(
    <MemoryRouter>
      <ContestListCard contest={contest} leagueCode="BIGDAWGS" testId="contest-card" />
    </MemoryRouter>,
  );
}

describe('ContestListCard', () => {
  it('shows an open contest as "Open for entries" in the open colour, not the raw enum', () => {
    renderCard('OPEN');

    const card = screen.getByRole('link', { name: /Masters Pick 6/ });
    expect(card).toHaveTextContent('Open for entries');
    expect(card).not.toHaveTextContent('OPEN');
    expect(screen.getByText('Open for entries').className).toContain('--status-active-text');
  });
});
