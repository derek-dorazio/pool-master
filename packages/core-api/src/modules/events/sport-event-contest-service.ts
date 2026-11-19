/**
 * The customer contests on one sport event (#1889), for the root admin's Event page: every one,
 * across every league, read-only.
 */
import type { SportEventContestReader } from '@poolmaster/shared/db';
import type { SportEventContest } from '@poolmaster/shared/domain';
import type { SportEventService } from './service';

export interface SportEventContestServiceDeps {
  sportEvents: Pick<SportEventService, 'requireEvent'>;
  reader: SportEventContestReader;
}

export class SportEventContestService {
  constructor(private readonly deps: SportEventContestServiceDeps) {}

  /** 404 EVENT_NOT_FOUND for an unknown event; a draft event's contests are listed too (it has none until released). */
  async listContests(sportEventId: string): Promise<SportEventContest[]> {
    await this.deps.sportEvents.requireEvent(sportEventId);
    return this.deps.reader.findContests(sportEventId);
  }
}
