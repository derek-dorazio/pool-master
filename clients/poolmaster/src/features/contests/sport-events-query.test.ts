import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { apiSuccess } from '@/features/leagues/test/fixtures';
import { sportEventsQueryOptions } from './sport-events-query';
import { buildSportEvent } from './test/contest-admin-fixtures';

const listEventsMock = vi.fn();

bindApiMocks({ listEvents: listEventsMock });

afterEach(() => {
  listEventsMock.mockReset();
});

describe('sportEventsQueryOptions', () => {
  it('asks only for events that can still take a contest, so past seasons never load, and lists them soonest first', async () => {
    const later = buildSportEvent({ id: 'event-2', startDate: '2099-05-14T12:00:00.000Z' });
    const sooner = buildSportEvent({ id: 'event-1', startDate: '2099-04-09T12:40:00.000Z' });
    listEventsMock.mockResolvedValue(apiSuccess({ events: [later, sooner] }));

    const events = await sportEventsQueryOptions('GOLF', true).queryFn();

    expect(listEventsMock).toHaveBeenCalledWith(expect.objectContaining({
      query: { sport: 'GOLF', status: ['SCHEDULED', 'POSTPONED', 'IN_PROGRESS'] },
    }));
    expect(events.map((event) => event.id)).toEqual(['event-1', 'event-2']);
  });
});
