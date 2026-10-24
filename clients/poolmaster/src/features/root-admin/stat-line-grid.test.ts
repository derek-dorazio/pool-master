import { describe, expect, it } from 'vitest';
import { getSportDefinition, Sport, type SportComposite } from '@poolmaster/shared/domain';
import { buildStatLineRow, isStatInput, type StatLineGridRow } from './stat-line-grid';

const composite = getSportDefinition(Sport.BASKETBALL).composite as SportComposite;
const row: StatLineGridRow = { sportEventParticipantId: 'sep-1', participantId: 'p-1', playerName: 'Shai Gilgeous-Alexander', team: null, line: { POINTS: 38, ASSISTS: 5 } };

describe('stat grid inputs', () => {
  it('accepts blank and whole numbers from 0 to 9999, and refuses negatives, decimals, words and 10000', () => {
    expect(['', ' ', '0', '42', '9999'].map((raw) => isStatInput(raw, 'POINTS'))).toEqual([true, true, true, true, true]);
    expect(['-1', '1.5', 'ten', '10000'].map((raw) => isStatInput(raw, 'POINTS'))).toEqual([false, false, false, false]);
  });

  it('accepts negative yards, as a run for a loss gives', () => {
    expect(['-3', '-9999'].map((raw) => isStatInput(raw, 'RUSHING_YARDS'))).toEqual([true, true]);
    expect(isStatInput('-10000', 'RUSHING_YARDS')).toBe(false);
  });

  it('sends nothing for inputs that make the stored line, and the whole changed line in the composite\'s stat order', () => {
    expect(buildStatLineRow(row, { POINTS: '38' }, composite)).toBeNull();
    expect(buildStatLineRow(row, { REBOUNDS: '7' }, composite)).toEqual({
      participantId: 'p-1',
      stats: [{ stat: 'POINTS', value: 38 }, { stat: 'REBOUNDS', value: 7 }, { stat: 'ASSISTS', value: 5 }],
    });
  });
});
