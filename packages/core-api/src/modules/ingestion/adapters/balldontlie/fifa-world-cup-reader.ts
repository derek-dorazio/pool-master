/**
 * The BALLDONTLIE FIFA World Cup reads behind the adapter (#1496): each edition's knockout
 * bracket as an event, its teams decided so far, an edition's teams, and the bracket's scores.
 * The matches endpoint needs the GOAT tier; the teams endpoint names no paid tier.
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import type { BalldontlieClient, BalldontlieQuery } from './balldontlie-client';
import { fifaMatchListSchema, fifaTeamListSchema, type FifaMatch } from './fifa-world-cup-contract';
import {
  FIFA_WC_MATCHES_PATH,
  FIFA_WC_TEAMS_PATH,
  knockoutMatchesOf,
  toWorldCupEvent,
  toWorldCupEvents,
  toWorldCupFieldParticipants,
  toWorldCupGameScoreUpdates,
  toWorldCupTeamParticipant,
  worldCupScopeId,
  type WorldCupScope,
} from './fifa-world-cup-mapping';

/** A range holding more editions than this reads the current edition instead. */
const MAX_EDITIONS_READ = 3;

/** The first edition the vendor serves; editions come every four years from it. */
const FIRST_EDITION = 2018;
const YEARS_BETWEEN_EDITIONS = 4;

export class WorldCupReader {
  constructor(private readonly client: BalldontlieClient) {}

  /**
   * The knockout brackets that start inside `dateRange`, read for each edition held in a year
   * it covers. Without a range, or with one too wide to walk, it reads the vendor's current
   * edition, which the endpoint gives when no edition is named.
   */
  async upcomingEvents(dateRange?: DateRange): Promise<SportEvent[]> {
    const editions = editionsIn(dateRange);
    if (editions !== null && editions.length === 0) return [];
    const matches = await this.matchesOf(editions === null ? {} : { 'seasons[]': editions });
    return toWorldCupEvents(matches)
      .filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** The edition's knockout bracket with the teams decided so far; null when the vendor lists none. */
  async eventDetails(scope: WorldCupScope): Promise<SportEventDetail | null> {
    const matches = await this.knockoutOf(scope);
    if (matches.length === 0) return null;
    const participants = toWorldCupFieldParticipants(matches);
    return { ...toWorldCupEvent(scope, matches, participants.length), participants };
  }

  /** The current edition's teams. */
  async teams(): Promise<ProviderParticipant[]> {
    const page = await this.client.get(FIFA_WC_TEAMS_PATH, {}, fifaTeamListSchema);
    return page.data.map((team) => toWorldCupTeamParticipant(team, FIFA_WC_TEAMS_PATH));
  }

  /** Every knockout match with both teams decided, with its state, score and any shoot-out. */
  async liveScores(scope: WorldCupScope): Promise<LiveScoreResult> {
    return { category: 'GAME', externalEventId: worldCupScopeId(scope), games: toWorldCupGameScoreUpdates(await this.knockoutOf(scope)) };
  }

  private async knockoutOf(scope: WorldCupScope): Promise<FifaMatch[]> {
    return knockoutMatchesOf(await this.matchesOf({ 'seasons[]': [scope.season] }));
  }

  private matchesOf(query: BalldontlieQuery): Promise<FifaMatch[]> {
    return this.client.getAllPages(FIFA_WC_MATCHES_PATH, query, fifaMatchListSchema);
  }
}

/**
 * The editions held in the years a range covers; null for no range, or a range holding too many
 * to name one by one.
 */
function editionsIn(dateRange?: DateRange): number[] | null {
  if (!dateRange) return null;
  const editions: number[] = [];
  for (let year = dateRange.from.getUTCFullYear(); year <= dateRange.to.getUTCFullYear(); year += 1) {
    if (year >= FIRST_EDITION && (year - FIRST_EDITION) % YEARS_BETWEEN_EDITIONS === 0) editions.push(year);
    if (editions.length > MAX_EDITIONS_READ) return null;
  }
  return editions;
}
