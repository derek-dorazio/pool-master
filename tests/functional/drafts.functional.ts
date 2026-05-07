import {
  acceptInvitation,
  createContest,
  enterContest,
  extendCurrentTurn,
  generateInviteLink,
  getDraftState,
  pauseDraft,
  resumeDraft,
  startDraft,
  submitContestSelection,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ScoringEngine, SelectionType } from '@poolmaster/shared/domain';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { randomUUID } from 'node:crypto';

const createdSportIds: string[] = [];
const createdParticipantIds: string[] = [];
const createdSportEventIds: string[] = [];
const createdSportEventParticipantIds: string[] = [];

async function cleanupDraftArtifacts(): Promise<void> {
  const prisma = getFunctionalPrisma();

  if (createdSportEventIds.length > 0) {
    const eventParticipants = await prisma.sportEventParticipant.findMany({
      where: {
        sportEventId: {
          in: createdSportEventIds,
        },
      },
      select: {
        id: true,
      },
    });
    const eventParticipantIds = eventParticipants.map((row) => row.id);

    if (eventParticipantIds.length > 0) {
      await prisma.contestEntryPick.deleteMany({
        where: {
          sportEventParticipantId: {
            in: eventParticipantIds,
          },
        },
      });
      await prisma.sportEventParticipantValuation.deleteMany({
        where: {
          sportEventParticipantId: {
            in: eventParticipantIds,
          },
        },
      });
      await prisma.sportEventParticipant.deleteMany({
        where: {
          id: {
            in: eventParticipantIds,
          },
        },
      });
    }

    createdSportEventParticipantIds.length = 0;

    await prisma.sportEvent.deleteMany({
      where: {
        id: {
          in: createdSportEventIds,
        },
      },
    });
    createdSportEventIds.length = 0;
  }

  if (createdParticipantIds.length > 0) {
    await prisma.participant.deleteMany({
      where: {
        id: {
          in: createdParticipantIds,
        },
      },
    });
    createdParticipantIds.length = 0;
  }

  if (createdSportIds.length > 0) {
    await prisma.sport.deleteMany({
      where: {
        id: {
          in: createdSportIds,
        },
      },
    });
    createdSportIds.length = 0;
  }
}

