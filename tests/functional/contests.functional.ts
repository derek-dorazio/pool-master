import {
  createContest,
  deleteContest,
  enterContest,
  getContest,
  getContestEntry,
  getContestConfiguration,
  getMyContestEntry,
  leaveContest,
  listContestEntries,
  listContestConfigTemplates,
  listContests,
  openContest,
  updateContestEntry,
  updateContest,
  submitContestSelection,
} from '@poolmaster/shared/generated/hey-api';
import {
  ContestStatus,
  ContestFormat,
  ParticipantType,
  ScoringEngine,
  SelectionType,
  Sport,
} from '@poolmaster/shared/domain';
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

async function cleanupContestArtifacts(): Promise<void> {
  const prisma = getFunctionalPrisma();

  if (createdSportEventParticipantIds.length > 0) {
    await prisma.contestEntryPick.deleteMany({
      where: {
        sportEventParticipantId: {
          in: createdSportEventParticipantIds,
        },
      },
    });
    await prisma.sportEventParticipantGolfStanding.deleteMany({
      where: {
        standing: {
          sportEventParticipantId: {
            in: createdSportEventParticipantIds,
          },
        },
      },
    });
    await prisma.sportEventParticipantStanding.deleteMany({
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

async function seedImportedGolfEvent(options: {
  eventName: string;
  participantCount: number;
  providerId?: string;
  /** How many tiers the field is split across, round-robin. Defaults to one tier. */
  tierCount?: number;
}) {
  const prisma = getFunctionalPrisma();
  const now = new Date();
  const startDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const sport = await prisma.sport.create({
    data: {
      name: `ManagedContestSport-${randomUUID().slice(0, 8)}`,
      participantType: ParticipantType.INDIVIDUAL,
      tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
    },
  });
  createdSportIds.push(sport.id);

  const sportEvent = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `managed-contest-event-${randomUUID().slice(0, 8)}`,
      providerId: options.providerId ?? 'functional-test',
      sport: Sport.GOLF,
      name: options.eventName,
      startDate,
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(sportEvent.id);

  // Tiers are event-owned now (plans/124 §4.5/§4.6) — a tiered contest's
  // draft/pick flow requires every selectable golfer to have a real tier
  // assignment (TIER_MISSING otherwise), so this fixture needs one covering
  // the whole field, not just the SportEventParticipant rows.
  const tierCount = options.tierCount ?? 1;
  const tiers = [];
  for (let tierIndex = 0; tierIndex < tierCount; tierIndex += 1) {
    const tierKey = String.fromCharCode(65 + tierIndex);
    tiers.push(await prisma.sportEventTier.create({
      data: {
        sportEventId: sportEvent.id,
        tierKey,
        label: `Tier ${tierKey}`,
        tierNumber: tierIndex + 1,
      },
    }));
  }

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
        role: 'GOLFER',
        teamAffiliation: index % 2 === 0 ? 'USA' : 'EUR',
      },
    });
    createdParticipantIds.push(participant.id);

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        isActive: true,
      },
    });
    createdSportEventParticipantIds.push(sportEventParticipant.id);
    await prisma.sportEventParticipantValuation.create({
      data: {
        sportEventParticipantId: sportEventParticipant.id,
        sportEventTierId: tiers[index % tierCount].id,
        tierOrderIndex: Math.floor(index / tierCount) + 1,
        tierAssignedSource: 'MANUAL',
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
  it('creates a template-first managed contest as a draft that becomes entry-ready once the commissioner opens it', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Managed Contest Commissioner',
      leagueName: 'Managed Contest Functional League',
    });
    const importedEvent = await seedImportedGolfEvent({
      eventName: 'Managed Masters Functional Event',
      participantCount: 80,
      // Six tiers, so the default template's one pick per tier makes a roster of 6.
      tierCount: 6,
    });

    const templatesResponse = await listContestConfigTemplates({
      client: commissioner.client,
      query: {
        sport: Sport.GOLF,
        contestFormat: ContestFormat.ROSTER,
        active: true,
      },
    });

    expect(templatesResponse.data?.templates.length).toBeGreaterThan(0);
    const defaultTemplate = templatesResponse.data?.templates.find(
      (template) => template.isDefault,
    );
    expect(defaultTemplate).toBeDefined();

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: `${league.name} Managed Masters Functional Event`,
        sportEventId: importedEvent.sportEventId,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        templateId: defaultTemplate?.id as string,
      },
    });

    // #245 — create answers with the canonical contest read; the template's configuration is the
    // contest's when none is supplied.
    expect(createResponse.response.status).toBe(201);
    expect(createResponse.data?.contest.id).toBeTruthy();
    expect(createResponse.data?.contest.status).toBe(ContestStatus.DRAFT);
    expect(createResponse.data?.contest.selectionType).toBe(SelectionType.TIERED);
    expect(createResponse.data?.contestConfiguration?.picksPerTier).toBe(
      defaultTemplate?.configuration.picksPerTier,
    );
    expect(createResponse.data?.contestConfiguration?.countedScores).toBe(
      defaultTemplate?.configuration.countedScores,
    );

    const contestId = createResponse.data?.contest.id as string;
    const configurationResponse = await getContestConfiguration({
      client: commissioner.client,
      path: {
        id: league.id,
        contestId,
      },
    });

    expect(configurationResponse.data?.contest.id).toBe(contestId);
    expect(configurationResponse.data?.contest.templateId).toBe(defaultTemplate?.id);
    expect(configurationResponse.data?.contest.sportEventId).toBe(
      importedEvent.sportEventId,
    );
    // pool-master-41t — the commissioner detail echoes the linked event's
    // effective tiers read-only (plans/124 §4.6/§5.3). seedImportedGolfEvent
    // splits the 80-golfer field across six tiers.
    const echoedTiers = configurationResponse.data?.contest.effectiveTiers ?? [];
    expect(echoedTiers).toHaveLength(6);
    expect(echoedTiers[0]).toMatchObject({
      tierKey: 'A',
      label: 'Tier A',
      tierNumber: 1,
    });
    expect(echoedTiers.reduce((total, tier) => total + tier.assignments.length, 0)).toBe(80);

    // #117 — a draft takes no entries until the commissioner opens it to the league.
    const draftEntryResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });
    expectFunctionalError(draftEntryResponse, { status: 400, code: 'CONTEST_ENTRY_LOCKED' });

    const openResponse = await openContest({
      client: commissioner.client,
      path: { id: league.id, contestId },
    });
    expect(openResponse.data?.contest.status).toBe(ContestStatus.OPEN);

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

    const templatesResponse = await listContestConfigTemplates({
      client: commissioner.client,
      query: {
        sport: Sport.GOLF,
        contestFormat: ContestFormat.ROSTER,
        active: true,
      },
    });
    const defaultTemplate = templatesResponse.data?.templates.find(
      (template) => template.isDefault,
    );
    expect(defaultTemplate).toBeDefined();

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: `${league.name} Managed Selection Event`,
        sportEventId: importedEvent.sportEventId,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        templateId: defaultTemplate?.id as string,
        configuration: {
          maxEntriesPerSquad: 3,
          picksPerTier: 1,
          countedScores: 1,
        },
      },
    });

    const contestId = createResponse.data?.contest.id as string;
    const openResponse = await openContest({
      client: commissioner.client,
      path: { id: league.id, contestId },
    });
    expect(openResponse.data?.contest.status).toBe(ContestStatus.OPEN);
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
    expect(selectionResponse.data?.pickHistories).toHaveLength(1);
    expect(selectionResponse.data?.pickHistories[0]?.participantId).toBe(
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

  it('rejects invalid contest creation requests through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Managed Invalid Commissioner',
      leagueName: 'Managed Invalid Functional League',
    });
    const importedEvent = await seedImportedGolfEvent({
      eventName: 'Managed Invalid Event',
      participantCount: 1,
    });
    const templatesResponse = await listContestConfigTemplates({
      client: commissioner.client,
      query: {
        sport: Sport.GOLF,
        contestFormat: ContestFormat.ROSTER,
        active: true,
      },
    });
    const defaultTemplate = templatesResponse.data?.templates.find(
      (template) => template.isDefault,
    );
    expect(defaultTemplate).toBeDefined();

    const missingTemplateResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Missing Template Contest',
        sportEventId: importedEvent.sportEventId,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        templateId: '00000000-0000-4000-8000-000000000000',
      },
    });

    expectFunctionalError(missingTemplateResponse, {
      status: 422,
      code: 'CONTEST_CONFIGURATION_INVALID',
    });

    // #245 — neither a template nor a configuration: the documented 400, not a generic one.
    const emptyCreateResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Empty Create Contest',
        sportEventId: importedEvent.sportEventId,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
      },
    });

    expectFunctionalError(emptyCreateResponse, {
      status: 400,
      code: 'CONTEST_CONFIGURATION_REQUIRED',
    });
  });

  it('lists, reads, updates, and deletes a contest through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Contest Commissioner',
      leagueName: 'Contest Functional League',
    });

    const { contestId } = await seedContestFixture(league.id, {
      name: 'Functional Contest',
      selectionType: SelectionType.BUDGET_PICK,
      scoringEngine: ScoringEngine.POSITION,
      status: 'DRAFT',
    });

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
        contestId,
      },
    });

    expect(detailResponse.data).toBeDefined();
    expect(detailResponse.data?.contest.id).toBe(contestId);
    expect(detailResponse.data?.contest.name).toBe('Functional Contest');
    expect(detailResponse.data?.contest.status).toBe('DRAFT');
    expect(detailResponse.data?.contest.leagueId).toBe(league.id);
    expect(detailResponse.data?.contest.selectionType).toBe('BUDGET_PICK');
    expect(detailResponse.data?.contest.scoringEngine).toBe('POSITION');

    const updateResponse = await updateContest({
      client: commissioner.client,
      path: {
        contestId,
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
        contestId,
      },
    });

    expect(deleteResponse.response.status).toBe(204);

    const deletedContest = await getContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expectFunctionalError(deletedContest, {
      status: 404,
      code: 'CONTEST_NOT_FOUND',
    });
  });

  it('enters, lists, leaves, and re-enters a contest through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Entry Commissioner',
      leagueName: 'Entry Functional League',
    });

    const { contestId } = await seedContestFixture(league.id, {
      name: 'Entry Lifecycle Contest',
      selectionType: SelectionType.BUDGET_PICK,
      scoringEngine: ScoringEngine.POSITION,
    });

    const enterResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(enterResponse.data).toBeDefined();
    expect(enterResponse.data?.contestId).toBe(contestId);
    expect(enterResponse.data?.entry.status).toBe('DRAFT');
    expect(enterResponse.data?.entry.entryNumber).toBe(1);

    const secondEnterResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expectFunctionalError(secondEnterResponse, {
      status: 409,
      code: 'CONTEST_ENTRY_LIMIT_REACHED',
    });

    const myEntryResponse = await getMyContestEntry({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(myEntryResponse.data).toBeDefined();
    expect(myEntryResponse.data?.contestId).toBe(contestId);
    expect(myEntryResponse.data?.entry?.id).toBe(enterResponse.data?.entry.id);

    const entriesResponse = await listContestEntries({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(entriesResponse.data).toBeDefined();
    expect(entriesResponse.data?.contestId).toBe(contestId);
    expect(entriesResponse.data?.isJoined).toBe(true);
    expect(entriesResponse.data?.myEntryId).toBe(enterResponse.data?.entry.id);
    expect(entriesResponse.data?.entries).toHaveLength(1);

    // The league's contest list counts submitted entries only (#481): this one is still an
    // unsubmitted draft with no picks, so it is listed above but not counted.
    const listedWithEntry = await listContests({
      client: commissioner.client,
      path: { id: league.id },
    });
    expect(listedWithEntry.data?.contests.find((contest) => contest.id === contestId)?.entryCount).toBe(0);

    const leaveResponse = await leaveContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(leaveResponse.data).toBeDefined();
    expect(leaveResponse.data?.contestId).toBe(contestId);
    expect(leaveResponse.data?.deleted).toBe(true);

    const afterLeaveMyEntry = await getMyContestEntry({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(afterLeaveMyEntry.data).toBeDefined();
    expect(afterLeaveMyEntry.data?.contestId).toBe(contestId);
    expect(afterLeaveMyEntry.data?.entry).toBeNull();

    const afterLeaveEntries = await listContestEntries({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(afterLeaveEntries.data).toBeDefined();
    expect(afterLeaveEntries.data?.isJoined).toBe(false);
    expect(afterLeaveEntries.data?.entries).toHaveLength(0);
    expect(afterLeaveEntries.data?.myEntryId).toBeNull();

    const listedAfterLeave = await listContests({
      client: commissioner.client,
      path: { id: league.id },
    });
    expect(listedAfterLeave.data?.contests.find((contest) => contest.id === contestId)?.entryCount).toBe(0);

    const reenterResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(reenterResponse.data).toBeDefined();
    expect(reenterResponse.data?.contestId).toBe(contestId);
    expect(reenterResponse.data?.entry.status).toBe('DRAFT');
    expect(reenterResponse.data?.entry.entryNumber).toBe(1);
  });

  it('re-enters a multi-entry contest after leaving it, numbering the new entry past the one the team still holds', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Multi Entry Commissioner',
      leagueName: 'Multi Entry Functional League',
    });
    const { contestId } = await seedContestFixture(league.id, {
      name: 'Multi Entry Contest',
      selectionType: SelectionType.BUDGET_PICK,
      scoringEngine: ScoringEngine.POSITION,
      configuration: { maxEntriesPerSquad: 2 },
    });
    await enterContest({ client: commissioner.client, path: { contestId } });
    await enterContest({ client: commissioner.client, path: { contestId } });
    // Leaving removes the team's first entry and keeps entry 2.
    await leaveContest({ client: commissioner.client, path: { contestId } });

    const reenterResponse = await enterContest({ client: commissioner.client, path: { contestId } });

    expect(reenterResponse.response.status).toBe(201);
    expect(reenterResponse.data?.entry.entryNumber).toBe(3);
    const entries = await listContestEntries({ client: commissioner.client, path: { contestId } });
    expect(entries.data?.entries.map((entry) => entry.entryNumber).sort()).toEqual([2, 3]);
  });

  it('renames a team-owned contest entry and rejects duplicate names through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Rename Commissioner',
      leagueName: 'Rename Functional League',
    });

    const { contestId } = await seedContestFixture(league.id, {
      name: 'Rename Contest',
      selectionType: SelectionType.BUDGET_PICK,
      scoringEngine: ScoringEngine.POSITION,
    });

    expect(contestId).toBeTruthy();

    const prisma = getFunctionalPrisma();
    await prisma.contest.update({
      where: {
        id: contestId,
      },
      data: {
        status: ContestStatus.OPEN,
      },
    });

    const enterResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(enterResponse.data?.entry.id).toBeTruthy();

    const secondEntry = await prisma.contestEntry.create({
      data: {
        contestId,
        squadId: enterResponse.data?.entry.squadId as string,
        entryNumber: 2,
        name: 'Rename Functional League Entry 2',
        status: 'SUBMITTED',
      },
    });

    const renameResponse = await updateContestEntry({
      client: commissioner.client,
      path: {
        contestId,
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
        contestId,
      },
    });

    expect(entriesResponse.data?.entries.find((entry) => entry.id === enterResponse.data?.entry.id)?.name)
      .toBe('Sunday Charge');

    const duplicateRenameResponse = await updateContestEntry({
      client: commissioner.client,
      path: {
        contestId,
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

    const { contestId } = await seedContestFixture(league.id, {
      name: 'Tiebreaker Contest',
      selectionType: SelectionType.BUDGET_PICK,
      scoringEngine: ScoringEngine.POSITION,
    });

    expect(contestId).toBeTruthy();

    const prisma = getFunctionalPrisma();
    await prisma.contest.update({
      where: {
        id: contestId,
      },
      data: {
        status: ContestStatus.OPEN,
      },
    });

    const entryResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId,
      },
    });

    expect(entryResponse.data?.entry.id).toBeTruthy();
    expect(entryResponse.data?.entry.tiebreakerValue ?? null).toBeNull();

    const updateResponse = await updateContestEntry({
      client: commissioner.client,
      path: {
        contestId,
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
        contestId,
      },
    });

    expect(refreshedEntryResponse.data?.entry?.tiebreakerValue).toBe(271);
  });

  // pool-master-eux.5: contest-entry detail keeps picks as pointers after legacy score fields are removed.
  it('pool-master-eux.5 returns expanded contest-entry detail with pick pointers only', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Entry Detail Commissioner',
      leagueName: 'Entry Detail Functional League',
    });

    const { contestId } = await seedContestFixture(league.id, {
      name: 'Entry Detail Contest',
      selectionType: SelectionType.TIERED,
      scoringEngine: ScoringEngine.STROKE_PLAY,
      configuration: {
        rounds: 1,
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
    });

    expect(contestId).toBeTruthy();

    const prisma = getFunctionalPrisma();
    await prisma.contest.update({
      where: {
        id: contestId,
      },
      data: {
        status: ContestStatus.OPEN,
      },
    });

    const sport = await prisma.sport.create({
      data: {
        name: `EntryDetailSport-${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });
    createdSportIds.push(sport.id);

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Entry Detail Golfer ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
        role: 'GOLFER',
        teamAffiliation: 'USA',
      },
    });
    createdParticipantIds.push(participant.id);

    const sportEvent = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `entry-detail-event-${randomUUID().slice(0, 8)}`,
        providerId: 'functional-test',
        sport: Sport.GOLF,
        name: 'Entry Detail Event',
        startDate: new Date('2099-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });
    createdSportEventIds.push(sportEvent.id);

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        isActive: true,
      },
    });
    createdSportEventParticipantIds.push(sportEventParticipant.id);

    await prisma.contest.update({
      where: {
        id: contestId,
      },
      data: {
        sportEventId: sportEvent.id,
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
            picksFromTier: 1,
            participantIds: [participant.id],
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

    const entryId = entryResponse.data?.entry.id;
    expect(entryId).toBeTruthy();

    await prisma.contestEntryPick.create({
      data: {
        entryId: entryId as string,
        sportEventParticipantId: sportEventParticipant.id,
        contestFormat: 'ROSTER',
        isAutoPicked: false,
      },
    });

    const detailResponse = await getContestEntry({
      client: commissioner.client,
      path: {
        contestId,
        entryId: entryId as string,
      },
    });

    expect(detailResponse.data?.entry.id).toBe(entryId);
    expect(detailResponse.data?.entry.participants).toEqual([
      expect.objectContaining({
        participantId: participant.id,
        participantName: participant.name,
        participantStatus: 'ACTIVE',
      }),
    ]);
  });

  it('rejects a league outsider from entering a contest', async () => {
    const { league } = await buildLeagueWithCommissioner({
      displayName: 'Outsider Commissioner',
      leagueName: 'Outsider Functional League',
    });
    const outsider = await buildRegisteredUser({
      displayName: 'Contest Outsider',
    });

    const { contestId } = await seedContestFixture(league.id, {
      name: 'Outsider Contest',
      selectionType: SelectionType.BUDGET_PICK,
      scoringEngine: ScoringEngine.POSITION,
    });

    expect(contestId).toBeTruthy();

    const enterResponse = await enterContest({
      client: outsider.client,
      path: {
        contestId,
      },
    });

    // #291 — a membership refusal is an authorization failure: 403, as the league pre-checks answer.
    expectFunctionalError(enterResponse, {
      status: 403,
      code: 'LEAGUE_MEMBERSHIP_REQUIRED',
    });
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

    const { contestId: lockedContestId } = await seedContestFixture(league.id, {
      name: 'Locked Contest',
      selectionType: SelectionType.TIERED,
      scoringEngine: ScoringEngine.STROKE_PLAY,
      configuration: {
        rounds: 1,
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
    });

    const { contestId: selectableContestId } = await seedContestFixture(league.id, {
      name: 'Selection Contest',
      selectionType: SelectionType.TIERED,
      scoringEngine: ScoringEngine.STROKE_PLAY,
      configuration: {
        rounds: 1,
        configJson: { picksPerTier: 1, countedScores: 1 },
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
    });

    expect(lockedContestId).toBeTruthy();
    expect(selectableContestId).toBeTruthy();

    const prisma = getFunctionalPrisma();
    await prisma.contest.update({
      where: {
        id: lockedContestId,
      },
      data: {
        status: ContestStatus.ACTIVE,
      },
    });

    const sport = await prisma.sport.create({
      data: {
        name: `FunctionalContestSport-${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });
    createdSportIds.push(sport.id);

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Functional Contest Player ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
        role: 'GOLFER',
        teamAffiliation: null,
      },
    });
    createdParticipantIds.push(participant.id);

    const sportEvent = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `functional-contest-event-${randomUUID().slice(0, 8)}`,
        providerId: 'functional-test',
        sport: Sport.GOLF,
        name: 'Functional Contest Event',
        startDate: new Date('2099-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });
    createdSportEventIds.push(sportEvent.id);

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        isActive: true,
      },
    });
    createdSportEventParticipantIds.push(sportEventParticipant.id);

    // Tiers are event-owned now (plans/124 §4.5/§4.6) — the pick-submission
    // flow requires a real tier assignment (TIER_MISSING otherwise), so this
    // fixture needs a SportEventTier alongside the legacy tierConfig
    // JSON this test also writes below.
    const tier = await prisma.sportEventTier.create({
      data: {
        sportEventId: sportEvent.id,
        tierKey: 'tier-1',
        label: 'Tier 1',
        tierNumber: 1,
      },
    });
    await prisma.sportEventParticipantValuation.create({
      data: {
        sportEventParticipantId: sportEventParticipant.id,
        sportEventTierId: tier.id,
        tierOrderIndex: 1,
        tierAssignedSource: 'MANUAL',
        price: 1000,
        priceAssignedSource: 'MANUAL',
      },
    });

    await prisma.contest.update({
      where: {
        id: selectableContestId,
      },
      data: {
        sportEventId: sportEvent.id,
      },
    });

    await prisma.contestConfiguration.update({
      where: {
        contestId: selectableContestId,
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
        contestId: lockedContestId,
      },
    });

    expectFunctionalError(lockedEntryResponse, {
      status: 400,
      code: 'CONTEST_ENTRY_LOCKED',
    });

    const entryResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId: selectableContestId,
      },
    });

    expect(entryResponse.data?.entry.id).toBeTruthy();

    const selectionResponse = await submitContestSelection({
      client: commissioner.client,
      path: {
        contestId: selectableContestId,
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
        contestId: selectableContestId,
      },
    });

    expectFunctionalError(leaveAfterSelectionResponse, {
      status: 400,
      code: 'CONTEST_ENTRY_SELECTIONS_EXIST',
    });
  });

  // pool-master-dxd.13 — pre-event-start, non-owning squad members must not
  // see another team's roster picks via getContestEntry. Owners still see
  // their own picks. Once the contest progresses past the joinable phase,
  // picks become visible to every league member.
  it('redacts contest-entry picks from non-owners while contest is OPEN, reveals after status moves past OPEN', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Visibility Commissioner',
      leagueName: 'Visibility Functional League',
    });
    const member = await buildRegisteredUser({
      displayName: 'Visibility Member',
    });

    const { acceptInvitation, generateInviteLink } = await import('@poolmaster/shared/generated/hey-api');

    const inviteLinkResponse = await generateInviteLink({
      client: commissioner.client,
      path: { id: league.id },
      body: { maxUses: 1 },
    });
    const acceptResponse = await acceptInvitation({
      client: member.client,
      body: {
        inviteCode: inviteLinkResponse.data?.invitation.inviteCode as string,
      },
    });
    expect(acceptResponse.data?.membership.userId).toBe(member.userId);

    const { contestId } = await seedContestFixture(league.id, {
      name: 'Visibility Contest',
      selectionType: SelectionType.TIERED,
      scoringEngine: ScoringEngine.STROKE_PLAY,
      configuration: {
        rounds: 1,
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
    });

    expect(contestId).toBeTruthy();

    const prisma = getFunctionalPrisma();
    await prisma.contest.update({
      where: { id: contestId },
      data: { status: ContestStatus.OPEN },
    });

    const sport = await prisma.sport.create({
      data: {
        name: `VisibilitySport-${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });
    createdSportIds.push(sport.id);

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Visibility Golfer ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
        role: 'GOLFER',
        teamAffiliation: 'USA',
      },
    });
    createdParticipantIds.push(participant.id);

    const sportEvent = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `visibility-event-${randomUUID().slice(0, 8)}`,
        providerId: 'functional-test',
        sport: Sport.GOLF,
        name: 'Visibility Event',
        startDate: new Date('2099-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });
    createdSportEventIds.push(sportEvent.id);

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        isActive: true,
      },
    });
    createdSportEventParticipantIds.push(sportEventParticipant.id);

    await prisma.contest.update({
      where: { id: contestId },
      data: { sportEventId: sportEvent.id },
    });

    await prisma.contestConfiguration.update({
      where: { contestId },
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

    // Member enters and adds a roster pick.
    const memberEntryResponse = await enterContest({
      client: member.client,
      path: { contestId },
    });
    const memberEntryId = memberEntryResponse.data?.entry.id;
    expect(memberEntryId).toBeTruthy();

    await prisma.contestEntryPick.create({
      data: {
        entryId: memberEntryId as string,
        sportEventParticipantId: sportEventParticipant.id,
        contestFormat: 'ROSTER',
        isAutoPicked: false,
      },
    });

    // 1) Commissioner viewing the member's entry while contest is OPEN
    //    must NOT receive participant picks. Defect this test catches:
    //    pre-event-start picks were visible to anyone in the league.
    const preEventNonOwnerResponse = await getContestEntry({
      client: commissioner.client,
      path: {
        contestId,
        entryId: memberEntryId as string,
      },
    });
    expect(preEventNonOwnerResponse.data?.picksRevealed).toBe(false);
    expect(preEventNonOwnerResponse.data?.entry.id).toBe(memberEntryId);
    expect(preEventNonOwnerResponse.data?.entry.picksCount).toBe(1);
    expect(preEventNonOwnerResponse.data?.entry.participants).toBeUndefined();

    // 2) Member viewing their OWN entry while contest is OPEN must see picks.
    const preEventOwnerResponse = await getContestEntry({
      client: member.client,
      path: {
        contestId,
        entryId: memberEntryId as string,
      },
    });
    expect(preEventOwnerResponse.data?.picksRevealed).toBe(false);
    expect(preEventOwnerResponse.data?.entry.picksCount).toBe(1);
    expect(preEventOwnerResponse.data?.entry.participants?.length).toBe(1);
    expect(preEventOwnerResponse.data?.entry.participants?.[0]?.participantId).toBe(participant.id);

    // 3) Move contest past OPEN, then non-owner viewing must see picks.
    await prisma.contest.update({
      where: { id: contestId },
      data: { status: ContestStatus.ACTIVE },
    });
    const postEventNonOwnerResponse = await getContestEntry({
      client: commissioner.client,
      path: {
        contestId,
        entryId: memberEntryId as string,
      },
    });
    expect(postEventNonOwnerResponse.data?.picksRevealed).toBe(true);
    expect(postEventNonOwnerResponse.data?.entry.picksCount).toBe(1);
    expect(postEventNonOwnerResponse.data?.entry.participants?.length).toBe(1);
    expect(postEventNonOwnerResponse.data?.entry.participants?.[0]?.participantId).toBe(participant.id);
  });

  // pool-master-dxd.13 — listContestEntries must mirror the same redaction
  // contract: pre-event-start the response carries picksRevealed=false,
  // entries[].participants is omitted for non-owning entries, and the
  // requester's own entries still bundle participants. Post-event-start
  // every entry includes participants[].
  it('listContestEntries redacts non-owner picks pre-event and reveals all picks once contest moves past OPEN', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'List Visibility Commissioner',
      leagueName: 'List Visibility Functional League',
    });
    const member = await buildRegisteredUser({
      displayName: 'List Visibility Member',
    });

    const { acceptInvitation, generateInviteLink, listContestEntries: listContestEntriesOp } = await import('@poolmaster/shared/generated/hey-api');

    const inviteLinkResponse = await generateInviteLink({
      client: commissioner.client,
      path: { id: league.id },
      body: { maxUses: 1 },
    });
    await acceptInvitation({
      client: member.client,
      body: {
        inviteCode: inviteLinkResponse.data?.invitation.inviteCode as string,
      },
    });

    const { contestId } = await seedContestFixture(league.id, {
      name: 'List Visibility Contest',
      selectionType: SelectionType.TIERED,
      scoringEngine: ScoringEngine.STROKE_PLAY,
      configuration: {
        rounds: 1,
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
    });
    expect(contestId).toBeTruthy();

    const prisma = getFunctionalPrisma();
    await prisma.contest.update({
      where: { id: contestId },
      data: { status: ContestStatus.OPEN },
    });

    const sport = await prisma.sport.create({
      data: {
        name: `ListVisibilitySport-${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });
    createdSportIds.push(sport.id);

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `List Visibility Golfer ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
        role: 'GOLFER',
        teamAffiliation: 'USA',
      },
    });
    createdParticipantIds.push(participant.id);

    const sportEvent = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `list-visibility-event-${randomUUID().slice(0, 8)}`,
        providerId: 'functional-test',
        sport: Sport.GOLF,
        name: 'List Visibility Event',
        startDate: new Date('2099-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });
    createdSportEventIds.push(sportEvent.id);

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        isActive: true,
      },
    });
    createdSportEventParticipantIds.push(sportEventParticipant.id);

    await prisma.contest.update({
      where: { id: contestId },
      data: { sportEventId: sportEvent.id },
    });
    await prisma.contestConfiguration.update({
      where: { contestId },
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

    // Both squads enter and pick.
    const commissionerEntryResponse = await enterContest({
      client: commissioner.client,
      path: { contestId },
    });
    const memberEntryResponse = await enterContest({
      client: member.client,
      path: { contestId },
    });
    const commissionerEntryId = commissionerEntryResponse.data?.entry.id as string;
    const memberEntryId = memberEntryResponse.data?.entry.id as string;

    await prisma.contestEntryPick.create({
      data: {
        entryId: commissionerEntryId,
        sportEventParticipantId: sportEventParticipant.id,
        contestFormat: 'ROSTER',
        isAutoPicked: false,
      },
    });
    await prisma.contestEntryPick.create({
      data: {
        entryId: memberEntryId,
        sportEventParticipantId: sportEventParticipant.id,
        contestFormat: 'ROSTER',
        isAutoPicked: false,
      },
    });

    // Pre-event-start, member's perspective:
    // - picksRevealed=false at the response level.
    // - the member's own entry has participants[].
    // - the commissioner's entry has picksCount but no participants[].
    const preEventListResponse = await listContestEntriesOp({
      client: member.client,
      path: { contestId },
    });
    expect(preEventListResponse.data?.picksRevealed).toBe(false);
    const preEntries = preEventListResponse.data?.entries ?? [];
    const preMemberEntry = preEntries.find((entry) => entry.id === memberEntryId);
    const preCommissionerEntry = preEntries.find((entry) => entry.id === commissionerEntryId);
    expect(preMemberEntry?.picksCount).toBe(1);
    expect(preMemberEntry?.participants?.length).toBe(1);
    expect(preCommissionerEntry?.picksCount).toBe(1);
    expect(preCommissionerEntry?.participants).toBeUndefined();

    // Move contest past OPEN. Now member's perspective sees both squads' picks.
    await prisma.contest.update({
      where: { id: contestId },
      data: { status: ContestStatus.ACTIVE },
    });
    const postEventListResponse = await listContestEntriesOp({
      client: member.client,
      path: { contestId },
    });
    expect(postEventListResponse.data?.picksRevealed).toBe(true);
    const postEntries = postEventListResponse.data?.entries ?? [];
    expect(postEntries.find((entry) => entry.id === memberEntryId)?.participants?.length).toBe(1);
    expect(postEntries.find((entry) => entry.id === commissionerEntryId)?.participants?.length).toBe(1);
  });
});
