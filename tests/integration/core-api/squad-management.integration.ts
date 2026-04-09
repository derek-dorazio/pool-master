import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';

describe('squad management integration', () => {
  beforeAll(async () => {
    await setupIntegrationTests();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await teardownIntegrationTests();
  });

  it('creates, updates, lists, and manages squad co-managers', async () => {
    const prisma = getPrisma();
    const owner = await createTestUser({ displayName: 'Owner One' });
    const coManager = await createTestUser({ displayName: 'Co Manager' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: owner.headers,
      payload: {
        name: 'Squad League',
        visibility: 'PRIVATE',
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    const leagueId = leagueRes.json().league.id as string;

    await prisma.leagueMembership.create({
      data: {
        leagueId,
        userId: coManager.user.id,
        role: 'MEMBER',
        permissions: [],
      },
    });

    const createSquadRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/squads`,
      headers: owner.headers,
      payload: { name: 'Ace Squad' },
    });

    expect(createSquadRes.statusCode).toBe(201);
    expect(createSquadRes.json().squad.name).toBe('Ace Squad');
    expect(createSquadRes.json().squad.memberCount).toBe(1);
    const squadId = createSquadRes.json().squad.id as string;

    const listRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/squads`,
      headers: owner.headers,
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().squads).toHaveLength(1);

    const updateRes = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/leagues/${leagueId}/squads/${squadId}`,
      headers: owner.headers,
      payload: { name: 'Renamed Squad' },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().squad.name).toBe('Renamed Squad');

    const addRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/squads/${squadId}/members`,
      headers: owner.headers,
      payload: { userId: coManager.user.id },
    });

    expect(addRes.statusCode).toBe(201);
    expect(addRes.json().membership.userId).toBe(coManager.user.id);

    const detailRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/squads/${squadId}`,
      headers: owner.headers,
    });

    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().squad.memberCount).toBe(2);

    const removeCoManagerRes = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/leagues/${leagueId}/squads/${squadId}/members/${coManager.user.id}`,
      headers: withoutJsonBodyHeaders(owner.headers),
    });

    expect(removeCoManagerRes.statusCode).toBe(200);
    expect(removeCoManagerRes.json().membership.status).toBe('INACTIVE');

    const removeOwnerRes = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/leagues/${leagueId}/squads/${squadId}/members/${owner.user.id}`,
      headers: withoutJsonBodyHeaders(owner.headers),
    });

    expect(removeOwnerRes.statusCode).toBe(200);

    const finalDetailRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/squads/${squadId}`,
      headers: owner.headers,
    });

    expect(finalDetailRes.statusCode).toBe(200);
    expect(finalDetailRes.json().squad.status).toBe('INACTIVE');
    expect(finalDetailRes.json().squad.memberCount).toBe(0);
  });

  it('enforces one active squad per user per league', async () => {
    const owner = await createTestUser({ displayName: 'Owner One' });
    const member = await createTestUser({ displayName: 'Member Two' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: owner.headers,
      payload: {
        name: 'Uniqueness League',
        visibility: 'PRIVATE',
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    const leagueId = leagueRes.json().league.id as string;

    await getPrisma().leagueMembership.create({
      data: {
        leagueId,
        userId: member.user.id,
        role: 'MEMBER',
        permissions: [],
      },
    });

    const firstSquadRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/squads`,
      headers: owner.headers,
      payload: { name: 'First Squad' },
    });
    expect(firstSquadRes.statusCode).toBe(201);
    const firstSquadId = firstSquadRes.json().squad.id as string;

    const addMemberRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/squads/${firstSquadId}/members`,
      headers: owner.headers,
      payload: { userId: member.user.id },
    });
    expect(addMemberRes.statusCode).toBe(201);

    const secondSquadRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/squads`,
      headers: member.headers,
      payload: { name: 'Second Squad' },
    });

    expect(secondSquadRes.statusCode).toBe(400);
    expect(secondSquadRes.json().error).toContain('already belongs to a squad');
  });
});
