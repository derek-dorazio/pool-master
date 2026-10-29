import {
  acceptInvitation,
  createContest,
  enterContest,
  generateInviteLink,
  getSelectionState,
  openContest,
  selectContestPick,
  submitContestEntry,
  unselectContestPick,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, SelectionType } from '@poolmaster/shared/domain';
import { attachContestEvent, buildLeagueWithCommissioner, buildRegisteredUser, seedContestFixture } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { randomUUID } from 'node:crypto';
import { SelectionPickResponseSchema } from '@poolmaster/shared/dto';
import { expectMatchesSchema } from '../support/expect-matches-schema';
import { cleanupFreshEventEditions, freshEventEdition } from '../support/event-edition';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';

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
      await prisma.sportEventParticipantGolfStanding.deleteMany({
        where: {
          standing: {
            sportEventParticipantId: {
              in: eventParticipantIds,
            },
          },
        },
      });
      await prisma.sportEventParticipantStanding.deleteMany({
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

    // SportEventTier and SportEventRound both have RESTRICT FKs to
    // SportEvent, so they must clear before the SportEvent delete below.
    await prisma.sportEventTier.deleteMany({
      where: {
        sportEventId: {
          in: createdSportEventIds,
        },
      },
    });
    await prisma.sportEventRound.deleteMany({
      where: {
        sportEventId: {
          in: createdSportEventIds,
        },
      },
    });
    await unlinkContestsFromSportEvents(prisma, createdSportEventIds);
    await prisma.sportEvent.deleteMany({
      where: {
        id: {
          in: createdSportEventIds,
        },
      },
    });
    await cleanupFreshEventEditions(prisma);
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

}

/**
 * A tiered contest with two entries on one small event, attached after both entered: enough for
 * the selection-room guards that answer before any participant is read (whose entry it is,
 * whether the contest exists).
 */
async function seedRoomGuardFixture() {
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

  const { contestId } = await seedContestFixture(league.id, {
    name: 'Draft Functional Contest',
    selectionType: SelectionType.TIERED,
  });

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
  // A selection room is always one event's (#713).
  const event = await seedMultiTierGolfEvent({ tierCount: 1, golfersPerTier: 1 });
  await attachContestEvent(contestId, event.sportEventId);

  return {
    contestId,
    commissioner,
    challenger,
    commissionerEntryId: commissionerEntry.data.entry.id,
    challengerEntryId: challengerEntry.data.entry.id,
  };
}

/**
 * A budget-pick room with two entries and two priced golfers ($3,200 and $5,100). Pass a roster
 * size or cap to test the budget.
 */
async function seedBudgetPickFixture(options: { rosterSize?: number; salaryCap?: number } = {}) {
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

  const { contestId } = await seedContestFixture(league.id, {
    name: 'Budget Functional Contest',
    selectionType: SelectionType.BUDGET_PICK,
    configuration: {
      configJson: {
        selectionType: SelectionType.BUDGET_PICK,
        rosterSize: options.rosterSize ?? 1,
        salaryCap: options.salaryCap ?? 8000,
        countedScores: 1,
      },
    },
  });

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
  const sport = await prisma.sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });

  const firstParticipant = await prisma.participant.create({
    data: {
      sportId: sport.id,
      name: `Draft Budget Player ${randomUUID().slice(0, 8)}`,
      participantType: 'INDIVIDUAL',
      externalIds: {},
      role: 'GOLFER',
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
      role: 'GOLFER',
      teamAffiliation: null,
    },
  });
  createdParticipantIds.push(secondParticipant.id);

  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `budget-functional-event-${randomUUID().slice(0, 8)}`,
      providerId: 'integration-test',
      sport: 'GOLF',
      name: 'Budget Functional Event',
      startDate: new Date('2099-04-20T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(event.id);

  const firstEventParticipant = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: event.id,
      participantId: firstParticipant.id,
      isActive: true,
    },
  });
  createdSportEventParticipantIds.push(firstEventParticipant.id);
  await prisma.sportEventParticipantValuation.create({
    data: {
      sportEventParticipantId: firstEventParticipant.id,
      price: 3200,
      priceAssignedSource: 'MANUAL',
    },
  });

  const secondEventParticipant = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: event.id,
      participantId: secondParticipant.id,
      isActive: true,
    },
  });
  createdSportEventParticipantIds.push(secondEventParticipant.id);
  await prisma.sportEventParticipantValuation.create({
    data: {
      sportEventParticipantId: secondEventParticipant.id,
      price: 5100,
      priceAssignedSource: 'MANUAL',
    },
  });

  await attachContestEvent(contestId, event.id);

  return {
    contestId,
    commissioner,
    challenger,
    commissionerEntryId: commissionerEntry.data.entry.id,
    challengerEntryId: challengerEntry.data.entry.id,
    sportEventId: event.id,
    firstEventParticipantId: firstEventParticipant.id,
    secondEventParticipantId: secondEventParticipant.id,
  };
}

