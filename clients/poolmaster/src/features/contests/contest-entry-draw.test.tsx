import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SelectionParticipant } from './contest-entry-selection';
import { DrawLineup } from './contest-entry-draw';

const GOLFER = { one: 'golfer', many: 'golfers' };

function participant(id: string, name: string, overrides: Partial<SelectionParticipant> = {}): SelectionParticipant {
  return { sportEventParticipantId: id, participantId: `p-${id}`, participantName: name, seedNumber: null, isAvailable: true, isSelected: true, ...overrides };
}

describe('DrawLineup', () => {
  it('says the draw has not run and how many the entry will be dealt', () => {
    render(<DrawLineup noun={GOLFER} selectionState={{ drawnAt: null, rosterSize: 3, selectionGroups: [] }} />);

    expect(screen.getByTestId('contest-entry-draw-pending')).toHaveTextContent('deals this entry 3 golfers at random');
  });

  it('lists only the dealt participants after the draw, with a team line where they play for one', () => {
    render(
      <DrawLineup
        noun={GOLFER}
        selectionState={{
          drawnAt: '2026-11-20T15:00:00.000Z',
          rosterSize: 2,
          selectionGroups: [{
            groupId: 'g-1',
            groupName: 'Field',
            groupNumber: 1,
            picksFromGroup: 2,
            selectedParticipantIds: ['a', 'b'],
            participants: [
              participant('a', 'Scottie Scheffler'),
              participant('b', 'Shohei Ohtani', { team: 'Los Angeles Dodgers', role: 'DH' }),
              participant('c', 'Not Dealt', { isSelected: false }),
            ],
          }],
        }}
      />,
    );

    expect(screen.getByTestId('contest-entry-draw-done')).toHaveTextContent('The draw is final.');
    const dealt = within(screen.getByRole('list', { name: 'Dealt golfers' })).getAllByRole('listitem');
    expect(dealt.map((row) => row.textContent)).toEqual(['Scottie Scheffler', 'Shohei OhtaniLos Angeles Dodgers · DH']);
  });

  it('shows an empty dealt list when the room sends no field', () => {
    render(<DrawLineup noun={GOLFER} selectionState={{ drawnAt: '2026-11-20T15:00:00.000Z', rosterSize: 2 }} />);

    expect(within(screen.getByRole('list', { name: 'Dealt golfers' })).queryAllByRole('listitem')).toEqual([]);
  });
});
