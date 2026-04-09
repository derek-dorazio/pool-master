import { render, screen } from '@testing-library/react';
import { SelectionOverview } from './selection-overview';
import type { DraftState } from './hooks/use-draft';

const baseDraft: DraftState = {
  contestId: 'contest-1',
  contestName: 'Budget Challenge',
  selectionType: 'BUDGET_PICK',
  isTurnBased: false,
  rosterSize: 3,
  selectionConfig: { isExclusive: false, rosterSize: 3, budget: 50000, pricingMethod: 'ODDS' },
  status: 'LIVE',
  currentPickNumber: 2,
  currentRound: 2,
  totalPicks: 6,
  totalRounds: 3,
  currentEntryId: 'entry-1',
  currentEntryName: 'My Entry',
  myEntryId: 'entry-1',
  isMyPick: true,
  timePerPickSeconds: 0,
  pickDeadline: null,
  availableParticipantIds: ['p3'],
  isComplete: false,
  entries: [
    { id: 'entry-1', userId: 'user-1', name: 'My Entry', isOnClock: false },
    { id: 'entry-2', userId: 'user-2', name: 'Other Entry', isOnClock: false },
  ],
  picks: [
    {
      pickNumber: 1,
      round: 1,
      pickInRound: 1,
      entryId: 'entry-1',
      entryName: 'My Entry',
      participantId: 'p1',
      participantName: 'Driver One',
      position: 'DRV',
      team: 'Team A',
      price: 18000,
      autoPicked: false,
      pickedAt: new Date().toISOString(),
    },
    {
      pickNumber: 2,
      round: 1,
      pickInRound: 1,
      entryId: 'entry-2',
      entryName: 'Other Entry',
      participantId: 'p2',
      participantName: 'Driver Two',
      position: 'DRV',
      team: 'Team B',
      price: 22000,
      autoPicked: false,
      pickedAt: new Date().toISOString(),
    },
  ],
};

describe('SelectionOverview', () => {
  it('shows real budget summary for budget-pick drafts', () => {
    render(<SelectionOverview draft={baseDraft} />);

    expect(screen.getByText('Budget Summary')).toBeInTheDocument();
    expect(screen.getAllByText('$50,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$18,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$32,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Odds').length).toBeGreaterThan(0);
    expect(screen.getByText('$22,000 spent')).toBeInTheDocument();
    expect(screen.getByText('Contestant Setup')).toBeInTheDocument();
    expect(screen.getByText('Budget Pick')).toBeInTheDocument();
  });
});
