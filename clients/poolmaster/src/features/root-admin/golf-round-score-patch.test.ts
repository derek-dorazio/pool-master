import { describe, expect, it } from 'vitest';
import type { GolfRoundScoreRow } from './sport-admin-utils';
import {
  buildRoundScorePatch,
  isSignedInt,
  isStrokes,
  isThru,
  rowHasInvalid,
} from './golf-round-score-patch';
import { toDateTimeLocalValue } from '@/features/shared/ui';

const EASTERN = 'America/New_York';

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
    expect(buildRoundScorePatch(row, undefined, EASTERN)).toBeNull();
    expect(buildRoundScorePatch(row, { strokes: '70', scoreToPar: '-2', thru: '18', status: 'IN_PROGRESS', completedAt: '' }, EASTERN)).toBeNull();
  });

  it('sends thru null when the admin blanks a stored thru, and nothing when it was already blank', () => {
    expect(buildRoundScorePatch(row, { thru: '' }, EASTERN)).toEqual({ thru: null });
    expect(buildRoundScorePatch(row, { thru: '  ' }, EASTERN)).toEqual({ thru: null });
    expect(buildRoundScorePatch(scoreRow({ thru: null }), { thru: '' }, EASTERN)).toBeNull();
  });

  it('sends each edited field and leaves unchanged fields out', () => {
    expect(buildRoundScorePatch(row, { strokes: '69', status: 'COMPLETED' }, EASTERN)).toEqual({
      strokes: 69,
      status: 'COMPLETED',
    });
    expect(buildRoundScorePatch(row, { scoreToPar: '+1', thru: '9' }, EASTERN)).toEqual({ scoreToPar: 1, thru: 9 });
  });

  it('sends strokes alone when only strokes is edited; to par is never derived from it', () => {
    expect(buildRoundScorePatch(row, { strokes: '75' }, EASTERN)).toEqual({ strokes: 75 });
  });

  it('sends completed at as the instant of the wall clock in the member\'s zone when set, and null when an admin clears a stored one', () => {
    expect(buildRoundScorePatch(row, { completedAt: '2026-04-10T15:30' }, EASTERN)).toEqual({
      completedAt: '2026-04-10T19:30:00.000Z',
    });
    const completed = scoreRow({ completedAt: '2026-04-10T22:15:00.000Z' });
    expect(buildRoundScorePatch(completed, { completedAt: toDateTimeLocalValue(completed.completedAt, EASTERN) }, EASTERN)).toBeNull();
    expect(buildRoundScorePatch(completed, { completedAt: '' }, EASTERN)).toEqual({ completedAt: null });
  });

  it('never clears a stored completed at from a half-typed value, and marks the row invalid', () => {
    const completed = scoreRow({ completedAt: '2026-04-10T22:15:00.000Z' });
    const draft = { completedAt: '', completedAtIncomplete: true };
    expect(buildRoundScorePatch(completed, draft, EASTERN)).toBeNull();
    expect(rowHasInvalid(draft, EASTERN)).toBe(true);
  });

  it('ignores an invalid numeric draft value', () => {
    expect(buildRoundScorePatch(row, { strokes: 'x' }, EASTERN)).toBeNull();
    expect(buildRoundScorePatch(row, { thru: '-1' }, EASTERN)).toBeNull();
    expect(buildRoundScorePatch(row, { scoreToPar: '1.5' }, EASTERN)).toBeNull();
  });

  it('never sends 0 strokes or a thru above 18, which the server would refuse with a 400, and marks the row invalid', () => {
    expect(buildRoundScorePatch(row, { strokes: '0' }, EASTERN)).toBeNull();
    expect(buildRoundScorePatch(row, { thru: '19' }, EASTERN)).toBeNull();
    expect(rowHasInvalid({ strokes: '0' }, EASTERN)).toBe(true);
    expect(rowHasInvalid({ thru: '25' }, EASTERN)).toBe(true);
    expect(rowHasInvalid({ strokes: '1', thru: '0' }, EASTERN)).toBe(false);
  });
});

describe('isStrokes and isThru', () => {
  it('accept strokes of 1 or more and thru from 0 to 18, and reject anything outside', () => {
    expect(['1', '68', ' 72 '].map(isStrokes)).toEqual([true, true, true]);
    expect(['0', '-1', '', '1.5'].map(isStrokes)).toEqual([false, false, false, false]);
    expect(['0', '9', '18'].map(isThru)).toEqual([true, true, true]);
    expect(['19', '25', '-1', ''].map(isThru)).toEqual([false, false, false, false]);
  });
});

describe('isSignedInt', () => {
  it('accepts whole numbers with an optional sign and rejects anything else', () => {
    expect(['0', '-3', '+4', ' 12 '].map(isSignedInt)).toEqual([true, true, true, true]);
    expect(['', '-', '1.5', 'E', '--2'].map(isSignedInt)).toEqual([false, false, false, false, false]);
  });
});
