/**
 * The league-neutral half of a best-of-series playoffs (#1496, #1545): the NBA's, NHL's, MLB's
 * and WNBA's are one shape that differs only in field names, so each league normalizes its games
 * and teams into the shapes here and shares everything else. Pure mappings, no I/O.
 *
 * The vendor has games, not events, so a league's playoffs are a scope of games: one season's
 * postseason (`nba-2025-postseason`), the scope id being the event's externalId. A series is one
 * match of the bracket, and the GAME writer counts its games' winners, so every postseason game
 * of the season is handed over on each sync.
 *
 * Team ids are the provider's own (`participantFeedId`, #2040): a mapping is kept per sport
 * league and kind of participant.
 */

import { seriesWinsNeeded, type Sport, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, isDone, PROGRESS_BY_STATE } from './competition-status';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';
import { participantFeedId } from './participant-feed-id';
import { ProviderSeasonType, providerSlotCode, slotPlaysOf } from './provider-slot-codes';

/** One league's playoffs, as the shared mapping needs it. */
export interface PlayoffsLeague {
  /** The vendor's path segment and the scope and team id prefix: `nba`. */
  key: string;
  sport: Sport;
  /** The event's name: "NBA Playoffs". */
  eventName: string;
  /**
   * Each round, first to final (#1497): its event name, how many games each of its series is played
   * over, and how many series it has. The playoffs end when a side wins the final's one series.
   */
  rounds: ReadonlyArray<{ name: string; seriesLength: number; seriesCount: number }>;
  /**
   * The years from the season's number to its playoffs: 1 where a season is numbered by the year
   * it starts and its playoffs fall in the next (the NBA's 2025 season, playoffs in 2026), 0
   * where they fall in the same year (MLB's, the WNBA's).
   */
  playoffYearOffset: 0 | 1;
  /**
   * How the league's bracket is seeded, which the provider's slate loads whole (#1728); left out
   * where the bracket is not built from the feed yet. See `series-playoff-bracket.ts`.
   */
  bracket?: PlayoffsBracketShape;
}

export const BracketShapeKind = {
  /** Seeded 1 to n within each group: the NBA's conferences, or the WNBA as one. */
  SEEDED: 'SEEDED',
  /** Seeded by division within each conference, a division's winner meeting a wild card: the NHL's. */
  DIVISIONS: 'DIVISIONS',
  /** Six seeds a league, the top two waiting out the first round: MLB's. */
  BYES: 'BYES',
} as const;
export type BracketShapeKind = (typeof BracketShapeKind)[keyof typeof BracketShapeKind];

/** One conference of a division-seeded bracket: its name on a team, its region label, and its divisions in bracket order. */
export interface DivisionBracketConference {
  name: string;
  label: string;
  divisions: readonly string[];
}

/**
 * A bracket fixed by seed. `groups` seed their own half each, in bracket order, by a team's
 * `metadata.conference` (null for a league seeded as one); `conferences` order a division bracket;
 * `leagues` order a bye bracket by a team's `metadata.league`.
 */
export type PlayoffsBracketShape =
  | { kind: typeof BracketShapeKind.SEEDED; groups: readonly string[] | null }
  | { kind: typeof BracketShapeKind.DIVISIONS; conferences: DivisionBracketConference[] }
  | { kind: typeof BracketShapeKind.BYES; leagues: ReadonlyArray<{ name: string; label: string }> };

/** A team as a league's normalizer reads it. */
export interface PlayoffTeam {
  id: number;
  name: string;
  /** The team's abbreviation as the feed sends it, stored on the participant (#2025). */
  abbreviation?: string;
  /** The league's own facts about the team (conference, division), read while mapping and not stored. */
  metadata: Record<string, unknown>;
}

