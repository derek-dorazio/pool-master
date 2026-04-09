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
import {
  ContestType,
  DraftStatus,
  InvitationStatus,
  LeagueVisibility,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Draft session CRUD integration', () => {
  let ownerHeaders: Record<string, string>;
  let memberHeaders: Record<string, string>;
  let contestId: string;
  let ownerEntryId: string;
  let memberEntryId: string;
  let availableParticipantIds: string[];

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Draft CRUD Owner' });
    const member = await createTestUser({ displayName: 'Draft CRUD Member' });
    ownerHeaders = owner.headers;
    memberHeaders = member.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Draft CRUD League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });
    const leagueId = leagueRes.json().league.id as string;

    const inviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: ownerHeaders,
      payload: { emails: [member.user.email] },
    });
    expect(inviteRes.statusCode).toBe(201);
    expect(inviteRes.json().sent[0].status).toBe(InvitationStatus.PENDING);

    const acceptRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: memberHeaders,
      payload: { inviteCode: inviteRes.json().sent[0].inviteCode },
    });
    expect(acceptRes.statusCode).toBe(201);

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Draft CRUD Contest',
        sport: 'GOLF',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.SNAKE_DRAFT,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        contestConfiguration: {
          rounds: 2,
          timePerPickSeconds: 60,
        },
      },
    });
    expect(contestRes.statusCode).toBe(201);
    contestId = contestRes.json().contest.id;

    const ownerEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });
    ownerEntryId = ownerEntryRes.json().entry.id as string;

    const memberEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(memberHeaders),
    });
    memberEntryId = memberEntryRes.json().entry.id as string;

    const prisma = getPrisma();
    const sport = await prisma.sport.create({
      data: {
        name: `DraftCrudSport-${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        statSchema: {},
      },
    });
    const event = await prisma.sportEvent.create({
      data: {
        externalId: `draft-crud-event-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: 'GOLF',
        name: 'Draft CRUD Event',
        startDate: new Date('2026-04-20T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });

    await prisma.contest.update({
      where: { id: contestId },
      data: {
        sportEventId: event.id,
        selectionType: SelectionType.SNAKE_DRAFT,
      },
    });

    const participantRows = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        prisma.participant.create({
          data: {
            sportId: sport.id,
            name: `Draft CRUD Player ${n}-${randomUUID().slice(0, 4)}`,
            participantType: 'INDIVIDUAL',
            externalIds: {},
            metadata: {},
            position: 'GOLFER',
          },
        }),
      ),
    );

    const eventParticipants = await Promise.all(
      participantRows.map((participant, index) =>
        prisma.sportEventParticipant.create({
          data: {
            sportEventId: event.id,
            participantId: participant.id,
            status: 'ACTIVE',
            valuations: {
              create: {
                price: 1000 + index * 100,
                orderIndex: index + 1,
                valuationSource: 'integration-test',
              },
            },
          },
        }),
      ),
    );
    availableParticipantIds = eventParticipants.map((row) => row.id);
  });

  it('creates and reads a snake draft session', async () => {
    const startRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.drafts.start(contestId),
      headers: ownerHeaders,
      payload: {
        entryIds: [ownerEntryId, memberEntryId],
        rounds: 2,
        timePerPickSeconds: 60,
        availableParticipantIds,
        autoPickPolicy: 'BEST_AVAILABLE',
      },
    });

    expect(startRes.statusCode).toBe(201);
    expect(startRes.json().contestId).toBe(contestId);
    expect(startRes.json().status).toBe(DraftStatus.LIVE);
    expect(startRes.json().draftPickHistories).toEqual([]);

    const stateRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.drafts.state(contestId),
      headers: ownerHeaders,
    });

    expect(stateRes.statusCode).toBe(200);
    expect(stateRes.json().contestId).toBe(contestId);
    expect(stateRes.json().currentPickNumber).toBe(1);
    expect(stateRes.json().entries).toHaveLength(2);
  });

  it('rejects duplicate draft session creation for the same contest', async () => {
    const startAgainRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.drafts.start(contestId),
      headers: ownerHeaders,
      payload: {
        entryIds: [ownerEntryId, memberEntryId],
        rounds: 2,
        timePerPickSeconds: 60,
        availableParticipantIds,
        autoPickPolicy: 'BEST_AVAILABLE',
      },
    });

    expect(startAgainRes.statusCode).toBe(409);
    expect(startAgainRes.json()).toMatchObject({
      error: 'DRAFT_EXISTS',
    });
  });

  it('enforces entry ownership and returns not-found for unknown contest state', async () => {
    const forbiddenPickRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.drafts.pick(contestId),
      headers: memberHeaders,
      payload: {
        entryId: ownerEntryId,
        participantId: availableParticipantIds[0],
      },
    });
    expect(forbiddenPickRes.statusCode).toBe(403);

    const pickRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.drafts.pick(contestId),
      headers: ownerHeaders,
      payload: {
        entryId: ownerEntryId,
        participantId: availableParticipantIds[0],
      },
    });
    expect(pickRes.statusCode).toBe(200);
    expect(pickRes.json().draftPickHistories).toHaveLength(1);
    expect(pickRes.json().status).toBe(DraftStatus.LIVE);

    const missingStateRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.drafts.state(randomUUID()),
      headers: ownerHeaders,
    });
    expect(missingStateRes.statusCode).toBe(404);
    expect(missingStateRes.json()).toMatchObject({
      error: 'CONTEST_NOT_FOUND',
    });
  });
});
