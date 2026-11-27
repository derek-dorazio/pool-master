/**
 * The shared event reads (#1748): one event's games and its field, each read once per event and
 * refused with the API's error when the response carries no data.
 */
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { eventFieldQueryOptions, eventGamesQueryOptions } from './use-event-games';

const { getEventBracketMock, listEventParticipantsMock } = vi.hoisted(() => ({
  getEventBracketMock: vi.fn(),
  listEventParticipantsMock: vi.fn(),
}));

bindApiMocks({
  getEventBracket: getEventBracketMock,
  listEventParticipants: listEventParticipantsMock,
});

describe('the shared event reads', () => {
  it('answers an event\'s games and its field as the API sends them', async () => {
    getEventBracketMock.mockResolvedValue({ data: { matches: [{ id: 'match-1' }] } });
    listEventParticipantsMock.mockResolvedValue({ data: { participants: [{ id: 'entrant-1' }] } });

    await expect(eventGamesQueryOptions('event-1').queryFn()).resolves.toEqual([{ id: 'match-1' }]);
    await expect(eventFieldQueryOptions('event-1').queryFn()).resolves.toEqual([{ id: 'entrant-1' }]);
  });

  it('refuses a games or field response with no data, so the page shows the read failed instead of an empty event', async () => {
    getEventBracketMock.mockResolvedValue({ error: { code: 'INTERNAL', message: 'down' } });
    listEventParticipantsMock.mockResolvedValue({ error: { code: 'INTERNAL', message: 'down' } });

    await expect(eventGamesQueryOptions('event-1').queryFn()).rejects.toThrow();
    await expect(eventFieldQueryOptions('event-1').queryFn()).rejects.toThrow();
  });

  it('reads nothing until an event is chosen', () => {
    expect([eventGamesQueryOptions('').enabled, eventFieldQueryOptions('').enabled, eventGamesQueryOptions('event-1').enabled]).toEqual([false, false, true]);
  });
});
