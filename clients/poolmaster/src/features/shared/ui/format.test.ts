import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatCupPoints,
  formatMoneyCents,
  formatNumber,
  formatNumberList,
  formatOrdinal,
  formatPlace,
} from './format';

describe('formatOrdinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [103, '103rd'],
    [111, '111th'],
  ])('writes place %i as "%s"', (place, expected) => {
    expect(formatOrdinal(place)).toBe(expected);
  });
});

describe('formatPlace', () => {
  it('reads an unshared place as an ordinal', () => {
    expect(formatPlace({ position: 6, displayPosition: '6' })).toBe('6th');
  });

  it('keeps a shared place as the server writes it, T2', () => {
    expect(formatPlace({ position: 2, displayPosition: 'T2' })).toBe('T2');
  });
});

describe('formatNumber', () => {
  it('groups a whole number the way the viewer\'s locale does', () => {
    expect([formatNumber(1000, 'en-US'), formatNumber(1000, 'en-GB'), formatNumber(1000, 'en-DE')]).toEqual(['1,000', '1,000', '1.000']);
  });

  it('writes zero and a negative number', () => {
    expect([formatNumber(0, 'en-US'), formatNumber(-1250, 'en-US')]).toEqual(['0', '-1,250']);
  });
});

describe('formatCount', () => {
  it('names one thing in the singular and any other count in the plural', () => {
    expect([formatCount(1, 'entry', 'en-US', 'entries'), formatCount(0, 'entry', 'en-US', 'entries'), formatCount(3, 'entry', 'en-US', 'entries')])
      .toEqual(['1 entry', '0 entries', '3 entries']);
  });

  it('adds an s for the plural when no plural is given, and groups the count in the viewer\'s locale', () => {
    expect([formatCount(2, 'sports league', 'en-US'), formatCount(1500, 'sports league', 'en-DE')]).toEqual(['2 sports leagues', '1.500 sports leagues']);
  });
});

describe('formatCupPoints', () => {
  it('reads tenths of a point to one decimal, and whole points without one', () => {
    expect([formatCupPoints(6125, 'en-US'), formatCupPoints(6000, 'en-US'), formatCupPoints(0, 'en-US'), formatCupPoints(12345, 'en-US')])
      .toEqual(['612.5', '600', '0', '1,234.5']);
  });

  it('writes the decimal and the grouping the way the viewer\'s locale does', () => {
    expect(formatCupPoints(12345, 'en-DE')).toBe('1.234,5');
  });

  it('keeps the sign of a negative gap', () => {
    expect(formatCupPoints(-15, 'en-US')).toBe('-1.5');
  });
});

describe('formatMoneyCents', () => {
  it('shows whole dollars without cents and cents only when there are some', () => {
    expect([formatMoneyCents(4900, 'en-US'), formatMoneyCents(1250, 'en-US'), formatMoneyCents(0, 'en-US')]).toEqual(['$49', '$12.5', '$0']);
  });

  it('marks the price as US dollars for a viewer outside the US', () => {
    expect(formatMoneyCents(4900, 'en-GB')).toBe('US$49');
  });
});

describe('formatNumberList', () => {
  it('joins numbers with commas, never grouping one, so a form box reads the list back the same', () => {
    expect(formatNumberList([1000, 6, 3])).toBe('1000, 6, 3');
    expect(formatNumberList([])).toBe('');
  });
});
