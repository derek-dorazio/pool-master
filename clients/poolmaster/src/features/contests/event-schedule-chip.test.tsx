import { render, screen } from '@testing-library/react';
import { SportEventStatus } from '@poolmaster/shared/domain';
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

  it('shows nothing for an event on schedule', () => {
    render(<EventScheduleChip status={SportEventStatus.SCHEDULED} testId="on-schedule" />);

    expect(screen.queryByTestId('on-schedule')).not.toBeInTheDocument();
  });
});
