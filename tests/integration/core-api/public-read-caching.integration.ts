/**
 * #1181 — the public reads CloudFront keeps, against real Postgres and the routes as index.ts
 * registers them: which answers are public, that an admin save that lands clears what it
 * changed at the CDN and in this task's own cache, and that a refused one clears nothing.
 */
import { randomUUID } from 'node:crypto';
import type {
  ContestConfigTemplateListResponse,
  SportLeagueListResponse,
  SportLeagueResponse,
} from '@poolmaster/shared/dto';
import type { SettingsGroup } from '@poolmaster/shared/dto/settings.dto';
import {
  PRIVATE_CACHE_CONTROL,
  PUBLIC_CACHE_CONTROL,
  PublicReadPath,
} from '../../../packages/core-api/src/core/public-cache';
import { expectDefined } from '../../support/expect-defined';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getCdnInvalidations,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';

const createdSportLeagueIds: string[] = [];

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const series = { eventSeries: { sportLeagueId: { in: createdSportLeagueIds } } };
  await getPrisma().sportEventTier.deleteMany({ where: { sportEvent: series } });
  await getPrisma().sportEventRound.deleteMany({ where: { sportEvent: series } });
  await getPrisma().sportEvent.deleteMany({ where: series });
  await getPrisma().eventSeries.deleteMany({ where: { sportLeagueId: { in: createdSportLeagueIds } } });
  await getPrisma().sportLeague.deleteMany({ where: { id: { in: createdSportLeagueIds } } });
  await getPrisma().platformRuntimeConfigHistory.deleteMany({ where: { configKey: { in: ['PLAN_CONFIG', 'EMAIL_CONFIG'] } } });
  await getPrisma().platformRuntimeConfig.deleteMany({ where: { configKey: { in: ['PLAN_CONFIG', 'EMAIL_CONFIG'] } } });
  await teardownIntegrationTests();
});
beforeEach(async () => {
  await cleanupTestData();
  getCdnInvalidations().reset();
});

async function createSportLeague(headers: Record<string, string>): Promise<string> {
  const response = await getApp().inject({
    method: 'POST',
    url: '/api/v1/sport-leagues',
    headers,
    payload: { sport: 'GOLF', name: `Cache Tour ${randomUUID()}` },
  });
  expect(response.statusCode).toBe(201);
  const id = response.json<SportLeagueResponse>().sportLeague.id;
  createdSportLeagueIds.push(id);
  return id;
}

async function listGolfLeagueNames(): Promise<string[]> {
  const response = await getApp().inject({ method: 'GET', url: '/api/v1/sport-leagues?sport=GOLF' });
  return response.json<SportLeagueListResponse>().sportLeagues.map((league) => league.name);
}

