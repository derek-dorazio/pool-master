/**
 * The BALLDONTLIE Premier League reads behind the adapter (#1496): a season's matches grouped
 * into matchweek events, a matchweek's teams, the season's teams, and a matchweek's scores. The
 * matches endpoint filters by season, dates or teams but not by matchweek, so a matchweek is read
 * as its season's matches (about four pages) and picked out by round number. The matches and
 * teams endpoints name no paid tier in the vendor's document.
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import type { BalldontlieClient } from './balldontlie-client';
import {
  EPL_MATCHES_PATH,
  EPL_TEAMS_PATH,
  eplScopeId,
  matchesByMatchweek,
  toEplFieldParticipants,
  toEplGameScoreUpdates,
  toEplMatchweekEvent,
  toEplMatchweekEvents,
  toEplTeamParticipant,
  type EplScope,
} from './epl-mapping';
import { soccerMatchListSchema, soccerTeamListSchema, type SoccerMatch } from './soccer-contract';

/** A range spanning more seasons than this reads the season under way and the next instead. */
const MAX_SEASONS_READ = 3;

/** The month (0-based) the next season's fixtures are out and its matchweeks are listed: July. */
const SEASON_ROLLOVER_MONTH = 6;

export class EplReader {
  constructor(
    private readonly client: BalldontlieClient,
    private readonly now: () => number,
  ) {}

  /**
   * The matchweeks that start inside `dateRange`. A season runs from August into the next May,
   * so a range reads the seasons starting the year before it to the year it ends. Without a
   * range, or with one too wide to walk, it reads the season under way and the next.
   */
  async upcomingEvents(dateRange?: DateRange): Promise<SportEvent[]> {
    const events: SportEvent[] = [];
    for (const season of this.seasonsFor(dateRange)) {
      events.push(...toEplMatchweekEvents(season, await this.matchesOf(season)));
    }
    return events.filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** The matchweek with its teams; null when the vendor has no match in it. */
  async eventDetails(scope: EplScope): Promise<SportEventDetail | null> {
    const matches = await this.matchweekOf(scope);
    if (matches.length === 0) return null;
    const teams = await this.client.get(EPL_TEAMS_PATH, { season: scope.season }, soccerTeamListSchema);
    const participants = toEplFieldParticipants(matches, teams.data);
    return { ...toEplMatchweekEvent(scope, matches, participants.length), participants };
  }

  /** The teams of the season under way. */
  async teams(): Promise<ProviderParticipant[]> {
    const [current] = this.seasonsFor();
    const page = await this.client.get(EPL_TEAMS_PATH, { season: current }, soccerTeamListSchema);
    return page.data.map(toEplTeamParticipant);
  }

  /** Every match of the matchweek, with its teams, state and score. */
  async liveScores(scope: EplScope): Promise<LiveScoreResult> {
    return { category: 'GAME', externalEventId: eplScopeId(scope), games: toEplGameScoreUpdates(await this.matchweekOf(scope)) };
  }

  private async matchweekOf(scope: EplScope): Promise<SoccerMatch[]> {
    return matchesByMatchweek(await this.matchesOf(scope.season)).get(scope.matchweek) ?? [];
  }

  private matchesOf(season: number): Promise<SoccerMatch[]> {
    return this.client.getAllPages(EPL_MATCHES_PATH, { season }, soccerMatchListSchema);
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