/** A tiered room with one tier and only the commissioner entered. */
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
  const { contestId } = await seedContestFixture(league.id, {
    name: 'Tiered Draft Functional Contest',
    selectionType: SelectionType.TIERED,
    configuration: {
      // The contest's picks per tier, which every event tier takes (#479).
      configJson: { selectionType: SelectionType.TIERED, picksPerTier: picksFromTier, countedScores: 1 },
    },
  });

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
  const sport = await prisma.sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });

  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `tiered-functional-event-${randomUUID().slice(0, 8)}`,
      providerId: 'integration-test',
      sport: 'GOLF',
      name: 'Tiered Functional Event',
      startDate: new Date('2099-04-20T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(event.id);

  // Tiers are event-owned (plans/124 §4.5/§4.6b): the selection room resolves selectionGroups
  // through SportEventTierService, so a real SportEventTier + valuation row is required per golfer.
  const tier = await prisma.sportEventTier.create({
    data: {
      sportEventId: event.id,
      tierKey: 'tier-1',
      label: 'Tier 1',
      tierNumber: 1,
    },
  });

  const eventParticipantIds: string[] = [];
  for (let index = 0; index < participantCount; index += 1) {
    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Draft Tiered Player ${index + 1} ${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        externalIds: {},
        role: 'GOLFER',
        teamAffiliation: null,
      },
    });
    createdParticipantIds.push(participant.id);

    const eventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: event.id,
        participantId: participant.id,
        isActive: true,
      },
    });
    createdSportEventParticipantIds.push(eventParticipant.id);
    eventParticipantIds.push(eventParticipant.id);
    await prisma.sportEventParticipantValuation.create({
      data: {
        sportEventParticipantId: eventParticipant.id,
        sportEventTierId: tier.id,
        tierOrderIndex: index + 1,
        tierAssignedSource: 'MANUAL',
        price: 1200 + index,
        priceAssignedSource: 'MANUAL',
      },
    });
  }

  await attachContestEvent(contestId, event.id);

  return {
    contestId,
    commissioner,
    entryId: entryResponse.data.entry.id,
    sportEventParticipantId: eventParticipantIds[0],
    sportEventParticipantIds: eventParticipantIds,
  };
}

/**
 * A contest-ready golf event with `tierCount` tiers of `golfersPerTier` golfers each, for a
 * contest made through the one managed create. Returns each tier's field-row ids in tier order.
 */
async function seedMultiTierGolfEvent(options: { tierCount: number; golfersPerTier: number }) {
  const prisma = getFunctionalPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });

  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `multi-tier-functional-event-${randomUUID().slice(0, 8)}`,
      providerId: 'functional-test',
      sport: 'GOLF',
      name: 'Multi Tier Functional Event',
      startDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(event.id);

  const tierFieldRowIds: string[][] = [];
  for (let tierIndex = 0; tierIndex < options.tierCount; tierIndex += 1) {
    const tier = await prisma.sportEventTier.create({
      data: {
        sportEventId: event.id,
        tierKey: `tier-${tierIndex + 1}`,
        label: `Tier ${tierIndex + 1}`,
        tierNumber: tierIndex + 1,
      },
    });
    const fieldRowIds: string[] = [];
    for (let golferIndex = 0; golferIndex < options.golfersPerTier; golferIndex += 1) {
      const participant = await prisma.participant.create({
        data: {
          sportId: sport.id,
          name: `Multi Tier Golfer ${tierIndex + 1}-${golferIndex + 1} ${randomUUID().slice(0, 8)}`,
          participantType: 'INDIVIDUAL',
          externalIds: {},
          role: 'GOLFER',
          teamAffiliation: null,
        },
      });
      createdParticipantIds.push(participant.id);
      const fieldRow = await prisma.sportEventParticipant.create({
        data: { sportEventId: event.id, participantId: participant.id, isActive: true },
      });
      createdSportEventParticipantIds.push(fieldRow.id);
      await prisma.sportEventParticipantValuation.create({
        data: {
          sportEventParticipantId: fieldRow.id,
          sportEventTierId: tier.id,
          tierOrderIndex: golferIndex + 1,
          tierAssignedSource: 'MANUAL',
        },
      });
      fieldRowIds.push(fieldRow.id);
    }
    tierFieldRowIds.push(fieldRowIds);
  }

  return { sportEventId: event.id, tierFieldRowIds };
}

