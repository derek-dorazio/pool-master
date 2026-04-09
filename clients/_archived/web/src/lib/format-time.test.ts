import { formatRelative, formatCountdown, getTimezoneAbbr } from './format-time';

describe('formatRelative', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = new Date();
    expect(formatRelative(now)).toBe('just now');
  });

  it('returns minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelative(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelative(threeHoursAgo)).toBe('3h ago');
  });

  it('returns yesterday', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(formatRelative(yesterday)).toBe('yesterday');
  });

  it('returns days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelative(threeDaysAgo)).toBe('3 days ago');
  });

  it('handles future: in a moment', () => {
    const soon = new Date(Date.now() + 10 * 1000);
    expect(formatRelative(soon)).toBe('in a moment');
  });

  it('handles future: in Nm', () => {
    const inFiveMin = new Date(Date.now() + 5 * 60 * 1000);
    expect(formatRelative(inFiveMin)).toBe('in 5m');
  });

  it('handles string input', () => {
    const now = new Date().toISOString();
    expect(formatRelative(now)).toBe('just now');
  });
});

describe('formatCountdown', () => {
  it('returns 0s for past dates', () => {
    const past = new Date(Date.now() - 1000);
    expect(formatCountdown(past)).toBe('0s');
  });

  it('shows seconds for short countdowns', () => {
    const soon = new Date(Date.now() + 30 * 1000);
    expect(formatCountdown(soon)).toMatch(/\d+s/);
  });

  it('shows minutes and seconds', () => {
    const inFiveMin = new Date(Date.now() + 5 * 60 * 1000 + 10 * 1000);
    const result = formatCountdown(inFiveMin);
    expect(result).toContain('5m');
    expect(result).toContain('s');
  });

  it('shows days for long countdowns', () => {
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000);
    const result = formatCountdown(inTwoDays);
    expect(result).toContain('2d');
    // Hours may be 2h or 3h due to ms elapsed between Date.now() calls
    expect(result).toMatch(/[23]h/);
  });
});

describe('getTimezoneAbbr', () => {
  it('returns abbreviation for known timezone', () => {
    const abbr = getTimezoneAbbr('America/New_York');
    expect(abbr).toMatch(/^E[DS]T$/);
  });

  it('returns abbreviation for UTC', () => {
    const abbr = getTimezoneAbbr('UTC');
    expect(abbr).toBe('UTC');
  });
});
