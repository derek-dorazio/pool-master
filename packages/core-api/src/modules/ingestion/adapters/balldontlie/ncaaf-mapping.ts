/**
 * Pure mappings from BALLDONTLIE's college football responses to the provider port's shapes, for
 * the College Football Playoff (#1496). No I/O.
 *
 * PoolMaster's CFP event is one season's playoff bracket (`ncaaf-2025-cfp`, played December 2025
 * to January 2026). The vendor's games carry no postseason flag, bowl name or venue, so the
 * playoff's games are found by date instead: `CFP_LEAGUE.window` (Derek, 2026-11-13, to be backed
 * out if the real feed turns out to mark playoff games). The window holds every bowl game too;
 * the GAME writer links a game only to the bracket match whose two teams it has, so a bowl
 * between two other schools links to nothing.
 *
 * The window opens after conference championship Saturday on purpose: a title game can pair two
 * playoff teams (2025: Indiana v Ohio State, the Big Ten title), and read with the bracket it
 * would link to the later playoff match between the same two teams.
 *
 * Team ids are prefixed (`ncaaf-team-12`): a bare number would collide with another sport's.
 * Each team carries the league's keyword in `metadata.tour`, so it links by name only to the
 * site's teams in the College Football Playoff league.
 */

import { Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import type { NcaafGame, NcaafTeam } from './ncaaf-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';

export const NCAAF_GAMES_PATH = '/ncaaf/v1/games';
export const NCAAF_TEAMS_PATH = '/ncaaf/v1/teams';

/** The span of time a season's playoff games are read from: `from` inclusive, `to` exclusive. */
export interface GameWindow {
  from: Date;
  to: Date;
}

const DECEMBER = 11;
const SATURDAY = 6;
/**
 * The hour (UTC) on the Sunday after championship Saturday that the window opens. A Saturday
 * night kickoff anywhere in the US, Hawaii's included, starts before it: the 2025 Big Ten title
 * game kicked off at 8 PM Eastern, which is 01:00 UTC on the Sunday.
 */
const WINDOW_OPENS_UTC_HOUR = 12;

/**
 * The games of one season's College Football Playoff: from the day after the first Saturday of
 * December (conference championship day) through January 31 of the next year. A rule, not stored
 * data, kept here so it can be backed out in one place once a key shows whether the vendor marks
 * playoff games.
 */
export function cfpGameWindow(season: number): GameWindow {
  const firstOfDecember = new Date(Date.UTC(season, DECEMBER, 1));
  const firstSaturday = 1 + ((SATURDAY - firstOfDecember.getUTCDay() + 7) % 7);
  return {
    from: new Date(Date.UTC(season, DECEMBER, firstSaturday + 1, WINDOW_OPENS_UTC_HOUR)),
    // Through January 31 in every US time zone: noon UTC on February 1 is early morning there.
    to: new Date(Date.UTC(season + 1, 1, 1, WINDOW_OPENS_UTC_HOUR)),
  };
}

/** The College Football Playoff's settings, in one place. */
export const CFP_LEAGUE = {
  /**
   * The tour name events and teams carry in `metadata.tour`, matched against a sport league's
   * match keyword. The College Football Playoff sport league is given it by migration.
   */
  tour: 'CFP',
  eventName: 'College Football Playoff',
  window: cfpGameWindow,
} as const;

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

export function ncaafTeamExternalId(teamId: number): string {
  return `ncaaf-team-${String(teamId)}`;
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
 * The games inside the season's window, whatever the date filter sent let through: the vendor's
 * `start_date` is a calendar date, and its time zone is not documented.
 */
export function cfpGamesOf(scope: CfpScope, games: readonly NcaafGame[]): NcaafGame[] {
  const { from, to } = CFP_LEAGUE.window(scope.season);
  return games.filter((game) => {
    const kickoff = Date.parse(required(game.date, NCAAF_GAMES_PATH, gameName(game), 'date'));
    return kickoff >= from.getTime() && kickoff < to.getTime();
  });
}

/**
 * One event for a season's playoff games, which must be at least one. The window holds bowls the
 * bracket does not play and names no game as the last, so the event is complete only once the
 * window has closed (`windowClosed`) and every game in it is done.
 */
export function toCfpEvent(scope: CfpScope, games: readonly NcaafGame[], windowClosed: boolean, participantCount?: number): SportEvent {
  const times = games.map((game) => Date.parse(required(game.date, NCAAF_GAMES_PATH, gameName(game), 'date')));
  const status = eventStatusOf(games.map((game) => PROGRESS_BY_STATE[game.status_state]), windowClosed);
  return {
    externalId: cfpScopeId(scope),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.AMERICAN_FOOTBALL,
    name: CFP_LEAGUE.eventName,
    startDate: new Date(Math.min(...times)),
    endDate: new Date(Math.max(...times)),
    status,
    participantCount,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    metadata: { tour: CFP_LEAGUE.tour, season: scope.season },
  };
}

export function toNcaafTeamParticipant(team: NcaafTeam, path: string): ProviderParticipant {
  const id = required(team.id, path, 'a team', 'id');
  return {
    externalId: ncaafTeamExternalId(id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.AMERICAN_FOOTBALL,
    name: required(team.full_name, path, `team ${String(id)}`, 'full_name'),
    active: true,
    metadata: {
      tour: CFP_LEAGUE.tour,
      ...(team.abbreviation ? { abbreviation: team.abbreviation } : {}),
      ...(team.conference ? { conference: team.conference } : {}),
    },
  };
}

/** The teams playing the window's games, each once, in the order they first appear. */
export function toCfpFieldParticipants(games: readonly NcaafGame[]): ProviderParticipant[] {
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
      homeTeamExternalId: ncaafTeamExternalId(home),
      awayTeamExternalId: ncaafTeamExternalId(visitor),
      state,
      homeScore: started ? game.home_score ?? null : null,
      awayScore: started ? game.away_score ?? null : null,
    }];
  });
}
