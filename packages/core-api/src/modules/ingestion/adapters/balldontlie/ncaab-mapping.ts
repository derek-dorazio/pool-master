/**
 * Pure mappings from BALLDONTLIE's NCAA men's basketball responses to the provider port's shapes
 * (#1496). No I/O.
 *
 * PoolMaster's event is one season's tournament (`ncaab-2025-tournament`, played in March and
 * April 2026), read from the vendor's bracket: its games, their regions, the teams' seeds and
 * scores. The scope id is the event's externalId, as an NFL scope's is. The season is the year
 * the season starts, as the vendor numbers it.
 *
 * The First Four is the vendor's round 1. PoolMaster's bracket starts at the round of 64, with
 * each First Four pairing one play-in place an admin fills with its winner. So First Four games
 * carry no score here, since no match is theirs, and their teams are left out of the field
 * before and after they play: the play-in place stands for them.
 *
 * Team ids are prefixed (`ncaab-team-150`), as the NFL's are, so they cannot collide with
 * another sport's.
 */

import { Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import { NcaabBracketRound, type NcaabBracketGame, type NcaabBracketTeam, type NcaabTeam } from './ncaab-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';

/**
 * The tour name events carry in `metadata.tour`, matched against a sport league's match keyword.
 * Basketball's NCAA Division I Men sport league's keyword is set to this by migration.
 */
export const NCAAB_LEAGUE_NAME = 'NCAAM';

/** The rounds of PoolMaster's bracket: the round of 64 to the championship. */
export const NCAAB_TOURNAMENT_ROUNDS = NcaabBracketRound.CHAMPIONSHIP - NcaabBracketRound.FIRST_FOUR;

export const BRACKET_PATH = '/ncaab/v1/bracket';
export const TEAMS_PATH = '/ncaab/v1/teams';

/** One season's men's tournament. */
export interface NcaabScope {
  season: number;
}

const SCOPE_ID_PATTERN = /^ncaab-(\d{4})-tournament$/;

export function ncaabScopeId(scope: NcaabScope): string {
  return `ncaab-${String(scope.season)}-tournament`;
}

/** The scope an event id names, or null when it names no NCAA men's tournament. */
export function parseNcaabScope(eventId: string): NcaabScope | null {
  const match = SCOPE_ID_PATTERN.exec(eventId);
  return match ? { season: Number(match[1]) } : null;
}

export function ncaabTeamExternalId(teamId: number): string {
  return `ncaab-team-${String(teamId)}`;
}

/** A field the document leaves optional but without which a row cannot be used. */
function required<Value>(value: Value | null | undefined, path: string, row: string, field: string): Value {
  if (value === undefined || value === null) {
    throw new BalldontlieContractError(path, [`${row} has no ${field}`]);
  }
  return value;
}

const gameName = (game: NcaabBracketGame) => `bracket game ${game.game_id === undefined || game.game_id === null ? '(no game id)' : String(game.game_id)}`;

/**
 * One event for a season's bracket, which must hold at least one game with a date. The
 * tournament is over once the bracket lists its championship and every game is done.
 */
export function toNcaabSportEvent(scope: NcaabScope, games: readonly NcaabBracketGame[], participantCount?: number): SportEvent {
  const times = games.flatMap((game) => (game.date ? [Date.parse(game.date)] : []));
  if (times.length === 0) {
    throw new BalldontlieContractError(BRACKET_PATH, [`the ${String(scope.season)} bracket has no game with a date`]);
  }
  const complete = games.some((game) => game.round === NcaabBracketRound.CHAMPIONSHIP);
  const status = eventStatusOf(games.map((game) => PROGRESS_BY_STATE[game.status_state]), complete);
  return {
    externalId: ncaabScopeId(scope),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.BASKETBALL,
    name: 'NCAA Men\'s Tournament',
    startDate: new Date(Math.min(...times)),
    endDate: new Date(Math.max(...times)),
    status,
    rounds: NCAAB_TOURNAMENT_ROUNDS,
    participantCount,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    metadata: { tour: NCAAB_LEAGUE_NAME, season: scope.season },
  };
}

export function toNcaabTeamParticipant(team: NcaabTeam): ProviderParticipant {
  const id = required(team.id, TEAMS_PATH, 'a team', 'id');
  return {
    externalId: ncaabTeamExternalId(id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.BASKETBALL,
    name: required(team.full_name, TEAMS_PATH, `team ${String(id)}`, 'full_name'),
    active: true,
    metadata: { abbreviation: team.abbreviation ?? undefined },
  };
}

/** A bracket side's team once it is decided: its id and seed, or null while it is to be decided. */
function decidedTeam(team: NcaabBracketTeam | null | undefined): (NcaabBracketTeam & { id: number }) | null {
  return team?.id === undefined || team.id === null ? null : { ...team, id: team.id };
}

/**
 * The teams in a season's bracket, each once, in the order they first appear, with their seed.
 * A side still to be decided names no team yet. A team that plays in the First Four is left out
 * in every round, its winner too: the admin's play-in place stands for it, and a row of its own
 * beside that place would make the place unfillable.
 */
export function toNcaabFieldParticipants(games: readonly NcaabBracketGame[]): ProviderParticipant[] {
  const playIn = new Set(games
    .filter((game) => game.round === NcaabBracketRound.FIRST_FOUR)
    .flatMap((game) => [decidedTeam(game.home_team)?.id, decidedTeam(game.away_team)?.id]));
  const teams = new Map<string, ProviderParticipant>();
  for (const game of games) {
    for (const side of [game.home_team, game.away_team]) {
      const team = decidedTeam(side);
      if (!team || playIn.has(team.id)) continue;
      const externalId = ncaabTeamExternalId(team.id);
      if (teams.has(externalId)) continue;
      const seed = team.seed ? Number.parseInt(team.seed, 10) : Number.NaN;
      teams.set(externalId, {
        externalId,
        providerId: BALLDONTLIE_PROVIDER_ID,
        sport: Sport.BASKETBALL,
        name: team.full_name ?? required(team.name, BRACKET_PATH, `a team of ${gameName(game)}`, 'name'),
        active: true,
        metadata: Number.isInteger(seed) ? { seed } : {},
      });
    }
  }
  return [...teams.values()];
}

/**
 * Each bracket game's teams, state and score, for the GAME live-score category: every game from
 * the round of 64 on whose two teams are decided. A game whose state the vendor calls `unknown`
 * is left out.
 */
export function toNcaabGameScoreUpdates(games: readonly NcaabBracketGame[]): GameScoreUpdate[] {
  return games.flatMap((game) => {
    const home = decidedTeam(game.home_team);
    const away = decidedTeam(game.away_team);
    if (game.status_state === CompetitionStatusState.UNKNOWN || !home || !away) return [];
    if (required(game.round, BRACKET_PATH, gameName(game), 'round') < NcaabBracketRound.ROUND_OF_64) return [];
    const state = GAME_STATE_BY_STATUS[game.status_state];
    const started = hasStarted(state);
    return [{
      externalGameId: String(required(game.game_id, BRACKET_PATH, 'a bracket game with both teams', 'game_id')),
      homeTeamExternalId: ncaabTeamExternalId(home.id),
      awayTeamExternalId: ncaabTeamExternalId(away.id),
      state,
      homeScore: started ? home.score ?? null : null,
      awayScore: started ? away.score ?? null : null,
    }];
  });
}
