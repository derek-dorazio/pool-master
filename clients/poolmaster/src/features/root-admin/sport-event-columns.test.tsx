import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataGrid, DEFAULT_DISPLAY_PREFERENCES } from '@/features/shared/ui';
import { sportEventNameColumn, sportEventScheduleColumns } from './sport-event-columns';
import { sportEventFixture } from './sport-test-fixtures';

function renderGrid() {
  render(
    <DataGrid
      columns={[sportEventNameColumn('Tournament'), ...sportEventScheduleColumns(DEFAULT_DISPLAY_PREFERENCES)]}
      data={[
        sportEventFixture({ id: 'masters', name: 'The Masters', venue: 'Augusta National' }),
        sportEventFixture({ id: 'open', name: 'The Open', venue: null }),
      ]}
      emptyMessage="No events."
      getRowId={(row) => row.id}
      rowTestId={(row) => `row-${row.id}`}
      search={{ label: 'Find an event', testId: 'search' }}
    />,
  );
}

describe('sport event columns', () => {
  it('names each event in the sport\'s word with its venue under it, and says when the venue is not set', () => {
    renderGrid();

    expect(screen.getByRole('columnheader', { name: /Tournament/ })).toBeInTheDocument();
    expect(screen.getByTestId('row-masters')).toHaveTextContent('Augusta National');
    expect(screen.getByTestId('row-open')).toHaveTextContent('Venue not set');
  });

  it('finds an event by its venue as well as its name', () => {
    renderGrid();

    fireEvent.change(screen.getByTestId('search'), { target: { value: 'Augusta' } });

    expect(screen.getByTestId('row-masters')).toBeInTheDocument();
    expect(screen.queryByTestId('row-open')).not.toBeInTheDocument();
  });

  it('shows when each event starts, its status and its readiness', () => {
    renderGrid();

    for (const header of ['Starts', 'Status', 'Readiness']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(header) })).toBeInTheDocument();
    }
  });
});
