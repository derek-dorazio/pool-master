/**
 * "Event still in draft" (#845, catalog row G1): an event that starts within 7 days and is still
 * a draft is invisible to commissioners, so no league can build a contest on it. Every active
 * root admin is told what it still needs before release, once a day until it is released or
 * starts.
 *
 * The lifecycle scheduler's "notifications due" step calls `queueDue` on every sweep. The
 * outbox idempotency key is the event, the whole days left until it starts and the person, so
 * each day's email is queued once and the next day's is a new one.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SportEventRepository, UserRepository } from '@poolmaster/shared/db';
import { SportEventStatus, type SportEvent, type User } from '@poolmaster/shared/domain';
import { emailRecipientOf, buildSportEventAdminUrl, type EmailService } from '../email';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import type { SportEventService } from '../events/service';

const DAY_MS = 24 * 60 * 60_000;
/** G1 starts this many days before an event starts. */
const WARN_DAYS = 7;

export interface DraftEventNoticeDeps {
  sportEvents: Pick<SportEventRepository, 'findAll'>;
  /** What each draft event still needs before it can be released. */
  releaseReadiness: Pick<SportEventService, 'releaseBlockersOf'>;
  users: Pick<UserRepository, 'findActiveRootAdmins'>;
  email: Pick<EmailService, 'send'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

export class DraftEventNotices implements DueNotifications {
  constructor(private readonly deps: DraftEventNoticeDeps) {}

  async queueDue(now: Date): Promise<void> {
    const drafts = await this.deps.sportEvents.findAll({
      statuses: [SportEventStatus.DRAFT],
      startsFrom: new Date(now.getTime() + 1),
      startsBefore: new Date(now.getTime() + WARN_DAYS * DAY_MS + 1),
    });
    if (drafts.length === 0) return;
    const rootAdmins = await this.deps.users.findActiveRootAdmins();
    for (const sportEvent of drafts) {
      try {
        await this.queueOne(sportEvent, rootAdmins, now);
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.eventStillDraft.failed',
          data: { sportEventId: sportEvent.id, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue the event still in draft email');
      }
    }
  }

  private async queueOne(
    sportEvent: SportEvent,
    rootAdmins: User[],
    now: Date,
  ): Promise<void> {
    const daysLeft = Math.ceil((sportEvent.startDate.getTime() - now.getTime()) / DAY_MS);
    const stillNeeded = await this.deps.releaseReadiness.releaseBlockersOf(sportEvent.id);
    const eventAdminUrl = buildSportEventAdminUrl(this.deps.appBaseUrl, sportEvent.sport, sportEvent.id);
    for (const user of rootAdmins) {
      await this.deps.email.send('EVENT_STILL_DRAFT', {
        to: emailRecipientOf(user),
        about: `${sportEvent.id}:${sportEvent.startDate.toISOString()}:${daysLeft}-days`,
        data: {
          firstName: user.firstName || user.username,
          eventName: sportEvent.name,
          startsAt: sportEvent.startDate,
          daysLeft,
          stillNeeded,
          eventAdminUrl,
        },
      });
    }
  }
}
