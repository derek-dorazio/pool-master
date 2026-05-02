/**
 * IngestionPersistence — persists ingested data to the database via Prisma.
 *
 * Called by ingestion callbacks to upsert sport events, participants,
 * and rankings received from data providers.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ContestStatus, type Sport } from '@poolmaster/shared/domain';
import type {
  SportEvent,
  SportEventDetail,
  ProviderParticipant,
  ProviderRanking,
} from '../core/provider-interface';
import type { IngestionJobRecord } from '../core/ingestion-scheduler';
import {
  resolveEventTiming,
  selectTimingPolicy,
} from '../../events/operational-timing';
import {
  renderSystemEmailTemplate,
  type ContestStartedEntrySummary,
  type MailDeliveryProvider,
} from '../../email';

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

export class IngestionPersistence {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
    private readonly mailDelivery?: MailDeliveryProvider,
    private readonly appBaseUrl = 'http://localhost:5173',
  ) {}

  /**
   * Upsert sport events by (providerId, externalId).
   * Returns the number of events persisted.
   */
  async persistEvents(events: SportEvent[]): Promise<number> {
    let count = 0;
    this.logger?.debug({
      count: events.length,
      events: events.slice(0, 10).map((event) => ({
        providerId: event.providerId,
        externalId: event.externalId,
        sport: event.sport,
        name: event.name,
        status: event.status,
        startDate: event.startDate.toISOString(),
        releaseAt: event.metadata.releaseAt ?? null,
        fieldLocksAt: event.metadata.fieldLocksAt ?? null,
      })),
    }, 'Persisting sport events from ingestion');

    for (const event of events) {
      const timingPolicy = await this.resolveTimingPolicy(event.sport, event.metadata);
      const resolvedTiming = resolveEventTiming({
        sport: event.sport,
        startDate: event.startDate,
        metadata: event.metadata,
      }, timingPolicy);

      const persistedEvent = await this.prisma.sportEvent.upsert({
        where: {
          providerId_externalId: {
            providerId: event.providerId,
            externalId: event.externalId,
          },
        },
        create: {
          externalId: event.externalId,
          providerId: event.providerId,
          sport: event.sport,
          name: event.name,
          venue: event.venue ?? null,
          location: event.location ?? null,
          startDate: event.startDate,
          endDate: event.endDate ?? null,
          status: event.status,
          rounds: event.rounds ?? null,
          participantCount: event.participantCount ?? null,
          releaseAt: resolvedTiming.releaseAt,
          fieldLocksAt: resolvedTiming.fieldLocksAt,
          fieldLocked: event.fieldLocked,
          metadata: event.metadata as any,
        },
        update: {
          name: event.name,
          venue: event.venue ?? null,
          location: event.location ?? null,
          startDate: event.startDate,
          endDate: event.endDate ?? null,
          status: event.status,
          rounds: event.rounds ?? null,
          participantCount: event.participantCount ?? null,
          releaseAt: resolvedTiming.releaseAt,
          fieldLocksAt: resolvedTiming.fieldLocksAt,
          fieldLocked: event.fieldLocked,
          metadata: event.metadata as any,
        },
      });
      await this.activateContestsForStartedEvent(persistedEvent.id, event);
      count++;
      this.logger?.debug({
        providerId: event.providerId,
        externalId: event.externalId,
        sport: event.sport,
        name: event.name,
        releaseAt: resolvedTiming.releaseAt.toISOString(),
        fieldLocksAt: resolvedTiming.fieldLocksAt.toISOString(),
        providerFieldLocked: event.fieldLocked,
      }, 'Persisted sport event from ingestion');
    }

    this.logger?.info({ count }, 'Persisted sport events from ingestion');
    return count;
  }

  private async activateContestsForStartedEvent(
    sportEventId: string,
    event: SportEvent,
  ): Promise<void> {
    if (event.status !== 'IN_PROGRESS') {
      return;
    }

    const candidates = await this.prisma.contest.findMany({
      where: {
        sportEventId,
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
          startsAt: event.startDate,
        },
      });

      if (update.count === 0) {
        this.logger?.debug({
          contestId: contest.id,
          sportEventId,
          providerId: event.providerId,
          eventExternalId: event.externalId,
        }, 'Skipped contest started email because contest was already active');
        continue;
      }

      this.logger?.info({
        contestId: contest.id,
        sportEventId,
        providerId: event.providerId,
        eventExternalId: event.externalId,
      }, 'Activated contest from in-progress sport event');
      await this.deliverContestStartedSummaryEmails(contest, event);
    }
  }

  private async deliverContestStartedSummaryEmails(
    contest: ContestStartedCandidate,
    event: SportEvent,
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
    const eventName = contest.sportEvent?.name ?? event.name;
    const startedAt = contest.sportEvent?.startDate ?? event.startDate;
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

  async persistIngestionJob(job: IngestionJobRecord): Promise<void> {
    this.logger?.debug({
      jobType: job.jobType,
      providerId: job.providerId,
      sport: job.sport,
      eventExternalId: job.eventExternalId ?? null,
      status: job.status,
      recordsProcessed: job.recordsProcessed,
      errors: job.errors,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
    }, 'Persisting ingestion job completion');

    await this.prisma.ingestionJob.create({
      data: {
        jobType: job.jobType,
        providerId: job.providerId,
        sport: job.sport,
        eventExternalId: job.eventExternalId ?? null,
        status: job.status,
        startedAt: job.startedAt ?? null,
        completedAt: job.completedAt ?? null,
        recordsProcessed: job.recordsProcessed,
        errors: job.errors,
        errorLog: job.errorLog as any,
      },
    });

    this.logger?.info({
      jobType: job.jobType,
      providerId: job.providerId,
      sport: job.sport,
      eventExternalId: job.eventExternalId ?? null,
      status: job.status,
      recordsProcessed: job.recordsProcessed,
      errors: job.errors,
    }, 'Persisted ingestion job completion');
  }

  private async resolveTimingPolicy(
    sport: Sport,
    metadata: Record<string, unknown>,
  ) {
    const policies = await this.prisma.contestTimingPolicy.findMany({
      where: {
        sport,
        active: true,
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    return selectTimingPolicy(
      policies,
      metadata,
    );
  }

  /**
   * Upsert participants by external ID via the provider mapping table.
   *
   * For each provider participant:
   * 1. Look up ParticipantProviderMapping by (providerId, externalId)
   * 2. If found — update the linked Participant record
   * 3. If not found — resolve the Sport, create a new Participant + mapping
   *
   * Returns the number of participants persisted.
   */
  async persistParticipants(participants: ProviderParticipant[]): Promise<number> {
    let count = 0;
    this.logger?.debug({
      count: participants.length,
      participants: participants.slice(0, 10).map((participant) => ({
        providerId: participant.providerId,
        externalId: participant.externalId,
        sport: participant.sport,
        name: participant.name,
        active: participant.active,
      })),
    }, 'Persisting participants from ingestion');

    for (const p of participants) {
      const mapping = await this.prisma.participantProviderMapping.findUnique({
        where: {
          providerId_externalId: {
            providerId: p.providerId,
            externalId: p.externalId,
          },
        },
        include: { participant: true },
      });

      if (mapping) {
        // Update existing participant
        await this.prisma.participant.update({
          where: { id: mapping.participantId },
          data: {
            name: p.name,
            firstName: p.firstName ?? null,
            lastName: p.lastName ?? null,
            nationality: p.nationality ?? null,
            position: p.position ?? null,
            teamAffiliation: p.teamAffiliation ?? null,
            photoUrl: p.photoUrl ?? null,
            status: p.active ? 'ACTIVE' : 'INACTIVE',
            metadata: p.metadata as any,
          },
        });
      } else {
        // Resolve the Sport row — find or create by name
        const sport = await this.prisma.sport.upsert({
          where: { name: p.sport },
          create: {
            name: p.sport,
            participantType: 'INDIVIDUAL',
          },
          update: {},
        });

        // Create participant + provider mapping in a transaction
        await this.prisma.$transaction(async (tx) => {
          const participant = await tx.participant.create({
            data: {
              sportId: sport.id,
              name: p.name,
              participantType: sport.participantType,
              externalId: p.externalId,
              firstName: p.firstName ?? null,
              lastName: p.lastName ?? null,
              nationality: p.nationality ?? null,
              position: p.position ?? null,
              teamAffiliation: p.teamAffiliation ?? null,
              photoUrl: p.photoUrl ?? null,
              status: p.active ? 'ACTIVE' : 'INACTIVE',
              metadata: p.metadata as any,
            },
          });

          await tx.participantProviderMapping.create({
            data: {
              participantId: participant.id,
              providerId: p.providerId,
              externalId: p.externalId,
              confidence: 'EXACT',
            },
          });
        });
      }

      count++;
    }

    this.logger?.info({ count }, 'Persisted participants from ingestion');
    return count;
  }

  /**
   * Persist a full event detail payload and link the event-scoped participants.
   *
   * This is the first-pass bridge between provider event detail responses and
   * the new event-participant model used by scoring and roster picks.
   */
  async persistEventDetail(detail: SportEventDetail): Promise<{
    eventsPersisted: number;
    participantsPersisted: number;
    sportEventParticipantsPersisted: number;
    sourceDataPersisted: number;
  }> {
    this.logger?.debug({
      providerId: detail.providerId,
      externalId: detail.externalId,
      sport: detail.sport,
      name: detail.name,
      participantCount: detail.participants.length,
    }, 'Persisting event detail from ingestion');
    const eventsPersisted = await this.persistEvents([detail]);
    const participantsPersisted = await this.persistParticipants(detail.participants);

    const persistedEvent = await this.prisma.sportEvent.findUnique({
      where: {
        providerId_externalId: {
          providerId: detail.providerId,
          externalId: detail.externalId,
        },
      },
    });
    if (!persistedEvent) {
      throw new Error(
        `Persisted sport event not found for ${detail.providerId}:${detail.externalId}`,
      );
    }

    let sportEventParticipantsPersisted = 0;
    let sourceDataPersisted = 0;

    for (const participant of detail.participants) {
      const mapping = await this.prisma.participantProviderMapping.findUnique({
        where: {
          providerId_externalId: {
            providerId: participant.providerId,
            externalId: participant.externalId,
          },
        },
      });
      if (!mapping) {
        continue;
      }

      const sportEventParticipant = await this.prisma.sportEventParticipant.upsert({
        where: {
          sportEventId_participantId: {
            sportEventId: persistedEvent.id,
            participantId: mapping.participantId,
          },
        },
        create: {
          sportEventId: persistedEvent.id,
          participantId: mapping.participantId,
          status: participant.active ? 'ACTIVE' : 'INACTIVE',
          metadata: participant.metadata as any,
        },
        update: {
          status: participant.active ? 'ACTIVE' : 'INACTIVE',
          metadata: participant.metadata as any,
        },
      });

      sportEventParticipantsPersisted++;

      await this.prisma.sportEventParticipantSourceData.create({
        data: {
          sportEventParticipantId: sportEventParticipant.id,
          providerId: participant.providerId,
          externalId: participant.externalId,
          rawPayload: {
            externalId: participant.externalId,
            providerId: participant.providerId,
            sport: participant.sport,
            name: participant.name,
            firstName: participant.firstName ?? null,
            lastName: participant.lastName ?? null,
            nationality: participant.nationality ?? null,
            position: participant.position ?? null,
            teamAffiliation: participant.teamAffiliation ?? null,
            photoUrl: participant.photoUrl ?? null,
            active: participant.active,
            metadata: participant.metadata,
          } as any,
          normalizedData: participant.metadata as any,
          receivedAt: new Date(),
        },
      });
      sourceDataPersisted++;
    }

    this.logger?.info({
      providerId: detail.providerId,
      externalId: detail.externalId,
      sport: detail.sport,
      eventsPersisted,
      participantsPersisted,
      sportEventParticipantsPersisted,
      sourceDataPersisted,
    }, 'Persisted event detail from ingestion');

    return {
      eventsPersisted,
      participantsPersisted,
      sportEventParticipantsPersisted,
      sourceDataPersisted,
    };
  }

  /**
   * Upsert rankings into ParticipantSeasonRecord.
   *
   * For each ranking:
   * 1. Resolve participant via ParticipantProviderMapping
   * 2. Determine the current season string from asOfDate
   * 3. Upsert the season record with updated ranking data
   *
   * Returns the number of rankings persisted.
   */
  async persistRankings(rankings: ProviderRanking[]): Promise<number> {
    let count = 0;
    this.logger?.debug({
      count: rankings.length,
      rankings: rankings.slice(0, 10).map((ranking) => ({
        participantExternalId: ranking.participantExternalId,
        rankingType: ranking.rankingType,
        rank: ranking.rank,
        asOfDate: ranking.asOfDate.toISOString(),
      })),
    }, 'Persisting rankings from ingestion');

    for (const r of rankings) {
      // We need the providerId from context — rankings reference participantExternalId
      // but don't carry providerId. Look up by externalId across all providers.
      const mapping = await this.prisma.participantProviderMapping.findFirst({
        where: { externalId: r.participantExternalId },
        include: { participant: { include: { sport: true } } },
      });

      if (!mapping) {
        // Skip rankings for unknown participants — they will be persisted
        // once the participant sync runs.
        continue;
      }

      const season = String(r.asOfDate.getFullYear());
      const sportName = mapping.participant.sport.name as Sport;

      // Build the ranking entry to merge into the rankings JSON array
      const rankingEntry = {
        type: r.rankingType,
        rank: r.rank,
        points: r.points ?? null,
        asOfDate: r.asOfDate.toISOString(),
      };

      // Upsert the season record
      const existing = await this.prisma.participantSeasonRecord.findUnique({
        where: {
          participantId_season: {
            participantId: mapping.participantId,
            season,
          },
        },
      });

      if (existing) {
        // Merge ranking into existing rankings array
        const currentRankings = (existing.rankings as any[]) ?? [];
        const idx = currentRankings.findIndex(
          (entry: any) => entry.type === r.rankingType,
        );
        if (idx >= 0) {
          currentRankings[idx] = rankingEntry;
        } else {
          currentRankings.push(rankingEntry);
        }

        await this.prisma.participantSeasonRecord.update({
          where: { id: existing.id },
          data: {
            rankings: currentRankings as any,
            lastUpdated: new Date(),
          },
        });
      } else {
        await this.prisma.participantSeasonRecord.create({
          data: {
            participantId: mapping.participantId,
            sport: sportName,
            season,
            rankings: [rankingEntry] as any,
            lastUpdated: new Date(),
          },
        });
      }

      count++;
    }

    this.logger?.info({ count }, 'Persisted rankings from ingestion');
    return count;
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
