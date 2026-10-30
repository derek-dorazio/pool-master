import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { squadStandingColumns, type SquadStandingRow } from './squad-standing-columns';
import { SquadStandingsGrid } from './squad-standings-grid';

const rows: SquadStandingRow[] = [
  { displayPosition: '1', points: 425, position: 1, squadId: 'squad-1', squadIsActive: true, squadName: 'Casey Crushers' },
  { displayPosition: 'T2', points: 100, position: 2, squadId: 'squad-2', squadIsActive: true, squadName: 'Birdie Bandits' },
];

function renderGrid({ focusSquadId = null, searchable, squadPath }: { focusSquadId?: string | null; searchable?: boolean; squadPath?: (squadId: string) => string } = {}) {
  render(
    <MemoryRouter>
      <SquadStandingsGrid
        columns={squadStandingColumns<SquadStandingRow>({ focusSquadId, squadPath, testIdPrefix: 'board' })}
        focusSquadId={focusSquadId}
        rows={rows}
        searchable={searchable}
        testIdPrefix="board"
      />
    </MemoryRouter>,
  );
}

describe('SquadStandingsGrid', () => {
  it('shows each squad\'s place as the server writes it, its name and its points in tenths, under the prefix\'s test ids', () => {
    renderGrid();

    expect(screen.getByTestId('board-standings')).toBeInTheDocument();
    expect(screen.getByTestId('board-standing-squad-2')).toHaveTextContent('T2');
    expect(screen.getByTestId('board-standing-squad-squad-1')).toHaveTextContent('Casey Crushers');
    expect(screen.getByTestId('board-standing-squad-1')).toHaveTextContent('42.5');
  });

  it('links each squad to the path the page gives', () => {
    renderGrid({ squadPath: (squadId) => `/squads/${squadId}` });
    expect(screen.getByRole('link', { name: /Casey Crushers/ })).toHaveAttribute('href', '/squads/squad-1');
  });

  it('names a squad without a link when the page gives no path', () => {
    renderGrid();
    expect(screen.queryByRole('link', { name: /Casey Crushers/ })).not.toBeInTheDocument();
  });

  it('offers search and a jump to the focused squad\'s row', () => {
    renderGrid({ focusSquadId: 'squad-2' });

    expect(screen.getByTestId('board-standings-search')).toBeInTheDocument();
    expect(screen.getByTestId('board-standings-jump')).toHaveTextContent('Jump to Birdie Bandits');
  });

  it('drops search and the jump when the page shows the one squad', () => {
    renderGrid({ focusSquadId: 'squad-2', searchable: false });

    expect(screen.queryByTestId('board-standings-search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('board-standings-jump')).not.toBeInTheDocument();
  });
});
