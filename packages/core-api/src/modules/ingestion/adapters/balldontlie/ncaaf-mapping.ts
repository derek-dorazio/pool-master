/**
 * Pure mappings from BALLDONTLIE's college football responses to the provider port's shapes, for
 * the College Football Playoff (#1496). No I/O.
 *
 * PoolMaster's CFP event is one season's playoff bracket (`ncaaf-2025-cfp`, played December 2025
 * to January 2026). The vendor's games carry no postseason flag, bowl name, round or venue, so
 * the adapter names no place for any game: each game is a play with no code and its two teams, and
 * the events sync places it in the Season slot whose date window holds its kickoff (#2012), taking
 * the slot's dates only from games between two of the seeds on the event's field. The windows are the
 * schedule's own dates, held as data on each Season's slots; a game no window holds (a regular
 * season game, another bowl) is not synced. The GAME writer links a game only to the bracket
 * match whose two teams it has, and the field is the seeds the admin places, so a bowl between two
 * other schools in a playoff round's window links to nothing.
 *
 * Team ids are the provider's own (`participantFeedId`, #2040), mapped per sport league.
 */

import { Sport, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, ProviderScheduledGame, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import type { NcaafGame, NcaafTeam } from './ncaaf-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';
import { participantFeedId } from './participant-feed-id';

export const NCAAF_GAMES_PATH = '/ncaaf/v1/games';
export const NCAAF_TEAMS_PATH = '/ncaaf/v1/teams';

/**
 * The name a season's slate is listed by: the vendor names none. The events the sync makes from it
 * are each named by their competition (#2154): the College Football Playoff, the bowl games.
 */
export function ncaafSlateName(scope: CfpScope): string {
  return `College football ${String(scope.season)} season`;
}

/** One season's College Football Playoff, by the year its season starts. */
export interface CfpScope {
  season: number;
}

const SCOPE_ID_PATTERN = /^ncaaf-(\d{4})-cfp$/;

export function cfpScopeId(scope: CfpScope): string {
  return `ncaaf-${String(scope.season)}-cfp`;
}

/** The scope an event id names, or null when it names no College Football Playoff. */
export function parseCfpScope(eventId: string): CfpScope | null {
  const match = SCOPE_ID_PATTERN.exec(eventId);
  return match ? { season: Number(match[1]) } : null;
}


/** A field the document leaves optional but without which a row cannot be used. */
function required<Value>(value: Value | undefined, path: string, row: string, field: string): Value {
  if (value === undefined) {
    throw new BalldontlieContractError(path, [`${row} has no ${field}`]);
  }
  return value;
}

const gameName = (game: NcaafGame) => `game ${game.id === undefined ? '(no id)' : String(game.id)}`;

/**
 * One event for a season's games, which must be at least one: the season's whole slate, since the
 * vendor marks no playoff game. Each game is a play with no code, which the events sync places by
 * the Season slots' date windows (#2012). The slate is the season's every game, so the event is
 * complete once they all are.
 */
export function toCfpEvent(scope: CfpScope, games: readonly NcaafGame[]): SportEvent {
  const times = games.map((game) => Date.parse(required(game.date, NCAAF_GAMES_PATH, gameName(game), 'date')));
  const status = eventStatusOf(games.map((game) => PROGRESS_BY_STATE[game.status_state]), true);
  return {
    externalId: cfpScopeId(scope),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.FOOTBALL,
    name: ncaafSlateName(scope),
    startDate: new Date(Math.min(...times)),
    endDate: new Date(Math.max(...times)),
    status,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    providerSlots: games.map((game, index) => ({
      code: null,
      startsAt: new Date(times[index]),
      endsAt: new Date(times[index]),
      teams: teamFeedIdsOf(game),
      gameIds: [providerGameIdOf(game)],
    })),
  };
}

const providerGameIdOf = (game: NcaafGame) => String(required(game.id, NCAAF_GAMES_PATH, gameName(game), 'id'));

/**
 * Each game as a one-game match of a one-round event (#2154): the sync gives an event the games
 * placed in its rest-of-phase slots (a season's bowls, its conference title games), and their
 * Matches come from them. The feed names no venue, so the home team it names is the home side.
 */
export function toNcaafScheduledGames(games: readonly NcaafGame[]): ProviderScheduledGame[] {
  return games.map((game) => {
    const [homeTeamExternalId, awayTeamExternalId] = teamFeedIdsOf(game);
    return {
      games: [{ providerGameId: providerGameIdOf(game), gameNumber: 1 }],
      roundNumber: 1,
      homeTeamExternalId,
      awayTeamExternalId,
      scheduledAt: new Date(required(game.date, NCAAF_GAMES_PATH, gameName(game), 'date')),
    };
  });
}

/**
 * A game's home and visiting teams by their feed ids: a window takes its dates only from games
 * between seeds (#2012).
 */
function teamFeedIdsOf(game: NcaafGame): [home: string, visitor: string] {
  const name = gameName(game);
  return [
    participantFeedId(required(required(game.home_team, NCAAF_GAMES_PATH, name, 'home_team').id, NCAAF_GAMES_PATH, name, 'home_team.id')),
    participantFeedId(required(required(game.visitor_team, NCAAF_GAMES_PATH, name, 'visitor_team').id, NCAAF_GAMES_PATH, name, 'visitor_team.id')),
  ];
}

export function toNcaafTeamParticipant(team: NcaafTeam, path: string): ProviderParticipant {
  const id = required(team.id, path, 'a team', 'id');
  return {
    externalId: participantFeedId(id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.FOOTBALL,
    name: required(team.full_name, path, `team ${String(id)}`, 'full_name'),
    status: SportEventParticipantStatus.ACTIVE,
    metadata: {
      ...(team.abbreviation ? { abbreviation: team.abbreviation } : {}),
      ...(team.conference ? { conference: team.conference } : {}),
    },
  };
}

/**
 * The teams playing the games, each once, in the order they first appear. The event's field is the
 * seeds the admin places: an event placed by date window takes no team from its feed onto its field
 * (#1715), so these only refresh the rows already there.
 */
export function teamsOfGames(games: readonly NcaafGame[]): ProviderParticipant[] {
  const field = new Map<string, ProviderParticipant>();
  for (const game of games) {
    for (const team of [required(game.home_team, NCAAF_GAMES_PATH, gameName(game), 'home_team'), required(game.visitor_team, NCAAF_GAMES_PATH, gameName(game), 'visitor_team')]) {
      const participant = toNcaafTeamParticipant(team, NCAAF_GAMES_PATH);
      field.set(participant.externalId, participant);
    }
  }
  return [...field.values()];
}

/** Each game's teams, state and score, for the GAME live-score category. */
export function toCfpGameScoreUpdates(games: readonly NcaafGame[]): GameScoreUpdate[] {
  return games.flatMap((game) => {
    if (game.status_state === CompetitionStatusState.UNKNOWN) return [];
    const name = gameName(game);
    const home = required(required(game.home_team, NCAAF_GAMES_PATH, name, 'home_team').id, NCAAF_GAMES_PATH, name, 'home_team.id');
    const visitor = required(required(game.visitor_team, NCAAF_GAMES_PATH, name, 'visitor_team').id, NCAAF_GAMES_PATH, name, 'visitor_team.id');
    const state = GAME_STATE_BY_STATUS[game.status_state];
    // A final with no score is passed on as one, and skipped there.
    const started = hasStarted(state);
    return [{
      providerGameId: String(required(game.id, NCAAF_GAMES_PATH, name, 'id')),
      homeTeamExternalId: participantFeedId(home),
      awayTeamExternalId: participantFeedId(visitor),
      state,
      homeScore: started ? game.home_score ?? null : null,
      awayScore: started ? game.away_score ?? null : null,
    }];
  });
}
