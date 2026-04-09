import { formatNumber, formatDecimal, formatPercent, formatOrdinal, formatCompact } from './format-number';

describe('formatNumber', () => {
  it('formats with thousand separators', () => {
    expect(formatNumber(1234.56, 'en-US')).toBe('1,234.56');
  });

  it('handles zero', () => {
    expect(formatNumber(0, 'en-US')).toBe('0');
  });
});

describe('formatDecimal', () => {
  it('formats with specified decimal places', () => {
    expect(formatDecimal(3.14159, 2, 'en-US')).toBe('3.14');
  });

  it('pads decimals', () => {
    expect(formatDecimal(5, 2, 'en-US')).toBe('5.00');
  });
});

describe('formatPercent', () => {
  it('formats ratio as percentage', () => {
    expect(formatPercent(0.753, 1, 'en-US')).toBe('75.3%');
  });

  it('formats 100%', () => {
    expect(formatPercent(1, 0, 'en-US')).toBe('100%');
  });

  it('formats 0%', () => {
    expect(formatPercent(0, 0, 'en-US')).toBe('0%');
  });
});

describe('formatOrdinal', () => {
  it('handles 1st', () => expect(formatOrdinal(1)).toBe('1st'));
  it('handles 2nd', () => expect(formatOrdinal(2)).toBe('2nd'));
  it('handles 3rd', () => expect(formatOrdinal(3)).toBe('3rd'));
  it('handles 4th', () => expect(formatOrdinal(4)).toBe('4th'));
  it('handles 11th (special case)', () => expect(formatOrdinal(11)).toBe('11th'));
  it('handles 12th (special case)', () => expect(formatOrdinal(12)).toBe('12th'));
  it('handles 13th (special case)', () => expect(formatOrdinal(13)).toBe('13th'));
  it('handles 21st', () => expect(formatOrdinal(21)).toBe('21st'));
  it('handles 101st', () => expect(formatOrdinal(101)).toBe('101st'));
  it('handles 111th', () => expect(formatOrdinal(111)).toBe('111th'));
});

describe('formatCompact', () => {
  it('formats thousands', () => {
    expect(formatCompact(1200, 'en-US')).toBe('1.2K');
  });

  it('formats millions', () => {
    expect(formatCompact(3400000, 'en-US')).toBe('3.4M');
  });

  it('handles small numbers', () => {
    expect(formatCompact(50, 'en-US')).toBe('50');
  });
});
