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
 * 64, with each First Four pairing one play-in place filled with its winner. So First Four games
 * carry no score here, since no match is theirs, and their teams are left out of the field before
 * and after they play: the play-in place stands for them. Once a First Four game is final, its
 * winner's round of 64 game names it (`playInWinnerTeamExternalId`), and that game fills the place
 * (#1571).
 *
 * Team ids are the provider's own (`participantFeedId`, #2040): the vendor numbers each league's
 * teams on its own, and a mapping is kept per sport league. Each team
 * carries its league's keyword in `metadata.tour`, so a school's men's and women's teams, which
 * share a name, each link to the site's own. Where the site keeps one row for the school,
 * affiliated with both leagues (as a sport data file loads it), that row takes both links.
 */

import { MatchSide, Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderBracketMatch, ProviderParticipant, ProviderScheduledGame, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import type { NcaaBracketGame, NcaaBracketTeam, NcaaTeam } from './ncaa-tournament-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';
import { participantFeedId } from './participant-feed-id';

/** One of the vendor's NCAA basketball leagues and how its bracket numbers its rounds. */
export interface NcaaTournamentLeague {
  /** The vendor's path segment (`/ncaab/v1/...`), and the prefix of its scope and team ids. */
  key: 'ncaab' | 'ncaaw';
  eventName: string;
  /**
   * The tour name its teams carry in `metadata.tour`, for display; a sport league
   * finds them by their provider league code (#1997).
   */
  tour: string;
  firstFourRound: number;
  championshipRound: number;
  /**
   * Whether its bracket names each game's region (`region_id`, `region_label`). The men's does;
   * the women's document has no region, so its bracket's shape cannot be read (#1728).
   */
  bracketRegions: boolean;
}

export const NCAA_MEN: NcaaTournamentLeague = {
  key: 'ncaab',
  eventName: 'NCAA Men\'s Tournament',
  tour: 'NCAAM',
  firstFourRound: 1,
  championshipRound: 7,
  bracketRegions: true,
};

export const NCAA_WOMEN: NcaaTournamentLeague = {
  key: 'ncaaw',
  eventName: 'NCAA Women\'s Tournament',
  tour: 'NCAAW',
  firstFourRound: 0,
  championshipRound: 6,
  bracketRegions: false,
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

const SCOPE_ID_PATTERN = new RegExp(`^(${NCAA_TOURNAMENT_LEAGUES.map((league) => league.key).join('|')})-(\\d{4})-tournament$`);

export function ncaaTournamentScopeId(scope: NcaaTournamentScope): string {
  return `${scope.league.key}-${String(scope.season)}-tournament`;
}

/** The scope an event id names, or null when it names no NCAA tournament. */
export function parseNcaaTournamentScope(eventId: string): NcaaTournamentScope | null {
  const match = SCOPE_ID_PATTERN.exec(eventId);
  const league = match && NCAA_TOURNAMENT_LEAGUES.find((each) => each.key === match[1]);
  return match && league ? { league, season: Number(match[2]) } : null;
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
  };
}

export function toNcaaTeamParticipant(league: NcaaTournamentLeague, team: NcaaTeam): ProviderParticipant {
  const path = teamsPathOf(league);
  const id = required(team.id, path, 'a team', 'id');
  return {
    externalId: participantFeedId(id),
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
      const externalId = participantFeedId(team.id);
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
 * the round of 64 on whose two teams are decided. A First Four winner's round of 64 game names
 * that team as the play-in place's (`playInWinnerTeamExternalId`), the place it fills. A game whose
 * state the vendor calls `unknown` is left out.
 */
export function toNcaaGameScoreUpdates(league: NcaaTournamentLeague, games: readonly NcaaBracketGame[]): GameScoreUpdate[] {
  const path = bracketPathOf(league);
  const playInWinners = new Set(games.flatMap((game) => {
    if (game.round !== league.firstFourRound || game.status_state !== CompetitionStatusState.FINAL) return [];
    const home = decidedTeam(game.home_team);
    const away = decidedTeam(game.away_team);
    if (!home || !away || home.score === undefined || home.score === null || away.score === undefined || away.score === null || home.score === away.score) return [];
    return [home.score > away.score ? home.id : away.id];
  }));
  return games.flatMap((game) => {
    const home = decidedTeam(game.home_team);
    const away = decidedTeam(game.away_team);
    if (game.status_state === CompetitionStatusState.UNKNOWN || !home || !away) return [];
    if (required(game.round, path, gameName(game), 'round') <= league.firstFourRound) return [];
    const state = GAME_STATE_BY_STATUS[game.status_state];
    const started = hasStarted(state);
    // Only its round of 64 game: in a later round the place is long filled and the winner is a team like any other.
    const playInWinner = game.round === league.firstFourRound + 1 ? [home, away].find((team) => playInWinners.has(team.id)) : undefined;
    return [{
      externalGameId: String(required(game.game_id, path, 'a bracket game with both teams', 'game_id')),
      homeTeamExternalId: participantFeedId(home.id),
      awayTeamExternalId: participantFeedId(away.id),
      state,
      homeScore: started ? home.score ?? null : null,
      awayScore: started ? away.score ?? null : null,
      ...(playInWinner ? { playInWinnerTeamExternalId: participantFeedId(playInWinner.id) } : {}),
    }];
  });
}

/** The seed of a decided bracket side, or null when the vendor gives none. */
function seedOf(team: NcaaBracketTeam): number | null {
  const seed = team.seed ? Number.parseInt(team.seed, 10) : Number.NaN;
  return Number.isInteger(seed) ? seed : null;
}

/** The teams that play in the First Four, by the vendor's id. */
function firstFourTeamIds(league: NcaaTournamentLeague, games: readonly NcaaBracketGame[]): Set<number> {
  return new Set(games
    .filter((game) => game.round === league.firstFourRound)
    .flatMap((game) => [decidedTeam(game.home_team)?.id, decidedTeam(game.away_team)?.id])
    .filter((id) => id !== undefined));
}

/** A First Four pairing's place in the field: its region and seed, the identity the place keeps. */
export function ncaaPlayInPlaceExternalId(scope: NcaaTournamentScope, regionLabel: string, seed: number): string {
  const region = regionLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${scope.league.key}-${String(scope.season)}-${region}-${String(seed)}-seed-play-in`;
}

/**
 * The play-in places of the field (#1728): one per First Four game in a named region, standing for
 * its pairing ("Texas Longhorns / NC State Wolfpack") with the pairing's seed, until the winner
 * fills it (#1571). A place is listed only while its game is not final: once it is, the winner is
 * about to fill the place, and a field load must not write the pairing a row again.
 */
export function toNcaaPlayInPlaces(scope: NcaaTournamentScope, games: readonly NcaaBracketGame[]): ProviderParticipant[] {
  const { league } = scope;
  return games.flatMap((game) => {
    const home = decidedTeam(game.home_team);
    const away = decidedTeam(game.away_team);
    const region = game.region_label;
    if (game.round !== league.firstFourRound || game.status_state === CompetitionStatusState.FINAL || !home || !away || !region) return [];
    const seed = seedOf(home) ?? seedOf(away);
    if (seed === null) return [];
    const name = (team: NcaaBracketTeam) => team.full_name ?? required(team.name, bracketPathOf(league), `a team of ${gameName(game)}`, 'name');
    return [{
      externalId: ncaaPlayInPlaceExternalId(scope, region, seed),
      providerId: BALLDONTLIE_PROVIDER_ID,
      sport: Sport.BASKETBALL,
      name: `${name(home)} / ${name(away)}`,
      active: true,
      metadata: { tour: league.tour, seed, playInPlace: true },
    }];
  });
}

/** Each region's round of 64 games from top to bottom, by the better seed of each. */
const ROUND_OF_64_BY_BETTER_SEED: readonly number[] = [1, 8, 5, 4, 6, 3, 7, 2];
const REGIONS = 4;
const GAMES_PER_REGION = ROUND_OF_64_BY_BETTER_SEED.length;
/** The seed a team's round of 64 opponent has: 1 meets 16, 8 meets 9. */
const OPPONENT_SEED_SUM = 17;

/**
 * The tournament's whole bracket from its round of 64 (#1728), numbered as an admin loads it: each
 * region's eight games in bracket order (1 v 16, 8 v 9, 5 v 12, 4 v 13, 6 v 11, 3 v 14, 7 v 10,
 * 2 v 15), the better seed home, regions in the vendor's `region_id` order (matches 1 to 32), then
 * each round's games below them, each pair of games linking to the next round's game (33 to 48,
 * 49 to 56, the Elite Eight 57 to 60), the first two regions' champions meeting in national
 * semifinal 61 and the last two in 62, and the championship 63. Every game is at a neutral site.
 * A side a First Four pairing fills is its play-in place. Null unless the vendor lists four
 * regions of eight round of 64 games with their seeds, every side placed: the women's bracket,
 * which names no region, never has a shape here.
 *
 * Which regions meet in the national semifinals is read from `region_id` order, which the vendor's
 * document does not promise; it is to be checked against a real bracket before a live tournament.
 */
export function toNcaaBracket(scope: NcaaTournamentScope, games: readonly NcaaBracketGame[]): ProviderBracketMatch[] | null {
  const { league } = scope;
  if (!league.bracketRegions) return null;
  const roundOf64 = games.filter((game) => game.round === league.firstFourRound + 1);
  const regionOrder = [...new Map(roundOf64
    .flatMap((game) => (game.region_label ? [[game.region_label, game.region_id ?? Number.MAX_SAFE_INTEGER] as const] : []))).entries()]
    .sort(([leftLabel, leftId], [rightLabel, rightId]) => leftId - rightId || leftLabel.localeCompare(rightLabel))
    .map(([label]) => label);
  if (regionOrder.length !== REGIONS) return null;
  const playInPlaces = new Set(toNcaaPlayInPlaces(scope, games).map((place) => place.externalId));
  const firstFour = firstFourTeamIds(league, games);

  const firstRound: ProviderBracketMatch[] = [];
  for (const [regionIndex, region] of regionOrder.entries()) {
    const regionGames = roundOf64.filter((game) => game.region_label === region);
    if (regionGames.length !== GAMES_PER_REGION) return null;
    const slots = new Map<number, ProviderBracketMatch>();
    for (const game of regionGames) {
      const sides = [decidedTeam(game.home_team), decidedTeam(game.away_team)].filter((team) => team !== null);
      const seeds = sides.map(seedOf).filter((seed) => seed !== null);
      const betterSeed = seeds.length === 0 ? null : Math.min(...seeds.map((seed) => Math.min(seed, OPPONENT_SEED_SUM - seed)));
      const position = betterSeed === null ? -1 : ROUND_OF_64_BY_BETTER_SEED.indexOf(betterSeed);
      if (betterSeed === null || position === -1 || slots.has(position)) return null;
      const sideOf = (seed: number): string | null => {
        const team = sides.find((side) => seedOf(side) === seed && !firstFour.has(side.id));
        if (team) return participantFeedId(team.id);
        const place = ncaaPlayInPlaceExternalId(scope, region, seed);
        return playInPlaces.has(place) ? place : null;
      };
      const home = sideOf(betterSeed);
      const away = sideOf(OPPONENT_SEED_SUM - betterSeed);
      if (home === null || away === null) return null;
      slots.set(position, {
        matchNumber: regionIndex * GAMES_PER_REGION + position + 1,
        roundNumber: 1,
        homeTeamExternalId: home,
        awayTeamExternalId: away,
        isNeutralSite: true,
        scheduledAt: game.date ? new Date(game.date) : null,
        advancesTo: null,
        regionLabel: region,
      });
    }
    firstRound.push(...[...slots.values()].sort((left, right) => left.matchNumber - right.matchNumber));
  }

  // Each later round: half the games of the round before, the region kept through the Elite Eight.
  const rounds: ProviderBracketMatch[][] = [firstRound];
  let previous = firstRound;
  let nextNumber = firstRound.length + 1;
  while (previous.length > 1) {
    const round: ProviderBracketMatch[] = [];
    for (let index = 0; index + 1 < previous.length; index += 2) {
      const left = previous[index];
      const right = previous[index + 1];
      round.push({
        matchNumber: nextNumber,
        roundNumber: left.roundNumber + 1,
        homeTeamExternalId: null,
        awayTeamExternalId: null,
        isNeutralSite: true,
        scheduledAt: null,
        advancesTo: null,
        regionLabel: left.regionLabel === right.regionLabel ? left.regionLabel : null,
      });
      left.advancesTo = { matchNumber: nextNumber, side: MatchSide.HOME };
      right.advancesTo = { matchNumber: nextNumber, side: MatchSide.AWAY };
      nextNumber += 1;
    }
    rounds.push(round);
    previous = round;
  }
  return rounds.flat();
}

/**
 * The tournament's games from the round of 64 on with both teams decided, each in PoolMaster's
 * round (#1728), for a synced event's matches to take their kickoffs from. A round of 64 game of a
 * First Four team is left out: its side is the play-in place until the winner fills it, and then
 * the game links like any other.
 */
export function toNcaaScheduledGames(league: NcaaTournamentLeague, games: readonly NcaaBracketGame[]): ProviderScheduledGame[] {
  const firstFour = firstFourTeamIds(league, games);
  return games.flatMap((game) => {
    const home = decidedTeam(game.home_team);
    const away = decidedTeam(game.away_team);
    const round = game.round;
    if (!home || !away || round === undefined || round <= league.firstFourRound || game.game_id === undefined || game.game_id === null) return [];
    if (round === league.firstFourRound + 1 && (firstFour.has(home.id) || firstFour.has(away.id))) return [];
    return [{
      externalGameId: String(game.game_id),
      roundNumber: round - league.firstFourRound,
      homeTeamExternalId: participantFeedId(home.id),
      awayTeamExternalId: participantFeedId(away.id),
      scheduledAt: game.date ? new Date(game.date) : null,
      isNeutralSite: true,
    }];
  });
}
