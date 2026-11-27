/**
 * The BALLDONTLIE college football reads behind the adapter (#1496): each season's College
 * Football Playoff as an event, its season's games, every college football team, and the scores of
 * the games played around now. The vendor marks no playoff game, so the events sync places the
 * season's games by its Season slots' date windows (#2012). The games and teams endpoints name no
 * paid tier in the vendor's document.
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import type { BalldontlieClient } from './balldontlie-client';
import { ncaafGameListSchema, ncaafTeamListSchema, type NcaafGame } from './ncaaf-contract';
import {
  cfpScopeId,
  NCAAF_GAMES_PATH,
  NCAAF_TEAMS_PATH,
  teamsOfGames,
  toCfpEvent,
  toCfpGameScoreUpdates,
  toNcaafScheduledGames,
  toNcaafTeamParticipant,
  type CfpScope,
} from './ncaaf-mapping';

/** A range spanning more seasons than this reads none. */
const MAX_SEASONS_READ = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A `format: date` query value: the UTC calendar date. */
const calendarDate = (moment: Date) => moment.toISOString().slice(0, 10);

export class NcaafReader {
  constructor(
    private readonly client: BalldontlieClient,
    private readonly now: () => number,
  ) {}

  /**
   * One season's playoff, when `season` names it (the events sync asks for a Season by its id,
   * #2003); otherwise the seasons' playoffs whose first game starts inside `dateRange`. A season
   * runs from August into the next January, so a range reads the seasons from the year before it
   * starts to the year it ends. With neither, or a range too wide to walk, it reads none.
   */
  async upcomingEvents(dateRange?: DateRange, season?: number): Promise<SportEvent[]> {
    const events: SportEvent[] = [];
    for (const each of season === undefined ? this.seasonsFor(dateRange) : [season]) {
      const scope = { season: each };
      const games = await this.gamesOf(scope);
      if (games.length > 0) events.push(toCfpEvent(scope, games));
    }
    return events
      .filter((event) => season !== undefined || !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /**
   * The season's playoff with the teams its games have; null when the vendor has no game yet. The
   * feed names no field size: the field is the seeds placed on the event (#1715).
   */
  async eventDetails(scope: CfpScope): Promise<SportEventDetail | null> {
    const games = await this.gamesOf(scope);
    if (games.length === 0) return null;
    return { ...toCfpEvent(scope, games), participants: teamsOfGames(games), games: toNcaafScheduledGames(games) };
  }

  /** Every college football team the vendor lists. */
  async teams(): Promise<ProviderParticipant[]> {
    const page = await this.client.get(NCAAF_TEAMS_PATH, {}, ncaafTeamListSchema);
    return page.data.map((team) => toNcaafTeamParticipant(team, NCAAF_TEAMS_PATH));
  }

  /**
   * The games of yesterday, today and tomorrow (UTC), with their teams, state and score: the ones
   * that can be live now. The GAME writer links each only to the bracket match whose teams it has.
   */
  async liveScores(scope: CfpScope): Promise<LiveScoreResult> {
    const now = this.now();
    const dates = [now - MS_PER_DAY, now, now + MS_PER_DAY].map((moment) => calendarDate(new Date(moment)));
    const games = await this.client.getAllPages(NCAAF_GAMES_PATH, { 'dates[]': dates }, ncaafGameListSchema);
    return { category: 'GAME', externalEventId: cfpScopeId(scope), games: toCfpGameScoreUpdates(games) };
  }

  /** The season's games, numbered by the year the season starts, as the vendor numbers them. */
  private gamesOf(scope: CfpScope): Promise<NcaafGame[]> {
    return this.client.getAllPages(NCAAF_GAMES_PATH, { 'seasons[]': [scope.season] }, ncaafGameListSchema);
  }

  private seasonsFor(dateRange?: DateRange): number[] {
    if (!dateRange) return [];
    const first = dateRange.from.getUTCFullYear() - 1;
    const count = dateRange.to.getUTCFullYear() - first + 1;
    return count <= MAX_SEASONS_READ ? Array.from({ length: count }, (_, index) => first + index) : [];
  }
}
