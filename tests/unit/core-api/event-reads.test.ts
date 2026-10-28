/**
 * One fan-out's shared reads (#1199): an event's data read once for all of its contests, a read
 * that fails read again by the next contest, and each answer the contest's own to change.
 */
import type { SportEvent, SportEventMatch } from '@poolmaster/shared/domain';
import {
  readEventMatchesOnce,
  readEventsOnce,
  readMatchesOnce,
  readOncePerKey,
} from '../../../packages/core-api/src/modules/events/event-reads';

function event(id: string): SportEvent {
  return { id, name: `Event ${id}` } as SportEvent;
}

function match(sportEventId: string, matchNumber: number): SportEventMatch {
  return { id: `${sportEventId}-game-${String(matchNumber)}`, sportEventId, matchNumber } as SportEventMatch;
}

describe('fan-out event reads', () => {
  describe('readOncePerKey', () => {
    it('reads each key once and gives every later caller the same answer', async () => {
      const load = jest.fn(async (key: string) => `league ${key}`);
      const read = readOncePerKey(load);

      const answers = await Promise.all([read('a'), read('a'), read('b'), read('a')]);

      expect(answers).toEqual(['league a', 'league a', 'league b', 'league a']);
      expect(load.mock.calls).toEqual([['a'], ['b']]);
    });

    it('forgets a read that failed, so the next caller reads it again instead of sharing the failure', async () => {
      const load = jest.fn()
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockResolvedValue('league a');
      const read = readOncePerKey<string>(load);

      await expect(read('a')).rejects.toThrow('database unavailable');
      await expect(read('a')).resolves.toBe('league a');
      await expect(read('a')).resolves.toBe('league a');
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe('readEventsOnce', () => {
    it('never reads a known event, reads the rest together once, and answers in the order asked without the events not found', async () => {
      const findByIds = jest.fn(async (ids: readonly string[]) => ids.filter((id) => id !== 'gone').map(event));
      const sportEvents = readEventsOnce({ findByIds }, [event('known')]);

      await expect(sportEvents.findByIds(['b', 'known', 'a', 'gone'])).resolves.toEqual([event('b'), event('known'), event('a')]);
      await expect(sportEvents.findByIds(['a', 'b'])).resolves.toEqual([event('a'), event('b')]);
      await expect(sportEvents.findByIds(['known'])).resolves.toEqual([event('known')]);
      expect(findByIds.mock.calls).toEqual([[['b', 'a', 'gone']]]);
    });

    it('reads only the events not read yet when a later contest covers more of the season', async () => {
      const findByIds = jest.fn(async (ids: readonly string[]) => ids.map(event));
      const sportEvents = readEventsOnce({ findByIds });

      await sportEvents.findByIds(['week-1']);
      await sportEvents.findByIds(['week-1', 'week-2']);

      expect(findByIds.mock.calls).toEqual([[['week-1']], [['week-2']]]);
    });
  });

  describe('readMatchesOnce', () => {
    it('reads each event\'s matches once, and hands each caller its own copy to change', async () => {
      const findBySportEvent = jest.fn(async (sportEventId: string) => [match(sportEventId, 1), match(sportEventId, 2)]);
      const matches = readMatchesOnce({ findBySportEvent });

      const first = await matches.findBySportEvent('week-1');
      first.reverse();
      const second = await matches.findBySportEvent('week-1');

      expect(second.map((game) => game.matchNumber)).toEqual([1, 2]);
      expect(findBySportEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('readEventMatchesOnce', () => {
    it('reads the events not read yet together, by event or across events, and answers by event then match number', async () => {
      const all = [match('week-1', 1), match('week-1', 2), match('week-2', 1), match('week-3', 1)];
      const findBySportEvents = jest.fn(async (ids: readonly string[]) => all.filter((game) => ids.includes(game.sportEventId)));
      const matches = readEventMatchesOnce({ findBySportEvents });

      await expect(matches.findBySportEvent('week-2')).resolves.toEqual([match('week-2', 1)]);
      await expect(matches.findBySportEvents(['week-3', 'week-1', 'week-2'])).resolves.toEqual([
        match('week-1', 1), match('week-1', 2), match('week-2', 1), match('week-3', 1),
      ]);
      await expect(matches.findBySportEvent('week-1')).resolves.toEqual([match('week-1', 1), match('week-1', 2)]);
      expect(findBySportEvents.mock.calls).toEqual([[['week-2']], [['week-1', 'week-3']]]);
    });

    it('answers an event with no matches with none, without reading it again', async () => {
      const findBySportEvents = jest.fn(async () => [] as SportEventMatch[]);
      const matches = readEventMatchesOnce({ findBySportEvents });

      await expect(matches.findBySportEvent('golf-major')).resolves.toEqual([]);
      await expect(matches.findBySportEvent('golf-major')).resolves.toEqual([]);
      expect(findBySportEvents).toHaveBeenCalledTimes(1);
    });
  });
});
