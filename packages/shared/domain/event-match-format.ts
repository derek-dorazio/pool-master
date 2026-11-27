import { MatchFormat } from './enums';
import type { SportEventSlotDefinition } from './contest-management-types';

/**
 * Whether an event is played as games between two sides (#698, #2008): some slot it covers is
 * HEAD_TO_HEAD, its slot definition's match format being the model home of how its games are
 * played. Such an event has its matches from the feed, cannot be released until every match has
 * its teams or an earlier match to fill them, and locks its seeds at release (the upset bonus reads
 * them). A golf tournament or a race covers FIELD slots only. Whether the matches form a bracket is
 * read from their links, not from here.
 */
export function eventPlaysMatches(event: { slotDefinitions: readonly Pick<SportEventSlotDefinition, 'matchFormat'>[] }): boolean {
  return event.slotDefinitions.some((definition) => definition.matchFormat === MatchFormat.HEAD_TO_HEAD);
}
