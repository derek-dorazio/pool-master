/**
 * CRUD-style integration coverage for roster picks.
 *
 * This suite stays close to the database because roster picks are now the
 * durable selection record for a contest entry. We create a real contest,
 * real entry, and real sport-event participant, then verify the row can be
 * created, updated, read back, rejected on uniqueness, and deleted.
 */
import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { LeagueVisibility, ParticipantType, Sport } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('RosterPick CRUD integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;
  let contestId: string;
  let entryId: string;
  let sportEventParticipantId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Roster Pick CRUD Owner' });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Roster Pick CRUD League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;

    const prisma = getPrisma();
    const sport = await prisma.sport.create({
      data: {
        name: `Roster Pick CRUD Sport ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        statSchema: {},
      },
    });

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Tiger Roster Pick CRUD ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
        metadata: {},
        position: 'GOLFER',
        teamAffiliation: null,
      },
    });

    const sportEvent = await prisma.sportEvent.create({
      data: {
        externalId: `roster-pick-crud-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: 'Roster Pick CRUD Event',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        status: 'ACTIVE',
      },
    });
    sportEventParticipantId = sportEventParticipant.id;

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contestManagement(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Roster Pick CRUD Contest',
        sportEventId: sportEvent.id,
        contestType: 'SINGLE_EVENT',
        configuration: {
          selectionType: 'BUDGET_PICK',
          rosterSize: 1,
          minimumEntries: 1,
          maxEntriesPerSquad: 1,
          budget: 1000,
          pricingMethod: 'FIXED_PRICE',
          participantScoringRules: [
            {
              participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
              sortOrder: 1,
              config: {},
              active: true,
            },
          ],
          entryAggregationRule: {
            aggregationDefinitionId: 'SUM_ALL_ENTRIES',
            config: {},
            active: true,
          },
          prizeDefinitions: [
            {
              prizeDefinitionId: 'FINAL_PLACE',
              displayName: 'Winner',
              sortOrder: 1,
              ruleConfig: { place: 1 },
              payoutType: 'FIXED_AMOUNT',
              amount: 100,
              active: true,
            },
          ],
        },
      },
    });

    expect(contestRes.statusCode).toBe(201);
    contestId = contestRes.json().contest.id;

    const entryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });

    expect([200, 201]).toContain(entryRes.statusCode);
    entryId = entryRes.json().entry.id;
  });

  it('creates, reads, updates, rejects duplicates, and deletes a roster pick', async () => {
    const prisma = getPrisma();

    const createdPick = await prisma.rosterPick.create({
      data: {
        entryId,
        sportEventParticipantId,
        draftRound: 1,
        draftPickNumber: 1,
        pickedAt: new Date('2026-04-10T12:05:00.000Z'),
        autoPicked: false,
      },
    });

    expect(createdPick.entryId).toBe(entryId);
    expect(createdPick.sportEventParticipantId).toBe(sportEventParticipantId);
    expect(createdPick.autoPicked).toBe(false);

    const readBack = await prisma.rosterPick.findUniqueOrThrow({
      where: { id: createdPick.id },
    });
    expect(readBack.id).toBe(createdPick.id);
    expect(await prisma.rosterPick.findMany({ where: { entryId } })).toHaveLength(1);

    const updatedPick = await prisma.rosterPick.update({
      where: { id: createdPick.id },
      data: {
        draftRound: 2,
        draftPickNumber: 3,
        autoPicked: true,
      },
    });

    expect(updatedPick.draftRound).toBe(2);
    expect(updatedPick.draftPickNumber).toBe(3);
    expect(updatedPick.autoPicked).toBe(true);

    await expect(
      prisma.rosterPick.create({
        data: {
          entryId,
          sportEventParticipantId,
          draftRound: 3,
          draftPickNumber: 4,
          pickedAt: new Date('2026-04-10T12:06:00.000Z'),
          autoPicked: false,
        },
      }),
    ).rejects.toMatchObject({
      code: 'P2002',
    });

    await prisma.rosterPick.delete({ where: { id: createdPick.id } });
    expect(await prisma.rosterPick.findUnique({ where: { id: createdPick.id } })).toBeNull();
    expect(await prisma.rosterPick.findMany({ where: { entryId } })).toHaveLength(0);
  });
});
