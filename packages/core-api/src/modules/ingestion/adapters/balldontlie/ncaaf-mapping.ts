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

import { Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import type { NcaafGame, NcaafTeam } from './ncaaf-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';
import { participantFeedId } from './participant-feed-id';

export const NCAAF_GAMES_PATH = '/ncaaf/v1/games';
export const NCAAF_TEAMS_PATH = '/ncaaf/v1/teams';

/** The name the College Football Playoff's event is listed by: the vendor names none. */
export const CFP_EVENT_NAME = 'College Football Playoff';

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
export function toCfpEvent(scope: CfpScope, games: readonly NcaafGame[], participantCount?: number): SportEvent {
  const times = games.map((game) => Date.parse(required(game.date, NCAAF_GAMES_PATH, gameName(game), 'date')));
  const status = eventStatusOf(games.map((game) => PROGRESS_BY_STATE[game.status_state]), true);
  return {
    externalId: cfpScopeId(scope),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.AMERICAN_FOOTBALL,
    name: CFP_EVENT_NAME,
    startDate: new Date(Math.min(...times)),
    endDate: new Date(Math.max(...times)),
    status,
    participantCount,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    providerSlots: games.map((game, index) => ({ code: null, startsAt: new Date(times[index]), endsAt: new Date(times[index]), teams: teamFeedIdsOf(game) })),
  };
}

/** A game's two teams by their feed ids: a window takes its dates only from games between seeds (#2012). */
function teamFeedIdsOf(game: NcaafGame): string[] {
  const name = gameName(game);
  return [
    required(required(game.home_team, NCAAF_GAMES_PATH, name, 'home_team').id, NCAAF_GAMES_PATH, name, 'home_team.id'),
    required(required(game.visitor_team, NCAAF_GAMES_PATH, name, 'visitor_team').id, NCAAF_GAMES_PATH, name, 'visitor_team.id'),
  ].map(participantFeedId);
}

export function toNcaafTeamParticipant(team: NcaafTeam, path: string): ProviderParticipant {
  const id = required(team.id, path, 'a team', 'id');
  return {
    externalId: participantFeedId(id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.AMERICAN_FOOTBALL,
    name: required(team.full_name, path, `team ${String(id)}`, 'full_name'),
    active: true,
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
      externalGameId: String(required(game.id, NCAAF_GAMES_PATH, name, 'id')),
      homeTeamExternalId: participantFeedId(home),
      awayTeamExternalId: participantFeedId(visitor),
      state,
      homeScore: started ? game.home_score ?? null : null,
      awayScore: started ? game.away_score ?? null : null,
    }];
  });
}
