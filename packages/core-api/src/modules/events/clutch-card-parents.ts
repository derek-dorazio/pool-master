/**
 * #1820 — the parent of each new Clutch Card event: the season event of its sport league's parent
 * league whose rounds it covers. The 2025 World Series Clutch Card is round 4 of the 2025 MLB
 * Postseason; the Men's Final Four round 5 of the NCAA tournament. The league names its parent
 * league and the rounds (`SportLeague.parentSportLeagueId`, `parentRoundNumbers`); the event is
 * found by its dates.
 *
 * Every creation path asks here, so every Clutch Card event created has a parent and no other
 * event has one. A Clutch Card event with no parent is refused: one the admin creates gets a 422,
 * and one a provider's sync creates is skipped until a later sweep finds its parent (the parent
 * league's own sweep creates it).
 */

import type { SportEventRepository } from '@poolmaster/shared/db';
import { isClutchCardLeague, type SportEvent, type SportEventParent, type SportLeague } from '@poolmaster/shared/domain';
import { SportEventError } from './errors';

/** How far before a Clutch Card event its season event may start: a season's playoffs never run a year. */
const SEASON_EVENT_LOOKBACK_MS = 366 * 24 * 60 * 60 * 1000;

/** One new event's parent, none for an event of any other league, or why it cannot have one. */
export type ClutchCardParentLookup =
  | { parentEvent: Omit<SportEventParent, 'name'> | undefined }
  | { refusal: SportEventError };

/**
 * The parent of each new event of the sport league, in the order of `starts`, in one read however
 * many: for a Clutch Card league, the one event of its parent league that was under way when the
 * new event starts (started by then and within the year before, not ended before) and has the
 * league's rounds. A season event whose end is not known yet counts as under way for that year. `parentEventId`
 * names the parent instead, for a caller that knows it: a test seed, whose events' dates are moved
 * and no longer line up with their parent's. An event of any other league has no parent, and naming
 * one is refused.
 */
export async function findClutchCardParents(
  sportEvents: Pick<SportEventRepository, 'findAll' | 'findById'>,
  sportLeague: SportLeague,
  starts: readonly Date[],
  options: { parentEventId?: string } = {},
): Promise<ClutchCardParentLookup[]> {
  if (!isClutchCardLeague(sportLeague)) {
    if (options.parentEventId === undefined) return starts.map(() => ({ parentEvent: undefined }));
    const refusal = new SportEventError(
      `${sportLeague.name} is not a Clutch Card league, so its events name no parent event.`,
      'PARENT_EVENT_NOT_ALLOWED',
      422,
    );
    return starts.map(() => ({ refusal }));
  }
  const parentLeagueId = sportLeague.parentSportLeagueId;
  const roundNumbers = [...sportLeague.parentRoundNumbers].sort((left, right) => left - right);
  if (parentLeagueId === null || roundNumbers.length === 0) {
    const refusal = new SportEventError(
      `${sportLeague.name} is a Clutch Card league that names no parent league and rounds, so its events cannot be linked to their season event.`,
      'CLUTCH_CARD_PARENT_NOT_CONFIGURED',
      422,
    );
    return starts.map(() => ({ refusal }));
  }
  if (starts.length === 0) return [];
  const lastRound = roundNumbers[roundNumbers.length - 1];
  const hasRounds = (event: SportEvent): boolean => (event.rounds ?? 0) >= lastRound;

  if (options.parentEventId !== undefined) {
    const named = await sportEvents.findById(options.parentEventId);
    const lookup = namedParentLookup(sportLeague, named, options.parentEventId, { parentLeagueId, roundNumbers, hasRounds });
    return starts.map(() => lookup);
  }

  const times = starts.map((start) => start.getTime());
  const candidates = (await sportEvents.findAll({
    sportLeagueId: parentLeagueId,
    startsFrom: new Date(Math.min(...times) - SEASON_EVENT_LOOKBACK_MS + 1),
    startsBefore: new Date(Math.max(...times) + 1),
  })).filter(hasRounds);
  return starts.map((start): ClutchCardParentLookup => {
    const spanning = candidates.filter((event) => event.startDate.getTime() <= start.getTime()
      && event.startDate.getTime() > start.getTime() - SEASON_EVENT_LOOKBACK_MS
      && (event.endDate === undefined || event.endDate.getTime() >= start.getTime()));
    if (spanning.length === 1) return { parentEvent: { id: spanning[0].id, roundNumbers } };
    if (spanning.length === 0) {
      return {
        refusal: new SportEventError(
          `No event of ${sportLeague.name}'s parent league with round ${lastRound} is under way on ${start.toISOString()}, so the Clutch Card event has no parent. Create the season event first.`,
          'PARENT_EVENT_NOT_FOUND',
          422,
        ),
      };
    }
    return {
      refusal: new SportEventError(
        `${spanning.length} events of ${sportLeague.name}'s parent league are under way on ${start.toISOString()} (${spanning.map((event) => event.name).join(', ')}); name the parent event.`,
        'PARENT_EVENT_AMBIGUOUS',
        422,
      ),
    };
  });
}

function namedParentLookup(
  sportLeague: SportLeague,
  named: SportEvent | null,
  parentEventId: string,
  parent: { parentLeagueId: string; roundNumbers: number[]; hasRounds: (event: SportEvent) => boolean },
): ClutchCardParentLookup {
  if (named === null) {
    return { refusal: new SportEventError(`Parent event ${parentEventId} was not found.`, 'PARENT_EVENT_NOT_FOUND', 422) };
  }
  if (named.sportLeagueId !== parent.parentLeagueId) {
    return {
      refusal: new SportEventError(
        `${named.name} is not an event of ${sportLeague.name}'s parent league, so it cannot be its Clutch Card events' parent.`,
        'PARENT_EVENT_MISMATCH',
        422,
      ),
    };
  }
  if (!parent.hasRounds(named)) {
    return {
      refusal: new SportEventError(
        `${named.name} has ${named.rounds ?? 0} round(s), and ${sportLeague.name} covers round(s) ${parent.roundNumbers.join(', ')} of it.`,
        'PARENT_EVENT_MISMATCH',
        422,
      ),
    };
  }
  return { parentEvent: { id: named.id, roundNumbers: parent.roundNumbers } };
}

/** The parent a creation must have: its lookup's, or its refusal thrown. */
export function parentOrThrow(lookup: ClutchCardParentLookup | undefined): Omit<SportEventParent, 'name'> | undefined {
  if (lookup === undefined) throw new Error('No parent lookup for a new event.');
  if ('refusal' in lookup) throw lookup.refusal;
  return lookup.parentEvent;
}
