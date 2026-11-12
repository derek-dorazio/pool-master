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
 * Team ids are prefixed by league (`nba-team-14`): a provider's participant ids share one
 * namespace across its sports and leagues.
 */

import { seriesWinsNeeded, type Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, isDone, PROGRESS_BY_STATE } from './competition-status';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';

/** One league's playoffs, as the shared mapping needs it. */
export interface PlayoffsLeague {
  /** The vendor's path segment and the scope and team id prefix: `nba`. */
  key: string;
  /** Carried in `metadata.tour`, matched against the sport league's match keyword. */
  tour: string;
  sport: Sport;
  /** The event's name: "NBA Playoffs". */
  eventName: string;
  /** How many games the final series is played over: the playoffs end when a side wins it. */
  finalSeriesLength: number;
  /**
   * The years from the season's number to its playoffs: 1 where a season is numbered by the year
   * it starts and its playoffs fall in the next (the NBA's 2025 season, playoffs in 2026), 0
   * where they fall in the same year (MLB's, the WNBA's).
   */
  playoffYearOffset: 0 | 1;
  /** The month (0-based) from which the reader takes a new season as the one under way. */
  seasonRolloverMonth: number;
}

/** A team as a league's normalizer reads it. */
export interface PlayoffTeam {
  id: number;
  name: string;
  /** The league's own facts about the team (abbreviation, conference), kept on the participant. */
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

export function playoffsTeamExternalId(league: PlayoffsLeague, teamId: number): string {
  return `${league.key}-team-${String(teamId)}`;
}

/** The side that won a final game, or null when it has no winner on the board. */
function winnerOf(game: PlayoffGame): PlayoffTeam | null {
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
  const pairOf = (game: PlayoffGame) => [game.home.id, game.away.id].sort((left, right) => left - right).join('|');
  const teams = new Set(games.flatMap((game) => [game.home.id, game.away.id]));
  const pairs = new Set(games.map(pairOf));
  if (pairs.size !== teams.size - 1) return false;
  const last = games.reduce((latest, game) => (game.start > latest.start ? game : latest));
  const winsByTeam = new Map<number, number>();
  for (const game of games) {
    const winner = pairOf(game) === pairOf(last) ? winnerOf(game) : null;
    if (winner) winsByTeam.set(winner.id, (winsByTeam.get(winner.id) ?? 0) + 1);
  }
  return [...winsByTeam.values()].some((wins) => wins >= seriesWinsNeeded(league.finalSeriesLength));
}

/** One season's playoffs as an event, from its games, which must be at least one. */
export function toPlayoffsEvent(league: PlayoffsLeague, season: number, games: readonly PlayoffGame[], participantCount?: number): SportEvent {
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
    participantCount,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    metadata: { tour: league.tour, season },
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
    externalId: playoffsTeamExternalId(league, team.id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: league.sport,
    name: team.name,
    active: true,
    metadata: { ...team.metadata, tour: league.tour },
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

/** Each game's teams, state and score, for the GAME live-score category. */
export function toPlayoffsGameScoreUpdates(league: PlayoffsLeague, games: readonly PlayoffGame[]): GameScoreUpdate[] {
  return games.flatMap((game) => {
    if (game.state === CompetitionStatusState.UNKNOWN) return [];
    const state = GAME_STATE_BY_STATUS[game.state];
    // A game not under way can show 0-0 at the vendor; it has no score yet.
    const started = hasStarted(state);
    return [{
      externalGameId: String(game.id),
      homeTeamExternalId: playoffsTeamExternalId(league, game.home.id),
      awayTeamExternalId: playoffsTeamExternalId(league, game.away.id),
      state,
      homeScore: started ? game.homeScore : null,
      awayScore: started ? game.awayScore : null,
    }];
  });
}
