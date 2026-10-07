import {
  acceptInvitation,
  enterContest,
  generateInviteLink,
  getDraftState,
  submitContestSelection,
} from '@poolmaster/shared/generated/hey-api';
import { ScoringEngine, SelectionType } from '@poolmaster/shared/domain';
import { buildLeagueWithCommissioner, buildRegisteredUser, seedContestFixture } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { randomUUID } from 'node:crypto';
import { cleanupFreshEventEditions, freshEventEdition } from '../support/event-edition';

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

/**
 * A contest configured with the retained SelectionType.SNAKE_DRAFT value (#200). No
 * turn-based implementation exists behind it, so no sport event is linked: the
 * draft-room endpoints must answer 501 before they would ever read participants.
 */
async function seedUnsupportedSelectionTypeFixture() {
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
    selectionType: SelectionType.SNAKE_DRAFT,
    scoringEngine: ScoringEngine.STROKE_PLAY,
    configuration: {
      rounds: 2,
      timePerPickSeconds: 60,
    },
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

  return {
    contestId,
    commissioner,
    challenger,
    commissionerEntryId: commissionerEntry.data.entry.id,
    challengerEntryId: challengerEntry.data.entry.id,
  };
}

/**
 * A budget-pick room with two entries and two priced golfers. Exclusive by default; pass
 * `isExclusive: false` for the room where both entries may hold the same golfer.
 */
