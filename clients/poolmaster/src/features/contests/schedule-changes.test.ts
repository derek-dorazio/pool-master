import { SportEventStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { describeScheduleChanges } from './schedule-changes';

const formatStart = (startDate: string) => `at ${startDate}`;

describe('describeScheduleChanges', () => {
  it('says each postponed event\'s new start and each cancelled one scores nothing, in contest order, in one line', () => {
    expect(describeScheduleChanges([
      { name: 'Week 11', startDate: '2026-11-13T01:15:00.000Z', status: SportEventStatus.COMPLETED },
      { name: 'Week 12', startDate: '2026-11-25T01:15:00.000Z', status: SportEventStatus.POSTPONED },
      { name: 'Week 13', startDate: '2026-11-27T01:15:00.000Z', status: SportEventStatus.CANCELLED },
    ], formatStart)).toBe('Week 12 postponed to at 2026-11-25T01:15:00.000Z. Week 13 cancelled: no points.');
  });

  it('says nothing while every event is on schedule', () => {
    expect(describeScheduleChanges([
      { name: 'Week 12', startDate: '2026-11-25T01:15:00.000Z', status: SportEventStatus.SCHEDULED },
      { name: 'Week 13', startDate: '2026-11-27T01:15:00.000Z', status: SportEventStatus.IN_PROGRESS },
    ], formatStart)).toBeNull();
  });
});
