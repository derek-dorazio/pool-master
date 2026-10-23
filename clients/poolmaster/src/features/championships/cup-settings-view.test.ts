import { CupPointsScale } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { describePointsTable, parseCustomPoints, previewPoints } from './cup-settings-view';

describe('parseCustomPoints', () => {
  it('reads whole points 1st place first, separated by commas, spaces or both', () => {
    expect(parseCustomPoints(' 10, 6 3,,0 ')).toEqual({ points: [10, 6, 3, 0], error: null });
  });

  it.each([
    ['nothing typed', '  ', 'Enter the points for 1st place at least.'],
    ['a fraction', '10, 2.5', "Each place's points must be a whole number from 0 to 1000."],
    ['a word', '10, lots', "Each place's points must be a whole number from 0 to 1000."],
    ['more than the cap', '1001', "Each place's points must be a whole number from 0 to 1000."],
    ['more than 50 places', Array.from({ length: 51 }, () => '1').join(','), 'Enter points for no more than 50 places.'],
  ])('refuses %s with a reason the form shows', (_case, text, error) => {
    expect(parseCustomPoints(text)).toEqual({ points: null, error });
  });
});

describe('previewPoints', () => {
  it('shows the first ten places of the Standard table', () => {
    expect(previewPoints({ scale: CupPointsScale.STANDARD, customPoints: [] }).map((row) => [row.place, row.points]).slice(0, 3))
      .toEqual([['1st', 100], ['2nd', 80], ['3rd', 65]]);
  });

  it('scores Field beaten on a 12-entry contest, so 1st beats eleven and earns 12', () => {
    expect(previewPoints({ scale: CupPointsScale.FIELD_BEATEN, customPoints: [] }).at(0)).toEqual({ place: '1st', points: 12 });
  });

  it('gives places past a custom list nothing', () => {
    expect(previewPoints({ scale: CupPointsScale.CUSTOM, customPoints: [10, 5] }).map((row) => row.points).slice(0, 4))
      .toEqual([10, 5, 0, 0]);
  });
});

describe('describePointsTable', () => {
  it('names a built-in table, and lists a custom one\'s points', () => {
    expect(describePointsTable({ scale: CupPointsScale.TOP_TEN, customPoints: [] })).toBe('Top ten');
    expect(describePointsTable({ scale: CupPointsScale.CUSTOM, customPoints: [10, 6, 3] })).toBe('Custom: 10, 6, 3');
  });
});