/** A postseason game as a league's normalizer reads it. */
export interface PlayoffGame {
  id: number;
  season: number;
  /** Whether the vendor marks it a playoff game; the reader keeps only those. */
  postseason: boolean;
  /** When it starts, in epoch milliseconds. */
  start: number;
  home: PlayoffTeam;
  away: PlayoffTeam;
  state: CompetitionStatusState;
  /** Null until the vendor has one. */
  homeScore: number | null;
  awayScore: number | null;
}

export function playoffsScopeId(league: PlayoffsLeague, season: number): string {
  return `${league.key}-${String(season)}-postseason`;
}

/** The season an event id names the league's playoffs of, or null when it names none. */
export function parsePlayoffsScope(league: PlayoffsLeague, eventId: string): number | null {
  const match = new RegExp(`^${league.key}-(\\d{4})-postseason$`).exec(eventId);
  return match ? Number(match[1]) : null;
}


/** A game's two teams as one key, whichever is at home: two teams meet in one series a postseason. */
export function pairOf(game: PlayoffGame): string {
  return [game.home.id, game.away.id].sort((left, right) => left - right).join('|');
}

/** One game of a series, with its number in it: 1 for the first played. */
export interface PlayoffSeriesGame {
  game: PlayoffGame;
  gameNumber: number;
}

/** One series: its round and its games, numbered in the order they start (#2007). */
export interface PlayoffSeries {
  round: number;
  games: PlayoffSeriesGame[];
}

/** A series' Game 1: the game numbered 1, which every series has. */
export function seriesGameOne(series: Pick<PlayoffSeries, 'games'>): PlayoffGame {
  const first = series.games.find((each) => each.gameNumber === 1);
  if (first === undefined) throw new Error('A series has no Game 1.');
  return first.game;
}

/**
 * Every series the games make, each with its round, earliest first. The vendor marks a game as
 * postseason but names no round, so a series' round is worked out from the bracket: a team's
 * first series is round 1, and each later series is one round past the later of its two teams'
 * previous series. A team with a bye into round 2 (MLB's top seeds) meets a
 * round 1 winner, so its series is still round 2. Two teams meet in one series a postseason.
 */
export function playoffSeries(games: readonly PlayoffGame[]): PlayoffSeries[] {
  const byPair = new Map<string, PlayoffGame[]>();
  for (const game of games) byPair.set(pairOf(game), [...(byPair.get(pairOf(game)) ?? []), game]);
  const series = [...byPair.values()]
    .map((seriesGames) => [...seriesGames].sort((left, right) => left.start - right.start || left.id - right.id))
    .sort((left, right) => left[0].start - right[0].start || pairOf(left[0]).localeCompare(pairOf(right[0])));
  const lastRoundOf = new Map<number, number>();
  return series.map((seriesGames) => {
    // Sorted by start above: the series' games numbered in the order they are played.
    const games = seriesGames.map((game, index) => ({ game, gameNumber: index + 1 }));
    const { home, away } = seriesGameOne({ games });
    const round = 1 + Math.max(lastRoundOf.get(home.id) ?? 0, lastRoundOf.get(away.id) ?? 0);
    lastRoundOf.set(home.id, round);
    lastRoundOf.set(away.id, round);
    return { round, games };
  });
}

/** The side that won a final game, or null when it has no winner on the board. */
export function winnerOf(game: PlayoffGame): PlayoffTeam | null {
  if (game.state !== CompetitionStatusState.FINAL || game.homeScore === null || game.awayScore === null) return null;
  if (game.homeScore === game.awayScore) return null;
  return game.homeScore > game.awayScore ? game.home : game.away;
}

/**
 * Whether the playoffs are over. Every listed game may be done between rounds, so it also takes
 * the whole bracket: a knockout of N teams plays N - 1 series, two teams meet once, and the
 * series that starts last is the final, which is over once a side has won more than half of it.
 */
