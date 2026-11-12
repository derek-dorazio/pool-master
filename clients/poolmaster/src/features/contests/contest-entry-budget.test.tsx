import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sport, getSportDefinition } from '@poolmaster/shared/domain';
import { LockedBudgetLineup } from './contest-entry-budget';
import type { SelectionGroup } from './contest-entry-selection';

const GOLFER = getSportDefinition(Sport.GOLF).vocabulary.participant;

function buildGroup(selected: { id: string; name: string; price: number }[]): SelectionGroup {
  const participants = selected.map(({ id, name, price }, index) => ({
    sportEventParticipantId: id,
    participantId: `participant-${id}`,
    participantName: name,
    role: 'GOLFER',
    team: undefined,
    status: 'ACTIVE',
    price,
    ranking: index + 1,
    seedNumber: null,
    orderIndex: index + 1,
    isAvailable: true,
    isSelected: true,
  }));
  return { groupId: 'budget', groupName: 'Budget', groupNumber: 1, picksFromGroup: 6, selectedParticipantIds: selected.map(({ id }) => id), participants };
}

describe('LockedBudgetLineup', () => {
  it('shows a locked budget entry as a titled section marked Locked, one row per golfer with its price, and the spend against the cap', () => {
    render(
      <LockedBudgetLineup
        group={buildGroup([{ id: 'sep-1', name: 'Scottie Scheffler', price: 11200 }, { id: 'sep-2', name: 'Rory McIlroy', price: 9800 }])}
        noun={GOLFER}
        summary={{ selectionType: 'BUDGET_PICK', salaryCap: 50000, spent: 21000, remaining: 29000, isOverBudget: false, openSlots: 0, cheapestFill: 0 }}
      />,
    );

    const section = screen.getByTestId('contest-entry-budget-locked');
    expect(within(section).getByRole('heading', { name: 'Your golfers' })).toBeInTheDocument();
    expect(section).toHaveTextContent('Locked');
    expect(screen.getByTestId('contest-entry-locked-participant-sep-1')).toHaveTextContent('Scottie Scheffler$11,200');
    expect(screen.getByTestId('contest-entry-locked-participant-sep-2')).toHaveTextContent('Rory McIlroy$9,800');
    expect(screen.getByTestId('contest-entry-budget-locked-spend')).toHaveTextContent('Spent $21,000 of the $50,000 salary cap.');
  });

  it('says no golfer was saved on an entry locked empty, with no spend line when there is no lineup summary', () => {
    render(<LockedBudgetLineup group={buildGroup([])} noun={GOLFER} summary={null} />);

    expect(screen.getByTestId('contest-entry-budget-locked')).toHaveTextContent('No golfer was saved on this entry.');
    expect(screen.queryByTestId('contest-entry-budget-locked-spend')).not.toBeInTheDocument();
  });
});
