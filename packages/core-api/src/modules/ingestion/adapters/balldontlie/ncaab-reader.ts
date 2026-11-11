/**
 * The BALLDONTLIE NCAA men's basketball reads behind the adapter (#1496): each season's
 * tournament as an event, its teams with their seeds, every Division I team, and the
 * tournament's game scores. The bracket endpoint needs the GOAT tier; teams name no paid tier.
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import type { BalldontlieClient } from './balldontlie-client';
import { ncaabBracketListSchema, ncaabTeamListSchema, type NcaabBracketGame } from './ncaab-contract';
import {
  BRACKET_PATH,
  ncaabScopeId,
  TEAMS_PATH,
  toNcaabFieldParticipants,
  toNcaabGameScoreUpdates,
  toNcaabSportEvent,
  toNcaabTeamParticipant,
  type NcaabScope,
} from './ncaab-mapping';

/** A range spanning more seasons than this reads the last tournament and the next instead. */
const MAX_SEASONS_READ = 3;

/** The month (0-based) a new college basketball season is under way: November. */
const SEASON_START_MONTH = 10;

export class NcaabReader {
  constructor(
    private readonly client: BalldontlieClient,
    private readonly now: () => number,
  ) {}

  /**
   * The tournaments that start inside `dateRange`. A season's tournament is played in the spring
   * after it starts, so a range reads the seasons starting the year before each year it covers.
   * Without a range, or with one too wide to walk, it reads the last tournament and the next.
   */
  async upcomingEvents(dateRange?: DateRange): Promise<SportEvent[]> {
    const events: SportEvent[] = [];
    for (const season of this.seasonsFor(dateRange)) {
      const games = await this.bracketOf({ season });
      if (games.length > 0) events.push(toNcaabSportEvent({ season }, games));
    }
    return events.filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** The tournament with its teams; null when the vendor has no bracket for the season yet. */
  async eventDetails(scope: NcaabScope): Promise<SportEventDetail | null> {
    const games = await this.bracketOf(scope);
    if (games.length === 0) return null;
    const participants = toNcaabFieldParticipants(games);
    return { ...toNcaabSportEvent(scope, games, participants.length), participants };
  }

  /** Every Division I team. */
  async teams(): Promise<ProviderParticipant[]> {
    const page = await this.client.get(TEAMS_PATH, {}, ncaabTeamListSchema);
    return page.data.map(toNcaabTeamParticipant);
  }

  /** Every bracket game with its teams decided, with its state and score. */
  async liveScores(scope: NcaabScope): Promise<LiveScoreResult> {
    const games = await this.bracketOf(scope);
    return { category: 'GAME', externalEventId: ncaabScopeId(scope), games: toNcaabGameScoreUpdates(games) };
  }

  private bracketOf(scope: NcaabScope): Promise<NcaabBracketGame[]> {
    return this.client.getAllPages(BRACKET_PATH, { season: scope.season }, ncaabBracketListSchema);
  }

  private seasonsFor(dateRange?: DateRange): number[] {
    if (dateRange) {
      // Season s's tournament is played in calendar year s + 1, so the years from..to are
      // seasons from - 1 to to - 1.
      const first = dateRange.from.getUTCFullYear() - 1;
      const seasonCount = dateRange.to.getUTCFullYear() - first;
      if (seasonCount <= MAX_SEASONS_READ) return Array.from({ length: seasonCount }, (_, index) => first + index);
    }
    const today = new Date(this.now());
    const current = today.getUTCMonth() >= SEASON_START_MONTH ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    return [current - 1, current];
  }
}
