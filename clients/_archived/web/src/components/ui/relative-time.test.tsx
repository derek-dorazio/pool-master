import { render, screen } from '@testing-library/react';
import { RelativeTime } from '@/components/ui/relative-time';

vi.mock('@/lib/format-time', () => ({
  formatRelative: (utcDate: Date | string) => {
    const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
    const diffMs = Date.now() - date.getTime();
    const seconds = Math.floor(Math.abs(diffMs) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days} days ago`;
  },
  formatTime: (_utcDate: Date | string, _format: string) =>
    'Wednesday, March 25, 2026 at 3:00 PM EDT',
}));

describe('RelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "just now" for recent timestamps', () => {
    const recent = new Date(Date.now() - 10_000).toISOString();
    render(<RelativeTime utcDate={recent} />);

    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('shows "Xm ago" for minutes-old timestamps', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    render(<RelativeTime utcDate={fiveMinAgo} />);

    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('shows "Xh ago" for hours-old timestamps', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    render(<RelativeTime utcDate={threeHoursAgo} />);

    expect(screen.getByText('3h ago')).toBeInTheDocument();
  });

  it('shows days for old timestamps', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
    render(<RelativeTime utcDate={threeDaysAgo} />);

    expect(screen.getByText('3 days ago')).toBeInTheDocument();
  });

  it('has title attribute with full date', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    render(<RelativeTime utcDate={recent} />);

    const span = screen.getByText('just now');
    expect(span).toHaveAttribute('title', 'Wednesday, March 25, 2026 at 3:00 PM EDT');
  });
});
