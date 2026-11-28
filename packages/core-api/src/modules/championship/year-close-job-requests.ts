/**
 * The jobs that close a league's championship year (#2021, plan §9c): their payloads, the
 * requests, and the handlers that collect them. A year closes once every contest in it is final
 * and every Season of it, in the sport leagues the league ran contests in, has finished its last
 * slot; so a contest going final and a Season slot moving are the two writes that can close one.
 * Each job reads the year as it stands when it runs and closes it at most once. The dedupe key
 * holds one job waiting per contest and per Season slot.
 */

import { z } from 'zod';
import { BackgroundJobType, ContestStatus, SeasonSlotStatus } from '@poolmaster/shared/domain';
import type { DomainEventType } from '../domain-events/domain-event';
import type { DomainEventHandler } from '../domain-events/domain-event-handler';

export const CloseLeagueChampionshipYearJobPayloadSchema = z.object({
  contestId: z.string().min(1),
});

export const CloseSeasonChampionshipYearsJobPayloadSchema = z.object({
  sportEventId: z.string().min(1),
  seasonSlotId: z.string().min(1),
});

/** A contest gone final can close its league's year. */
export const closeLeagueChampionshipYearHandler: DomainEventHandler<typeof DomainEventType.CONTEST_STATUS_CHANGED> = {
  key: 'close-league-championship-year',
  queues: [BackgroundJobType.CLOSE_LEAGUE_CHAMPIONSHIP_YEAR],
  when: (event) => event.to === ContestStatus.COMPLETED,
  jobs: (event, { queue }) => [queue.request(BackgroundJobType.CLOSE_LEAGUE_CHAMPIONSHIP_YEAR, { contestId: event.contest.id }, {
    dedupeKey: `${BackgroundJobType.CLOSE_LEAGUE_CHAMPIONSHIP_YEAR}:${event.contest.id}`,
  })],
};

/** The Season slot statuses that leave nothing to play in the slot. */
const FINISHED_SLOT_STATUSES: ReadonlySet<SeasonSlotStatus> = new Set([SeasonSlotStatus.COMPLETED, SeasonSlotStatus.CANCELLED]);

/**
 * A Season slot finished or cancelled can close the year of each league with a contest in its
 * Season. A slot starting never can: it is unfinished itself, so the year closes only once it
 * ends, which is its own event. A job, since it reaches every such league.
 */
export const closeSeasonChampionshipYearsHandler: DomainEventHandler<typeof DomainEventType.SEASON_SLOT_STATUS_CHANGED> = {
  key: 'close-season-championship-years',
  queues: [BackgroundJobType.CLOSE_SEASON_CHAMPIONSHIP_YEARS],
  when: (event) => FINISHED_SLOT_STATUSES.has(event.to),
  jobs: (event, { queue }) => [queue.request(
    BackgroundJobType.CLOSE_SEASON_CHAMPIONSHIP_YEARS,
    { sportEventId: event.sportEventId, seasonSlotId: event.seasonSlotId },
    { dedupeKey: `${BackgroundJobType.CLOSE_SEASON_CHAMPIONSHIP_YEARS}:${event.seasonSlotId}` },
  )],
};
