import { formatParticipantPrice, formatRemainingBudget, formatBudgetUsed } from './format-salary';

describe('formatParticipantPrice', () => {
  it('formats cents as whole dollars', () => {
    expect(formatParticipantPrice(1250000, 'USD', 'en-US')).toBe('$12,500');
  });

  it('handles zero', () => {
    expect(formatParticipantPrice(0, 'USD', 'en-US')).toBe('$0');
  });
});

describe('formatRemainingBudget', () => {
  it('formats remaining of total', () => {
    expect(formatRemainingBudget(3750000, 5000000, 'USD', 'en-US')).toBe('$37,500 of $50,000 remaining');
  });
});

describe('formatBudgetUsed', () => {
  it('formats percentage used', () => {
    expect(formatBudgetUsed(2500000, 5000000)).toBe('50% used');
  });

  it('handles zero total', () => {
    expect(formatBudgetUsed(0, 0)).toBe('0% used');
  });

  it('handles full budget used', () => {
    expect(formatBudgetUsed(5000000, 5000000)).toBe('100% used');
  });
});