describe('public read headers (#1181)', () => {
  it('serves the sport league list to a visitor with no session as public, and to a signed-in member as private', async () => {
    const member = await createTestUser({ displayName: 'Cache Header Member' });

    const anonymous = await getApp().inject({ method: 'GET', url: '/api/v1/sport-leagues' });
    const signedIn = await getApp().inject({ method: 'GET', url: '/api/v1/sport-leagues', headers: member.headers });

    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
  });

  it('serves the plans and the contest templates to a visitor with no session as public', async () => {
    const plans = await getApp().inject({ method: 'GET', url: '/api/v1/plans' });
    const templates = await getApp().inject({ method: 'GET', url: '/api/v1/contest-config-templates/?sport=GOLF' });

    expect(plans.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    expect(templates.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
  });

  it('never makes a member\'s own league list public', async () => {
    const member = await createTestUser({ displayName: 'Cache League Member' });

    const leagues = await getApp().inject({ method: 'GET', url: '/api/v1/leagues', headers: member.headers });

    expect(leagues.statusCode).toBe(200);
    expect(leagues.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
  });
});

describe('admin saves clear the public reads they change (#1181)', () => {
  it('a sport league rename clears the sport league list and the event pages at the CDN, and the next list read shows the new name', async () => {
    const admin = await createTestUser({ displayName: 'Cache Sport League Admin', isRootAdmin: true });
    const sportLeagueId = await createSportLeague(admin.headers);
    const before = await listGolfLeagueNames();
    getCdnInvalidations().reset();
    const renamed = `Renamed Cache Tour ${randomUUID()}`;

    const response = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/sport-leagues/${sportLeagueId}`,
      headers: admin.headers,
      payload: { name: renamed },
    });

    expect(response.statusCode).toBe(200);
    expect(getCdnInvalidations().paths()).toEqual([PublicReadPath.EVENT_PAGES, PublicReadPath.SPORT_LEAGUES]);
    expect(before).not.toContain(renamed);
    expect(await listGolfLeagueNames()).toContain(renamed);
  });

  it('a sport league write a member is refused clears nothing', async () => {
    const member = await createTestUser({ displayName: 'Cache Refused Member' });

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/sport-leagues',
      headers: member.headers,
      payload: { sport: 'GOLF', name: `Refused Tour ${randomUUID()}` },
    });

    expect(response.statusCode).toBe(403);
    expect(getCdnInvalidations().calls).toEqual([]);
  });

  it('a contest template update clears the templates and the event pages at the CDN, and the next list read shows it', async () => {
    const admin = await createTestUser({ displayName: 'Cache Template Admin', isRootAdmin: true });
    const listed = await getApp().inject({ method: 'GET', url: '/api/v1/contest-config-templates/?sport=GOLF' });
    const template = expectDefined(listed.json<ContestConfigTemplateListResponse>().templates.at(0), 'a golf template');
    const description = `Cached description ${randomUUID()}`;

    try {
      const response = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/contest-config-templates/${template.id}`,
        headers: admin.headers,
        payload: { description },
      });

      expect(response.statusCode).toBe(200);
      expect(getCdnInvalidations().paths()).toEqual([PublicReadPath.CONTEST_CONFIG_TEMPLATES, PublicReadPath.EVENT_PAGES]);
      const relisted = await getApp().inject({ method: 'GET', url: '/api/v1/contest-config-templates/?sport=GOLF' });
      const updated = relisted.json<ContestConfigTemplateListResponse>().templates.find((row) => row.id === template.id);
      expect(updated?.description).toBe(description);
    } finally {
      await getPrisma().contestConfigTemplate.update({ where: { id: template.id }, data: { description: template.description } });
    }
  });

  it('saving the plan settings clears the Plans page at the CDN; saving the email settings clears nothing', async () => {
    const admin = await createTestUser({ displayName: 'Cache Settings Admin', isRootAdmin: true });
    const read = async (key: string) => (await getApp().inject({ method: 'GET', url: `/api/v1/platform/settings/${key}`, headers: admin.headers })).json<SettingsGroup>();
    const save = (group: SettingsGroup) => getApp().inject({
      method: 'PUT',
      url: `/api/v1/platform/settings/${group.key}`,
      headers: admin.headers,
      payload: { key: group.key, value: group.value, expectedUpdatedAt: group.updatedAt },
    });

    expect((await save(await read('EMAIL_CONFIG'))).statusCode).toBe(200);
    expect(getCdnInvalidations().calls).toEqual([[]]);
    getCdnInvalidations().reset();

    expect((await save(await read('PLAN_CONFIG'))).statusCode).toBe(200);
    expect(getCdnInvalidations().paths()).toEqual([PublicReadPath.PLANS]);
  });

  it('resetting the plan settings clears the Plans page at the CDN', async () => {
    const admin = await createTestUser({ displayName: 'Cache Reset Admin', isRootAdmin: true });

    const response = await getApp().inject({ method: 'POST', url: '/api/v1/platform/settings/PLAN_CONFIG/reset', headers: withoutJsonBodyHeaders(admin.headers) });

    expect(response.statusCode).toBe(200);
    expect(getCdnInvalidations().paths()).toEqual([PublicReadPath.PLANS]);
  });

  it('an event created for a sport league clears the event pages at the CDN, since it can be the edition a page offers', async () => {
    const admin = await createTestUser({ displayName: 'Cache Event Admin', isRootAdmin: true });
    const sportLeagueId = await createSportLeague(admin.headers);
    getCdnInvalidations().reset();

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: admin.headers,
      payload: {
        name: `Cache Open ${randomUUID()}`,
        startDate: '2084-06-16T08:00:00.000Z',
        endDate: '2084-06-19T20:00:00.000Z',
        rounds: 4,
        sportLeagueId,
        eventYear: 2084,
        autoLifecycleEnabled: false,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(getCdnInvalidations().paths()).toEqual([PublicReadPath.EVENT_PAGES]);
  });
});
