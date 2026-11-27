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
 * women's round 0), so each league names its own. PoolMaster's event starts at the First Four,
 * its play-in round (#2184): each First Four game is a match of round 1, its two teams in the
 * field like any other, and its winner advances into the side of its round of 64 match, which
 * stays empty until then. No team stands in for a pairing.
 *
 * Team ids are the provider's own (`participantFeedId`, #2040): the vendor numbers each league's
 * teams on its own, and a mapping is kept per sport league, so a school's men's and women's
 * teams, which share a name, each map to their own league's participant.
 */

import { MatchSide, Sport, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderBracketMatch, ProviderParticipant, ProviderScheduledGame, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import type { NcaaBracketGame, NcaaBracketTeam, NcaaTeam } from './ncaa-tournament-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';
import { participantFeedId } from './participant-feed-id';
import { ProviderSeasonType, providerSlotCode, slotPlaysOf } from './provider-slot-codes';

/** One of the vendor's NCAA basketball leagues and how its bracket numbers its rounds. */
export interface NcaaTournamentLeague {
  /** The vendor's path segment (`/ncaab/v1/...`), and the prefix of its scope and team ids. */
  key: 'ncaab' | 'ncaaw';
  eventName: string;
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
  firstFourRound: 1,
  championshipRound: 7,
  bracketRegions: true,
};

export const NCAA_WOMEN: NcaaTournamentLeague = {
  key: 'ncaaw',
  eventName: 'NCAA Women\'s Tournament',
  firstFourRound: 0,
  championshipRound: 6,
  bracketRegions: false,
};

export const NCAA_TOURNAMENT_LEAGUES: readonly NcaaTournamentLeague[] = [NCAA_MEN, NCAA_WOMEN];

/** The rounds of PoolMaster's event: the First Four to the championship. */
export function tournamentRoundsOf(league: NcaaTournamentLeague): number {
  return league.championshipRound - league.firstFourRound + 1;
}

/** PoolMaster's round of a vendor round: the First Four is round 1. */
function eventRoundOf(league: NcaaTournamentLeague, vendorRound: number): number {
  return vendorRound - league.firstFourRound + 1;
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
export function toNcaaTournamentEvent(scope: NcaaTournamentScope, games: readonly NcaaBracketGame[]): SportEvent {
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
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    // A bracket game's code is the vendor's round, First Four included; an undated game has no place in time yet.
    providerSlots: slotPlaysOf(games.flatMap((game) => (game.date && game.round !== undefined
      ? [{ code: providerSlotCode(ProviderSeasonType.POSTSEASON, game.round), start: Date.parse(game.date) }]
      : []))),
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
    status: SportEventParticipantStatus.ACTIVE,
    ...(team.abbreviation ? { abbreviation: team.abbreviation } : {}),
    metadata: {},
  };
}

/** A bracket side's team once it is decided: its id and seed, or null while it is to be decided. */
function decidedTeam(team: NcaaBracketTeam | null | undefined): (NcaaBracketTeam & { id: number }) | null {
  return team?.id === undefined || team.id === null ? null : { ...team, id: team.id };
}

/**
 * The teams in a season's bracket, each once, in the order they first appear, with their seed,
 * the First Four's teams included. A side still to be decided names no team yet.
 */
export function toNcaaFieldParticipants(league: NcaaTournamentLeague, games: readonly NcaaBracketGame[]): ProviderParticipant[] {
  const teams = new Map<string, ProviderParticipant>();
  for (const game of games) {
    for (const side of [game.home_team, game.away_team]) {
      const team = decidedTeam(side);
      if (!team) continue;
      const externalId = participantFeedId(team.id);
      if (teams.has(externalId)) continue;
      const seed = team.seed ? Number.parseInt(team.seed, 10) : Number.NaN;
      teams.set(externalId, {
        externalId,
        providerId: BALLDONTLIE_PROVIDER_ID,
        sport: Sport.BASKETBALL,
        name: team.full_name ?? required(team.name, bracketPathOf(league), `a team of ${gameName(game)}`, 'name'),
        status: SportEventParticipantStatus.ACTIVE,
        ...(Number.isInteger(seed) && { seed }),
        metadata: {},
      });
    }
  }
  return [...teams.values()];
}

/**
 * Each bracket game's teams, state and score, for the GAME live-score category: every game, the
 * First Four's included, whose two teams are decided. A game whose state the vendor calls
 * `unknown` is left out.
 */
export function toNcaaGameScoreUpdates(league: NcaaTournamentLeague, games: readonly NcaaBracketGame[]): GameScoreUpdate[] {
  const path = bracketPathOf(league);
  return games.flatMap((game) => {
    const home = decidedTeam(game.home_team);
    const away = decidedTeam(game.away_team);
    if (game.status_state === CompetitionStatusState.UNKNOWN || !home || !away) return [];
    required(game.round, path, gameName(game), 'round');
    const state = GAME_STATE_BY_STATUS[game.status_state];
    const started = hasStarted(state);
    return [{
      providerGameId: String(required(game.game_id, path, 'a bracket game with both teams', 'game_id')),
      homeTeamExternalId: participantFeedId(home.id),
      awayTeamExternalId: participantFeedId(away.id),
      state,
      homeScore: started ? home.score ?? null : null,
      awayScore: started ? away.score ?? null : null,
    }];
  });
}

/** The seed of a decided bracket side, or null when the vendor gives none. */
function seedOf(team: NcaaBracketTeam): number | null {
  const seed = team.seed ? Number.parseInt(team.seed, 10) : Number.NaN;
  return Number.isInteger(seed) ? seed : null;
}

/** Each region's round of 64 games from top to bottom, by the better seed of each. */
const ROUND_OF_64_BY_BETTER_SEED: readonly number[] = [1, 8, 5, 4, 6, 3, 7, 2];
const REGIONS = 4;
const GAMES_PER_REGION = ROUND_OF_64_BY_BETTER_SEED.length;
/** The seed a team's round of 64 opponent has: 1 meets 16, 8 meets 9. */
const OPPONENT_SEED_SUM = 17;

/**
 * The tournament's whole bracket (#1728), numbered as an admin loads it. Round 1 is the First
 * Four (#2184): its games in region order, then by seed, each advancing
 * into the side of the round of 64 game its pairing's seed plays in. Round 2 is the round of 64:
 * each region's eight games in bracket order (1 v 16, 8 v 9, 5 v 12, 4 v 13, 6 v 11, 3 v 14,
 * 7 v 10, 2 v 15), the better seed home, regions in the vendor's `region_id` order, then each
 * round's games below them, each pair of games linking to the next round's game, the first two
 * regions' champions meeting in the first national semifinal and the last two in the second, and
 * the championship last. Every slot of it says neutral site (#2154). A side a First Four game fills is empty
 * until its winner advances into it. Null unless the vendor lists four regions of eight round of 64
 * games with their seeds, every side placed: the women's bracket, which names no region, never has
 * a shape here.
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

  // Each First Four game by its region and the seed its pairing shares.
  const playIns = new Map<string, NcaaBracketGame & { region_label: string; seed: number }>();
  for (const game of games) {
    if (game.round !== league.firstFourRound) continue;
    const home = decidedTeam(game.home_team);
    const away = decidedTeam(game.away_team);
    const seed = (home && seedOf(home)) ?? (away && seedOf(away));
    if (!game.region_label || seed === null) return null;
    playIns.set(JSON.stringify([game.region_label, seed]), { ...game, region_label: game.region_label, seed });
  }
  const playInTeams = new Set([...playIns.values()].flatMap((game) => [decidedTeam(game.home_team)?.id, decidedTeam(game.away_team)?.id]));

  const firstFourOf = new Map([...playIns.entries()]
    .sort(([, left], [, right]) => regionOrder.indexOf(left.region_label) - regionOrder.indexOf(right.region_label) || left.seed - right.seed)
    .map(([key, game], index): [string, ProviderBracketMatch] => {
      const home = decidedTeam(game.home_team);
      const away = decidedTeam(game.away_team);
      return [key, {
        matchNumber: index + 1,
        roundNumber: 1,
        homeTeamExternalId: home ? participantFeedId(home.id) : null,
        awayTeamExternalId: away ? participantFeedId(away.id) : null,
        scheduledAt: game.date ? new Date(game.date) : null,
        advancesTo: null,
        regionLabel: game.region_label,
      }];
    }));
  const firstFour = [...firstFourOf.values()];

  const roundOfSixtyFour: ProviderBracketMatch[] = [];
  for (const [regionIndex, region] of regionOrder.entries()) {
    const regionGames = roundOf64.filter((game) => game.region_label === region);
    if (regionGames.length !== GAMES_PER_REGION) return null;
    const slots = new Map<number, { match: ProviderBracketMatch; feeders: [ProviderBracketMatch | undefined, ProviderBracketMatch | undefined] }>();
    for (const game of regionGames) {
      const sides = [decidedTeam(game.home_team), decidedTeam(game.away_team)].filter((team) => team !== null);
      const seeds = sides.map(seedOf).filter((seed) => seed !== null);
      const betterSeed = seeds.length === 0 ? null : Math.min(...seeds.map((seed) => Math.min(seed, OPPONENT_SEED_SUM - seed)));
      const position = betterSeed === null ? -1 : ROUND_OF_64_BY_BETTER_SEED.indexOf(betterSeed);
      if (betterSeed === null || position === -1 || slots.has(position)) return null;
      // A seed a First Four game fills: its side is empty until the winner advances into it.
      const sideOf = (seed: number): { team: string | null; feeder?: ProviderBracketMatch } | null => {
        const feeder = firstFourOf.get(JSON.stringify([region, seed]));
        if (feeder) return { team: null, feeder };
        const team = sides.find((side) => seedOf(side) === seed && !playInTeams.has(side.id));
        return team ? { team: participantFeedId(team.id) } : null;
      };
      const home = sideOf(betterSeed);
      const away = sideOf(OPPONENT_SEED_SUM - betterSeed);
      if (home === null || away === null) return null;
      slots.set(position, {
        match: {
          matchNumber: regionIndex * GAMES_PER_REGION + position + 1,
          roundNumber: 2,
          homeTeamExternalId: home.team,
          awayTeamExternalId: away.team,
          scheduledAt: game.date ? new Date(game.date) : null,
          advancesTo: null,
          regionLabel: region,
        },
        feeders: [home.feeder, away.feeder],
      });
    }
    for (const { match, feeders: [home, away] } of [...slots.values()].sort((left, right) => left.match.matchNumber - right.match.matchNumber)) {
      if (home) home.advancesTo = { roundNumber: match.roundNumber, matchNumber: match.matchNumber, side: MatchSide.HOME };
      if (away) away.advancesTo = { roundNumber: match.roundNumber, matchNumber: match.matchNumber, side: MatchSide.AWAY };
      roundOfSixtyFour.push(match);
    }
  }
  if (firstFour.some((match) => match.advancesTo === null)) return null;

  // Each later round: half the games of the round before, the region kept through the Elite Eight.
  const rounds: ProviderBracketMatch[][] = [firstFour, roundOfSixtyFour];
  let previous = roundOfSixtyFour;
  while (previous.length > 1) {
    const round: ProviderBracketMatch[] = [];
    for (let index = 0; index + 1 < previous.length; index += 2) {
      const left = previous[index];
      const right = previous[index + 1];
      // Numbered within its round (#2161), in the draw's order.
      const next = { roundNumber: left.roundNumber + 1, matchNumber: index / 2 + 1 };
      round.push({
        ...next,
        homeTeamExternalId: null,
        awayTeamExternalId: null,
        scheduledAt: null,
        advancesTo: null,
        regionLabel: left.regionLabel === right.regionLabel ? left.regionLabel : null,
      });
      left.advancesTo = { ...next, side: MatchSide.HOME };
      right.advancesTo = { ...next, side: MatchSide.AWAY };
    }
    rounds.push(round);
    previous = round;
  }
  return rounds.flat();
}

/**
 * The tournament's games with both teams decided, the First Four's included, each in PoolMaster's
 * round (#1728), for a synced event's matches to take their kickoffs from. A First Four winner's
 * round of 64 game pairs with its match once the winner has advanced into it.
 */
export function toNcaaScheduledGames(league: NcaaTournamentLeague, games: readonly NcaaBracketGame[]): ProviderScheduledGame[] {
  return games.flatMap((game) => {
    const home = decidedTeam(game.home_team);
    const away = decidedTeam(game.away_team);
    const round = game.round;
    if (!home || !away || round === undefined || game.game_id === undefined || game.game_id === null) return [];
    return [{
      games: [{ providerGameId: String(game.game_id), gameNumber: 1 }],
      roundNumber: eventRoundOf(league, round),
      homeTeamExternalId: participantFeedId(home.id),
      awayTeamExternalId: participantFeedId(away.id),
      scheduledAt: game.date ? new Date(game.date) : null,
    }];
  });
}
