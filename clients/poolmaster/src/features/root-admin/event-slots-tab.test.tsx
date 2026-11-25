import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { SportEventDto } from '@/lib/api';
import type { EventPageContext } from './event-page-context';
import { EventSlotsTab } from './event-slots-tab';
import { seasonSlotFixture, sportEventFixture } from './sport-test-fixtures';

function renderTab(event: SportEventDto) {
  const context = { event, overview: undefined, sportLeague: undefined, isSynced: false, activity: {} } as unknown as EventPageContext;
  return render(
    <MemoryRouter initialEntries={['/slots']}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route element={<EventSlotsTab />} path="/slots" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('EventSlotsTab', () => {
  it('lists each Season slot the event covers with its name or kind, dates, status and test label', () => {
    renderTab(sportEventFixture({
      slots: [
        seasonSlotFixture({ id: 'week', key: 'WEEK_3', slotKind: 'WEEK', weekNumber: 3, isTestData: false, label: null, status: 'COMPLETED' }),
        seasonSlotFixture({ id: 'masters', name: 'The Masters', label: 'QA A' }),
      ],
    }));

    const week = screen.getByTestId('root-admin-event-slot-week');
    expect(within(week).getByText('Week 3')).toBeInTheDocument();
    expect(within(week).getByText('Completed')).toBeInTheDocument();
    const masters = screen.getByTestId('root-admin-event-slot-masters');
    expect(within(masters).getByText('The Masters')).toBeInTheDocument();
    expect(within(masters).getByText('QA A')).toBeInTheDocument();
    expect(within(masters).getByText('Tournament')).toBeInTheDocument();
  });

  it('says so when the event covers no slot yet', () => {
    renderTab(sportEventFixture({ slots: [], isTestData: false }));

    expect(screen.getByText('This event covers no Season slot yet.')).toBeInTheDocument();
  });

  it('opens a slot to read in a dialog with no Edit, its unknown end said as such', async () => {
    renderTab(sportEventFixture({ slots: [seasonSlotFixture({ id: 'open', name: 'The Open', endsAt: null, seriesFormat: 'BEST_OF', seriesGames: 7, pairing: 'RESEEDED' })] }));

    await userEvent.click(within(screen.getByTestId('root-admin-event-slot-open')).getByRole('button', { name: /open/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('root-admin-event-slot-dialog-slot')).toHaveTextContent('The Open');
    expect(within(dialog).getByTestId('root-admin-event-slot-dialog-ends')).toHaveTextContent('Not known yet');
    expect(within(dialog).getByTestId('root-admin-event-slot-dialog-label')).toHaveTextContent('QA 1');
    expect(within(dialog).getByTestId('root-admin-event-slot-dialog-series')).toHaveTextContent('7');
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('names a synced slot as such in its dialog', async () => {
    renderTab(sportEventFixture({ slots: [seasonSlotFixture({ id: 'final', slotKind: 'FINAL', isTestData: false, label: null })] }));

    await userEvent.click(within(screen.getByTestId('root-admin-event-slot-final')).getByRole('button', { name: /open/i }));

    expect(await screen.findByTestId('root-admin-event-slot-dialog-label')).toHaveTextContent('Synced slot');
  });
});
