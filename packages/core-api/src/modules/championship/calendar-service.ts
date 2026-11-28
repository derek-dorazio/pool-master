/**
 * A league's championship calendar (#2021): its years open and closed, the year it is in now and
 * what still holds each open year open, so the web names a year from the API and never the clock.
 */

import type { LeagueChampionshipYearRepository } from '@poolmaster/shared/db';
import { type ChampionshipCalendar, championshipCalendar } from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';

export interface ChampionshipCalendarServiceDeps {
  years: Pick<LeagueChampionshipYearRepository, 'readCalendarInput'>;
  /** Only decides which drafts can never open, as the year close does. */
  now?: () => Date;
  logger?: Pick<FastifyBaseLogger, 'debug'>;
}

export class ChampionshipCalendarService {
  private readonly now: () => Date;

  constructor(private readonly deps: ChampionshipCalendarServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async getCalendar(leagueId: string): Promise<ChampionshipCalendar> {
    const calendar = championshipCalendar(await this.deps.years.readCalendarInput(leagueId, this.now()));
    this.deps.logger?.debug({ action: 'championship.calendar', data: { leagueId, currentYear: calendar.currentYear, yearCount: calendar.years.length } }, 'Read a championship calendar');
    return calendar;
  }
}
