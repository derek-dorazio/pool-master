import {
  createContest,
  createManagedContest,
  deleteContest,
  enterContest,
  getContest,
  getContestEntry,
  getManagedContest,
  getMyContestEntry,
  leaveContest,
  listContestEntries,
  listContests,
  listManagedContestTemplates,
  updateContestEntry,
  updateContest,
  submitContestSelection,
} from '@poolmaster/shared/generated/hey-api';
import {
  ContestStatus,
  ContestType,
  ParticipantType,
  ScoringEngine,
  SelectionType,
  Sport,
  TierAssignmentMethod,
} from '@poolmaster/shared/domain';
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

async function cleanupContestArtifacts(): Promise<void> {
  const prisma = getFunctionalPrisma();

  if (createdSportEventParticipantIds.length > 0) {
    await prisma.contestEntryParticipantScoreEvent.deleteMany({
      where: {
        participantScore: {
          rosterPick: {
            sportEventParticipantId: {
              in: createdSportEventParticipantIds,
            },
          },
        },
      },
    });
    await prisma.contestEntryParticipantScore.deleteMany({
      where: {
        rosterPick: {
          sportEventParticipantId: {
            in: createdSportEventParticipantIds,
          },
        },
      },
    });
    await prisma.rosterPick.deleteMany({
      where: {
        sportEventParticipantId: {
          in: createdSportEventParticipantIds,
        },
      },
    });
    await prisma.sportEventParticipantValuation.deleteMany({
      where: {
        sportEventParticipantId: {
          in: createdSportEventParticipantIds,
        },
      },
    });
    await prisma.sportEventParticipant.deleteMany({
      where: {
        id: {
          in: createdSportEventParticipantIds,
        },
      },
    });
    createdSportEventParticipantIds.length = 0;
  }

  if (createdSportEventIds.length > 0) {
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

async function seedImportedGolfEvent(options: {
  eventName: string;
  participantCount: number;
  providerId?: string;
}) {
  const prisma = getFunctionalPrisma();
  const sport = await prisma.sport.create({
    data: {
      name: `ManagedContestSport-${randomUUID().slice(0, 8)}`,
      participantType: ParticipantType.INDIVIDUAL,
      statSchema: {},
    },
  });
  createdSportIds.push(sport.id);

  const sportEvent = await prisma.sportEvent.create({
    data: {
      externalId: `managed-contest-event-${randomUUID().slice(0, 8)}`,
      providerId: options.providerId ?? 'functional-test',
      sport: Sport.GOLF,
      name: options.eventName,
      startDate: new Date('2026-04-10T12:00:00.000Z'),
      releaseAt: new Date('2026-04-07T16:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-09T16:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(sportEvent.id);

  const seededParticipants: Array<{
    participantId: string;
    sportEventParticipantId: string;
    participantName: string;
  }> = [];

  for (let index = 0; index < options.participantCount; index += 1) {
    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Managed Contest Golfer ${index + 1}-${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
        metadata: {},
        position: 'GOLFER',
        teamAffiliation: index % 2 === 0 ? 'USA' : 'EUR',
      },
    });
    createdParticipantIds.push(participant.id);

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        status: 'ACTIVE',
      },
    });
    createdSportEventParticipantIds.push(sportEventParticipant.id);

    await prisma.sportEventParticipantSourceData.create({
      data: {
        sportEventParticipantId: sportEventParticipant.id,
        providerId: options.providerId ?? 'functional-test',
        externalId: `managed-contest-golfer-${index + 1}`,
        rawPayload: {
          metadata: {
            odds: 8 + index * 2,
            ranking: index + 1,
            scoreToPar: -(index + 1),
          },
        },
        normalizedData: {
          odds: 8 + index * 2,
          ranking: index + 1,
          scoreToPar: -(index + 1),
          thru: 'F',
          finishPosition: index + 1,
        },
        receivedAt: new Date(`2026-04-08T1${index}:00:00.000Z`),
      },
    });

    seededParticipants.push({
      participantId: participant.id,
      sportEventParticipantId: sportEventParticipant.id,
      participantName: participant.name,
    });
  }

  return {
    sportEventId: sportEvent.id,
    participants: seededParticipants,
  };
}

afterEach(async () => {
  await cleanupContestArtifacts();
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Contests and Entries', () => {
  it('creates a template-first managed contest for an imported golf event and is immediately entry-ready', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Managed Contest Commissioner',
      leagueName: 'Managed Contest Functional League',
    });
    const importedEvent = await seedImportedGolfEvent({
      eventName: 'Managed Masters Functional Event',
      participantCount: 6,
    });

    const templatesResponse = await listManagedContestTemplates({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      query: {
        sport: Sport.GOLF,
        contestType: ContestType.SINGLE_EVENT,
      },
    });

    expect(templatesResponse.data?.templates.length).toBeGreaterThan(0);
    const defaultTemplate = templatesResponse.data?.templates.find(
      (template) => template.isDefault,
    );
    expect(defaultTemplate).toBeDefined();

    const createResponse = await createManagedContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: `${league.name} Managed Masters Functional Event`,
        sportEventId: importedEvent.sportEventId,
        contestType: ContestType.SINGLE_EVENT,
        templateId: defaultTemplate?.id as string,
      },
    });

    expect(createResponse.data?.contest.id).toBeTruthy();
    expect(createResponse.data?.contest.status).toBe(ContestStatus.OPEN);
    expect(createResponse.data?.contest.templateId).toBe(defaultTemplate?.id);
    expect(createResponse.data?.contest.configuration.mode).toBe(
      defaultTemplate?.configuration.mode,
    );

    const contestId = createResponse.data?.contest.id as string;
    const managedDetailResponse = await getManagedContest({
      client: commissioner.client,
      path: {
        id: league.id,
        contestId,
      },
    });

    expect(managedDetailResponse.data?.contest.id).toBe(contestId);
    expect(managedDetailResponse.data?.contest.sportEventId).toBe(
      importedEvent.sportEventId,
    );

    const entryResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(entryResponse.data?.contestId).toBe(contestId);
    expect(entryResponse.data?.entry.entryNumber).toBe(1);

    const myEntryResponse = await getMyContestEntry({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(myEntryResponse.data?.entry?.id).toBe(entryResponse.data?.entry.id);
  });

  it('runs managed contest entry lifecycle against an imported event-backed field and rejects participants from another event', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Managed Selection Commissioner',
      leagueName: 'Managed Selection Functional League',
    });
    const importedEvent = await seedImportedGolfEvent({
      eventName: 'Managed Selection Event',
      participantCount: 1,
    });
    const outsiderEvent = await seedImportedGolfEvent({
      eventName: 'Managed Outsider Event',
      participantCount: 1,
    });

    const templatesResponse = await listManagedContestTemplates({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      query: {
        sport: Sport.GOLF,
        contestType: ContestType.SINGLE_EVENT,
      },
    });
    const defaultTemplate = templatesResponse.data?.templates.find(
      (template) => template.isDefault,
    );
    expect(defaultTemplate).toBeDefined();

    const createResponse = await createManagedContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: `${league.name} Managed Selection Event`,
        sportEventId: importedEvent.sportEventId,
        contestType: ContestType.SINGLE_EVENT,
        templateId: defaultTemplate?.id as string,
        configurationOverrides: {
          mode: 'GOLF_TIERED',
          locksAt: '2026-04-10T11:55:00.000Z',
          maxEntriesPerSquad: 3,
          rosterSize: 1,
          countedScores: 1,
          tierSource: 'ODDS',
          tierGeneration: {
            defaultTierSize: 10,
          },
          tiers: [
            {
              tierKey: 'A',
              label: 'Tier A',
              pickCount: 1,
              startPosition: 1,
              endPosition: 10,
            },
          ],
          cutRule: {
            type: 'FIXED_SCORE',
            fixedScore: 80,
          },
          playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
          displayScoring: 'TO_PAR',
          tiebreaker: {
            type: 'PREDICT_WINNING_SCORE',
          },
        },
      },
    });

    const contestId = createResponse.data?.contest.id as string;
    const firstEntryResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });
    const secondEntryResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    const selectedParticipant = importedEvent.participants[0];
    const outsiderParticipant = outsiderEvent.participants[0];

    const selectionResponse = await submitContestSelection({
      client: commissioner.client,
      path: {
        contestId,
      },
      body: {
        entryId: firstEntryResponse.data?.entry.id as string,
        participantId: selectedParticipant.sportEventParticipantId,
      },
    });

    expect(selectionResponse.data?.contestId).toBe(contestId);
    expect(selectionResponse.data?.draftPickHistories).toHaveLength(1);
    expect(selectionResponse.data?.draftPickHistories[0]?.participantId).toBe(
      selectedParticipant.sportEventParticipantId,
    );
    expect(selectionResponse.data?.isComplete).toBe(false);

    const entryDetailResponse = await getContestEntry({
      client: commissioner.client,
      path: {
        contestId,
        entryId: firstEntryResponse.data?.entry.id as string,
      },
    });

    expect(entryDetailResponse.data?.entry.participants).toEqual([
      expect.objectContaining({
        participantId: selectedParticipant.participantId,
        participantName: selectedParticipant.participantName,
        participantStatus: 'ACTIVE',
        latestPerformance: expect.objectContaining({
          scoreToPar: -1,
          thru: 'F',
          finishPosition: 1,
        }),
      }),
    ]);

    const outsiderSelectionResponse = await submitContestSelection({
      client: commissioner.client,
      path: {
        contestId,
      },
      body: {
        entryId: secondEntryResponse.data?.entry.id as string,
        participantId: outsiderParticipant.sportEventParticipantId,
      },
    });

    expectFunctionalError(outsiderSelectionResponse, {
      status: 400,
      code: 'PARTICIPANT_NOT_IN_EVENT',
    });
  });

  it('rejects invalid template-first managed contest creation requests through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Managed Invalid Commissioner',
      leagueName: 'Managed Invalid Functional League',
    });
    const importedEvent = await seedImportedGolfEvent({
      eventName: 'Managed Invalid Event',
      participantCount: 1,
    });
    const templatesResponse = await listManagedContestTemplates({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      query: {
        sport: Sport.GOLF,
        contestType: ContestType.SINGLE_EVENT,
      },
    });
    const defaultTemplate = templatesResponse.data?.templates.find(
      (template) => template.isDefault,
    );
    expect(defaultTemplate).toBeDefined();

    const missingTemplateResponse = await createManagedContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Missing Template Contest',
        sportEventId: importedEvent.sportEventId,
        contestType: ContestType.SINGLE_EVENT,
        templateId: '00000000-0000-4000-8000-000000000000',
      },
    });

    expectFunctionalError(missingTemplateResponse, {
      status: 422,
      code: 'CONTEST_CONFIGURATION_INVALID',
    });

    const mismatchedOverrideResponse = await createManagedContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Mismatch Template Contest',
        sportEventId: importedEvent.sportEventId,
        contestType: ContestType.SINGLE_EVENT,
        templateId: defaultTemplate?.id as string,
        configurationOverrides: {
          mode: 'GOLF_CATEGORY_PICKS',
          maxEntriesPerSquad: 1,
          categories: [
            {
              categoryKey: 'ROOKIE',
              label: 'Rookie',
              pickCount: 1,
            },
          ],
          cutRule: {
            type: 'FIXED_SCORE',
            fixedScore: 80,
          },
          playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
          displayScoring: 'TO_PAR',
          tiebreaker: {
            type: 'PREDICT_WINNING_SCORE',
          },
        },
      },
    });

    expectFunctionalError(mismatchedOverrideResponse, {
      status: 422,
      code: 'CONTEST_CONFIGURATION_INVALID',
    });
  });

  it('creates, lists, reads, updates, and deletes a contest through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Contest Commissioner',
      leagueName: 'Contest Functional League',
    });

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Functional Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.BUDGET_PICK,
        scoringEngine: ScoringEngine.POSITION,
      },
    });

    expect(createResponse.data).toBeDefined();
    expect(createResponse.data?.contest.name).toBe('Functional Contest');
    expect(createResponse.data?.contest.leagueId).toBe(league.id);
    expect(createResponse.data?.contest.status).toBe('DRAFT');
    expect(createResponse.data?.contest.selectionType).toBe('BUDGET_PICK');
    expect(createResponse.data?.contest.scoringEngine).toBe('POSITION');

    const contestId = createResponse.data?.contest.id;
    expect(contestId).toBeTruthy();

    const listResponse = await listContests({
      client: commissioner.client,
      path: {
        id: league.id,
      },
    });

    expect(listResponse.data).toBeDefined();
    const listedContest = listResponse.data?.contests.find((contest) => contest.id === contestId);
    expect(listedContest).toBeDefined();
    expect(listedContest?.name).toBe('Functional Contest');
    expect(listedContest?.status).toBe('DRAFT');

    const detailResponse = await getContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(detailResponse.data).toBeDefined();
    expect(detailResponse.data?.contest.id).toBe(contestId);
    expect(detailResponse.data?.contest.name).toBe('Functional Contest');
    expect(detailResponse.data?.contest.status).toBe('DRAFT');

    const updateResponse = await updateContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
      body: {
        name: 'Functional Contest Updated',
        isExclusive: true,
      },
    });

    expect(updateResponse.data).toBeDefined();
    expect(updateResponse.data?.contest.id).toBe(contestId);
    expect(updateResponse.data?.contest.name).toBe('Functional Contest Updated');
    expect(updateResponse.data?.contest.isExclusive).toBe(true);

    const deleteResponse = await deleteContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(deleteResponse.response.status).toBe(204);

    const deletedContest = await getContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expectFunctionalError(deletedContest, {
      status: 404,
      code: 'CONTEST_NOT_FOUND',
    });
  });

  it('creates, enters, lists, leaves, and re-enters a contest through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Entry Commissioner',
      leagueName: 'Entry Functional League',
    });

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Entry Lifecycle Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.BUDGET_PICK,
        scoringEngine: ScoringEngine.POSITION,
      },
    });

    const contestId = createResponse.data?.contest.id;
    expect(contestId).toBeTruthy();

    const enterResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(enterResponse.data).toBeDefined();
    expect(enterResponse.data?.contestId).toBe(contestId);
    expect(enterResponse.data?.entry.status).toBe('ACTIVE');
    expect(enterResponse.data?.entry.totalScore).toBe(0);
    expect(enterResponse.data?.entry.entryNumber).toBe(1);

    const myEntryResponse = await getMyContestEntry({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(myEntryResponse.data).toBeDefined();
    expect(myEntryResponse.data?.contestId).toBe(contestId);
    expect(myEntryResponse.data?.entry?.id).toBe(enterResponse.data?.entry.id);

    const entriesResponse = await listContestEntries({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(entriesResponse.data).toBeDefined();
    expect(entriesResponse.data?.contestId).toBe(contestId);
    expect(entriesResponse.data?.isJoined).toBe(true);
    expect(entriesResponse.data?.myEntryId).toBe(enterResponse.data?.entry.id);
    expect(entriesResponse.data?.entries).toHaveLength(1);

    const leaveResponse = await leaveContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(leaveResponse.data).toBeDefined();
    expect(leaveResponse.data?.contestId).toBe(contestId);
    expect(leaveResponse.data?.deleted).toBe(true);

    const afterLeaveMyEntry = await getMyContestEntry({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(afterLeaveMyEntry.data).toBeDefined();
    expect(afterLeaveMyEntry.data?.contestId).toBe(contestId);
    expect(afterLeaveMyEntry.data?.entry).toBeNull();

    const afterLeaveEntries = await listContestEntries({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(afterLeaveEntries.data).toBeDefined();
    expect(afterLeaveEntries.data?.isJoined).toBe(false);
    expect(afterLeaveEntries.data?.entries).toHaveLength(0);
    expect(afterLeaveEntries.data?.myEntryId).toBeNull();

    const reenterResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(reenterResponse.data).toBeDefined();
    expect(reenterResponse.data?.contestId).toBe(contestId);
    expect(reenterResponse.data?.entry.status).toBe('ACTIVE');
    expect(reenterResponse.data?.entry.entryNumber).toBe(1);

    const cleanupDeleteResponse = await deleteContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(cleanupDeleteResponse.response.status).toBe(204);

    const deletedContest = await getContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expectFunctionalError(deletedContest, {
      status: 404,
      code: 'CONTEST_NOT_FOUND',
    });
  });

  it('renames a team-owned contest entry and rejects duplicate names through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Rename Commissioner',
      leagueName: 'Rename Functional League',
    });

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Rename Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.BUDGET_PICK,
        scoringEngine: ScoringEngine.POSITION,
      },
    });

    const contestId = createResponse.data?.contest.id;
    expect(contestId).toBeTruthy();

    const prisma = getFunctionalPrisma();
    await prisma.contest.update({
      where: {
        id: contestId as string,
      },
      data: {
        status: ContestStatus.OPEN,
      },
    });

    const enterResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(enterResponse.data?.entry.id).toBeTruthy();

    const secondEntry = await prisma.contestEntry.create({
      data: {
        contestId: contestId as string,
        squadId: enterResponse.data?.entry.squadId as string,
        entryNumber: 2,
        name: 'Rename Functional League Entry 2',
        status: 'ACTIVE',
        totalScore: 0,
        isEliminated: false,
      },
    });

    const renameResponse = await updateContestEntry({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
        entryId: enterResponse.data?.entry.id as string,
      },
      body: {
        name: 'Sunday Charge',
      },
    });

    expect(renameResponse.data).toBeDefined();
    expect(renameResponse.data?.entry.id).toBe(enterResponse.data?.entry.id);
    expect(renameResponse.data?.entry.name).toBe('Sunday Charge');

    const entriesResponse = await listContestEntries({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(entriesResponse.data?.entries.find((entry) => entry.id === enterResponse.data?.entry.id)?.name)
      .toBe('Sunday Charge');

    const duplicateRenameResponse = await updateContestEntry({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
        entryId: secondEntry.id,
      },
      body: {
        name: 'Sunday Charge',
      },
    });

    expectFunctionalError(duplicateRenameResponse, {
      status: 400,
      code: 'CONTEST_ENTRY_NAME_DUPLICATE',
    });
  });

  it('updates a contest-entry tiebreaker value through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Tiebreaker Commissioner',
      leagueName: 'Tiebreaker Functional League',
    });

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Tiebreaker Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.BUDGET_PICK,
        scoringEngine: ScoringEngine.POSITION,
      },
    });

    const contestId = createResponse.data?.contest.id;
    expect(contestId).toBeTruthy();

    const prisma = getFunctionalPrisma();
    await prisma.contest.update({
      where: {
        id: contestId as string,
      },
      data: {
        status: ContestStatus.OPEN,
      },
    });

    const entryResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(entryResponse.data?.entry.id).toBeTruthy();
    expect(entryResponse.data?.entry.tiebreakerValue ?? null).toBeNull();

    const updateResponse = await updateContestEntry({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
        entryId: entryResponse.data?.entry.id as string,
      },
      body: {
        tiebreakerValue: 271,
      },
    });

    expect(updateResponse.data?.entry.id).toBe(entryResponse.data?.entry.id);
    expect(updateResponse.data?.entry.tiebreakerValue).toBe(271);

    const refreshedEntryResponse = await getMyContestEntry({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(refreshedEntryResponse.data?.entry?.tiebreakerValue).toBe(271);
  });

  it('returns expanded contest-entry detail with roster picks and latest performance', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Entry Detail Commissioner',
      leagueName: 'Entry Detail Functional League',
    });

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Entry Detail Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        contestConfiguration: {
          rounds: 1,
          tierAssignmentMethod: TierAssignmentMethod.ODDS,
          tierConfig: [
            {
              tierId: 'tier-1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 1,
              participantIds: [],
            },
          ],
        },
      },
    });

    const contestId = createResponse.data?.contest.id;
    expect(contestId).toBeTruthy();

    const prisma = getFunctionalPrisma();
    await prisma.contest.update({
      where: {
        id: contestId as string,
      },
      data: {
        status: ContestStatus.OPEN,
      },
    });

    const sport = await prisma.sport.create({
      data: {
        name: `EntryDetailSport-${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        statSchema: {},
      },
    });
    createdSportIds.push(sport.id);

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Entry Detail Golfer ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
        metadata: {},
        position: 'GOLFER',
        teamAffiliation: 'USA',
      },
    });
    createdParticipantIds.push(participant.id);

    const sportEvent = await prisma.sportEvent.create({
      data: {
        externalId: `entry-detail-event-${randomUUID().slice(0, 8)}`,
        providerId: 'functional-test',
        sport: Sport.GOLF,
        name: 'Entry Detail Event',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        releaseAt: new Date('2026-04-10T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-04-10T12:00:00.000Z'),
        status: 'IN_PROGRESS',
      },
    });
    createdSportEventIds.push(sportEvent.id);

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        status: 'ACTIVE',
      },
    });
    createdSportEventParticipantIds.push(sportEventParticipant.id);

    await prisma.sportEventParticipantSourceData.create({
      data: {
        sportEventParticipantId: sportEventParticipant.id,
        providerId: 'functional-test',
        externalId: participant.id,
        rawPayload: { scoreToPar: -11, round1: 70, round2: 68 },
        normalizedData: {
          scoreToPar: -11,
          thru: 'F',
          round1: 70,
          round2: 68,
          finishPosition: 1,
        },
        receivedAt: new Date('2026-04-10T15:00:00.000Z'),
      },
    });

    await prisma.contest.update({
      where: {
        id: contestId as string,
      },
      data: {
        sportEventId: sportEvent.id,
      },
    });

    await prisma.contestConfiguration.update({
      where: {
        contestId: contestId as string,
      },
      data: {
        tierConfig: [
          {
            tierId: 'tier-1',
            tierName: 'Tier 1',
            tierNumber: 1,
            picksFromTier: 1,
            participantIds: [participant.id],
          },
        ],
      },
    });

    const entryResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    const entryId = entryResponse.data?.entry.id;
    expect(entryId).toBeTruthy();

    const rosterPick = await prisma.rosterPick.create({
      data: {
        entryId: entryId as string,
        sportEventParticipantId: sportEventParticipant.id,
        autoPicked: false,
      },
    });

    await prisma.contestEntryParticipantScore.create({
      data: {
        entryId: entryId as string,
        rosterPickId: rosterPick.id,
        pointsEarned: -11,
      },
    });

    const detailResponse = await getContestEntry({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
        entryId: entryId as string,
      },
    });

    expect(detailResponse.data?.entry.id).toBe(entryId);
    expect(detailResponse.data?.entry.participants).toEqual([
      expect.objectContaining({
        participantId: participant.id,
        participantName: participant.name,
        participantStatus: 'ACTIVE',
        contestPoints: -11,
        latestPerformance: expect.objectContaining({
          scoreToPar: -11,
          thru: 'F',
          round1: 70,
          round2: 68,
          finishPosition: 1,
        }),
      }),
    ]);
  });

  it('rejects a league outsider from entering a contest', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Outsider Commissioner',
      leagueName: 'Outsider Functional League',
    });
    const outsider = await buildRegisteredUser({
      displayName: 'Contest Outsider',
    });

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Outsider Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.BUDGET_PICK,
        scoringEngine: ScoringEngine.POSITION,
      },
    });

    const contestId = createResponse.data?.contest.id;
    expect(contestId).toBeTruthy();

    const enterResponse = await enterContest({
      client: outsider.client,
      path: {
        contestId: contestId as string,
      },
    });

    expectFunctionalError(enterResponse, {
      status: 400,
      code: 'LEAGUE_MEMBERSHIP_REQUIRED',
    });

    const cleanupDeleteResponse = await deleteContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(cleanupDeleteResponse.response.status).toBe(204);
  });

  it('rejects locked contest entry creation and leaving after selections exist', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Negative Contest Commissioner',
      leagueName: 'Negative Contest League',
    });
    const member = await buildRegisteredUser({
      displayName: 'Negative Contest Member',
    });

    const { acceptInvitation, generateInviteLink } = await import('@poolmaster/shared/generated/hey-api');

    const inviteLinkResponse = await generateInviteLink({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        maxUses: 1,
      },
    });

    const acceptResponse = await acceptInvitation({
      client: member.client,
      body: {
        inviteCode: inviteLinkResponse.data?.invitation.inviteCode as string,
      },
    });
    expect(acceptResponse.data?.membership.userId).toBe(member.userId);

    const lockedContestResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Locked Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        contestConfiguration: {
          rounds: 1,
          tierAssignmentMethod: TierAssignmentMethod.ODDS,
          tierConfig: [
            {
              tierId: 'tier-1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 1,
              participantIds: [],
            },
          ],
        },
      },
    });

    const selectableContestResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Selection Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        contestConfiguration: {
          rounds: 1,
          tierAssignmentMethod: TierAssignmentMethod.ODDS,
          tierConfig: [
            {
              tierId: 'tier-1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 1,
              participantIds: [],
            },
          ],
        },
      },
    });

    const lockedContestId = lockedContestResponse.data?.contest.id;
    const selectableContestId = selectableContestResponse.data?.contest.id;
    expect(lockedContestId).toBeTruthy();
    expect(selectableContestId).toBeTruthy();

    const prisma = getFunctionalPrisma();
    await prisma.contest.update({
      where: {
        id: lockedContestId as string,
      },
      data: {
        status: ContestStatus.LOCKED,
      },
    });

    const sport = await prisma.sport.create({
      data: {
        name: `FunctionalContestSport-${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        statSchema: {},
      },
    });
    createdSportIds.push(sport.id);

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Functional Contest Player ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
        metadata: {},
        position: 'GOLFER',
        teamAffiliation: null,
      },
    });
    createdParticipantIds.push(participant.id);

    const sportEvent = await prisma.sportEvent.create({
      data: {
        externalId: `functional-contest-event-${randomUUID().slice(0, 8)}`,
        providerId: 'functional-test',
        sport: Sport.GOLF,
        name: 'Functional Contest Event',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        releaseAt: new Date('2026-04-10T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });
    createdSportEventIds.push(sportEvent.id);

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        status: 'ACTIVE',
      },
    });
    createdSportEventParticipantIds.push(sportEventParticipant.id);

    await prisma.sportEventParticipantValuation.create({
      data: {
        sportEventParticipantId: sportEventParticipant.id,
        price: 1000,
        tier: 'tier-1',
        orderIndex: 1,
        valuationSource: 'functional-test',
      },
    });

    await prisma.contest.update({
      where: {
        id: selectableContestId as string,
      },
      data: {
        sportEventId: sportEvent.id,
      },
    });

    await prisma.contestConfiguration.update({
      where: {
        contestId: selectableContestId as string,
      },
      data: {
        tierConfig: [
          {
            tierId: 'tier-1',
            tierName: 'Tier 1',
            tierNumber: 1,
            picksFromTier: 1,
            participantIds: [participant.id],
          },
        ],
      },
    });

    const lockedEntryResponse = await enterContest({
      client: member.client,
      path: {
        contestId: lockedContestId as string,
      },
    });

    expectFunctionalError(lockedEntryResponse, {
      status: 400,
      code: 'CONTEST_ENTRY_LOCKED',
    });

    const entryResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId: selectableContestId as string,
      },
    });

    expect(entryResponse.data?.entry.id).toBeTruthy();

    const selectionResponse = await submitContestSelection({
      client: commissioner.client,
      path: {
        contestId: selectableContestId as string,
      },
      body: {
        entryId: entryResponse.data?.entry.id as string,
        participantId: sportEventParticipant.id,
      },
    });

    expect(selectionResponse.data).toBeDefined();

    const leaveAfterSelectionResponse = await leaveContest({
      client: commissioner.client,
      path: {
        contestId: selectableContestId as string,
      },
    });

    expectFunctionalError(leaveAfterSelectionResponse, {
      status: 400,
      code: 'CONTEST_ENTRY_SELECTIONS_EXIST',
    });
  });
});