async function seedSnakeDraftFixture() {
  const { commissioner, league } = await buildLeagueWithCommissioner({
    displayName: 'Draft Commissioner',
    leagueName: 'Draft Functional League',
  });
  const challenger = await buildRegisteredUser({
    displayName: 'Draft Challenger',
  });

  const inviteResponse = await generateInviteLink({
    client: commissioner.client,
    path: {
      id: league.id,
    },
    body: {
      maxUses: 1,
    },
  });

  if (!inviteResponse.data) {
    throw new Error('Builder: generateInviteLink failed for draft functional fixture');
  }

  const acceptResponse = await acceptInvitation({
    client: challenger.client,
    body: {
      inviteCode: inviteResponse.data.invitation.inviteCode,
    },
  });

  if (!acceptResponse.data) {
    throw new Error('Builder: acceptInvitation failed for draft functional fixture');
  }

  const contestResponse = await createContest({
    client: commissioner.client,
    path: {
      id: league.id,
    },
    body: {
      name: 'Draft Functional Contest',
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.SNAKE_DRAFT,
      scoringEngine: ScoringEngine.STROKE_PLAY,
      contestConfiguration: {
        rounds: 2,
        timePerPickSeconds: 60,
      },
    },
  });

  if (!contestResponse.data) {
    throw new Error('Builder: createContest failed for draft functional fixture');
  }

  const contestId = contestResponse.data.contest.id;

  const commissionerEntry = await enterContest({
    client: commissioner.client,
    path: {
      contestId,
    },
  });
  if (!commissionerEntry.data) {
    throw new Error('Builder: enterContest failed for commissioner draft fixture');
  }

  const challengerEntry = await enterContest({
    client: challenger.client,
    path: {
      contestId,
    },
  });
  if (!challengerEntry.data) {
    throw new Error('Builder: enterContest failed for challenger draft fixture');
  }

  const prisma = getFunctionalPrisma();
  const sport = await prisma.sport.create({
    data: {
      name: `DraftSnakeSport-${randomUUID().slice(0, 8)}`,
      participantType: 'INDIVIDUAL',
    },
  });
  createdSportIds.push(sport.id);

  const event = await prisma.sportEvent.create({
    data: {
      externalId: `snake-functional-event-${randomUUID().slice(0, 8)}`,
      providerId: 'integration-test',
      sport: 'GOLF',
      name: 'Snake Functional Event',
      startDate: new Date('2026-04-20T12:00:00.000Z'),
      releaseAt: new Date('2026-04-20T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-20T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(event.id);

  const participants = await Promise.all(
    [1, 2, 3, 4].map((index) =>
      prisma.participant.create({
        data: {
          sportId: sport.id,
          name: `Draft Snake Player ${index}-${randomUUID().slice(0, 8)}`,
          participantType: 'INDIVIDUAL',
          externalIds: {},
          position: 'GOLFER',
          teamAffiliation: null,
        },
      }),
    ),
  );
  createdParticipantIds.push(...participants.map((participant) => participant.id));

  const eventParticipants = await Promise.all(
    participants.map((participant) =>
      prisma.sportEventParticipant.create({
        data: {
          sportEventId: event.id,
          participantId: participant.id,
          status: 'ACTIVE',
        },
      }),
    ),
  );
  createdSportEventParticipantIds.push(...eventParticipants.map((row) => row.id));

  await prisma.contest.update({
    where: {
      id: contestId,
    },
    data: {
      sportEventId: event.id,
    },
  });

  return {
    contestId,
    commissioner,
    challenger,
    commissionerEntryId: commissionerEntry.data.entry.id,
    challengerEntryId: challengerEntry.data.entry.id,
    availableParticipantIds: eventParticipants.map((row) => row.id),
  };
}

async function seedBudgetPickFixture() {
  const { commissioner, league } = await buildLeagueWithCommissioner({
    displayName: 'Budget Commissioner',
    leagueName: 'Budget Functional League',
  });
  const challenger = await buildRegisteredUser({
    displayName: 'Budget Challenger',
  });

  const inviteResponse = await generateInviteLink({
    client: commissioner.client,
    path: {
      id: league.id,
    },
    body: {
      maxUses: 1,
    },
  });

  if (!inviteResponse.data) {
    throw new Error('Builder: generateInviteLink failed for budget fixture');
  }

  const acceptResponse = await acceptInvitation({
    client: challenger.client,
    body: {
      inviteCode: inviteResponse.data.invitation.inviteCode,
    },
  });

  if (!acceptResponse.data) {
    throw new Error('Builder: acceptInvitation failed for budget fixture');
  }

  const contestResponse = await createContest({
    client: commissioner.client,
    path: {
      id: league.id,
    },
    body: {
      name: 'Budget Functional Contest',
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.BUDGET_PICK,
      scoringEngine: ScoringEngine.STROKE_PLAY,
      contestConfiguration: {
        rosterSize: 1,
        budget: 8000,
        pricingMethod: 'WORLD_RANKING',
        isExclusive: true,
      },
    },
  });

  if (!contestResponse.data) {
    throw new Error('Builder: createContest failed for budget fixture');
  }

  const contestId = contestResponse.data.contest.id;

  const commissionerEntry = await enterContest({
    client: commissioner.client,
    path: {
      contestId,
    },
  });
  if (!commissionerEntry.data) {
    throw new Error('Builder: enterContest failed for commissioner budget fixture');
  }

  const challengerEntry = await enterContest({
    client: challenger.client,
    path: {
      contestId,
    },
  });
  if (!challengerEntry.data) {
    throw new Error('Builder: enterContest failed for challenger budget fixture');
  }

  const prisma = getFunctionalPrisma();
  const sport = await prisma.sport.create({
    data: {
      name: `DraftBudgetSport-${randomUUID().slice(0, 8)}`,
      participantType: 'INDIVIDUAL',
    },
  });
  createdSportIds.push(sport.id);

  const firstParticipant = await prisma.participant.create({
    data: {
      sportId: sport.id,
      name: `Draft Budget Player ${randomUUID().slice(0, 8)}`,
      participantType: 'INDIVIDUAL',
      externalIds: {},
      position: 'GOLFER',
      teamAffiliation: null,
    },
  });
  createdParticipantIds.push(firstParticipant.id);

  const secondParticipant = await prisma.participant.create({
    data: {
      sportId: sport.id,
      name: `Draft Budget Player ${randomUUID().slice(0, 8)}`,
      participantType: 'INDIVIDUAL',
      externalIds: {},
      position: 'GOLFER',
      teamAffiliation: null,
    },
  });
  createdParticipantIds.push(secondParticipant.id);

  const event = await prisma.sportEvent.create({
    data: {
      externalId: `budget-functional-event-${randomUUID().slice(0, 8)}`,
      providerId: 'integration-test',
      sport: 'GOLF',
      name: 'Budget Functional Event',
      startDate: new Date('2026-04-20T12:00:00.000Z'),
      releaseAt: new Date('2026-04-20T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-20T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(event.id);

  const firstEventParticipant = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: event.id,
      participantId: firstParticipant.id,
      status: 'ACTIVE',
      valuations: {
        create: {
          price: 3200,
          orderIndex: 1,
          valuationSource: 'functional-test',
        },
      },
    },
  });
  createdSportEventParticipantIds.push(firstEventParticipant.id);

  const secondEventParticipant = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: event.id,
      participantId: secondParticipant.id,
      status: 'ACTIVE',
      valuations: {
        create: {
          price: 5100,
          orderIndex: 2,
          valuationSource: 'functional-test',
        },
      },
    },
  });
  createdSportEventParticipantIds.push(secondEventParticipant.id);

  await prisma.contest.update({
    where: {
      id: contestId,
    },
    data: {
      sportEventId: event.id,
    },
  });

  return {
    contestId,
    commissioner,
    challenger,
    commissionerEntryId: commissionerEntry.data.entry.id,
    challengerEntryId: challengerEntry.data.entry.id,
    firstEventParticipantId: firstEventParticipant.id,
    secondEventParticipantId: secondEventParticipant.id,
  };
}

async function seedTieredDraftFixture(options: {
  participantCount?: number;
  picksFromTier?: number;
} = {}) {
  const participantCount = options.participantCount ?? 1;
  const picksFromTier = options.picksFromTier ?? 1;
  const { commissioner, league } = await buildLeagueWithCommissioner({
    displayName: 'Tiered Draft Commissioner',
    leagueName: 'Tiered Draft Functional League',
  });

  const contestResponse = await createContest({
    client: commissioner.client,
    path: {
      id: league.id,
    },
    body: {
      name: 'Tiered Draft Functional Contest',
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.TIERED,
      scoringEngine: ScoringEngine.STROKE_PLAY,
      contestConfiguration: {
        rounds: 1,
        tierAssignmentMethod: 'AUTO_ODDS',
        tierConfig: [
          {
            tierId: 'tier-1',
            tierName: 'Tier 1',
            tierNumber: 1,
            picksFromTier,
            participantIds: [],
          },
        ],
      },
    },
  });

  if (!contestResponse.data) {
    throw new Error('Builder: createContest failed for tiered draft fixture');
  }

  const contestId = contestResponse.data.contest.id;

  const entryResponse = await enterContest({
    client: commissioner.client,
    path: {
      contestId,
    },
  });

  if (!entryResponse.data) {
    throw new Error('Builder: enterContest failed for tiered draft fixture');
  }

  const prisma = getFunctionalPrisma();
  const sport = await prisma.sport.create({
    data: {
      name: `DraftTieredSport-${randomUUID().slice(0, 8)}`,
      participantType: 'INDIVIDUAL',
    },
  });
  createdSportIds.push(sport.id);

  const event = await prisma.sportEvent.create({
    data: {
      externalId: `tiered-functional-event-${randomUUID().slice(0, 8)}`,
      providerId: 'integration-test',
      sport: 'GOLF',
      name: 'Tiered Functional Event',
      startDate: new Date('2026-04-20T12:00:00.000Z'),
      releaseAt: new Date('2026-04-20T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-20T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(event.id);

  const participantIds: string[] = [];
  const eventParticipantIds: string[] = [];
  for (let index = 0; index < participantCount; index += 1) {
    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Draft Tiered Player ${index + 1} ${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        externalIds: {},
        position: 'GOLFER',
        teamAffiliation: null,
      },
    });
    createdParticipantIds.push(participant.id);
    participantIds.push(participant.id);

    const eventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: event.id,
        participantId: participant.id,
        status: 'ACTIVE',
        valuations: {
          create: {
            price: 1200 + index,
            tier: 'tier-1',
            orderIndex: index + 1,
            valuationSource: 'functional-test',
          },
        },
      },
    });
    createdSportEventParticipantIds.push(eventParticipant.id);
    eventParticipantIds.push(eventParticipant.id);
  }

  await prisma.contest.update({
    where: {
      id: contestId,
    },
    data: {
      sportEventId: event.id,
    },
  });

  await prisma.contestConfiguration.update({
    where: {
      contestId,
    },
    data: {
      tierConfig: [
        {
          tierId: 'tier-1',
          tierName: 'Tier 1',
          tierNumber: 1,
          picksFromTier,
          participantIds,
        },
      ] as object[],
    },
  });

  return {
    contestId,
    commissioner,
    entryId: entryResponse.data.entry.id,
    sportEventParticipantId: eventParticipantIds[0],
    sportEventParticipantIds: eventParticipantIds,
  };
}

afterEach(async () => {
  await cleanupDraftArtifacts();
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Drafts and Roster Selection', () => {
  it('drives the snake draft lifecycle and rejects duplicate picks', async () => {
    const fixture = await seedSnakeDraftFixture();

    const startResponse = await startDraft({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryIds: [fixture.commissionerEntryId, fixture.challengerEntryId],
        rounds: 2,
        timePerPickSeconds: 60,
        availableParticipantIds: fixture.availableParticipantIds,
        autoPickPolicy: 'BEST_AVAILABLE',
      },
    });

    expect(startResponse.data).toBeDefined();
    expect(startResponse.data?.contestId).toBe(fixture.contestId);
    expect(startResponse.data?.status).toBe('LIVE');
    expect(startResponse.data?.entries).toHaveLength(2);
    expect(startResponse.data?.draftPickHistories).toHaveLength(0);

    const stateResponse = await getDraftState({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expect(stateResponse.data).toBeDefined();
    expect(stateResponse.data?.contestId).toBe(fixture.contestId);
    expect(stateResponse.data?.currentPickNumber).toBe(1);
    expect(stateResponse.data?.isTurnBased).toBe(true);
    expect(stateResponse.data?.entries).toHaveLength(2);
    expect(stateResponse.data?.draftPickHistories).toHaveLength(0);

    const pauseResponse = await pauseDraft({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expect(pauseResponse.data?.status).toBe('PAUSED');

    const resumeResponse = await resumeDraft({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expect(resumeResponse.data?.status).toBe('LIVE');

    const extendResponse = await extendCurrentTurn({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        additionalSeconds: 30,
      },
    });

    expect(extendResponse.data?.currentTurnStartedAt).toBeTruthy();

    const duplicateStartResponse = await startDraft({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryIds: [fixture.commissionerEntryId, fixture.challengerEntryId],
        rounds: 2,
        timePerPickSeconds: 60,
        availableParticipantIds: fixture.availableParticipantIds,
        autoPickPolicy: 'BEST_AVAILABLE',
      },
    });

    expectFunctionalError(duplicateStartResponse, {
      status: 409,
      code: 'DRAFT_EXISTS',
    });

    const firstPickResponse = await submitContestSelection({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryId: fixture.commissionerEntryId,
        participantId: fixture.availableParticipantIds[0],
      },
    });

    expect(firstPickResponse.data).toBeDefined();
    expect(firstPickResponse.data?.draftPickHistories).toHaveLength(1);
    expect(firstPickResponse.data?.draftPickHistories[0].participantId).toBe(fixture.availableParticipantIds[0]);
    expect(firstPickResponse.data?.isComplete).toBe(false);
    expect(firstPickResponse.data?.status).toBe('LIVE');

    const afterPickStateResponse = await getDraftState({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expect(afterPickStateResponse.data?.draftPickHistories).toHaveLength(1);
    expect(afterPickStateResponse.data?.status).toBe('LIVE');

    const duplicatePickResponse = await submitContestSelection({
      client: fixture.challenger.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryId: fixture.challengerEntryId,
        participantId: fixture.availableParticipantIds[0],
      },
    });

    expectFunctionalError(duplicatePickResponse, {
      status: 400,
      code: 'INVALID_PICK',
    });

    const wrongEntryResponse = await submitContestSelection({
      client: fixture.challenger.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryId: fixture.commissionerEntryId,
        participantId: fixture.availableParticipantIds[1],
      },
    });

    expectFunctionalError(wrongEntryResponse, {
      status: 403,
      code: 'DRAFT_ENTRY_ACCESS_DENIED',
    });

    const missingStateResponse = await getDraftState({
      client: fixture.commissioner.client,
      path: {
        contestId: randomUUID(),
      },
    });

    expectFunctionalError(missingStateResponse, {
      status: 404,
      code: 'CONTEST_NOT_FOUND',
    });
  });

  it('rejects non-commissioners from snake draft control endpoints with stable draft permission codes', async () => {
    const fixture = await seedSnakeDraftFixture();

    const startResponse = await startDraft({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryIds: [fixture.commissionerEntryId, fixture.challengerEntryId],
        rounds: 2,
        timePerPickSeconds: 60,
        availableParticipantIds: fixture.availableParticipantIds,
        autoPickPolicy: 'BEST_AVAILABLE',
      },
    });

    expect(startResponse.data?.status).toBe('LIVE');

    const pauseDenied = await pauseDraft({
      client: fixture.challenger.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expectFunctionalError(pauseDenied, {
      status: 403,
      code: 'DRAFT_COMMISSIONER_ACCESS_REQUIRED',
    });

    const extendDenied = await extendCurrentTurn({
      client: fixture.challenger.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        additionalSeconds: 15,
      },
    });

    expectFunctionalError(extendDenied, {
      status: 403,
      code: 'DRAFT_COMMISSIONER_ACCESS_REQUIRED',
    });
  });

  it('reads a budget-pick room and rejects duplicate roster picks across entries', async () => {
    const fixture = await seedBudgetPickFixture();

    const stateResponse = await getDraftState({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expect(stateResponse.data).toBeDefined();
    expect(stateResponse.data?.contestId).toBe(fixture.contestId);
    expect(stateResponse.data?.selectionType).toBe(SelectionType.BUDGET_PICK);
    expect(stateResponse.data?.myEntryId).toBe(fixture.commissionerEntryId);
    expect(stateResponse.data?.contestConfiguration?.rosterSize).toBe(1);
    expect(stateResponse.data?.contestConfiguration?.budget).toBe(8000);
    expect(stateResponse.data?.contestConfiguration?.pricingMethod).toBe('WORLD_RANKING');
    expect(stateResponse.data?.draftPickHistories).toHaveLength(0);
    expect(stateResponse.data?.availableParticipantIds).toEqual(
      expect.arrayContaining([fixture.firstEventParticipantId, fixture.secondEventParticipantId]),
    );

    const firstPickResponse = await submitContestSelection({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryId: fixture.commissionerEntryId,
        participantId: fixture.firstEventParticipantId,
      },
    });

    expect(firstPickResponse.data).toBeDefined();
    expect(firstPickResponse.data?.draftPickHistories).toHaveLength(1);
    expect(firstPickResponse.data?.draftPickHistories[0]).toEqual(
      expect.objectContaining({
        entryId: fixture.commissionerEntryId,
        participantId: fixture.firstEventParticipantId,
        price: 3200,
      }),
    );
    expect(firstPickResponse.data?.isComplete).toBe(false);

    const afterPickStateResponse = await getDraftState({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expect(afterPickStateResponse.data?.draftPickHistories).toHaveLength(1);
    expect(afterPickStateResponse.data?.draftPickHistories[0]).toEqual(
      expect.objectContaining({
        entryId: fixture.commissionerEntryId,
        participantId: fixture.firstEventParticipantId,
        price: 3200,
      }),
    );
    expect(afterPickStateResponse.data?.availableParticipantIds).not.toContain(fixture.firstEventParticipantId);
    expect(afterPickStateResponse.data?.availableParticipantIds).toContain(fixture.secondEventParticipantId);

    const duplicatePickResponse = await submitContestSelection({
      client: fixture.challenger.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryId: fixture.challengerEntryId,
        participantId: fixture.firstEventParticipantId,
      },
    });

    expectFunctionalError(duplicatePickResponse, {
      status: 400,
      code: 'PARTICIPANT_ALREADY_TAKEN',
    });
  });

  it('reads a tiered room, submits a selection, and returns updated tiered state', async () => {
    const fixture = await seedTieredDraftFixture();

    const stateResponse = await getDraftState({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      query: {
        entryId: fixture.entryId,
      },
    });

    expect(stateResponse.data).toBeDefined();
    expect(stateResponse.data?.contestId).toBe(fixture.contestId);
    expect(stateResponse.data?.selectionType).toBe(SelectionType.TIERED);
    expect(stateResponse.data?.myEntryId).toBe(fixture.entryId);
    expect(stateResponse.data?.selectedEntryId).toBe(fixture.entryId);
    expect(stateResponse.data?.selectionGroups).toHaveLength(1);
    expect(stateResponse.data?.selectionGroups?.[0]).toEqual(
      expect.objectContaining({
        groupId: 'tier-1',
        groupName: 'Tier 1',
        groupNumber: 1,
        picksFromGroup: 1,
      }),
    );
    expect(stateResponse.data?.selectionGroups?.[0]?.participants[0]).toEqual(
      expect.objectContaining({
        sportEventParticipantId: fixture.sportEventParticipantId,
        isSelected: false,
      }),
    );
    expect(stateResponse.data?.availableParticipantIds).toContain(fixture.sportEventParticipantId);
    expect(stateResponse.data?.draftPickHistories).toHaveLength(0);

    const submitResponse = await submitContestSelection({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryId: fixture.entryId,
        participantId: fixture.sportEventParticipantId,
      },
    });

    expect(submitResponse.data).toBeDefined();
    expect(submitResponse.data?.contestId).toBe(fixture.contestId);
    expect(submitResponse.data?.selectionType).toBe(SelectionType.TIERED);
    expect(submitResponse.data?.draftPickHistories).toHaveLength(1);
    expect(submitResponse.data?.draftPickHistories[0]).toEqual(
      expect.objectContaining({
        entryId: fixture.entryId,
        participantId: fixture.sportEventParticipantId,
        tierId: 'tier-1',
        tierName: 'Tier 1',
      }),
    );
    expect(submitResponse.data?.isComplete).toBe(true);

    const afterPickStateResponse = await getDraftState({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      query: {
        entryId: fixture.entryId,
      },
    });

    expect(afterPickStateResponse.data?.draftPickHistories).toHaveLength(1);
    expect(afterPickStateResponse.data?.draftPickHistories[0]).toEqual(
      expect.objectContaining({
        participantId: fixture.sportEventParticipantId,
        tierId: 'tier-1',
        tierName: 'Tier 1',
      }),
    );
    expect(afterPickStateResponse.data?.isComplete).toBe(true);
    expect(afterPickStateResponse.data?.availableParticipantIds).toContain(fixture.sportEventParticipantId);
    expect(afterPickStateResponse.data?.selectionGroups?.[0]?.selectedParticipantIds).toEqual([
      fixture.sportEventParticipantId,
    ]);
    expect(afterPickStateResponse.data?.selectionGroups?.[0]?.participants[0]?.isSelected).toBe(true);
  });

  it('pool-master-mab replaces and unselects participants in a completed tiered entry group', async () => {
    const fixture = await seedTieredDraftFixture({ participantCount: 3, picksFromTier: 2 });
    const [firstParticipantId, secondParticipantId, replacementParticipantId] = fixture.sportEventParticipantIds;

    await submitContestSelection({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId },
      body: { entryId: fixture.entryId, participantId: firstParticipantId },
    });
    const secondPickResponse = await submitContestSelection({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId },
      body: { entryId: fixture.entryId, participantId: secondParticipantId },
    });

    expect(secondPickResponse.data?.selectionGroups?.[0]?.selectedParticipantIds).toEqual([
      firstParticipantId,
      secondParticipantId,
    ]);

    const replacementResponse = await submitContestSelection({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId },
      body: { entryId: fixture.entryId, participantId: replacementParticipantId },
    });

    expect(replacementResponse.data?.selectionGroups?.[0]?.selectedParticipantIds).toEqual([
      firstParticipantId,
      replacementParticipantId,
    ]);
    expect(replacementResponse.data?.draftPickHistories).toHaveLength(2);

    const unselectResponse = await submitContestSelection({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId },
      body: { entryId: fixture.entryId, participantId: firstParticipantId },
    });

    expect(unselectResponse.data?.selectionGroups?.[0]?.selectedParticipantIds).toEqual([
      replacementParticipantId,
    ]);
    expect(unselectResponse.data?.draftPickHistories).toHaveLength(1);
  });
});
