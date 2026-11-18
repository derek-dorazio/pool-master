import { render, screen } from '@testing-library/react';
import { MatchStatus, SportEventStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { EventScheduleChip } from './event-schedule-chip';

describe('EventScheduleChip', () => {
  it('says Postponed in gold and Cancelled in grey', () => {
    render(
      <>
        <EventScheduleChip status={SportEventStatus.POSTPONED} testId="postponed" />
        <EventScheduleChip status={SportEventStatus.CANCELLED} testId="cancelled" />
      </>,
    );

    expect(screen.getByTestId('postponed')).toHaveTextContent('Postponed');
    expect(screen.getByTestId('postponed')).toHaveClass('bg-[var(--status-warning-surface)]');
    expect(screen.getByTestId('cancelled')).toHaveTextContent('Cancelled');
    expect(screen.getByTestId('cancelled')).toHaveClass('bg-[var(--status-neutral-surface)]');
  });

  it('gives a postponed game the same gold chip as a postponed week, and nothing to a game on schedule', () => {
    render(
      <>
        <EventScheduleChip status={MatchStatus.POSTPONED} testId="postponed-game" />
        <EventScheduleChip status={MatchStatus.SCHEDULED} testId="scheduled-game" />
      </>,
    );

    expect(screen.getByTestId('postponed-game')).toHaveTextContent('Postponed');
    expect(screen.getByTestId('postponed-game')).toHaveClass('bg-[var(--status-warning-surface)]');
    expect(screen.queryByTestId('scheduled-game')).not.toBeInTheDocument();
  });

  it('shows nothing for an event on schedule', () => {
    render(<EventScheduleChip status={SportEventStatus.SCHEDULED} testId="on-schedule" />);

    expect(screen.queryByTestId('on-schedule')).not.toBeInTheDocument();
  });
});