function isComplete(league: PlayoffsLeague, games: readonly PlayoffGame[]): boolean {
  if (!games.every((game) => isDone(PROGRESS_BY_STATE[game.state]))) return false;
  const teams = new Set(games.flatMap((game) => [game.home.id, game.away.id]));
  const pairs = new Set(games.map(pairOf));
  if (pairs.size !== teams.size - 1) return false;
  const last = games.reduce((latest, game) => (game.start > latest.start ? game : latest));
  const winsByTeam = new Map<number, number>();
  for (const game of games) {
    const winner = pairOf(game) === pairOf(last) ? winnerOf(game) : null;
    if (winner) winsByTeam.set(winner.id, (winsByTeam.get(winner.id) ?? 0) + 1);
  }
  const finalSeriesLength = league.rounds[league.rounds.length - 1].seriesLength;
  return [...winsByTeam.values()].some((wins) => wins >= seriesWinsNeeded(finalSeriesLength));
}

/** One season's playoffs as an event, from its games, which must be at least one. */
export function toPlayoffsEvent(league: PlayoffsLeague, season: number, games: readonly PlayoffGame[]): SportEvent {
  const times = games.map((game) => game.start);
  const status = eventStatusOf(games.map((game) => PROGRESS_BY_STATE[game.state]), isComplete(league, games));
  return {
    externalId: playoffsScopeId(league, season),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: league.sport,
    name: league.eventName,
    startDate: new Date(Math.min(...times)),
    endDate: new Date(Math.max(...times)),
    status,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    // The vendor names no round, so a game's code takes its series' round in the bracket (`playoffSeries`).
    providerSlots: slotPlaysOf(playoffSeries(games).flatMap((series) => series.games.map(({ game }) => ({
      code: providerSlotCode(ProviderSeasonType.POSTSEASON, series.round),
      start: game.start,
    })))),
  };
}

/** Each season's playoffs the games cover, as one event each, earliest first. */
export function toPlayoffsEvents(league: PlayoffsLeague, games: readonly PlayoffGame[]): SportEvent[] {
  const bySeason = new Map<number, PlayoffGame[]>();
  for (const game of games) bySeason.set(game.season, [...(bySeason.get(game.season) ?? []), game]);
  return [...bySeason]
    .map(([season, seasonGames]) => toPlayoffsEvent(league, season, seasonGames))
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
}

export function toPlayoffsTeamParticipant(league: PlayoffsLeague, team: PlayoffTeam): ProviderParticipant {
  return {
    externalId: participantFeedId(team.id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: league.sport,
    name: team.name,
    status: SportEventParticipantStatus.ACTIVE,
    ...(team.abbreviation === undefined ? {} : { abbreviation: team.abbreviation }),
    metadata: team.metadata,
  };
}

/** The teams playing the playoffs' games, each once, in the order they first appear. */
export function toPlayoffsFieldParticipants(league: PlayoffsLeague, games: readonly PlayoffGame[]): ProviderParticipant[] {
  const teams = new Map<number, PlayoffTeam>();
  for (const game of games) {
    teams.set(game.home.id, game.home);
    teams.set(game.away.id, game.away);
  }
  return [...teams.values()].map((team) => toPlayoffsTeamParticipant(league, team));
}

/** Each game's teams, state, score and number in its series, for the GAME live-score category. */
export function toPlayoffsGameScoreUpdates(games: readonly PlayoffGame[]): GameScoreUpdate[] {
  const numberOf = new Map(playoffSeries(games).flatMap((series) => series.games.map(({ game, gameNumber }) => [game, gameNumber] as const)));
  return games.flatMap((game) => {
    if (game.state === CompetitionStatusState.UNKNOWN) return [];
    const gameNumber = numberOf.get(game);
    const state = GAME_STATE_BY_STATUS[game.state];
    // A game not under way can show 0-0 at the vendor; it has no score yet.
    const started = hasStarted(state);
    return [{
      providerGameId: String(game.id),
      ...(gameNumber !== undefined && { gameNumber }),
      homeTeamExternalId: participantFeedId(game.home.id),
      awayTeamExternalId: participantFeedId(game.away.id),
      state,
      homeScore: started ? game.homeScore : null,
      awayScore: started ? game.awayScore : null,
    }];
  });
}
