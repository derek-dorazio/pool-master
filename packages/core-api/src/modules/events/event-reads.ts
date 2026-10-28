/**
 * One fan-out's shared reads (#1199). An event's transition starts, settles or reminds every
 * contest on it, and each contest would otherwise read the same matches, events, sport league and
 * tiers again: hundreds of contests on an NFL week or a major. A fan-out builds these wrappers
 * once, before its loop, so each is read once for all of its contests.
 *
 * A wrapper lives only as long as its fan-out, which writes none of what it holds, so nothing in
 * it goes stale. A read that fails is forgotten, so the next contest reads it again, as it would
 * have without the wrapper. Each answer is a fresh array, so no contest can change another's.
 */

import type { SportEventMatchRepository, SportEventRepository } from '@poolmaster/shared/db';
import type { SportEvent, SportEventMatch } from '@poolmaster/shared/domain';

/** `load`, read once per key: later calls for the key share the first call's answer. */
export function readOncePerKey<T>(load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const answers = new Map<string, Promise<T>>();
  return (key) => remember(answers, key, () => load(key));
}

/**
 * The events, each read once: an event already read, or one of `known`, is not read again, and
 * the rest are read together. Answers in the order asked, leaving out the events not found.
 */
export function readEventsOnce(
  source: Pick<SportEventRepository, 'findByIds'>,
  known: readonly SportEvent[] = [],
): Pick<SportEventRepository, 'findByIds'> {
  const answers = new Map<string, Promise<SportEvent | undefined>>(
    known.map((sportEvent) => [sportEvent.id, Promise.resolve(sportEvent)]),
  );
  return {
    findByIds: async (ids) => {
      readMissingTogether(answers, ids, async (missing) => {
        const found = new Map((await source.findByIds(missing)).map((sportEvent) => [sportEvent.id, sportEvent]));
        return (id) => found.get(id);
      });
      const sportEvents = await Promise.all(ids.map((id) => answers.get(id) ?? Promise.resolve(undefined)));
      return sportEvents.filter((sportEvent): sportEvent is SportEvent => sportEvent !== undefined);
    },
  };
}

/** Each event's matches, read once, however many contests ask for them. */
export function readMatchesOnce(
  source: Pick<SportEventMatchRepository, 'findBySportEvent'>,
): Pick<SportEventMatchRepository, 'findBySportEvent'> {
  const bySportEvent = readOncePerKey((sportEventId) => source.findBySportEvent(sportEventId));
  return { findBySportEvent: async (sportEventId) => [...await bySportEvent(sportEventId)] };
}

/**
 * Each event's matches, read once, by event or across events: the events not read yet are read
 * together. Answers as the repository does, by event and then in match-number order.
 */
export function readEventMatchesOnce(
  source: Pick<SportEventMatchRepository, 'findBySportEvents'>,
): Pick<SportEventMatchRepository, 'findBySportEvent' | 'findBySportEvents'> {
  const answers = new Map<string, Promise<SportEventMatch[]>>();
  const findBySportEvents = async (ids: readonly string[]): Promise<SportEventMatch[]> => {
    const sportEventIds = [...new Set(ids)].sort();
    readMissingTogether(answers, sportEventIds, async (missing) => {
      const matches = await source.findBySportEvents(missing);
      return (id) => matches.filter((match) => match.sportEventId === id);
    });
    return (await Promise.all(sportEventIds.map((id) => answers.get(id) ?? Promise.resolve([])))).flat();
  };
  return { findBySportEvent: (sportEventId) => findBySportEvents([sportEventId]), findBySportEvents };
}

function remember<T>(answers: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const known = answers.get(key);
  if (known) return known;
  const answer = load();
  answers.set(key, answer);
  answer.catch(() => answers.delete(key));
  return answer;
}

/** Reads the keys not answered yet in one call, and records each one's share of it. */
function readMissingTogether<T>(
  answers: Map<string, Promise<T>>,
  keys: readonly string[],
  load: (missing: string[]) => Promise<(key: string) => T>,
): void {
  const missing = [...new Set(keys)].filter((key) => !answers.has(key));
  if (missing.length === 0) return;
  const read = load(missing);
  for (const key of missing) void remember(answers, key, async () => (await read)(key));
}
