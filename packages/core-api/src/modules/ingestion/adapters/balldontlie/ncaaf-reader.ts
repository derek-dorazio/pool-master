/**
 * The BALLDONTLIE college football reads behind the adapter (#1496): each season's College
 * Football Playoff as an event, the teams playing in its window, every college football team, and
 * the window's game scores. The games and teams endpoints name no paid tier in the vendor's
 * document.
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import type { BalldontlieClient } from './balldontlie-client';
import { ncaafGameListSchema, ncaafTeamListSchema, type NcaafGame } from './ncaaf-contract';
import {
  CFP_LEAGUE,
  cfpGamesOf,
  cfpScopeId,
  NCAAF_GAMES_PATH,
  NCAAF_TEAMS_PATH,
  toCfpEvent,
  toCfpFieldParticipants,
  toCfpGameScoreUpdates,
  toNcaafTeamParticipant,
  type CfpScope,
} from './ncaaf-mapping';

/** A range spanning more seasons than this reads the current and next season instead of every one. */
const MAX_SEASONS_READ = 3;

/** The month (0-based) a new season's playoff starts being listed: March, after the title game. */
const SEASON_ROLLOVER_MONTH = 2;

/** A `format: date` query value: the UTC calendar date. */
const calendarDate = (moment: Date) => moment.toISOString().slice(0, 10);

export class NcaafReader {
  constructor(
    private readonly client: BalldontlieClient,
    private readonly now: () => number,
  ) {}

  /**
   * The playoffs whose first game starts inside `dateRange`. A playoff runs from December into
   * the next January, so a range reads the seasons from the year before it starts to the year it
   * ends. Without a range, or with one too wide to walk, it reads the season under way and the
   * next.
   */
  async upcomingEvents(dateRange?: DateRange): Promise<SportEvent[]> {
    const events: SportEvent[] = [];
    for (const season of this.seasonsFor(dateRange)) {
      const scope = { season };
      const games = await this.gamesOf(scope);
      if (games.length > 0) events.push(toCfpEvent(scope, games, this.windowClosed(scope)));
    }
    return events
      .filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** The season's playoff with the teams playing in its window; null when the vendor has no game in it yet. */
  async eventDetails(scope: CfpScope): Promise<SportEventDetail | null> {
    const games = await this.gamesOf(scope);
    if (games.length === 0) return null;
    const participants = toCfpFieldParticipants(games);
    return { ...toCfpEvent(scope, games, this.windowClosed(scope), participants.length), participants };
  }

  /** Every college football team the vendor lists. */
  async teams(): Promise<ProviderParticipant[]> {
    const page = await this.client.get(NCAAF_TEAMS_PATH, {}, ncaafTeamListSchema);
    return page.data.map((team) => toNcaafTeamParticipant(team, NCAAF_TEAMS_PATH));
  }

  /** Every game in the season's window, with its teams, state and score. */
  async liveScores(scope: CfpScope): Promise<LiveScoreResult> {
    return { category: 'GAME', externalEventId: cfpScopeId(scope), games: toCfpGameScoreUpdates(await this.gamesOf(scope)) };
  }

  /**
   * The games inside the season's window. Asked for by date alone, not by `seasons[]`: how the
   * vendor numbers a January game's season is not documented, and the window names one season.
   */
  private async gamesOf(scope: CfpScope): Promise<NcaafGame[]> {
    const { from, to } = CFP_LEAGUE.window(scope.season);
    const games = await this.client.getAllPages(
      NCAAF_GAMES_PATH,
      { start_date: calendarDate(from), end_date: calendarDate(to) },
      ncaafGameListSchema,
    );
    return cfpGamesOf(scope, games);
  }

  private windowClosed(scope: CfpScope): boolean {
    return this.now() >= CFP_LEAGUE.window(scope.season).to.getTime();
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