async function seedBudgetPickFixture(options: { isExclusive?: boolean } = {}) {
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
    scoringEngine: ScoringEngine.STROKE_PLAY,
    configuration: {
      rosterSize: 1,
      budget: 8000,
      isExclusive: options.isExclusive ?? true,
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
  const sport = await prisma.sport.create({
    data: {
      name: `DraftBudgetSport-${randomUUID().slice(0, 8)}`,
      participantType: 'INDIVIDUAL',
      tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
    },
  });
  createdSportIds.push(sport.id);

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
      startDate: new Date('2026-04-20T12:00:00.000Z'),
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

/**
 * A tiered room with one tier. Non-exclusive by default, with only the commissioner entered;
 * `isExclusive: true` with `withChallenger: true` is the room where a second entry contends
 * for the same golfers.
 */
async function seedTieredDraftFixture(options: {
  participantCount?: number;
  picksFromTier?: number;
  isExclusive?: boolean;
  withChallenger?: boolean;
} = {}) {
  const participantCount = options.participantCount ?? 1;
  const picksFromTier = options.picksFromTier ?? 1;
  const { commissioner, league } = await buildLeagueWithCommissioner({
    displayName: 'Tiered Draft Commissioner',
    leagueName: 'Tiered Draft Functional League',
  });
  const challenger = options.withChallenger
    ? await buildRegisteredUser({ displayName: 'Tiered Draft Challenger' })
    : null;

  if (challenger) {
    const inviteResponse = await generateInviteLink({
      client: commissioner.client,
      path: { id: league.id },
      body: { maxUses: 1 },
    });
    if (!inviteResponse.data) {
      throw new Error('Builder: generateInviteLink failed for tiered draft fixture');
    }

    const acceptResponse = await acceptInvitation({
      client: challenger.client,
      body: { inviteCode: inviteResponse.data.invitation.inviteCode },
    });
    if (!acceptResponse.data) {
      throw new Error('Builder: acceptInvitation failed for tiered draft fixture');
    }
  }

  const { contestId } = await seedContestFixture(league.id, {
    name: 'Tiered Draft Functional Contest',
    selectionType: SelectionType.TIERED,
    scoringEngine: ScoringEngine.STROKE_PLAY,
    configuration: {
      rounds: 1,
      isExclusive: options.isExclusive ?? false,
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

  const challengerEntryResponse = challenger
    ? await enterContest({ client: challenger.client, path: { contestId } })
    : null;
  if (challengerEntryResponse && !challengerEntryResponse.data) {
    throw new Error('Builder: enterContest failed for challenger tiered draft fixture');
  }

  const prisma = getFunctionalPrisma();
  const sport = await prisma.sport.create({
    data: {
      name: `DraftTieredSport-${randomUUID().slice(0, 8)}`,
      participantType: 'INDIVIDUAL',
      tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
    },
  });
  createdSportIds.push(sport.id);

  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `tiered-functional-event-${randomUUID().slice(0, 8)}`,
      providerId: 'integration-test',
      sport: 'GOLF',
      name: 'Tiered Functional Event',
      startDate: new Date('2026-04-20T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(event.id);

  // Tiers are event-owned now (plans/124 §4.5/§4.6b) — the draft room
  // resolves selectionGroups through SportEventTierService, not the legacy
  // contestConfiguration.tierConfig JSON this fixture also sends, so a real
  // SportEventTier + valuation row is required per golfer.
  const tier = await prisma.sportEventTier.create({
    data: {
      sportEventId: event.id,
      tierKey: 'tier-1',
      label: 'Tier 1',
      tierNumber: 1,
      defaultPickCount: picksFromTier,
    },
  });

  const participantIds: string[] = [];
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
    participantIds.push(participant.id);

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
    challenger,
    entryId: entryResponse.data.entry.id,
    challengerEntryId: challengerEntryResponse?.data?.entry.id ?? null,
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
  it('#200 answers 501 DRAFT_MODE_UNSUPPORTED for a contest configured with the retained SNAKE_DRAFT type', async () => {
    const fixture = await seedUnsupportedSelectionTypeFixture();

    const stateResponse = await getDraftState({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
    });

    expectFunctionalError(stateResponse, {
      status: 501,
      code: 'DRAFT_MODE_UNSUPPORTED',
    });

    const pickResponse = await submitContestSelection({
      client: fixture.commissioner.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryId: fixture.commissionerEntryId,
        participantId: randomUUID(),
      },
    });

    expectFunctionalError(pickResponse, {
      status: 501,
      code: 'DRAFT_MODE_UNSUPPORTED',
    });
  });

  it('#200 rejects a selection for another squad\'s entry and a draft-state read for an unknown contest', async () => {
    const fixture = await seedUnsupportedSelectionTypeFixture();

    const wrongEntryResponse = await submitContestSelection({
      client: fixture.challenger.client,
      path: {
        contestId: fixture.contestId,
      },
      body: {
        entryId: fixture.commissionerEntryId,
        participantId: randomUUID(),
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

  it('#198 lets two entries in a non-exclusive budget-pick room hold the same participant', async () => {
    const fixture = await seedBudgetPickFixture({ isExclusive: false });

    const firstPickResponse = await submitContestSelection({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId },
      body: { entryId: fixture.commissionerEntryId, participantId: fixture.firstEventParticipantId },
    });

    expect(firstPickResponse.data?.draftPickHistories).toHaveLength(1);
    expect(firstPickResponse.data?.availableParticipantIds).toEqual(
      expect.arrayContaining([fixture.firstEventParticipantId, fixture.secondEventParticipantId]),
    );

    const samePickResponse = await submitContestSelection({
      client: fixture.challenger.client,
      path: { contestId: fixture.contestId },
      body: { entryId: fixture.challengerEntryId, participantId: fixture.firstEventParticipantId },
    });

    expect(samePickResponse.data?.draftPickHistories).toHaveLength(2);
    expect(samePickResponse.data?.draftPickHistories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryId: fixture.commissionerEntryId,
          participantId: fixture.firstEventParticipantId,
        }),
        expect.objectContaining({
          entryId: fixture.challengerEntryId,
          participantId: fixture.firstEventParticipantId,
        }),
      ]),
    );
    expect(samePickResponse.data?.availableParticipantIds).toContain(fixture.firstEventParticipantId);
    expect(samePickResponse.data?.isComplete).toBe(true);
  });

  it('#198 rejects a participant another entry holds in an exclusive tiered room, and frees it on toggle-off', async () => {
    const fixture = await seedTieredDraftFixture({
      participantCount: 2,
      isExclusive: true,
      withChallenger: true,
    });
    const challenger = fixture.challenger;
    const challengerEntryId = fixture.challengerEntryId;
    if (!challenger || !challengerEntryId) throw new Error('fixture: challenger missing');
    const [takenParticipantId, otherParticipantId] = fixture.sportEventParticipantIds;

    const firstPickResponse = await submitContestSelection({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId },
      body: { entryId: fixture.entryId, participantId: takenParticipantId },
    });

    expect(firstPickResponse.data?.draftPickHistories).toHaveLength(1);
    expect(firstPickResponse.data?.availableParticipantIds).not.toContain(takenParticipantId);
    expect(firstPickResponse.data?.availableParticipantIds).toContain(otherParticipantId);

    const takenPickResponse = await submitContestSelection({
      client: challenger.client,
      path: { contestId: fixture.contestId },
      body: { entryId: challengerEntryId, participantId: takenParticipantId },
    });

    expectFunctionalError(takenPickResponse, {
      status: 400,
      code: 'PARTICIPANT_ALREADY_TAKEN',
    });

    // The holder re-submitting its own pick is a tiered toggle-off, which deletes the pick and
    // puts the participant back in the pool.
    const toggleOffResponse = await submitContestSelection({
      client: fixture.commissioner.client,
      path: { contestId: fixture.contestId },
      body: { entryId: fixture.entryId, participantId: takenParticipantId },
    });

    expect(toggleOffResponse.data?.draftPickHistories).toHaveLength(0);
    expect(toggleOffResponse.data?.availableParticipantIds).toContain(takenParticipantId);

    const freedPickResponse = await submitContestSelection({
      client: challenger.client,
      path: { contestId: fixture.contestId },
      body: { entryId: challengerEntryId, participantId: takenParticipantId },
    });

    expect(freedPickResponse.data?.draftPickHistories).toEqual([
      expect.objectContaining({
        entryId: challengerEntryId,
        participantId: takenParticipantId,
        tierId: 'tier-1',
      }),
    ]);
    expect(freedPickResponse.data?.availableParticipantIds).not.toContain(takenParticipantId);
  });
});
