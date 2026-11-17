import { SportEventStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { contestScheduleChipStatus, describeScheduleChanges } from './schedule-changes';

const formatStart = (startDate: string) => `at ${startDate}`;

describe('describeScheduleChanges', () => {
  it('says each postponed event\'s new start and each cancelled one scores nothing, in contest order, in one line', () => {
    expect(describeScheduleChanges([
      { name: 'Week 11', startDate: '2026-11-13T01:15:00.000Z', status: SportEventStatus.COMPLETED },
      { name: 'Week 12', startDate: '2026-11-25T01:15:00.000Z', status: SportEventStatus.POSTPONED },
      { name: 'Week 13', startDate: '2026-11-27T01:15:00.000Z', status: SportEventStatus.CANCELLED },
    ], formatStart)).toBe('Week 12 postponed to at 2026-11-25T01:15:00.000Z. Week 13 cancelled: no points.');
  });

  it('names only the latest three changes and counts the earlier ones, so a long season keeps one short line', () => {
    const cancelled = (week: number) => ({ name: `Week ${String(week)}`, startDate: '2026-11-01T01:15:00.000Z', status: SportEventStatus.CANCELLED });

    expect(describeScheduleChanges([cancelled(3), cancelled(5), cancelled(8), cancelled(9), cancelled(12)], formatStart))
      .toBe('Week 8 cancelled: no points. Week 9 cancelled: no points. Week 12 cancelled: no points. Plus 2 more earlier.');
  });

  it('says nothing while every event is on schedule', () => {
    expect(describeScheduleChanges([
      { name: 'Week 12', startDate: '2026-11-25T01:15:00.000Z', status: SportEventStatus.SCHEDULED },
      { name: 'Week 13', startDate: '2026-11-27T01:15:00.000Z', status: SportEventStatus.IN_PROGRESS },
    ], formatStart)).toBeNull();
  });
});

describe('contestScheduleChipStatus', () => {
  it('chips a contest Postponed while any of its events is postponed, even beside a cancelled one', () => {
    expect(contestScheduleChipStatus([{ status: SportEventStatus.CANCELLED }, { status: SportEventStatus.POSTPONED }])).toBe(SportEventStatus.POSTPONED);
  });

  it('chips a contest Cancelled only once every event is cancelled', () => {
    expect(contestScheduleChipStatus([{ status: SportEventStatus.CANCELLED }])).toBe(SportEventStatus.CANCELLED);
    expect(contestScheduleChipStatus([{ status: SportEventStatus.CANCELLED }, { status: SportEventStatus.SCHEDULED }])).toBeNull();
  });

  it('gives no chip to a contest on schedule or with no events', () => {
    expect(contestScheduleChipStatus([{ status: SportEventStatus.SCHEDULED }])).toBeNull();
    expect(contestScheduleChipStatus([])).toBeNull();
  });
});
