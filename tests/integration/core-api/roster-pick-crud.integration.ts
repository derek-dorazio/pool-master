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
  buildContestEligibleEventTiming,
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ParticipantType, Sport } from '@poolmaster/shared/domain';

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
  let entryLocksAt: string;

  beforeAll(async () => {
    const eventTiming = buildContestEligibleEventTiming();
    entryLocksAt = eventTiming.entryLocksAt.toISOString();
    const owner = await createTestUser({ displayName: 'Roster Pick CRUD Owner' });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: buildCreateLeaguePayload('Roster Pick CRUD League'),
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
        startDate: eventTiming.startDate,
        releaseAt: eventTiming.releaseAt,
        fieldLocksAt: eventTiming.fieldLocksAt,
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
          mode: 'GOLF_TIERED',
          locksAt: entryLocksAt,
          maxEntriesPerSquad: 1,
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
              endPosition: null,
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
