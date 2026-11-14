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

import { MatchSide, Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderBracketMatch, ProviderParticipant, ProviderScheduledGame, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import { NflSeasonType, type NflGame, type NflStanding, type NflTeam } from './nfl-contract';
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

/** Rounds of an NFL postseason: Wild Card, Divisional, Conference Championship and the Super Bowl. */
export const NFL_POSTSEASON_ROUNDS = 4;

/** Teams each conference sends to the postseason, seeded 1 to 7; the 1 seed's bye skips the Wild Card. */
export const NFL_PLAYOFF_SEEDS = 7;

/** The conferences in the bracket's order: the AFC's matches come first, and its champion is the Super Bowl's home side. */
const NFL_CONFERENCES = ['AFC', 'NFC'] as const;

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

function eventStatus(scope: NflScope, games: readonly NflGame[]): SportEvent['status'] {
  const complete = scope.kind === NflScopeKind.WEEK || games.length >= NFL_POSTSEASON_GAMES;
  return eventStatusOf(games.map((game) => PROGRESS_BY_STATE[game.status_state]), complete);
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
    // A week's games are one round; the playoffs are four.
    rounds: scope.kind === NflScopeKind.WEEK ? 1 : NFL_POSTSEASON_ROUNDS,
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

/**
 * A week's games as scheduled, each in the week's one round, for a synced league's event to take
 * its matches from (#1728). The vendor does not mark a neutral site, so none is.
 */
export function toNflScheduledGames(games: readonly NflGame[]): ProviderScheduledGame[] {
  return games.map(toNflScheduledGame);
}

function toNflScheduledGame(game: NflGame): ProviderScheduledGame {
  return {
    externalGameId: String(required(game.id, game.id, 'id')),
    roundNumber: 1,
    homeTeamExternalId: nflTeamExternalId(required(required(game.home_team, game.id, 'home_team').id, game.id, 'home_team.id')),
    awayTeamExternalId: nflTeamExternalId(required(required(game.visitor_team, game.id, 'visitor_team').id, game.id, 'visitor_team.id')),
    scheduledAt: new Date(required(game.date, game.id, 'date')),
    isNeutralSite: false,
  };
}

const STANDINGS_PATH = '/nfl/v1/standings';

/**
 * The postseason's field from a season's standings (#1728): each conference's seeds 1 to 7, each
 * team with its seed, AFC first and best seed first. A team the standings seed below 7 is left out.
 */
export function toNflPlayoffField(standings: readonly NflStanding[]): ProviderParticipant[] {
  return standings
    .flatMap((standing) => {
      const seed = standing.playoff_seed;
      if (seed === undefined || seed < 1 || seed > NFL_PLAYOFF_SEEDS || standing.team === undefined) return [];
      const participant = toNflTeamParticipant(standing.team, STANDINGS_PATH);
      return [{ ...participant, metadata: { ...participant.metadata, seed } }];
    })
    .sort((left, right) => conferenceOrder(left) - conferenceOrder(right) || seedOf(left) - seedOf(right));
}

function conferenceOrder(participant: ProviderParticipant): number {
  return NFL_CONFERENCES.findIndex((conference) => conference === participant.metadata['conference']);
}

function seedOf(participant: ProviderParticipant): number {
  return participant.metadata.seed ?? Number.MAX_SAFE_INTEGER;
}

/**
 * The NFL postseason's whole bracket from its seeded field (#1728), numbered as an admin loads it:
 * each conference's Wild Card games (2 hosts 7, 3 hosts 6, 4 hosts 5) are matches 1 to 3 for the
 * AFC and 4 to 6 for the NFC, its Divisional games 7 and 8 (AFC) and 9 and 10 (NFC) with the 1
 * seed waiting at home in the first, its Conference Championship 11 (AFC) and 12 (NFC), and the
 * Super Bowl 13 at a neutral site, the AFC champion on the home side. The NFL reseeds after the
 * Wild Card and after the Divisional round, so only the Conference Championships link on. A Wild
 * Card match takes its game's kickoff once the provider lists it. Null unless both conferences
 * have exactly the seeds 1 to 7.
 */
export function toNflPlayoffBracket(field: readonly ProviderParticipant[], games: readonly ProviderScheduledGame[]): ProviderBracketMatch[] | null {
  const conferences: Array<{ label: string; teamOfSeed: (seed: number) => string }> = [];
  for (const conference of NFL_CONFERENCES) {
    const teams = field.filter((participant) => participant.metadata['conference'] === conference);
    const bySeed = new Map(teams.map((participant) => [participant.metadata.seed, participant.externalId]));
    if (teams.length !== NFL_PLAYOFF_SEEDS || bySeed.size !== NFL_PLAYOFF_SEEDS) return null;
    conferences.push({
      label: conference,
      teamOfSeed: (seed) => {
        const team = bySeed.get(seed);
        if (team === undefined) throw new BalldontlieContractError(STANDINGS_PATH, [`the ${conference} has no ${String(seed)} seed`]);
        return team;
      },
    });
  }
  const kickoffOf = (home: string, away: string): Date | null =>
    games.find((game) => pairOf(game.homeTeamExternalId, game.awayTeamExternalId) === pairOf(home, away))?.scheduledAt ?? null;
  const wildCard = conferences.flatMap(({ label, teamOfSeed }, index) => WILD_CARD_SEEDS.map(([homeSeed, awaySeed], game) => {
    const home = teamOfSeed(homeSeed);
    const away = teamOfSeed(awaySeed);
    return bracketSlot(1 + index * 3 + game, 1, label, { homeTeamExternalId: home, awayTeamExternalId: away, scheduledAt: kickoffOf(home, away) });
  }));
  const divisional = conferences.flatMap(({ label, teamOfSeed }, index) => [
    bracketSlot(7 + index * 2, 2, label, { homeTeamExternalId: teamOfSeed(1) }),
    bracketSlot(8 + index * 2, 2, label),
  ]);
  const championships = conferences.map(({ label }, index) =>
    bracketSlot(11 + index, 3, label, { advancesTo: { matchNumber: SUPER_BOWL_MATCH, side: index === 0 ? MatchSide.HOME : MatchSide.AWAY } }));
  return [...wildCard, ...divisional, ...championships, bracketSlot(SUPER_BOWL_MATCH, NFL_POSTSEASON_ROUNDS, null, { isNeutralSite: true })];
}

/** Each conference's Wild Card games by seed, home first. */
const WILD_CARD_SEEDS = [[2, 7], [3, 6], [4, 5]] as const;

const SUPER_BOWL_MATCH = 13;

function pairOf(left: string, right: string): string {
  return [left, right].sort().join('|');
}

function bracketSlot(
  matchNumber: number,
  roundNumber: number,
  regionLabel: string | null,
  fill: Partial<Pick<ProviderBracketMatch, 'homeTeamExternalId' | 'awayTeamExternalId' | 'scheduledAt' | 'advancesTo' | 'isNeutralSite'>> = {},
): ProviderBracketMatch {
  return { matchNumber, roundNumber, homeTeamExternalId: null, awayTeamExternalId: null, isNeutralSite: false, scheduledAt: null, advancesTo: null, regionLabel, ...fill };
}

/**
 * The postseason's games with both teams decided, each in its round (#1728). The vendor numbers
 * postseason weeks with a gap before the Super Bowl, so a game's round is its week's place among
 * the weeks played so far. A game with a team the field does not have (an all-star game) is left out.
 */
export function toNflPostseasonGames(games: readonly NflGame[], fieldTeamIds: ReadonlySet<string>): ProviderScheduledGame[] {
  const decided = games.filter((game) => {
    const home = game.home_team?.id;
    const away = game.visitor_team?.id;
    return home !== undefined && away !== undefined && fieldTeamIds.has(nflTeamExternalId(home)) && fieldTeamIds.has(nflTeamExternalId(away));
  });
  const weekOf = (game: NflGame): number => required(game.week, game.id, 'week');
  const weeks = [...new Set(decided.map(weekOf))].sort((left, right) => left - right);
  return decided.map((game) => {
    const roundNumber = weeks.indexOf(weekOf(game)) + 1;
    return { ...toNflScheduledGame(game), roundNumber, isNeutralSite: roundNumber === NFL_POSTSEASON_ROUNDS };
  });
}

/** Each game's teams, state and score, for the GAME live-score category. */
export function toGameScoreUpdates(games: readonly NflGame[]): GameScoreUpdate[] {
  return games.flatMap((game) => {
    if (game.status_state === CompetitionStatusState.UNKNOWN) return [];
    const home = required(required(game.home_team, game.id, 'home_team').id, game.id, 'home_team.id');
    const visitor = required(required(game.visitor_team, game.id, 'visitor_team').id, game.id, 'visitor_team.id');
    const state = GAME_STATE_BY_STATUS[game.status_state];
    // A final with no score is passed on as one, and skipped there.
    const started = hasStarted(state);
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
