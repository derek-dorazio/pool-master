import { SportEventStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { contestScheduleChipStatus, describeScheduleChanges } from './schedule-changes';

describe('describeScheduleChanges', () => {
  it('says each cancelled event scores nothing, in contest order, in one line, and leaves out the events on schedule', () => {
    expect(describeScheduleChanges([
      { name: 'Week 11', status: SportEventStatus.COMPLETED },
      { name: 'Week 12', status: SportEventStatus.CANCELLED },
      { name: 'Week 13', status: SportEventStatus.SCHEDULED },
      { name: 'Week 14', status: SportEventStatus.CANCELLED },
    ])).toBe('Week 12 cancelled: no points. Week 14 cancelled: no points.');
  });

  it('names only the latest three changes and counts the earlier ones, so a long season keeps one short line', () => {
    const cancelled = (week: number) => ({ name: `Week ${String(week)}`, status: SportEventStatus.CANCELLED });

    expect(describeScheduleChanges([cancelled(3), cancelled(5), cancelled(8), cancelled(9), cancelled(12)]))
      .toBe('Week 8 cancelled: no points. Week 9 cancelled: no points. Week 12 cancelled: no points. Plus 2 more earlier.');
  });

  it('says nothing while every event is on schedule', () => {
    expect(describeScheduleChanges([
      { name: 'Week 12', status: SportEventStatus.SCHEDULED },
      { name: 'Week 13', status: SportEventStatus.IN_PROGRESS },
    ])).toBeNull();
  });
});

describe('contestScheduleChipStatus', () => {
  it('chips a contest Cancelled only once every event is cancelled', () => {
    expect(contestScheduleChipStatus([{ status: SportEventStatus.CANCELLED }])).toBe(SportEventStatus.CANCELLED);
    expect(contestScheduleChipStatus([{ status: SportEventStatus.CANCELLED }, { status: SportEventStatus.SCHEDULED }])).toBeNull();
  });

  it('gives no chip to a contest on schedule or with no events', () => {
    expect(contestScheduleChipStatus([{ status: SportEventStatus.SCHEDULED }])).toBeNull();
    expect(contestScheduleChipStatus([])).toBeNull();
  });
});
