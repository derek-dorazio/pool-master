/**
 * CRUD-style integration coverage for the core league lifecycle.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner user
 * - creates its own league
 * - lists the owner's leagues
 * - fetches league detail
 * - updates league settings
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { InvitePolicy, LeagueVisibility, WeekDay } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('League CRUD Integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'League CRUD Owner' });
    ownerHeaders = owner.headers;
  });

  it('creates, lists, fetches, and updates a league through real routes', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'League CRUD League',
        visibility: LeagueVisibility.PRIVATE,
        maxMembers: 12,
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdLeague = createRes.json().league;
    leagueId = createdLeague.id;
    expect(createdLeague.name).toBe('League CRUD League');
    expect(createdLeague.visibility).toBe(LeagueVisibility.PRIVATE);
    expect(createdLeague.maxMembers).toBe(12);

    const listRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.list,
      headers: ownerHeaders,
    });

    expect(listRes.statusCode).toBe(200);
    const leagues = listRes.json().leagues;
    expect(Array.isArray(leagues)).toBe(true);
    expect(leagues.some((league: { id: string }) => league.id === leagueId)).toBe(true);

    const detailRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.detail(leagueId),
      headers: ownerHeaders,
    });

    expect(detailRes.statusCode).toBe(200);
    const detailLeague = detailRes.json().league;
    expect(detailLeague.id).toBe(leagueId);
    expect(detailLeague.name).toBe('League CRUD League');
    expect(detailLeague.role).toBe('OWNER');

    const updateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.settings(leagueId),
      headers: ownerHeaders,
      payload: {
        invitePolicy: InvitePolicy.LINK_INVITE,
        weeklyRecapEnabled: true,
        weeklyRecapDay: WeekDay.FRIDAY,
        timezone: 'America/New_York',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const updatedLeague = updateRes.json().league;
    expect(updatedLeague.id).toBe(leagueId);
    expect(updatedLeague.invitePolicy).toBe(InvitePolicy.LINK_INVITE);
    expect(updatedLeague.settings.weeklyRecapEnabled).toBe(true);
    expect(updatedLeague.settings.weeklyRecapDay).toBe(WeekDay.FRIDAY);
    expect(updatedLeague.settings.timezone).toBe('America/New_York');
  });
});
