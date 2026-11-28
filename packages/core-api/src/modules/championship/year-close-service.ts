/**
 * The championship year close (#2021, plan §9c): a league's year closes when every contest in it
 * is final (drafts that can never open aside) and every Season of that year, in the sport leagues
 * the league ran contests in, has finished its last slot. Closed once, stored once
 * (`LeagueChampionshipYear`), and never reopened; no clock decides it. Run by the jobs a contest
 * going final and a Season slot moving queue (`year-close-job-requests.ts`).
 */

import type { LeagueChampionshipYearKey, LeagueChampionshipYearRepository } from '@poolmaster/shared/db';
import type { FastifyBaseLogger } from 'fastify';

export interface ChampionshipYearCloseServiceDeps {
  years: Pick<LeagueChampionshipYearRepository, 'isClosed' | 'readYearState' | 'close' | 'findContestYear' | 'findLeagueYearsOfSeasonSlot'>;
  now?: () => Date;
  logger?: Pick<FastifyBaseLogger, 'debug' | 'info'>;
}

/** How many years a run closed, as a job answers. */
export interface YearCloseResult {
  changedCount: number;
}

export class ChampionshipYearCloseService {
  private readonly now: () => Date;

  constructor(private readonly deps: ChampionshipYearCloseServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Closes the year of a contest that went final, when nothing else holds it open. */
  async closeContestYear(contestId: string): Promise<YearCloseResult> {
    const key = await this.deps.years.findContestYear(contestId);
    if (key === null) return { changedCount: 0 };
    return { changedCount: await this.closeYear(key) ? 1 : 0 };
  }

  /** Closes the year of each league with a contest in the Season slot's Season, when nothing holds it open. */
  async closeSeasonYears(seasonSlotId: string): Promise<YearCloseResult> {
    const keys = await this.deps.years.findLeagueYearsOfSeasonSlot(seasonSlotId);
    let changedCount = 0;
    for (const key of keys) {
      if (await this.closeYear(key)) changedCount += 1;
    }
    return { changedCount };
  }

  /** Closes one league's year when nothing holds it open; false when it stays open or was closed already. */
  async closeYear(key: LeagueChampionshipYearKey): Promise<boolean> {
    if (await this.deps.years.isClosed(key)) return false;
    const now = this.now();
    const state = await this.deps.years.readYearState(key, now);
    if (state.contestCount === 0 || state.unfinishedContestCount > 0 || state.unfinishedSeasonSlotCount > 0) {
      this.deps.logger?.debug({ action: 'championship.year.open', data: { ...key, ...state } }, 'Championship year still open');
      return false;
    }
    const closed = await this.deps.years.close(key, now);
    if (closed) this.deps.logger?.info({ action: 'championship.year.closed', data: { ...key, closedAt: now } }, 'Closed a championship year');
    return closed;
  }
}
