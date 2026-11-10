/**
 * The BALLDONTLIE NFL reads behind the adapter (#1496): the season's games grouped into events
 * (a regular season week, or the postseason), a scope's teams, every NFL team, and a scope's
 * game scores. The games and teams endpoints name no paid tier in the vendor's document.
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import type { BalldontlieClient } from './balldontlie-client';
import { NflSeasonType, nflGameListSchema, nflTeamListSchema, type NflGame } from './nfl-contract';
import {
  nflScopeId,
  NflScopeKind,
  seasonTypeOf,
  toGameScoreUpdates,
  toNflFieldParticipants,
  toNflSportEvent,
  toNflSportEvents,
  toNflTeamParticipant,
  type NflScope,
} from './nfl-mapping';

const GAMES_PATH = '/nfl/v1/games';
const TEAMS_PATH = '/nfl/v1/teams';

/** A range spanning more seasons than this reads the current and next season instead of every one. */
const MAX_SEASONS_READ = 3;

/** The month (0-based) a new NFL season's events start being listed: March, after the Super Bowl. */
const SEASON_ROLLOVER_MONTH = 2;

export class NflReader {
  constructor(
    private readonly client: BalldontlieClient,
    private readonly now: () => number,
  ) {}

  /**
   * The events whose games start inside `dateRange`. An NFL season runs from September into the
   * next February, so a range reads the seasons from the year before it starts to the year it
   * ends. Without a range, or with one too wide to walk, it reads the season under way and the
   * next: every NFL game ever played is no catalog.
   */
  async upcomingEvents(dateRange?: DateRange): Promise<SportEvent[]> {
    const games: NflGame[] = [];
    for (const season of this.seasonsFor(dateRange)) {
      games.push(...await this.client.getAllPages(
        GAMES_PATH,
        { 'seasons[]': [season], 'season_types[]': [NflSeasonType.REGULAR_SEASON, NflSeasonType.POSTSEASON] },
        nflGameListSchema,
      ));
    }
    return toNflSportEvents(games)
      .filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** The scope with the teams playing its games; null when the vendor has no game in it yet. */
  async eventDetails(scope: NflScope): Promise<SportEventDetail | null> {
    const games = await this.gamesOf(scope);
    if (games.length === 0) return null;
    const participants = toNflFieldParticipants(games);
    return { ...toNflSportEvent(scope, games, participants.length), participants };
  }

  /** Every NFL team. */
  async teams(): Promise<ProviderParticipant[]> {
    const page = await this.client.get(TEAMS_PATH, {}, nflTeamListSchema);
    return page.data.map((team) => toNflTeamParticipant(team, TEAMS_PATH));
  }

  /** Every game of the scope, with its teams, state and score. */
  async liveScores(scope: NflScope): Promise<LiveScoreResult> {
    const games = await this.gamesOf(scope);
    return { category: 'GAME', externalEventId: nflScopeId(scope), games: toGameScoreUpdates(games) };
  }

  private gamesOf(scope: NflScope): Promise<NflGame[]> {
    return this.client.getAllPages(
      GAMES_PATH,
      {
        'seasons[]': [scope.season],
        'season_types[]': [seasonTypeOf(scope)],
        'weeks[]': scope.kind === NflScopeKind.WEEK ? [scope.week] : undefined,
      },
      nflGameListSchema,
    );
  }

  private seasonsFor(dateRange?: DateRange): number[] {
    if (dateRange) {
      const first = dateRange.from.getUTCFullYear() - 1;
      const count = dateRange.to.getUTCFullYear() - first + 1;
      if (count <= MAX_SEASONS_READ) return Array.from({ length: count }, (_, index) => first + index);
    }
    const today = new Date(this.now());
    const current = today.getUTCMonth() >= SEASON_ROLLOVER_MONTH ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    return [current, current + 1];
  }
}
