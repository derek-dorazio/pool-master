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
import type {
  ContestEntryResponse,
  ContestResponse,
  LeagueContextResponse,
} from '@poolmaster/shared/dto';
import { freshEventEdition } from '../../support/event-edition';

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
    const eventTiming = buildContestEligibleEventTiming();
    const owner = await createTestUser({ displayName: 'Roster Pick CRUD Owner' });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: buildCreateLeaguePayload('Roster Pick CRUD League'),
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json<LeagueContextResponse>().league.id;

    const prisma = getPrisma();
    const sport = await prisma.sport.create({
      data: {
        name: `Roster Pick CRUD Sport ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });

    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Tiger Roster Pick CRUD ${randomUUID().slice(0, 8)}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
        role: 'GOLFER',
        teamAffiliation: null,
      },
    });

    const sportEvent = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `roster-pick-crud-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: 'Roster Pick CRUD Event',
        startDate: eventTiming.startDate,
        status: 'SCHEDULED',
      },
    });

    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        isActive: true,
      },
    });
    sportEventParticipantId = sportEventParticipant.id;

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Roster Pick CRUD Contest',
        sportEventId: sportEvent.id,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        configuration: {
          maxEntriesPerSquad: 1,
          rosterSize: 1,
          countedScores: 1,
        },
      },
    });

    expect(contestRes.statusCode).toBe(201);
    contestId = contestRes.json<ContestResponse>().contest.id;

    // A new contest is a draft (#117); members enter only once it is opened to the league.
    const openRes = await getApp().inject({
      method: 'POST',
      url: `${API_ROUTES.contestManagement.detail(leagueId, contestId)}/open`,
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });
    expect(openRes.statusCode).toBe(200);

    const entryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });

    expect([200, 201]).toContain(entryRes.statusCode);
    entryId = entryRes.json<ContestEntryResponse>().entry.id;
  });

  it('creates, reads, updates, rejects duplicates, and deletes a roster pick', async () => {
    const prisma = getPrisma();

    const createdPick = await prisma.contestEntryPick.create({
      data: {
        entryId,
        sportEventParticipantId,
        draftRound: 1,
        draftPickNumber: 1,
        pickedAt: new Date('2026-04-10T12:05:00.000Z'),
        contestFormat: 'ROSTER',
        isAutoPicked: false,
      },
    });

    expect(createdPick.entryId).toBe(entryId);
    expect(createdPick.sportEventParticipantId).toBe(sportEventParticipantId);
    expect(createdPick.isAutoPicked).toBe(false);

    const readBack = await prisma.contestEntryPick.findUniqueOrThrow({
      where: { id: createdPick.id },
    });
    expect(readBack.id).toBe(createdPick.id);
    expect(await prisma.contestEntryPick.findMany({ where: { entryId } })).toHaveLength(1);

    const updatedPick = await prisma.contestEntryPick.update({
      where: { id: createdPick.id },
      data: {
        draftRound: 2,
        draftPickNumber: 3,
        isAutoPicked: true,
      },
    });

    expect(updatedPick.draftRound).toBe(2);
    expect(updatedPick.draftPickNumber).toBe(3);
    expect(updatedPick.isAutoPicked).toBe(true);

    await expect(
      prisma.contestEntryPick.create({
        data: {
          entryId,
          sportEventParticipantId,
          draftRound: 3,
          draftPickNumber: 4,
          pickedAt: new Date('2026-04-10T12:06:00.000Z'),
          contestFormat: 'ROSTER',
        isAutoPicked: false,
        },
      }),
    ).rejects.toMatchObject({
      code: 'P2002',
    });

    await prisma.contestEntryPick.delete({ where: { id: createdPick.id } });
    expect(await prisma.contestEntryPick.findUnique({ where: { id: createdPick.id } })).toBeNull();
    expect(await prisma.contestEntryPick.findMany({ where: { entryId } })).toHaveLength(0);
  });
});