afterEach(async () => {
  await cleanupDraftArtifacts();
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Roster Selection', () => {
  it('#200 rejects a selection for another squad\'s entry and a selection-state read for an unknown contest', async () => {
    const fixture = await seedRoomGuardFixture();

    const wrongEntryResponse = await selectContestPick({
      client: fixture.challenger.client,
      path: {
        contestId: fixture.contestId,
        entryId: fixture.commissionerEntryId,
        sportEventParticipantId: randomUUID(),
      },
    });

    expectFunctionalError(wrongEntryResponse, {
      status: 403,
      code: 'ENTRY_ACCESS_DENIED',
    });

    const wrongEntryUnselect = await unselectContestPick({
      client: fixture.challenger.client,
      path: {
        contestId: fixture.contestId,
        entryId: fixture.commissionerEntryId,
        sportEventParticipantId: randomUUID(),
      },
    });

    expectFunctionalError(wrongEntryUnselect, {
      status: 403,
      code: 'ENTRY_ACCESS_DENIED',
    });

    const missingStateResponse = await getSelectionState({
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

  it('reads a budget-pick room and records a pick with its price, leaving the golfer open to other entries', async () => {
    const fixture = await seedBudgetPickFixture();

    const stateResponse = await getSelectionState({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expect(stateResponse.data).toBeDefined();
    expect(stateResponse.data?.contestId).toBe(fixture.contestId);
    expect(stateResponse.data?.selectionType).toBe(SelectionType.BUDGET_PICK);
    expect(stateResponse.data?.myEntryId).toBe(fixture.commissionerEntryId);
    expect(stateResponse.data?.rosterSize).toBe(1);
    expect(stateResponse.data?.pickHistories).toHaveLength(0);
    expect(stateResponse.data?.availableParticipantIds).toEqual(
      expect.arrayContaining([fixture.firstEventParticipantId, fixture.secondEventParticipantId]),
    );

    const firstPickResponse = await selectContestPick({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
        entryId: fixture.commissionerEntryId,
        sportEventParticipantId: fixture.firstEventParticipantId,
      },
    });

    expect(firstPickResponse.data).toBeDefined();
    expectMatchesSchema(SelectionPickResponseSchema, firstPickResponse.data);
    expect(firstPickResponse.data?.picks).toHaveLength(1);
    expect(firstPickResponse.data?.picks[0]).toEqual(
      expect.objectContaining({
        entryId: fixture.commissionerEntryId,
        participantId: fixture.firstEventParticipantId,
        price: 3200,
      }),
    );
    expect(firstPickResponse.data?.lineupSummary).toMatchObject({ spent: 3200, openSlots: 0 });

    const afterPickStateResponse = await getSelectionState({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expect(afterPickStateResponse.data?.pickHistories).toHaveLength(1);
    expect(afterPickStateResponse.data?.pickHistories[0]).toEqual(
      expect.objectContaining({
        entryId: fixture.commissionerEntryId,
        participantId: fixture.firstEventParticipantId,
        price: 3200,
      }),
    );
    expect(afterPickStateResponse.data?.availableParticipantIds).toEqual(
      expect.arrayContaining([fixture.firstEventParticipantId, fixture.secondEventParticipantId]),
    );
  });

  // #93: the cap never refuses a pick; it refuses the submit, and the room shows the spend.
  it.each([
    { salaryCap: 8000, expectSubmitted: false },
    { salaryCap: 8300, expectSubmitted: true },
  ])('lets a budget entry pick both golfers ($8,300) under a $$salaryCap cap, and submits it only when it fits', async ({ salaryCap, expectSubmitted }) => {
    const fixture = await seedBudgetPickFixture({ rosterSize: 2, salaryCap });
    const pickFor = (sportEventParticipantId: string) => selectContestPick({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId, entryId: fixture.commissionerEntryId, sportEventParticipantId },
    });

    expect((await pickFor(fixture.secondEventParticipantId)).response?.status).toBe(200);
    const fullRoom = await pickFor(fixture.firstEventParticipantId);
    expect(fullRoom.response?.status).toBe(200);
    expect(fullRoom.data?.lineupSummary).toEqual({
      selectionType: SelectionType.BUDGET_PICK,
      salaryCap,
      spent: 8300,
      remaining: salaryCap - 8300,
      isOverBudget: !expectSubmitted,
      openSlots: 0,
      cheapestFill: 0,
    });

    const submitted = await submitContestEntry({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId, entryId: fixture.commissionerEntryId, sportEventId: fixture.sportEventId },
    });

    if (expectSubmitted) {
      expect(submitted.response?.status).toBe(200);
      expect(submitted.data?.entries.find((entry) => entry.id === fixture.commissionerEntryId)?.status).toBe('SUBMITTED');
    } else {
      expectFunctionalError(submitted, { status: 409, code: 'ENTRY_OVER_BUDGET' });
      await expect(getFunctionalPrisma().contestEntryEvent.findUniqueOrThrow({
        where: { contestEntryId_sportEventId: { contestEntryId: fixture.commissionerEntryId, sportEventId: fixture.sportEventId } },
      })).resolves.toMatchObject({ status: 'DRAFT' });
    }
  });

  // #93: a full budget roster takes a new golfer only after one comes off, so a swap is unselect
  // then pick. The unselect leaves the submitted entry short, which sends it back to DRAFT, and
  // the dearer golfer leaves it over the cap, so it cannot count again until it fits.
  it('sends a submitted budget entry back to DRAFT when it swaps to a golfer over the cap, and refuses to resubmit it', async () => {
    const fixture = await seedBudgetPickFixture({ rosterSize: 1, salaryCap: 4000 });
    const pickFor = (sportEventParticipantId: string) => selectContestPick({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId, entryId: fixture.commissionerEntryId, sportEventParticipantId },
    });
    const unpickFor = (sportEventParticipantId: string) => unselectContestPick({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId, entryId: fixture.commissionerEntryId, sportEventParticipantId },
    });
    const submit = () => submitContestEntry({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId, entryId: fixture.commissionerEntryId, sportEventId: fixture.sportEventId },
    });
    const entryStatus = async () => (await getFunctionalPrisma().contestEntryEvent.findUniqueOrThrow({
      where: { contestEntryId_sportEventId: { contestEntryId: fixture.commissionerEntryId, sportEventId: fixture.sportEventId } },
    })).status;

    expect((await pickFor(fixture.firstEventParticipantId)).response?.status).toBe(200);
    expect((await submit()).response?.status).toBe(200);
    expect(await entryStatus()).toBe('SUBMITTED');

    const unpicked = await unpickFor(fixture.firstEventParticipantId);
    expect(unpicked.response?.status).toBe(200);
    expect(unpicked.data?.entryStatus).toBe('DRAFT');
    const overCap = await pickFor(fixture.secondEventParticipantId);
    expect(overCap.response?.status).toBe(200);
    expect(overCap.data?.lineupSummary).toMatchObject({ spent: 5100, isOverBudget: true, openSlots: 0 });
    expect(overCap.data?.entryStatus).toBe('DRAFT');
    expect(await entryStatus()).toBe('DRAFT');

    expectFunctionalError(await submit(), { status: 409, code: 'ENTRY_OVER_BUDGET' });
    expect(await entryStatus()).toBe('DRAFT');
  });

  it('reads a tiered room, submits a selection, and returns updated tiered state', async () => {
    const fixture = await seedTieredDraftFixture();

    const stateResponse = await getSelectionState({
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
    expect(stateResponse.data?.pickHistories).toHaveLength(0);

    const submitResponse = await selectContestPick({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.sportEventParticipantId,
      },
    });

    // #1259: the answer is the entry's own change, not the room.
    expect(submitResponse.data).toBeDefined();
    expectMatchesSchema(SelectionPickResponseSchema, submitResponse.data);
    expect(submitResponse.data?.contestId).toBe(fixture.contestId);
    expect(submitResponse.data?.entryId).toBe(fixture.entryId);
    expect(submitResponse.data?.entryStatus).toBe('DRAFT');
    expect(submitResponse.data?.lineupSummary).toBeNull();
    expect(submitResponse.data?.picks).toHaveLength(1);
    expect(submitResponse.data?.picks[0]).toEqual(
      expect.objectContaining({
        entryId: fixture.entryId,
        participantId: fixture.sportEventParticipantId,
        tierId: 'tier-1',
        tierName: 'Tier 1',
      }),
    );
    expect(submitResponse.data).not.toHaveProperty('selectionGroups');

    // Selecting the held golfer again changes nothing: a repeat never unselects (#1259).
    const repeatResponse = await selectContestPick({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.sportEventParticipantId,
      },
    });
    expect(repeatResponse.data?.picks.map((pick) => pick.participantId)).toEqual([fixture.sportEventParticipantId]);

    const afterPickStateResponse = await getSelectionState({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      query: {
        entryId: fixture.entryId,
      },
    });

    expect(afterPickStateResponse.data?.pickHistories).toHaveLength(1);
    expect(afterPickStateResponse.data?.pickHistories[0]).toEqual(
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

    const pick = (sportEventParticipantId: string) => selectContestPick({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId, entryId: fixture.entryId, sportEventParticipantId },
    });
    const heldIds = (response: Awaited<ReturnType<typeof pick>>) => response.data?.picks.map((row) => row.participantId);

    await pick(firstParticipantId);
    const secondPickResponse = await pick(secondParticipantId);

    expect(heldIds(secondPickResponse)).toEqual([firstParticipantId, secondParticipantId]);

    const replacementResponse = await pick(replacementParticipantId);

    expect(heldIds(replacementResponse)).toEqual([firstParticipantId, replacementParticipantId]);

    const unselectResponse = await unselectContestPick({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId, entryId: fixture.entryId, sportEventParticipantId: firstParticipantId },
    });

    expect(heldIds(unselectResponse)).toEqual([replacementParticipantId]);

    // Unselecting a golfer the entry no longer holds changes nothing.
    const repeatUnselect = await unselectContestPick({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId, entryId: fixture.entryId, sportEventParticipantId: firstParticipantId },
    });
    expect(heldIds(repeatUnselect)).toEqual([replacementParticipantId]);

    const room = await getSelectionState({ client: fixture.commissioner.client, path: { contestId: fixture.contestId }, query: { entryId: fixture.entryId } });
    expect(room.data?.selectionGroups?.[0]?.selectedParticipantIds).toEqual([replacementParticipantId]);
  });

  // #479 — the defect: the selection room took each tier's pick count from the event and ignored
  // the commissioner's setting, so a "2 per tier" contest still allowed one golfer per tier.
  it('honours the commissioner\'s picksPerTier: a 3-tier contest at 2 per tier has a roster of 6, holds 2 golfers from one tier, and a third from that tier replaces the newest', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Picks Per Tier Commissioner',
      leagueName: 'Picks Per Tier Functional League',
    });
    const event = await seedMultiTierGolfEvent({ tierCount: 3, golfersPerTier: 3 });
    const [firstId, secondId, thirdId] = event.tierFieldRowIds[0];

    const created = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: 'Two Per Tier Contest',
        sportEventIds: [event.sportEventId],
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        configuration: { maxEntriesPerSquad: 1, selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 4 },
      },
    });
    expect(created.response?.status).toBe(201);
    const contestId = created.data?.contest.id as string;

    const opened = await openContest({ client: commissioner.client, path: { id: league.id, contestId } });
    expect(opened.response?.status).toBe(200);
    const entered = await enterContest({ client: commissioner.client, path: { contestId } });
    const entryId = entered.data?.entry.id as string;
    expect(entryId).toBeTruthy();

    const room = await getSelectionState({ client: commissioner.client, path: { contestId }, query: { entryId } });
    expect(room.data?.rosterSize).toBe(6);
    expect(room.data?.selectionGroups?.map((group) => group.picksFromGroup)).toEqual([2, 2, 2]);

    const pick = (sportEventParticipantId: string) => selectContestPick({
      client: commissioner.client,
      path: { contestId, entryId, sportEventParticipantId },
    });
    await pick(firstId);
    const secondPick = await pick(secondId);
    expect(secondPick.data?.picks.map((row) => row.participantId)).toEqual([firstId, secondId]);

    const thirdPick = await pick(thirdId);
    expect(thirdPick.data?.picks.map((row) => row.participantId)).toEqual([firstId, thirdId]);
  });

  it('#198 lets two entries in a budget-pick room hold the same participant', async () => {
    const fixture = await seedBudgetPickFixture();

    const firstPickResponse = await selectContestPick({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId, entryId: fixture.commissionerEntryId, sportEventParticipantId: fixture.firstEventParticipantId },
    });

    expect(firstPickResponse.data?.picks).toHaveLength(1);

    const samePickResponse = await selectContestPick({
      client: fixture.challenger.client,
      path: { contestId: fixture.contestId, entryId: fixture.challengerEntryId, sportEventParticipantId: fixture.firstEventParticipantId },
    });

    // Both entries now hold it; each answer carries only its own entry's picks, so the challenger
    // sees one row, their own, and the commissioner's pick never reaches them.
    expect(samePickResponse.data?.picks).toEqual([
      expect.objectContaining({
        entryId: fixture.challengerEntryId,
        participantId: fixture.firstEventParticipantId,
      }),
    ]);
    expect(samePickResponse.data?.lineupSummary).toMatchObject({ openSlots: 0 });
  });
});
