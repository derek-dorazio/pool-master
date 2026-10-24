import { ParticipantType, SelectionType, type Sport, TournamentFormat } from '../enums';
import { getSportDefinition } from './registry';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';
import type { SportComposite } from './sport-stats';

/**
 * What a sport league plays differently from its sport (#934), as `SportLeague` stores it: null
 * keeps the sport's. A championship stat pool league (the World Series under baseball) sets
 * both: a field of players, scored by the composite family.
 */
export interface SportLeagueOverrides {
  participantType: ParticipantType | null;
  scoringFamily: ScoringFamily | null;
}

/**
 * A sport league's definition: its sport's, with what the league overrides (#934). Every reader
 * of an event's selection types, scoring definitions, tiers or rounds reads it through here, so a
 * stat pool league of a team sport plays golf's shape rather than its sport's bracket.
 *
 * A league whose family is its sport's keeps its sport's definition, with its participant type
 * if it sets one. A league scored by `COMPOSITE` plays its sport's stat pool, which only a sport
 * with a composite has: any other family override is a broken reference row and throws.
 */
export function sportLeagueDefinitionOf(sport: Sport, overrides: SportLeagueOverrides): SportDefinition {
  const definition = getSportDefinition(sport);
  const family = overrides.scoringFamily ?? definition.scoringFamily;
  if (family === definition.scoringFamily) {
    return overrides.participantType === null ? definition : { ...definition, participantType: overrides.participantType };
  }
  if (family !== ScoringFamily.COMPOSITE || definition.composite === null) {
    throw new Error(`A ${sport} sport league cannot be scored by ${family}`);
  }
  return statPoolDefinition(definition, definition.composite, overrides.participantType ?? ParticipantType.INDIVIDUAL);
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

/**
 * A sport's championship stat pool (#932, `plans/championship-stat-pools.md` §3): golf's shape.
 * Each game is a round played by the whole field of players, as a golf tournament's rounds are
 * (so it takes golf's tournament format: every round by every participant, no matches), picked
 * by golf's roster formats and scored by the one composite definition.
 */
function statPoolDefinition(definition: SportDefinition, composite: SportComposite, participantType: ParticipantType): SportDefinition {
  return {
    sport: definition.sport,
    name: definition.name,
    participantType,
    scoringFamily: ScoringFamily.COMPOSITE,
    tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
    defaultRounds: composite.defaultGames,
    defaultTierLayout: { tierCount: 6, tierSize: 5 },
    selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
    scoringDefinitions: ['COMPOSITE_TOTAL'],
    shootout: null,
    composite,
    vocabulary: {
      participant: { one: 'player', many: 'players' },
      event: definition.vocabulary.event,
      sportLeague: definition.vocabulary.sportLeague,
      round: { one: 'game', many: 'games' },
      withdrawn: definition.vocabulary.withdrawn,
      eventStart: definition.vocabulary.eventStart,
    },
    roundLabel: (roundNumber) => `Game ${roundNumber}`,
  };
}
