/**
 * Pure mappings from BALLDONTLIE's NFL responses to the provider port's shapes (#1496). No I/O.
 *
 * The vendor has games, not events, so PoolMaster's NFL events are scopes of games: one regular
 * season week (`nfl-2026-week-12`, the pick'em event) or a season's postseason
 * (`nfl-2026-postseason`, the playoff bracket). The scope id is the event's externalId, and a
 * match takes its result from the game an admin links it to.
 *
 * Team ids are prefixed (`nfl-team-12`): a provider's participant ids share one namespace across
 * its sports, and a bare number would collide with a golfer's.
 */

import { ProviderGameState, Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { NflSeasonType, NflStatusState, type NflGame, type NflTeam } from './nfl-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';

/**
 * The tour name events carry in `metadata.tour`, matched against a sport league's match keyword.
 * The NFL sport league's keyword must be set to this for its year import to find these events.
 */
export const NFL_LEAGUE_NAME = 'NFL';

/**
 * Games in a full NFL postseason: six Wild Card, four Divisional, two Conference Championship
 * and the Super Bowl. A postseason with fewer is not over, however many of its games are.
 */
export const NFL_POSTSEASON_GAMES = 13;

export const NflScopeKind = {
  WEEK: 'WEEK',
  POSTSEASON: 'POSTSEASON',
} as const;
export type NflScopeKind = (typeof NflScopeKind)[keyof typeof NflScopeKind];

/** The games one NFL event covers. */
export type NflScope =
  | { kind: typeof NflScopeKind.WEEK; season: number; week: number }
  | { kind: typeof NflScopeKind.POSTSEASON; season: number };

const SCOPE_ID_PATTERN = /^nfl-(\d{4})-(?:postseason|week-([1-9]\d?))$/;

export function nflScopeId(scope: NflScope): string {
  return scope.kind === NflScopeKind.POSTSEASON
    ? `nfl-${String(scope.season)}-postseason`
    : `nfl-${String(scope.season)}-week-${String(scope.week)}`;
}

/** The scope an event id names, or null when it names no NFL scope (a golf tournament's id, say). */
export function parseNflScope(eventId: string): NflScope | null {
  const match = SCOPE_ID_PATTERN.exec(eventId);
  if (!match) return null;
  const season = Number(match[1]);
  const week = match.at(2);
  return week === undefined
    ? { kind: NflScopeKind.POSTSEASON, season }
    : { kind: NflScopeKind.WEEK, season, week: Number(week) };
}

/** The `season_types[]` a scope's games are read with. */
export function seasonTypeOf(scope: NflScope): NflSeasonType {
  return scope.kind === NflScopeKind.POSTSEASON ? NflSeasonType.POSTSEASON : NflSeasonType.REGULAR_SEASON;
}

export function nflTeamExternalId(teamId: number): string {
  return `nfl-team-${String(teamId)}`;
}

const GAMES_PATH = '/nfl/v1/games';

/** A field the document leaves optional but without which a game cannot be placed or scored. */
function required<Value>(value: Value | undefined, gameId: number | undefined, field: string): Value {
  if (value === undefined) {
    throw new BalldontlieContractError(GAMES_PATH, [`game ${gameId === undefined ? '(no id)' : String(gameId)} has no ${field}`]);
  }
  return value;
}

/** The scope a game belongs to. */
export function scopeOfGame(game: NflGame): NflScope {
  const season = required(game.season, game.id, 'season');
  return required(game.postseason, game.id, 'postseason')
    ? { kind: NflScopeKind.POSTSEASON, season }
    : { kind: NflScopeKind.WEEK, season, week: required(game.week, game.id, 'week') };
}

/** What a game's state says about the event it is part of. */
const GameProgress = {
  NOT_STARTED: 'NOT_STARTED',
  POSTPONED: 'POSTPONED',
  LIVE: 'LIVE',
  FINAL: 'FINAL',
  CALLED_OFF: 'CALLED_OFF',
} as const;
type GameProgress = (typeof GameProgress)[keyof typeof GameProgress];

const PROGRESS_BY_STATE: Readonly<Record<NflStatusState, GameProgress>> = {
  [NflStatusState.SCHEDULED]: GameProgress.NOT_STARTED,
  // `unknown` "cannot be safely classified": such a game neither starts nor finishes its event.
  [NflStatusState.UNKNOWN]: GameProgress.NOT_STARTED,
  [NflStatusState.POSTPONED]: GameProgress.POSTPONED,
  // A delay or suspension pauses a game that has started; it resumes, so it is live.
  [NflStatusState.IN_PROGRESS]: GameProgress.LIVE,
  [NflStatusState.DELAYED]: GameProgress.LIVE,
  [NflStatusState.SUSPENDED]: GameProgress.LIVE,
  [NflStatusState.FINAL]: GameProgress.FINAL,
  [NflStatusState.CANCELED]: GameProgress.CALLED_OFF,
  [NflStatusState.ABANDONED]: GameProgress.CALLED_OFF,
};

function eventStatus(scope: NflScope, games: readonly NflGame[]): SportEvent['status'] {
  const progress = games.map((game) => PROGRESS_BY_STATE[game.status_state]);
  const done = progress.filter((each) => each === GameProgress.FINAL || each === GameProgress.CALLED_OFF).length;
  const complete = scope.kind === NflScopeKind.WEEK || games.length >= NFL_POSTSEASON_GAMES;
  if (done === games.length && complete) {
    return progress.includes(GameProgress.FINAL) ? 'COMPLETED' : 'CANCELLED';
  }
  // A game called off counts toward the end of its event, never toward its start.
  if (progress.some((each) => each === GameProgress.FINAL || each === GameProgress.LIVE)) return 'IN_PROGRESS';
  return progress.every((each) => each === GameProgress.POSTPONED) ? 'POSTPONED' : 'SCHEDULED';
}

/** One event for a scope's games, which must be at least one. */
export function toNflSportEvent(scope: NflScope, games: readonly NflGame[], participantCount?: number): SportEvent {
  const times = games.map((game) => Date.parse(required(game.date, game.id, 'date')));
  const status = eventStatus(scope, games);
  return {
    externalId: nflScopeId(scope),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.AMERICAN_FOOTBALL,
    name: scope.kind === NflScopeKind.POSTSEASON ? 'NFL Playoffs' : `NFL Week ${String(scope.week)}`,
    startDate: new Date(Math.min(...times)),
    endDate: new Date(Math.max(...times)),
    status,
    // A week's games are one round; the playoffs take the sport's own rounds.
    rounds: scope.kind === NflScopeKind.WEEK ? 1 : undefined,
    participantCount,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    metadata: { tour: NFL_LEAGUE_NAME, season: scope.season, seasonType: seasonTypeOf(scope) },
  };
}

/** Every scope the games cover, as one event each, earliest first. */
export function toNflSportEvents(games: readonly NflGame[]): SportEvent[] {
  const byScope = new Map<string, { scope: NflScope; games: NflGame[] }>();
  for (const game of games) {
    const scope = scopeOfGame(game);
    const id = nflScopeId(scope);
    const entry = byScope.get(id) ?? { scope, games: [] };
    entry.games.push(game);
    byScope.set(id, entry);
  }
  return [...byScope.values()]
    .map((entry) => toNflSportEvent(entry.scope, entry.games))
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
}

export function toNflTeamParticipant(team: NflTeam, path: string): ProviderParticipant {
  if (team.id === undefined || !team.full_name) {
    throw new BalldontlieContractError(path, [`a team has no ${team.id === undefined ? 'id' : 'full_name'}`]);
  }
  return {
    externalId: nflTeamExternalId(team.id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.AMERICAN_FOOTBALL,
    name: team.full_name,
    active: true,
    metadata: { abbreviation: team.abbreviation, conference: team.conference, division: team.division },
  };
}

/** The teams playing a scope's games, each once, in the order they first appear. */
export function toNflFieldParticipants(games: readonly NflGame[]): ProviderParticipant[] {
  const teams = new Map<string, ProviderParticipant>();
  for (const game of games) {
    for (const team of [required(game.home_team, game.id, 'home_team'), required(game.visitor_team, game.id, 'visitor_team')]) {
      const participant = toNflTeamParticipant(team, GAMES_PATH);
      teams.set(participant.externalId, participant);
    }
  }
  return [...teams.values()];
}

/** The game state each vendor state reports; `unknown` has none, and its game is left out. */
const GAME_STATE_BY_STATUS: Readonly<Record<Exclude<NflStatusState, 'unknown'>, ProviderGameState>> = {
  [NflStatusState.SCHEDULED]: ProviderGameState.SCHEDULED,
  [NflStatusState.IN_PROGRESS]: ProviderGameState.IN_PROGRESS,
  [NflStatusState.DELAYED]: ProviderGameState.IN_PROGRESS,
  [NflStatusState.SUSPENDED]: ProviderGameState.IN_PROGRESS,
  [NflStatusState.FINAL]: ProviderGameState.FINAL,
  [NflStatusState.POSTPONED]: ProviderGameState.POSTPONED,
  [NflStatusState.CANCELED]: ProviderGameState.CANCELLED,
  [NflStatusState.ABANDONED]: ProviderGameState.CANCELLED,
};

/** Each game's teams, state and score, for the GAME live-score category. */
export function toGameScoreUpdates(games: readonly NflGame[]): GameScoreUpdate[] {
  return games.flatMap((game) => {
    if (game.status_state === NflStatusState.UNKNOWN) return [];
    const home = required(required(game.home_team, game.id, 'home_team').id, game.id, 'home_team.id');
    const visitor = required(required(game.visitor_team, game.id, 'visitor_team').id, game.id, 'visitor_team.id');
    const state = GAME_STATE_BY_STATUS[game.status_state];
    // A score before kickoff means nothing; a final with no score is passed on as one, and skipped there.
    const started = state === ProviderGameState.IN_PROGRESS || state === ProviderGameState.FINAL;
    return [{
      externalGameId: String(required(game.id, game.id, 'id')),
      homeTeamExternalId: nflTeamExternalId(home),
      awayTeamExternalId: nflTeamExternalId(visitor),
      state,
      homeScore: started ? game.home_team_score ?? null : null,
      awayScore: started ? game.visitor_team_score ?? null : null,
    }];
  });
}
