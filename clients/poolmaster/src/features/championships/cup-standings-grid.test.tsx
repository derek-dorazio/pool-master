import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { CupProjectedStandingDto, CupStandingRowDto } from '@/lib/api';
import { CupStandingsGrid } from './cup-standings-grid';

function standing(squadId: string, squadName: string, position: number, movement: number | null): CupStandingRowDto {
  return {
    squadId, squadName, squadIconKey: TeamIconKey.CAPTAIN_SMILE_OCEAN, squadIsActive: true, position, displayPosition: String(position),
    points: 100 - position, wins: 0, podiums: 0, contestsCounted: 1, movement, pointsAfter: [], trophy: null,
  };
}

const ROWS = [standing('squad-1', 'Casey Crushers', 1, 2), standing('squad-2', 'Birdie Bandits', 2, null), standing('squad-3', 'Eagle Eyes', 3, -1)];

function projected(squadId: string, position: number): CupProjectedStandingDto {
  return { squadId, position, displayPosition: String(position), points: 200 - position, gained: 10, movement: 0 };
}

function renderGrid(props: Partial<Parameters<typeof CupStandingsGrid>[0]> = {}) {
  render(
    <MemoryRouter>
      <CupStandingsGrid focusSquadId={null} rows={ROWS} squadPath={(squadId) => `/teams/${squadId}`} {...props} />
    </MemoryRouter>,
  );
}

function rowOrder() {
  return screen.getAllByTestId(/^cup-standing-squad-\d$/).map((row) => row.getAttribute('data-testid'));
}

describe('CupStandingsGrid', () => {
  it('shows each squad\'s movement since the latest counted contest', () => {
    renderGrid();

    expect(screen.getByLabelText('Up 2 places')).toHaveTextContent('▲2');
    expect(screen.getByLabelText('No movement yet')).toHaveTextContent('–');
    expect(screen.getByLabelText('Down 1 place')).toHaveTextContent('▼1');
  });

  it('leaves movement out for a season that is over', () => {
    renderGrid({ showMovement: false });

    expect(screen.queryByText('Move')).not.toBeInTheDocument();
  });

  it('greys in where each squad would stand if the live contests ended now, blank for a squad with none, and sorts by it', () => {
    renderGrid({ projection: new Map([['squad-1', projected('squad-1', 2)], ['squad-3', projected('squad-3', 1)]]) });

    expect(screen.getByTestId('cup-projected-squad-3')).toHaveTextContent('1st');
    expect(screen.queryByTestId('cup-projected-squad-2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('data-grid-sort-projected'));
    expect(rowOrder()).toEqual(['cup-standing-squad-3', 'cup-standing-squad-1', 'cup-standing-squad-2']);
  });
});
