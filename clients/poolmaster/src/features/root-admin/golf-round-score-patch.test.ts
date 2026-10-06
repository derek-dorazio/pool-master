import { describe, expect, it } from 'vitest';
import type { GolfRoundScoreRow } from './golf-admin-utils';
import { buildRoundScorePatch, isSignedInt, toDateTimeInput } from './golf-round-score-patch';

function scoreRow(overrides: Partial<GolfRoundScoreRow> = {}): GolfRoundScoreRow {
  return {
    sportEventParticipantId: 'sep-1',
    participantName: 'Rory McIlroy',
    strokes: 70,
    scoreToPar: -2,
    thru: 18,
    status: 'IN_PROGRESS',
    completedAt: null,
    ...overrides,
  };
}

describe('buildRoundScorePatch', () => {
  const row = scoreRow();

  it('returns null when nothing changed, including a draft equal to the stored values', () => {
    expect(buildRoundScorePatch(row, undefined)).toBeNull();
    expect(buildRoundScorePatch(row, { strokes: '70', scoreToPar: '-2', thru: '18', status: 'IN_PROGRESS', completedAt: '' })).toBeNull();
  });

  it('sends each edited field and leaves unchanged fields out', () => {
    expect(buildRoundScorePatch(row, { strokes: '69', status: 'COMPLETED' })).toEqual({
      strokes: 69,
      status: 'COMPLETED',
    });
    expect(buildRoundScorePatch(row, { scoreToPar: '+1', thru: '9' })).toEqual({ scoreToPar: 1, thru: 9 });
  });

  it('sends strokes alone when only strokes is edited; to par is never derived from it', () => {
    expect(buildRoundScorePatch(row, { strokes: '75' })).toEqual({ strokes: 75 });
  });

  it('sends completed at as an ISO instant when set, and null when an admin clears a stored one', () => {
    expect(buildRoundScorePatch(row, { completedAt: '2026-04-10T15:30' })).toEqual({
      completedAt: new Date('2026-04-10T15:30').toISOString(),
    });
    const completed = scoreRow({ completedAt: '2026-04-10T22:15:00.000Z' });
    expect(buildRoundScorePatch(completed, { completedAt: toDateTimeInput(completed.completedAt) })).toBeNull();
    expect(buildRoundScorePatch(completed, { completedAt: '' })).toEqual({ completedAt: null });
  });

  it('ignores an invalid numeric draft value', () => {
    expect(buildRoundScorePatch(row, { strokes: 'x' })).toBeNull();
    expect(buildRoundScorePatch(row, { thru: '-1' })).toBeNull();
    expect(buildRoundScorePatch(row, { scoreToPar: '1.5' })).toBeNull();
  });
});

describe('isSignedInt', () => {
  it('accepts whole numbers with an optional sign and rejects anything else', () => {
    expect(['0', '-3', '+4', ' 12 '].map(isSignedInt)).toEqual([true, true, true, true]);
    expect(['', '-', '1.5', 'E', '--2'].map(isSignedInt)).toEqual([false, false, false, false, false]);
  });
});
