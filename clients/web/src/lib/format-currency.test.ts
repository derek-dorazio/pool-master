import { getCurrencyDecimals, formatCurrency, formatCurrencyWithCode, getCurrencySymbol, formatBudget } from './format-currency';

describe('getCurrencyDecimals', () => {
  it('returns 2 for USD', () => expect(getCurrencyDecimals('USD')).toBe(2));
  it('returns 0 for JPY', () => expect(getCurrencyDecimals('JPY')).toBe(0));
  it('returns 3 for BHD', () => expect(getCurrencyDecimals('BHD')).toBe(3));
  it('returns 2 for unknown currency', () => expect(getCurrencyDecimals('XYZ')).toBe(2));
  it('is case-insensitive', () => expect(getCurrencyDecimals('usd')).toBe(2));
});

describe('formatCurrency', () => {
  it('formats USD cents to dollars', () => {
    expect(formatCurrency(5000, 'USD', 'en-US')).toBe('$50.00');
  });

  it('formats JPY (zero decimals)', () => {
    expect(formatCurrency(5000, 'JPY', 'ja-JP')).toContain('5,000');
  });

  it('handles zero', () => {
    expect(formatCurrency(0, 'USD', 'en-US')).toBe('$0.00');
  });
});

describe('formatCurrencyWithCode', () => {
  it('appends currency code', () => {
    expect(formatCurrencyWithCode(5000, 'USD', 'en-US')).toBe('$50.00 USD');
  });
});

describe('getCurrencySymbol', () => {
  it('returns $ for USD', () => {
    expect(getCurrencySymbol('USD', 'en-US')).toBe('$');
  });

  it('returns symbol for EUR', () => {
    const symbol = getCurrencySymbol('EUR', 'en-US');
    expect(symbol).toContain('€');
  });
});

describe('formatBudget', () => {
  it('formats without decimals', () => {
    expect(formatBudget(5000000, 'USD', 'en-US')).toBe('$50,000');
  });

  it('handles zero', () => {
    expect(formatBudget(0, 'USD', 'en-US')).toBe('$0');
  });
});
