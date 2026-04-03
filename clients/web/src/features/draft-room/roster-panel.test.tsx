import { render, screen } from '@testing-library/react';
import { RosterPanel } from './roster-panel';
import type { DraftState } from './hooks/use-draft';

const budgetDraft: DraftState = {
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
  ],
};

describe('RosterPanel', () => {
  it('shows spent and remaining budget for budget-pick drafts', () => {
    render(<RosterPanel draft={budgetDraft} />);

    expect(screen.getByText('Budget: $18,000 / $50,000 spent')).toBeInTheDocument();
    expect(screen.getByText(/Remaining budget:/)).toBeInTheDocument();
    expect(screen.getByText('$32,000')).toBeInTheDocument();
    expect(screen.getByText(/Team A .* \$18,000/i)).toBeInTheDocument();
  });
});
