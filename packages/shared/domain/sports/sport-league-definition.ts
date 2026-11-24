import { type ParticipantType, type Sport } from '../enums';
import { getSportDefinition } from './registry';
import type { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

/**
 * What a sport league plays differently from its sport (#934), as `SportLeague` stores it: null
 * keeps the sport's.
 */
export interface SportLeagueOverrides {
  participantType: ParticipantType | null;
  scoringFamily: ScoringFamily | null;
}

/**
 * A sport league's definition: its sport's, with what the league overrides (#934). Every reader
 * of an event's selection types, scoring definitions, tiers or rounds reads it through here.
 *
 * A league keeps its sport's definition, with its participant type if it sets one. A family
 * override that is not its sport's family is a broken reference row and throws.
 */
export function sportLeagueDefinitionOf(sport: Sport, overrides: SportLeagueOverrides): SportDefinition {
  const definition = getSportDefinition(sport);
  const family = overrides.scoringFamily ?? definition.scoringFamily;
  if (family !== definition.scoringFamily) {
    throw new Error(`A ${sport} sport league cannot be scored by ${family}`);
  }
  return overrides.participantType === null ? definition : { ...definition, participantType: overrides.participantType };
}

/** An event as its sport league's definition is read off it: its sport, and the overrides it carries (`SportEvent`). */
export interface SportLeagueEvent {
  sport: Sport;
  participantType?: ParticipantType | null;
  scoringFamily?: ScoringFamily | null;
}

/** An event's definition: its sport league's, from the overrides it carries. */
export function eventSportDefinition(event: SportLeagueEvent): SportDefinition {
  return sportLeagueDefinitionOf(event.sport, {
    participantType: event.participantType ?? null,
    scoringFamily: event.scoringFamily ?? null,
  });
}
