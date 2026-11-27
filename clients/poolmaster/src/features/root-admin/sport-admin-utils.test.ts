import { describe, expect, it } from 'vitest';
import type { ParticipantRoundStatus } from '@poolmaster/shared/domain';
import {
  formatSportEventStatus,
  sportEventStatusTone,
  golfRoundScoreRows,
} from './sport-admin-utils';
import { fieldEntryFixture, participantFixture } from './sport-test-fixtures';

// plans/124 §6.3/§6.4 — pure helpers backing the golf admin keystone screens (pool-master-3dg).

describe('pool-master-3dg sport-admin-utils: status formatting', () => {
  it('an event status reads its display string, sentence case like every other status', () => {
    expect(formatSportEventStatus('IN_PROGRESS')).toBe('In progress');
    expect(formatSportEventStatus('SCHEDULED')).toBe('Scheduled');
  });

  it('pool-master-3dg tones live, completed, and warning statuses distinctly', () => {
    expect(sportEventStatusTone('IN_PROGRESS')).toBe('live');
    expect(sportEventStatusTone('COMPLETED')).toBe('completed');
    expect(sportEventStatusTone('CANCELLED')).toBe('warning');
    expect(sportEventStatusTone('POSTPONED')).toBe('warning');
    expect(sportEventStatusTone('SCHEDULED')).toBe('neutral');
  });
});


describe('sport-admin-utils: golfRoundScoreRows (issue 236)', () => {
  function result(roundNumber: number, strokes: number, status: ParticipantRoundStatus = 'COMPLETED') {
    return {
      id: `r-${roundNumber}`,
      sportEventRoundId: `round-${roundNumber}`,
      roundNumber,
      status,
      completedAt: null,
      golf: { strokes, scoreToPar: strokes - 71, thru: 18 },
    };
  }

  it('takes the golfers with a golf result in the chosen round, sorted by name', () => {
    const field = [
      fieldEntryFixture({
        id: 'sep-z',
        participant: participantFixture({ name: 'Zach' }),
        rounds: [result(1, 70), result(2, 72, 'IN_PROGRESS')],
      }),
      fieldEntryFixture({ id: 'sep-a', participant: participantFixture({ name: 'Adam' }), rounds: [result(2, 69)] }),
      fieldEntryFixture({ id: 'sep-none', participant: participantFixture({ name: 'Nobody' }), rounds: [] }),
    ];

    expect(golfRoundScoreRows(field, 2)).toEqual([
      { sportEventParticipantId: 'sep-a', participantName: 'Adam', strokes: 69, scoreToPar: -2, thru: 18, status: 'COMPLETED', completedAt: null },
      { sportEventParticipantId: 'sep-z', participantName: 'Zach', strokes: 72, scoreToPar: 1, thru: 18, status: 'IN_PROGRESS', completedAt: null },
    ]);
    expect(golfRoundScoreRows(field, 4)).toEqual([]);
  });

  it('skips a round row that carries no golf result', () => {
    const field = [
      fieldEntryFixture({ rounds: [{ ...result(1, 70), golf: null }] }),
    ];
    expect(golfRoundScoreRows(field, 1)).toEqual([]);
  });
});
