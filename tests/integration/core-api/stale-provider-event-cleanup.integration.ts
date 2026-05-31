import {
  PrismaContestFormat,
  PrismaParticipantType,
  PrismaSportCategory,
  PrismaTournamentFormat,
} from '@prisma/client';
import {
  AdminProviderEventCleanupResponseSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

describe('pool-master-rop.68.1.6: stale provider event cleanup', () => {
  beforeAll(async () => {
    await setupIntegrationTests();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await teardownIntegrationTests();
  });

  it('pool-master-rop.68.1.6: dry-runs and executes stale provider event cleanup without deleting contest-referenced events or global mappings', async () => {
    const prisma = getPrisma();
    const rootAdmin = await createTestUser({
      displayName: 'Provider Cleanup Root Admin',
      isRootAdmin: true,
    });

    const golfSport = await prisma.sport.create({
      data: {
        name: 'Cleanup Golf',
        participantType: PrismaParticipantType.INDIVIDUAL,
        category: PrismaSportCategory.GOLF,
        tournamentFormat: PrismaTournamentFormat.STROKE_PLAY_TOURNAMENT,
      },
    });
    const tennisSport = await prisma.sport.create({
      data: {
        name: 'Cleanup Tennis',
        participantType: PrismaParticipantType.INDIVIDUAL,
        category: PrismaSportCategory.TENNIS,
        tournamentFormat: PrismaTournamentFormat.KNOCKOUT_BRACKET,
      },
    });

    const staleNonGolfEvent = await createCleanupSportEvent({
      externalId: 'cleanup-tennis-old',
      sport: 'TENNIS',
      name: 'Cleanup Tennis Old Event',
      startDate: new Date('2025-05-01T12:00:00.000Z'),
      endDate: new Date('2025-05-02T22:00:00.000Z'),
    });
    const staleGolfEvent = await createCleanupSportEvent({
      externalId: 'cleanup-golf-old',
      sport: 'GOLF',
      name: 'Cleanup Golf Old Event',
      startDate: new Date('2025-04-01T12:00:00.000Z'),
      endDate: new Date('2025-04-04T22:00:00.000Z'),
    });
    const futureGolfEvent = await createCleanupSportEvent({
      externalId: 'cleanup-golf-future',
      sport: 'GOLF',
      name: 'Cleanup Golf Future Event',
      startDate: new Date('2035-04-01T12:00:00.000Z'),
      endDate: new Date('2035-04-04T22:00:00.000Z'),
    });
    const inProgressGolfEvent = await createCleanupSportEvent({
      externalId: 'cleanup-golf-in-progress',
      sport: 'GOLF',
      name: 'Cleanup Golf In Progress Event',
      startDate: new Date('2025-04-01T12:00:00.000Z'),
      endDate: new Date('2035-04-04T22:00:00.000Z'),
    });
    const noEndDateGolfEvent = await createCleanupSportEvent({
      externalId: 'cleanup-golf-no-end-date',
      sport: 'GOLF',
      name: 'Cleanup Golf No End Date Event',
      startDate: new Date('2025-05-01T12:00:00.000Z'),
      endDate: null,
    });
    const directContestGolfEvent = await createCleanupSportEvent({
      externalId: 'cleanup-golf-direct-contest',
      sport: 'GOLF',
      name: 'Cleanup Golf Direct Contest Event',
      startDate: new Date('2025-06-01T12:00:00.000Z'),
      endDate: new Date('2025-06-04T22:00:00.000Z'),
    });
    const pickedGolfEvent = await createCleanupSportEvent({
      externalId: 'cleanup-golf-picked',
      sport: 'GOLF',
      name: 'Cleanup Golf Picked Event',
      startDate: new Date('2025-07-01T12:00:00.000Z'),
      endDate: new Date('2025-07-04T22:00:00.000Z'),
    });
    const joinedContestGolfEvent = await createCleanupSportEvent({
      externalId: 'cleanup-golf-joined-contest',
      sport: 'GOLF',
      name: 'Cleanup Golf Joined Contest Event',
      startDate: new Date('2025-08-01T12:00:00.000Z'),
      endDate: new Date('2025-08-04T22:00:00.000Z'),
    });

    const staleNonGolfParticipant = await createCleanupParticipant({
      sportId: tennisSport.id,
      name: 'Cleanup Tennis Player',
      providerExternalId: 'cleanup-tennis-player',
    });
    const staleGolfParticipant = await createCleanupParticipant({
      sportId: golfSport.id,
      name: 'Cleanup Golf Player',
      providerExternalId: 'cleanup-golf-player',
    });
    const pickedGolfParticipant = await createCleanupParticipant({
      sportId: golfSport.id,
      name: 'Cleanup Picked Golf Player',
      providerExternalId: 'cleanup-picked-golf-player',
    });

    await attachCleanupEventParticipant({
      eventId: staleNonGolfEvent.id,
      participantId: staleNonGolfParticipant.participantId,
      includeChildren: true,
    });
    await attachCleanupEventParticipant({
      eventId: staleGolfEvent.id,
      participantId: staleGolfParticipant.participantId,
      includeChildren: true,
    });
    const pickedEventParticipant = await attachCleanupEventParticipant({
      eventId: pickedGolfEvent.id,
      participantId: pickedGolfParticipant.participantId,
      includeChildren: false,
    });

    const league = await prisma.league.create({
      data: {
        leagueCode: 'CLN68A',
        name: 'Cleanup League',
        createdBy: rootAdmin.user.id,
      },
    });
    const directContest = await prisma.contest.create({
      data: {
        leagueId: league.id,
        sportEventId: directContestGolfEvent.id,
        name: 'Cleanup Direct Contest',
        selectionType: 'ROSTER',
        scoringEngine: 'GOLF_ROSTER',
        contestFormat: PrismaContestFormat.ROSTER,
      },
    });
    const pickedContest = await prisma.contest.create({
      data: {
        leagueId: league.id,
        name: 'Cleanup Pick Contest',
        selectionType: 'ROSTER',
        scoringEngine: 'GOLF_ROSTER',
        contestFormat: PrismaContestFormat.ROSTER,
      },
    });
    const joinedContest = await prisma.contest.create({
      data: {
        leagueId: league.id,
        name: 'Cleanup Joined Contest',
        selectionType: 'ROSTER',
        scoringEngine: 'GOLF_ROSTER',
        contestFormat: PrismaContestFormat.ROSTER,
      },
    });
    await prisma.contestSportEvent.create({
      data: {
        contestId: joinedContest.id,
        sportEventId: joinedContestGolfEvent.id,
      },
    });
    const squad = await prisma.squad.create({
      data: {
        leagueId: league.id,
        createdBy: rootAdmin.user.id,
        name: 'Cleanup Squad',
      },
    });
    const entry = await prisma.contestEntry.create({
      data: {
        contestId: pickedContest.id,
        squadId: squad.id,
        name: 'Cleanup Entry',
      },
    });
    await prisma.contestEntryPick.create({
      data: {
        entryId: entry.id,
        sportEventParticipantId: pickedEventParticipant.id,
        contestFormat: PrismaContestFormat.ROSTER,
      },
    });

    const dryRunResponse = await getApp().inject({
      method: 'POST',
      url: '/api/v1/admin/providers/stale-events/cleanup',
      headers: rootAdmin.headers,
      payload: { mode: 'DRY_RUN' },
    });
    expect(dryRunResponse.statusCode).toBe(200);
    expect(AdminProviderEventCleanupResponseSchema.safeParse(dryRunResponse.json()).success).toBe(true);
    expect(dryRunResponse.json().summary).toMatchObject({
      inventoriedEventCount: 6,
      deletableEventCount: 3,
      blockedEventCount: 3,
      deletedEventCount: 0,
      sportEventParticipantCount: 3,
      valuationCount: 2,
      golfRoundCount: 2,
      pickCount: 1,
    });
    expect(dryRunResponse.json().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: staleNonGolfEvent.externalId,
          staleReason: 'NON_GOLF_EVENT',
          deletable: true,
          deleted: false,
        }),
        expect.objectContaining({
          externalId: staleGolfEvent.externalId,
          staleReason: 'PAST_GOLF_EVENT',
          deletable: true,
          deleted: false,
        }),
        expect.objectContaining({
          externalId: noEndDateGolfEvent.externalId,
          staleReason: 'PAST_GOLF_EVENT',
          deletable: true,
          deleted: false,
        }),
        expect.objectContaining({
          externalId: directContestGolfEvent.externalId,
          deletable: false,
          blockedReasons: ['DIRECT_CONTEST_REFERENCE'],
        }),
        expect.objectContaining({
          externalId: joinedContestGolfEvent.externalId,
          deletable: false,
          blockedReasons: ['CONTEST_SPORT_EVENT_REFERENCE'],
          contestSportEventCount: 1,
        }),
        expect.objectContaining({
          externalId: pickedGolfEvent.externalId,
          deletable: false,
          blockedReasons: ['CONTEST_ENTRY_PICK_REFERENCE'],
        }),
      ]),
    );
    expect(
      dryRunResponse.json().events.some((row: { externalId: string }) => row.externalId === futureGolfEvent.externalId),
    ).toBe(false);
    expect(
      dryRunResponse.json().events.some((row: { externalId: string }) => row.externalId === inProgressGolfEvent.externalId),
    ).toBe(false);

    const executeResponse = await getApp().inject({
      method: 'POST',
      url: '/api/v1/admin/providers/stale-events/cleanup',
      headers: rootAdmin.headers,
      payload: { mode: 'EXECUTE' },
    });
    expect(executeResponse.statusCode).toBe(200);
    expect(AdminProviderEventCleanupResponseSchema.safeParse(executeResponse.json()).success).toBe(true);
    expect(executeResponse.json().summary).toMatchObject({
      inventoriedEventCount: 6,
      deletableEventCount: 3,
      blockedEventCount: 3,
      deletedEventCount: 3,
    });

    await expect(prisma.sportEvent.findUniqueOrThrow({ where: { id: staleNonGolfEvent.id } })).rejects.toThrow();
    await expect(prisma.sportEvent.findUniqueOrThrow({ where: { id: staleGolfEvent.id } })).rejects.toThrow();
    await expect(prisma.sportEvent.findUniqueOrThrow({ where: { id: noEndDateGolfEvent.id } })).rejects.toThrow();
    await expect(prisma.sportEvent.findUniqueOrThrow({ where: { id: futureGolfEvent.id } })).resolves.toBeDefined();
    await expect(prisma.sportEvent.findUniqueOrThrow({ where: { id: inProgressGolfEvent.id } })).resolves.toBeDefined();
    await expect(prisma.sportEvent.findUniqueOrThrow({ where: { id: directContestGolfEvent.id } })).resolves.toBeDefined();
    await expect(prisma.sportEvent.findUniqueOrThrow({ where: { id: pickedGolfEvent.id } })).resolves.toBeDefined();
    await expect(prisma.sportEvent.findUniqueOrThrow({ where: { id: joinedContestGolfEvent.id } })).resolves.toBeDefined();

    expect(await prisma.sportEventParticipant.count({ where: { sportEventId: staleGolfEvent.id } })).toBe(0);
    expect(await prisma.sportEventParticipantGolfRound.count()).toBe(0);
    expect(await prisma.sportEventParticipantGolfStanding.count()).toBe(0);
    expect(await prisma.sportEventParticipantValuation.count()).toBe(0);
    expect(await prisma.participantProviderMapping.count()).toBe(3);
    expect(await prisma.participant.count()).toBe(3);
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: directContest.id } })).resolves.toBeDefined();
    await expect(prisma.contestSportEvent.findFirstOrThrow({
      where: { contestId: joinedContest.id, sportEventId: joinedContestGolfEvent.id },
    })).resolves.toBeDefined();
    await expect(prisma.adminAuditEntry.findFirstOrThrow({
      where: {
        actorId: rootAdmin.user.id,
        action: 'sportsdata.cleanup_stale_events',
        resourceType: 'SPORT_EVENT',
        resourceId: 'stale-provider-events',
      },
    })).resolves.toMatchObject({
      actorEmail: rootAdmin.user.email,
      description: 'Deleted 3 stale provider event(s) after inventorying 6.',
    });
  });

  it('pool-master-rop.68.1.6: rejects stale provider event cleanup requests without an explicit mode', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Provider Cleanup Validation Root Admin',
      isRootAdmin: true,
    });

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/admin/providers/stale-events/cleanup',
      headers: rootAdmin.headers,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.safeParse(response.json()).success).toBe(true);
  });
});

