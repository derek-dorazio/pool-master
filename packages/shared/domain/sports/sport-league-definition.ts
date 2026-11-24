import { type ParticipantType, type Sport } from '../enums';
import { getSportDefinition } from './registry';
import type { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

/**
 * What only a sport league says about its play, as `SportLeague` stores it (#2001): who competes
 * in its events and how they are scored. Every league sets both; the sport registry carries
 * neither, so the league row is the one place each fact lives.
 */
export interface SportLeaguePlay {
  participantType: ParticipantType;
  scoringFamily: ScoringFamily;
}

/** A sport league's definition: its sport's, with who competes and how it is scored. */
export type SportLeagueDefinition = SportDefinition & SportLeaguePlay;

/**
 * A sport league's definition (#934, #2001). Every reader of an event's selection types, scoring
 * definitions, tiers or rounds reads it through here.
 */
export function sportLeagueDefinitionOf(sport: Sport, play: SportLeaguePlay): SportLeagueDefinition {
  return { ...getSportDefinition(sport), participantType: play.participantType, scoringFamily: play.scoringFamily };
}

/** An event as its sport league's definition is read off it: its sport, and its league's play (`SportEvent`). */
export interface SportLeagueEvent extends SportLeaguePlay {
  sport: Sport;
}

/** An event's definition: its sport league's, from the play it carries. */
export function eventSportDefinition(event: SportLeagueEvent): SportLeagueDefinition {
  return sportLeagueDefinitionOf(event.sport, event);
}
