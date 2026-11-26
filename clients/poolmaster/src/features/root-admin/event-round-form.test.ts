import { describe, expect, it } from 'vitest';
import type { SportEventRoundDto } from '@/lib/api';
import { roundScheduleRequestBody, roundScheduleValuesOf } from './event-round-form';
import { SlotKind } from '@poolmaster/shared/domain';
import { roundSlot } from '@/features/contests/test/round-slots';

const round: SportEventRoundDto = {
  id: 'round-1',
  sportEventId: 'event-1',
  roundNumber: 2,
  slot: roundSlot(SlotKind.TOURNAMENT),
  scheduledDate: '2026-11-26T17:00:00.000Z',
  scheduledEndAt: null,
  status: 'SCHEDULED',
  resultCount: 0,
  completedAt: null,
};

describe('the round schedule form', () => {
  it('shows the round\'s start in the viewer\'s zone and a blank end when it has none', () => {
    expect(roundScheduleValuesOf(round, 'America/New_York')).toEqual({ scheduledDate: '2026-11-26T12:00', scheduledEndAt: '' });
  });

  it('sends the typed start and end as instants in the viewer\'s zone', () => {
    expect(roundScheduleRequestBody(round, { scheduledDate: '2026-11-26T12:00', scheduledEndAt: '2026-11-26T18:30' }, 'America/New_York')).toEqual({
      rounds: [{ roundNumber: 2, scheduledDate: '2026-11-26T17:00:00.000Z', scheduledEndAt: '2026-11-26T23:30:00.000Z' }],
    });
  });

  it('clears a blank end, and sends a start it cannot read as typed for the server to refuse', () => {
    expect(roundScheduleRequestBody(round, { scheduledDate: 'not a time', scheduledEndAt: '' }, 'America/New_York')).toEqual({
      rounds: [{ roundNumber: 2, scheduledDate: 'not a time', scheduledEndAt: null }],
    });
  });
});
