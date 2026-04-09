import { render, screen } from '@testing-library/react';
import { DualTimezone } from '@/components/ui/dual-timezone';

vi.mock('@/stores/preferences-store', () => ({
  usePreferencesStore: (selector: (s: { timezone: string }) => string) =>
    selector({ timezone: 'America/New_York' }),
}));

vi.mock('@/lib/format-time', () => ({
  formatTime: (date: Date, format: string, tz: string) =>
    `formatted-${format}-${tz}`,
  getTimezoneAbbr: (tz: string) => {
    const abbrs: Record<string, string> = {
      'America/New_York': 'ET',
      'America/Los_Angeles': 'PT',
    };
    return abbrs[tz] ?? tz;
  },
}));

describe('DualTimezone', () => {
  const testDate = '2026-03-28T19:00:00Z';

  it('shows single time when user and league timezone are the same', () => {
    render(
      <DualTimezone
        utcDate={testDate}
        leagueTimezone="America/New_York"
      />,
    );

    // When timezones match, no secondary time is shown
    const spans = screen.getAllByText(/formatted/);
    expect(spans).toHaveLength(1);
  });

  it('shows both times when user and league timezones are different', () => {
    render(
      <DualTimezone
        utcDate={testDate}
        leagueTimezone="America/Los_Angeles"
      />,
    );

    // Primary time in user tz
    expect(screen.getByText(/formatted-DATETIME_SHORT-America\/New_York/)).toBeInTheDocument();
    // Abbreviation for user tz
    expect(screen.getByText(/ET/)).toBeInTheDocument();
    // Secondary time in league tz
    expect(screen.getByText(/formatted-TIME-America\/Los_Angeles/)).toBeInTheDocument();
    // Abbreviation for league tz
    expect(screen.getByText(/PT/)).toBeInTheDocument();
  });

  it('does not show abbreviation when timezones are the same', () => {
    render(
      <DualTimezone
        utcDate={testDate}
        leagueTimezone="America/New_York"
      />,
    );

    // When same tz, the abbr is empty string so ET should not appear as separate element
    const primarySpan = screen.getByText(/formatted-DATETIME_SHORT/);
    expect(primarySpan).toBeInTheDocument();
    expect(screen.queryByText(/formatted-TIME/)).not.toBeInTheDocument();
  });

  it('accepts Date object as utcDate', () => {
    render(
      <DualTimezone
        utcDate={new Date(testDate)}
        leagueTimezone="America/New_York"
      />,
    );

    expect(screen.getByText(/formatted-DATETIME_SHORT/)).toBeInTheDocument();
  });
});
