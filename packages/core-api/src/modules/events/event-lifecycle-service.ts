/**
 * EventLifecycleService — the one place a SportEvent's status changes and its
 * downstream side effects (contest activation, contest settlement, admin
 * audit) fire. Extracted from IngestionPersistence per plans/124 §3.3 so an
 * admin-triggered transition (a later slice) and a provider-triggered one
 * produce byte-identical downstream behavior — there is exactly one code
 * path for "what happens when a sport event's status changes."
 *
 * Provider-driven transitions (`actor.type === 'PROVIDER'`) stay permissive:
 * an undeclared jump in SPORT_EVENT_STATUS_TRANSITIONS is applied anyway,
 * only logged. Admin- and scheduler-driven transitions (`actor.type ===
 * 'ROOT_ADMIN'` or `'SYSTEM'`) are strict and throw EventLifecycleError
 * (422 SPORT_EVENT_INVALID_TRANSITION) on an undeclared jump, and write an
 * AdminAuditEntry. `SYSTEM` (the plans/124 §3.6 lifecycle scheduler)
 * attributes to the seeded "system" User row (plans/124 §9 item 11) since
 * AdminAuditEntry.actorId is a required FK.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ContestStatus, SportEventStatus, isDeclaredSportEventTransition, SYSTEM_USER_ID, SYSTEM_USER_EMAIL } from '@poolmaster/shared/domain';
import {
  renderSystemEmailTemplate,
  type ContestStartedEntrySummary,
  type MailDeliveryProvider,
} from '../email';
import { logAdminAction } from '../admin/admin-audit-service';

export interface CompletedSportEventSettlement {
  settleCompletedSportEvent(
    sportEventId: string,
    input?: { completedAt?: Date },
  ): Promise<unknown>;
}

export type SportEventStatusTransitionActor =
  | { type: 'PROVIDER' }
  | { type: 'ROOT_ADMIN'; userId: string; email: string }
  | { type: 'SYSTEM'; reason: string };

export interface SportEventStatusTransitionInput {
  sportEventId: string;
  toStatus: SportEventStatus;
  actor: SportEventStatusTransitionActor;
}

interface TransitionedSportEvent {
  id: string;
  providerId: string;
  externalId: string;
  name: string;
  startDate: Date;
  endDate: Date | null;
  status: SportEventStatus;
}

export interface SportEventStatusTransitionResult {
  sportEvent: TransitionedSportEvent;
  fromStatus: SportEventStatus;
  toStatus: SportEventStatus;
}

export class EventLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: string = 'SPORT_EVENT_INVALID_TRANSITION',
    readonly statusCode: number = 422,
  ) {
    super(message);
    this.name = 'EventLifecycleError';
  }
}

interface ContestStartedEmailUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  username: string;
  isActive: boolean;
}

interface ContestStartedCandidate {
  id: string;
  leagueId: string;
  name: string;
  league: {
    name: string;
    leagueCode: string;
    memberships: Array<{
      role: string;
      user: ContestStartedEmailUser;
    }>;
  };
  sportEvent: {
    name: string;
    startDate: Date;
  } | null;
  entries: Array<{
    id: string;
    name: string;
    squad: {
      name: string;
      memberships: Array<{
        user: ContestStartedEmailUser;
      }>;
    };
  }>;
}

export class EventLifecycleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
    private readonly mailDelivery?: MailDeliveryProvider,
    private readonly appBaseUrl = 'http://localhost:5173',
    private readonly golfContestSettlement?: CompletedSportEventSettlement,
  ) {}

  async applySportEventStatusTransition(
    input: SportEventStatusTransitionInput,
  ): Promise<SportEventStatusTransitionResult> {
    const before = await this.prisma.sportEvent.findUniqueOrThrow({
      where: { id: input.sportEventId },
    });
    const fromStatus = before.status as SportEventStatus;
    const isStrict = input.actor.type !== 'PROVIDER';

    if (fromStatus !== input.toStatus && !isDeclaredSportEventTransition(fromStatus, input.toStatus)) {
      if (isStrict) {
        throw new EventLifecycleError(
          `Sport event ${input.sportEventId} cannot transition from ${fromStatus} to ${input.toStatus}`,
        );
      }
      this.logger?.warn({
        sportEventId: input.sportEventId,
        fromStatus,
        toStatus: input.toStatus,
        actor: input.actor.type,
      }, 'Provider-driven sport event transition is not in the declared transition map; applying it anyway');
    }

    const updated = await this.prisma.sportEvent.update({
      where: { id: input.sportEventId },
      data: {
        status: input.toStatus,
        ...(input.toStatus === SportEventStatus.COMPLETED && !before.endDate
          ? { endDate: new Date() }
          : {}),
      },
    });

    if (input.toStatus === SportEventStatus.IN_PROGRESS) {
      await this.activateContestsForStartedEvent(updated);
    }
    if (input.toStatus === SportEventStatus.COMPLETED) {
      await this.settleContestsForCompletedEvent(updated);
    }
    if (input.actor.type === 'ROOT_ADMIN' || input.actor.type === 'SYSTEM') {
      await this.writeTransitionAuditEntry(updated, fromStatus, input.toStatus, input.actor);
    }

    return {
      sportEvent: updated as TransitionedSportEvent,
      fromStatus,
      toStatus: input.toStatus,
    };
  }

  private async writeTransitionAuditEntry(
    sportEvent: TransitionedSportEvent,
    fromStatus: SportEventStatus,
    toStatus: SportEventStatus,
    actor: { type: 'ROOT_ADMIN'; userId: string; email: string } | { type: 'SYSTEM'; reason: string },
  ): Promise<void> {
    const actorUserId = actor.type === 'ROOT_ADMIN' ? actor.userId : SYSTEM_USER_ID;
    const actorEmail = actor.type === 'ROOT_ADMIN' ? actor.email : SYSTEM_USER_EMAIL;
    const description = actor.type === 'ROOT_ADMIN'
      ? `Root-admin transitioned sport event ${sportEvent.name} from ${fromStatus} to ${toStatus}`
      : `Scheduler transitioned sport event ${sportEvent.name} from ${fromStatus} to ${toStatus} (${actor.reason})`;

    await logAdminAction({
      actorUserId,
      actorEmail,
      action: 'sport_event.transition',
      resourceType: 'SPORT_EVENT',
      resourceId: sportEvent.id,
      description,
      beforeState: { status: fromStatus },
      afterState: { status: toStatus },
    });
  }

  private async settleContestsForCompletedEvent(
    sportEvent: TransitionedSportEvent,
  ): Promise<void> {
    if (!this.golfContestSettlement) {
      return;
    }

    await this.golfContestSettlement.settleCompletedSportEvent(sportEvent.id, {
      completedAt: sportEvent.endDate ?? sportEvent.startDate,
    });
  }

  private async activateContestsForStartedEvent(
    sportEvent: TransitionedSportEvent,
  ): Promise<void> {
    const candidates = await this.prisma.contest.findMany({
      where: {
        sportEventId: sportEvent.id,
        status: { in: [ContestStatus.OPEN, ContestStatus.LOCKED] },
      },
      select: {
        id: true,
        leagueId: true,
        name: true,
        league: {
          select: {
            name: true,
            leagueCode: true,
            memberships: {
              where: { status: 'ACTIVE', role: 'COMMISSIONER' },
              select: {
                role: true,
                user: {
                  select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    username: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        },
        sportEvent: {
          select: {
            name: true,
            startDate: true,
          },
        },
        entries: {
          where: { status: 'ACTIVE' },
          orderBy: [{ entryNumber: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            squad: {
              select: {
                name: true,
                memberships: {
                  where: { status: 'ACTIVE' },
                  select: {
                    user: {
                      select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        username: true,
                        isActive: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }) as ContestStartedCandidate[];

    for (const contest of candidates) {
      const update = await this.prisma.contest.updateMany({
        where: {
          id: contest.id,
          status: { in: [ContestStatus.OPEN, ContestStatus.LOCKED] },
        },
        data: {
          status: ContestStatus.ACTIVE,
          startsAt: sportEvent.startDate,
        },
      });

      if (update.count === 0) {
        this.logger?.debug({
          contestId: contest.id,
          sportEventId: sportEvent.id,
          providerId: sportEvent.providerId,
          eventExternalId: sportEvent.externalId,
        }, 'Skipped contest started email because contest was already active');
        continue;
      }

      this.logger?.info({
        contestId: contest.id,
        sportEventId: sportEvent.id,
        providerId: sportEvent.providerId,
        eventExternalId: sportEvent.externalId,
      }, 'Activated contest from in-progress sport event');
      await this.deliverContestStartedSummaryEmails(contest, sportEvent);
    }
  }

  private async deliverContestStartedSummaryEmails(
    contest: ContestStartedCandidate,
    sportEvent: TransitionedSportEvent,
  ): Promise<void> {
    if (!this.mailDelivery) {
      this.logger?.debug({
        contestId: contest.id,
        leagueId: contest.leagueId,
      }, 'Skipped contest started summary email because mail delivery is unavailable');
      return;
    }

    const recipients = collectContestStartedRecipients(contest);
    const entries = buildContestStartedEntrySummary(contest);
    const eventName = contest.sportEvent?.name ?? sportEvent.name;
    const startedAt = contest.sportEvent?.startDate ?? sportEvent.startDate;
    const contestUrl = buildContestUrl(
      this.appBaseUrl,
      contest.league.leagueCode,
      contest.id,
    );

    for (const user of recipients) {
      const message = renderSystemEmailTemplate('CONTEST_STARTED_SUMMARY', {
        userName: formatUserName(user),
        leagueName: contest.league.name,
        contestName: contest.name,
        eventName,
        contestUrl,
        startedAt,
        entryCount: contest.entries.length,
        entries,
      });

      try {
        await this.mailDelivery.send({
          to: user.email,
          subject: message.subject,
          text: message.text,
          html: message.html,
          metadata: {
            templateKey: message.templateKey,
            leagueId: contest.leagueId,
            contestId: contest.id,
          },
        });
        this.logger?.info({
          contestId: contest.id,
          leagueId: contest.leagueId,
          userId: user.id,
          templateKey: message.templateKey,
        }, 'Delivered contest started summary email');
      } catch (err) {
        this.logger?.error({
          contestId: contest.id,
          leagueId: contest.leagueId,
          userId: user.id,
          templateKey: message.templateKey,
          error: err instanceof Error ? err.message : String(err),
        }, 'Failed to deliver contest started summary email');
      }
    }
  }
}

function collectContestStartedRecipients(
  contest: ContestStartedCandidate,
): ContestStartedEmailUser[] {
  const recipients = new Map<string, ContestStartedEmailUser>();
  const addUser = (user: ContestStartedEmailUser) => {
    if (!user.isActive) return;
    recipients.set(user.id, user);
  };

  for (const membership of contest.league.memberships) {
    addUser(membership.user);
  }
  for (const entry of contest.entries) {
    for (const membership of entry.squad.memberships) {
      addUser(membership.user);
    }
  }

  return Array.from(recipients.values());
}

function buildContestStartedEntrySummary(
  contest: ContestStartedCandidate,
): ContestStartedEntrySummary[] {
  return contest.entries.map((entry) => ({
    entryName: entry.name,
    teamName: entry.squad.name,
  }));
}

function formatUserName(user: ContestStartedEmailUser): string {
  const fullName = [user.firstName, user.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  return fullName || user.username || user.email;
}

function buildContestUrl(
  appBaseUrl: string,
  leagueCode: string,
  contestId: string,
): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/league/${encodeURIComponent(leagueCode)}/contests/${encodeURIComponent(contestId)}`;
}
