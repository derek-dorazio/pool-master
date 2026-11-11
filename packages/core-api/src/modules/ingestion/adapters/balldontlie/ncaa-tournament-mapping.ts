/**
 * Pure mappings from BALLDONTLIE's NCAA basketball tournament responses, men's and women's, to
 * the provider port's shapes (#1496). No I/O.
 *
 * PoolMaster's event is one season's tournament (`ncaab-2025-tournament` for the men's,
 * `ncaaw-2025-tournament` for the women's, played in March and April 2026), read from the
 * vendor's bracket: its games, the teams' seeds and scores. The scope id is the event's
 * externalId, as an NFL scope's is. The season is the year the season starts, as the vendor
 * numbers it.
 *
 * The two brackets number their rounds differently (the men's First Four is round 1, the
 * women's round 0), so each league names its own. PoolMaster's bracket starts at the round of
 * 64, with each First Four pairing one play-in place an admin fills with its winner. So First
 * Four games carry no score here, since no match is theirs, and their teams are left out of the
 * field before and after they play: the play-in place stands for them.
 *
 * Team ids are prefixed by league (`ncaab-team-150`, `ncaaw-team-150`): the vendor numbers each
 * league's teams on its own, and a bare number would collide with another sport's. Each team
 * carries its league's keyword in `metadata.tour`, so a school's men's and women's teams, which
 * share a name, each link to the site's own.
 */

import { Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import type { NcaaBracketGame, NcaaBracketTeam, NcaaTeam } from './ncaa-tournament-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';

/** One of the vendor's NCAA basketball leagues and how its bracket numbers its rounds. */
export interface NcaaTournamentLeague {
  /** The vendor's path segment (`/ncaab/v1/...`), and the prefix of its scope and team ids. */
  key: 'ncaab' | 'ncaaw';
  eventName: string;
  /**
   * The tour name its events and teams carry in `metadata.tour`, matched against a sport
   * league's match keyword. Basketball's NCAA Division I sport leagues are given these by
   * migration.
   */
  tour: string;
  firstFourRound: number;
  championshipRound: number;
}

export const NCAA_MEN: NcaaTournamentLeague = {
  key: 'ncaab',
  eventName: 'NCAA Men\'s Tournament',
  tour: 'NCAAM',
  firstFourRound: 1,
  championshipRound: 7,
};

export const NCAA_WOMEN: NcaaTournamentLeague = {
  key: 'ncaaw',
  eventName: 'NCAA Women\'s Tournament',
  tour: 'NCAAW',
  firstFourRound: 0,
  championshipRound: 6,
};

export const NCAA_TOURNAMENT_LEAGUES: readonly NcaaTournamentLeague[] = [NCAA_MEN, NCAA_WOMEN];

/** The rounds of PoolMaster's bracket: the round of 64 to the championship. */
export function tournamentRoundsOf(league: NcaaTournamentLeague): number {
  return league.championshipRound - league.firstFourRound;
}

export const bracketPathOf = (league: NcaaTournamentLeague) => `/${league.key}/v1/bracket`;
export const teamsPathOf = (league: NcaaTournamentLeague) => `/${league.key}/v1/teams`;

/** One season's tournament in one league. */
export interface NcaaTournamentScope {
  league: NcaaTournamentLeague;
  season: number;
}

const SCOPE_ID_PATTERN = /^(ncaab|ncaaw)-(\d{4})-tournament$/;

export function ncaaTournamentScopeId(scope: NcaaTournamentScope): string {
  return `${scope.league.key}-${String(scope.season)}-tournament`;
}

/** The scope an event id names, or null when it names no NCAA tournament. */
export function parseNcaaTournamentScope(eventId: string): NcaaTournamentScope | null {
  const match = SCOPE_ID_PATTERN.exec(eventId);
  const league = match && NCAA_TOURNAMENT_LEAGUES.find((each) => each.key === match[1]);
  return match && league ? { league, season: Number(match[2]) } : null;
}

export function ncaaTeamExternalId(league: NcaaTournamentLeague, teamId: number): string {
  return `${league.key}-team-${String(teamId)}`;
}

/** A field the document leaves optional but without which a row cannot be used. */
function required<Value>(value: Value | null | undefined, path: string, row: string, field: string): Value {
  if (value === undefined || value === null) {
    throw new BalldontlieContractError(path, [`${row} has no ${field}`]);
  }
  return value;
}

const gameName = (game: NcaaBracketGame) => `bracket game ${game.game_id === undefined || game.game_id === null ? '(no game id)' : String(game.game_id)}`;

/**
 * One event for a season's bracket, which must hold at least one game with a date. The
 * tournament is over once the bracket lists its championship and every game is done.
 */
export function toNcaaTournamentEvent(scope: NcaaTournamentScope, games: readonly NcaaBracketGame[], participantCount?: number): SportEvent {
  const { league } = scope;
  const times = games.flatMap((game) => (game.date ? [Date.parse(game.date)] : []));
  if (times.length === 0) {
    throw new BalldontlieContractError(bracketPathOf(league), [`the ${String(scope.season)} bracket has no game with a date`]);
  }
  const complete = games.some((game) => game.round === league.championshipRound);
  const status = eventStatusOf(games.map((game) => PROGRESS_BY_STATE[game.status_state]), complete);
  return {
    externalId: ncaaTournamentScopeId(scope),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.BASKETBALL,
    name: league.eventName,
    startDate: new Date(Math.min(...times)),
    endDate: new Date(Math.max(...times)),
    status,
    rounds: tournamentRoundsOf(league),
    participantCount,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    metadata: { tour: league.tour, season: scope.season },
  };
}

export function toNcaaTeamParticipant(league: NcaaTournamentLeague, team: NcaaTeam): ProviderParticipant {
  const path = teamsPathOf(league);
  const id = required(team.id, path, 'a team', 'id');
  return {
    externalId: ncaaTeamExternalId(league, id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.BASKETBALL,
    name: required(team.full_name, path, `team ${String(id)}`, 'full_name'),
    active: true,
    metadata: { tour: league.tour, ...(team.abbreviation ? { abbreviation: team.abbreviation } : {}) },
  };
}

/** A bracket side's team once it is decided: its id and seed, or null while it is to be decided. */
function decidedTeam(team: NcaaBracketTeam | null | undefined): (NcaaBracketTeam & { id: number }) | null {
  return team?.id === undefined || team.id === null ? null : { ...team, id: team.id };
}

/**
 * The teams in a season's bracket, each once, in the order they first appear, with their seed.
 * A side still to be decided names no team yet. A team that plays in the First Four is left out
 * in every round, its winner too: the admin's play-in place stands for it, and a row of its own
 * beside that place would make the place unfillable.
 */
export function toNcaaFieldParticipants(league: NcaaTournamentLeague, games: readonly NcaaBracketGame[]): ProviderParticipant[] {
  const playIn = new Set(games
    .filter((game) => game.round === league.firstFourRound)
    .flatMap((game) => [decidedTeam(game.home_team)?.id, decidedTeam(game.away_team)?.id]));
  const teams = new Map<string, ProviderParticipant>();
  for (const game of games) {
    for (const side of [game.home_team, game.away_team]) {
      const team = decidedTeam(side);
      if (!team || playIn.has(team.id)) continue;
      const externalId = ncaaTeamExternalId(league, team.id);
      if (teams.has(externalId)) continue;
      const seed = team.seed ? Number.parseInt(team.seed, 10) : Number.NaN;
      teams.set(externalId, {
        externalId,
        providerId: BALLDONTLIE_PROVIDER_ID,
        sport: Sport.BASKETBALL,
        name: team.full_name ?? required(team.name, bracketPathOf(league), `a team of ${gameName(game)}`, 'name'),
        active: true,
        metadata: { tour: league.tour, ...(Number.isInteger(seed) ? { seed } : {}) },
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
export function toNcaaGameScoreUpdates(league: NcaaTournamentLeague, games: readonly NcaaBracketGame[]): GameScoreUpdate[] {
  const path = bracketPathOf(league);
  return games.flatMap((game) => {
    const home = decidedTeam(game.home_team);
    const away = decidedTeam(game.away_team);
    if (game.status_state === CompetitionStatusState.UNKNOWN || !home || !away) return [];
    if (required(game.round, path, gameName(game), 'round') <= league.firstFourRound) return [];
    const state = GAME_STATE_BY_STATUS[game.status_state];
    const started = hasStarted(state);
    return [{
      externalGameId: String(required(game.game_id, path, 'a bracket game with both teams', 'game_id')),
      homeTeamExternalId: ncaaTeamExternalId(league, home.id),
      awayTeamExternalId: ncaaTeamExternalId(league, away.id),
      state,
      homeScore: started ? home.score ?? null : null,
      awayScore: started ? away.score ?? null : null,
    }];
  });
}
