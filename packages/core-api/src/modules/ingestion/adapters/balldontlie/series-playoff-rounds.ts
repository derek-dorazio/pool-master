/**
 * One round of a best-of-series playoffs as an event of its own, for a Clutch Card (#1497): the
 * NBA Finals, or the conference finals' two series together. Pure mappings, no I/O, shared by
 * every series league the way `series-playoffs.ts` is.
 *
 * The vendor marks a game as postseason but names no round, so a series' round is worked out from
 * the bracket: a team's first series is round 1, and each later series is one round past the later
 * of its two teams' previous series. A team with a bye into round 2 (MLB's top seeds) meets a
 * round 1 winner, so its series is still round 2. Two teams meet in one series a postseason.
 *
 * A Clutch Card's game N is each of the round's series' Game N: the series' games in the order
 * they start. A round's scope id is the event's externalId (`nba-2025-postseason-round-4`).
 */

import { seriesWinsNeeded, type SportStat } from '@poolmaster/shared/domain';
import type { StatLineGameUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, PROGRESS_BY_STATE } from './competition-status';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';
import { pairOf, winnerOf, type PlayoffGame, type PlayoffsLeague } from './series-playoffs';

/** One series: its round and its games in the order they start. */
export interface PlayoffSeries {
  round: number;
  games: PlayoffGame[];
}

/** A player's line in one game, as a league's normalizer reads it: only a player who played. */
export interface PlayoffStatLine {
  gameId: number;
  playerId: number;
  /** Each stat the league's composite counts, once. */
  stats: ReadonlyArray<{ stat: SportStat; value: number }>;
}

/** A player on a team's roster, as a league's normalizer reads it. */
export interface PlayoffPlayer {
  id: number;
  name: string;
  /** The league's own facts about the player (position, team), kept on the participant. */
  metadata: Record<string, unknown>;
}

export function playoffRoundScopeId(league: PlayoffsLeague, season: number, round: number): string {
  return `${league.key}-${String(season)}-postseason-round-${String(round)}`;
}

/** The season and round an event id names, or null when it names no round the league plays. */
export function parsePlayoffRoundScope(league: PlayoffsLeague, eventId: string): { season: number; round: number } | null {
  const match = new RegExp(`^${league.key}-(\\d{4})-postseason-round-(\\d{1,2})$`).exec(eventId);
  if (!match) return null;
  const round = Number(match[2]);
  return round >= 1 && round <= league.rounds.length ? { season: Number(match[1]), round } : null;
}

export function playoffsPlayerExternalId(league: PlayoffsLeague, playerId: number): string {
  return `${league.key}-player-${String(playerId)}`;
}

/** Every series the games make, each with its round, earliest first. */
export function playoffSeries(games: readonly PlayoffGame[]): PlayoffSeries[] {
  const byPair = new Map<string, PlayoffGame[]>();
  for (const game of games) byPair.set(pairOf(game), [...(byPair.get(pairOf(game)) ?? []), game]);
  const series = [...byPair.values()]
    .map((seriesGames) => [...seriesGames].sort((left, right) => left.start - right.start || left.id - right.id))
    .sort((left, right) => left[0].start - right[0].start || pairOf(left[0]).localeCompare(pairOf(right[0])));
  const lastRoundOf = new Map<number, number>();
  return series.map((seriesGames) => {
    const { home, away } = seriesGames[0];
    const round = 1 + Math.max(lastRoundOf.get(home.id) ?? 0, lastRoundOf.get(away.id) ?? 0);
    lastRoundOf.set(home.id, round);
    lastRoundOf.set(away.id, round);
    return { round, games: seriesGames };
  });
}

/** Whether a series is decided: a side has won more than half of its games. */
function isDecided(series: PlayoffSeries, seriesLength: number): boolean {
  const wins = new Map<number, number>();
  for (const game of series.games) {
    const winner = winnerOf(game);
    if (winner) wins.set(winner.id, (wins.get(winner.id) ?? 0) + 1);
  }
  return [...wins.values()].some((count) => count >= seriesWinsNeeded(seriesLength));
}

/**
 * A round's series as an event, from those series, which must be at least one. It is complete once
 * the round's every series is listed and decided.
 */
export function toPlayoffRoundEvent(league: PlayoffsLeague, season: number, round: number, series: readonly PlayoffSeries[], participantCount?: number): SportEvent {
  const { name, seriesLength, seriesCount } = league.rounds[round - 1];
  const games = series.flatMap((each) => each.games);
  const times = games.map((game) => game.start);
  const complete = series.length === seriesCount && series.every((each) => isDecided(each, seriesLength));
  const status = eventStatusOf(games.map((game) => PROGRESS_BY_STATE[game.state]), complete);
  return {
    externalId: playoffRoundScopeId(league, season, round),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: league.sport,
    name,
    startDate: new Date(Math.min(...times)),
    endDate: new Date(Math.max(...times)),
    status,
    participantCount,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    metadata: { tour: league.tour, season, round },
  };
}

/** Each round a season's games have reached, as an event each, in round order. */
export function toPlayoffRoundEvents(league: PlayoffsLeague, season: number, games: readonly PlayoffGame[]): SportEvent[] {
  const series = playoffSeries(games);
  const rounds = [...new Set(series.map((each) => each.round))]
    .filter((round) => round <= league.rounds.length)
    .sort((left, right) => left - right);
  return rounds.map((round) => toPlayoffRoundEvent(league, season, round, series.filter((each) => each.round === round)));
}

/**
 * The round's box scores in the STAT_LINE category: each of its games that is under way or done,
 * numbered within its series, with each player's line. A game the vendor cannot classify is left out.
 */
export function toPlayoffRoundBoxScores(league: PlayoffsLeague, series: readonly PlayoffSeries[], lines: readonly PlayoffStatLine[]): StatLineGameUpdate[] {
  const linesOf = new Map<number, PlayoffStatLine[]>();
  for (const line of lines) linesOf.set(line.gameId, [...(linesOf.get(line.gameId) ?? []), line]);
  return series.flatMap((each) => each.games.flatMap((game, index) => {
    if (game.state === CompetitionStatusState.UNKNOWN) return [];
    return [{
      externalGameId: String(game.id),
      gameNumber: index + 1,
      state: GAME_STATE_BY_STATUS[game.state],
      lines: (linesOf.get(game.id) ?? []).map((line) => ({
        participantExternalId: playoffsPlayerExternalId(league, line.playerId),
        stats: [...line.stats],
      })),
    }];
  }));
}

export function toPlayoffPlayerParticipant(league: PlayoffsLeague, player: PlayoffPlayer): ProviderParticipant {
  return {
    externalId: playoffsPlayerExternalId(league, player.id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: league.sport,
    name: player.name,
    active: true,
    metadata: { ...player.metadata, tour: league.tour },
  };
}
