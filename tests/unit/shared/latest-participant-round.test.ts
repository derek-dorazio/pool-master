/**
 * A participant's current round is the latest of its own rounds (#2047): the golf standings writer
 * and the API's standing read it from the same helper, so they cannot drift apart.
 */
import { expect } from '@jest/globals';
import { latestParticipantRound } from '@poolmaster/shared/domain';

describe('latestParticipantRound', () => {
  it('takes the highest round number, whatever order the rounds come in', () => {
    const rounds = [{ round: { roundNumber: 2 }, id: 'b' }, { round: { roundNumber: 3 }, id: 'c' }, { round: { roundNumber: 1 }, id: 'a' }];

    expect(latestParticipantRound(rounds, (each) => each.round)?.id).toBe('c');
  });

  it('gives a participant with no rounds of its own, a team, no current round', () => {
    expect(latestParticipantRound([], (each: { round: { roundNumber: number } }) => each.round)).toBeNull();
  });
});