async function createCleanupSportEvent(input: {
  externalId: string;
  sport: string;
  name: string;
  startDate: Date;
  endDate: Date | null;
}) {
  return getPrisma().sportEvent.create({
    data: {
      externalId: input.externalId,
      providerId: 'contract-provider',
      sport: input.sport,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      releaseAt: new Date(input.startDate.getTime() - 14 * 24 * 60 * 60_000),
      fieldLocksAt: new Date(input.startDate.getTime() - 24 * 60 * 60_000),
      status: 'SCHEDULED',
      participantCount: 1,
      metadata: {},
    },
  });
}

async function createCleanupParticipant(input: {
  sportId: string;
  name: string;
  providerExternalId: string;
}): Promise<{ participantId: string }> {
  const participant = await getPrisma().participant.create({
    data: {
      sportId: input.sportId,
      name: input.name,
      participantType: PrismaParticipantType.INDIVIDUAL,
      externalId: input.providerExternalId,
    },
  });
  await getPrisma().participantProviderMapping.create({
    data: {
      participantId: participant.id,
      providerId: 'contract-provider',
      externalId: input.providerExternalId,
    },
  });
  return { participantId: participant.id };
}

async function attachCleanupEventParticipant(input: {
  eventId: string;
  participantId: string;
  includeChildren: boolean;
}) {
  const eventParticipant = await getPrisma().sportEventParticipant.create({
    data: {
      sportEventId: input.eventId,
      participantId: input.participantId,
      status: 'active',
      metadata: {},
    },
  });
  if (input.includeChildren) {
    await getPrisma().sportEventParticipantValuation.create({
      data: {
        sportEventParticipantId: eventParticipant.id,
        valuationSource: 'cleanup-test',
        price: 10,
        tier: 'A',
        orderIndex: 1,
      },
    });
    await getPrisma().sportEventParticipantGolfRound.create({
      data: {
        sportEventParticipantId: eventParticipant.id,
        round: 1,
        strokes: 70,
        scoreToPar: -2,
        status: 'COMPLETED',
      },
    });
    await getPrisma().sportEventParticipantGolfStanding.create({
      data: {
        sportEventParticipantId: eventParticipant.id,
        eventScoreToPar: -2,
        eventStrokes: 70,
        currentRound: 1,
        currentRoundThru: 18,
        status: 'COMPLETE',
      },
    });
  }
  return eventParticipant;
}
