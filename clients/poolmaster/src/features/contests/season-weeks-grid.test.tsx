import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { totalColumn } from './leaderboard-columns';
import { SeasonWeeksGrid } from './season-weeks-grid';

type Row = { entryId: string; entryName: string; displayPosition: string | null; squadId: string; weeksSurvived: number };
type Week = { id: string; name: string };

const WEEKS: Week[] = [{ id: 'week-1', name: 'Week 1' }, { id: 'week-2', name: 'Week 2' }];
const ROWS: Row[] = [
  { entryId: 'entry-1', entryName: 'Sharks 1', displayPosition: '1', squadId: 'squad-1', weeksSurvived: 2 },
  { entryId: 'entry-2', entryName: 'Lakers 2', displayPosition: '2', squadId: 'squad-2', weeksSurvived: 1 },
];

function renderGrid({ isLive }: { isLive: boolean }) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SeasonWeeksGrid<Row, Week>
          board={{ contestId: 'contest-1', leagueCode: 'BIGDAWGS', leagueId: 'league-1', mySquadId: 'squad-1' }}
          currentWeek={{ id: 'week-2', isLive }}
          data={ROWS}
          // A survivor-style entry: one line per week across the row; Lakers 2 has nothing to open.
          details={(row) => (row.entryId === 'entry-1' ? WEEKS.map((week) => ({ id: week.id, entry: week.name, span: `${week.name} game`, testId: `detail-${week.id}` })) : [])}
          emptyMessage="No entries."
          summaryColumns={[totalColumn<Row>('grid', { header: 'Weeks', id: 'weeks', value: (row) => row.weeksSurvived })]}
          testIdPrefix="grid"
          weekCell={(row, week) => `${row.entryName} ${week.name}`}
          weekHeading={(week) => week.name}
          weekId={(week) => week.id}
          weeks={WEEKS}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SeasonWeeksGrid', () => {
  it('lays a line that reads across the row over every column after Entry, under the viewer\'s own entry, which starts open', () => {
    renderGrid({ isLive: true });

    const cells = within(screen.getByTestId('detail-week-2')).getAllByRole('cell');
    expect(cells.map((cell) => [cell.textContent, cell.getAttribute('colspan')])).toEqual([['Week 2', '1'], ['Week 2 game', '3']]);
    expect(screen.getByTestId('grid-toggle-entry-1')).toHaveAttribute('aria-expanded', 'true');
  });

  it('gives an entry with nothing to open no ▼, and marks the current week live only while it is under way', () => {
    renderGrid({ isLive: false });

    expect(screen.queryByTestId('grid-toggle-entry-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('grid-week-week-2-live')).not.toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent.replace('↕', ''))).toEqual(['Entry', 'Weeks', 'Week 2', 'Week 1']);
  });
});
